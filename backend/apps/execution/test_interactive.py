import asyncio
import json
import os
from contextlib import asynccontextmanager
from threading import Event
from unittest import skipUnless
from unittest.mock import patch

from asgiref.testing import ApplicationCommunicator
from django.test import SimpleTestCase, override_settings
from django.urls import reverse

from config.routing import build_websocket_application

from .interaction import MAX_INPUT_CHUNK, MAX_STDIN_BYTES, InputRejected, Interaction
from .sessions import SUBPROTOCOL, SessionRegistry
from .states import ExecutionState
from .test_sessions import REQUEST

ORIGIN = "http://localhost:5173"
PROGRAMS = [
    (
        "c", "main.c", {},
        r"""
#include <stdio.h>
#include <string.h>
int main(void) {
    char first[64], second[64];
    fputs("first?", stdout); fflush(stdout);
    if (!fgets(first, sizeof first, stdin)) return 1;
    fputs("second?", stdout); fflush(stdout);
    if (!fgets(second, sizeof second, stdin)) return 2;
    first[strcspn(first, "\n")] = 0;
    second[strcspn(second, "\n")] = 0;
    printf("%s:%s\n", first, second);
}
""",
    ),
    (
        "cpp", "main.cpp", {},
        """
#include <iostream>
#include <string>
int main() {
    std::string first, second;
    std::cout << "first?" << std::flush;
    if (!std::getline(std::cin, first)) return 1;
    std::cout << "second?" << std::flush;
    if (!std::getline(std::cin, second)) return 2;
    std::cout << first << ':' << second << std::endl;
}
""",
    ),
    (
        "java", "Main.java", {"main_class": "Main"},
        """
import java.io.*;
class Main {
    public static void main(String[] args) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
        System.out.print("first?"); System.out.flush();
        String first = in.readLine();
        System.out.print("second?"); System.out.flush();
        String second = in.readLine();
        System.out.println(first + ":" + second);
    }
}
""",
    ),
    ("python", "main.py", {}, "a=input('first?'); b=input('second?'); print(a+':'+b)"),
]


class InteractionLimitTests(SimpleTestCase):
    def test_input_budget_and_output_backpressure_are_bounded(self):
        interaction = Interaction(b"x" * MAX_STDIN_BYTES)
        self.assertEqual(len(interaction.read_input()), MAX_STDIN_BYTES)
        with self.assertRaises(InputRejected):
            interaction.send_input(b"x")

        for _ in range(interaction.events.maxsize + 1):
            interaction.emit("stdout", b"x")
        self.assertEqual(interaction.events.qsize(), interaction.events.maxsize)
        self.assertEqual(interaction.interruption(), ExecutionState.RESOURCE_LIMIT_EXCEEDED)


class SocketFixture:
    async def create(self, request):
        response = await self.async_client.post(
            reverse("create_execution"), request, content_type="application/json",
            headers={"Origin": ORIGIN},
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    @asynccontextmanager
    async def socket(self, info, *, token=None, origin=ORIGIN, client="127.0.0.1"):
        protocols = [SUBPROTOCOL, "owner." + (token if token is not None else info["owner_token"])]
        communicator = ApplicationCommunicator(
            build_websocket_application(),
            {
                "type": "websocket", "path": info["websocket_path"],
                "headers": [(b"origin", origin.encode())],
                "client": (client, 12345), "subprotocols": protocols,
            },
        )
        await communicator.send_input({"type": "websocket.connect"})
        try:
            yield communicator
        finally:
            await communicator.send_input({"type": "websocket.disconnect", "code": 1000})
            await communicator.wait()


@override_settings(LOCAL_EXECUTION_ENABLED=True, FRONTEND_ORIGINS=[ORIGIN])
class SocketTests(SocketFixture, SimpleTestCase):
    async def test_wrong_owner_origin_and_remote_client_cannot_connect(self):
        registry = SessionRegistry()
        with patch("apps.execution.api.sessions", registry), patch("apps.execution.consumer.sessions", registry):
            info = await self.create(REQUEST)
            for options in (
                {"token": "invalid-owner"},
                {"origin": "https://invalid.test"},
                {"client": "192.0.2.3"},
            ):
                async with self.socket(info, **options) as socket:
                    close = await socket.receive_output(timeout=3)
                    self.assertEqual(close["type"], "websocket.close")
            self.assertIsNotNone(registry.claim(info["id"], info["owner_token"]))
            registry.finish(info["id"])


async def send_json(socket, packet):
    await socket.send_input({"type": "websocket.receive", "text": json.dumps(packet)})


async def receive_until(socket, messages, predicate):
    async with asyncio.timeout(15):
        while not predicate():
            event = await socket.receive_output(timeout=12)
            if event["type"] != "websocket.send":
                raise AssertionError(f"Unexpected WebSocket event: {event}")
            message = json.loads(event["text"])
            messages.append(message)
            if message["type"] == "result" and not predicate():
                raise AssertionError(f"Execution ended before the expected event: {messages}")


def stream(messages, kind):
    return "".join(event["data"] for event in messages if event["type"] == kind)


@skipUnless(os.environ.get("ARCLIS_TEST_WORKER") == "1", "Requires rootless Docker and images")
@override_settings(LOCAL_EXECUTION_ENABLED=True, FRONTEND_ORIGINS=[ORIGIN])
class InteractiveWorkerTests(SocketFixture, SimpleTestCase):
    async def accepted(self, socket):
        accepted = await socket.receive_output(timeout=3)
        self.assertEqual(accepted["type"], "websocket.accept")
        self.assertEqual(accepted["subprotocol"], SUBPROTOCOL)

    async def terminal(self, socket, messages, state):
        await receive_until(socket, messages, lambda: any(m["type"] == "result" for m in messages))
        result = [m for m in messages if m["type"] == "result"]
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["state"], state, messages)
        self.assertEqual((await socket.receive_output(timeout=3))["type"], "websocket.close")
        return result[0]

    async def test_four_languages_stream_two_prompts_and_receive_two_inputs(self):
        for language, path, options, code in PROGRAMS:
            with self.subTest(language=language):
                info = await self.create({
                    "language": language, "entry_file": path, "files": [{"path": path, "content": code}],
                    **options,
                })
                async with self.socket(info) as socket:
                    await self.accepted(socket)
                    messages = []
                    for prompt, answer in (("first?", "one\n"), ("second?", "two\n")):
                        await receive_until(socket, messages, lambda: prompt in stream(messages, "stdout"))
                        await send_json(socket, {"type": "stdin", "data": answer})
                    result = await self.terminal(socket, messages, "COMPLETED")
                    self.assertEqual(result["exit_code"], 0)
                    self.assertEqual(stream(messages, "stdout"), "first?second?one:two\n")
                    states = [m["state"] for m in messages if m["type"] == "status"]
                    self.assertEqual(states, ["PREPARING", "COMPILING", "RUNNING"])

    async def test_initial_input_and_eof_deliver_buffered_text(self):
        payload = {
            **REQUEST,
            "stdin": "initial:",
            "files": [{"path": "main.py", "content": "import sys; print(sys.stdin.read())"}],
        }
        async with self.socket(await self.create(payload)) as socket:
            await self.accepted(socket)
            await send_json(socket, {"type": "stdin", "data": "messages"})
            await send_json(socket, {"type": "eof"})
            messages = []
            await self.terminal(socket, messages, "COMPLETED")
            self.assertEqual(stream(messages, "stdout"), "initial:messages\n")

    async def test_bad_message_and_repeat_cancellation_emit_one_result(self):
        payload = {**REQUEST, "files": [{"path": "main.py", "content": "input('ready?')"}]}
        async with self.socket(await self.create(payload)) as socket:
            await self.accepted(socket)
            messages = []
            await receive_until(socket, messages, lambda: "ready?" in stream(messages, "stdout"))
            await send_json(socket, {"type": "stdin", "data": "x" * (MAX_INPUT_CHUNK + 1)})
            await receive_until(socket, messages, lambda: any(m["type"] == "error" for m in messages))
            self.assertIn("stdin_rejected", [m.get("code") for m in messages])
            await send_json(socket, {"type": "cancel"})
            await send_json(socket, {"type": "cancel"})
            await self.terminal(socket, messages, "CANCELLED")

    async def test_disconnect_returns_slot_after_worker_cleanup(self):
        registry = SessionRegistry(running=1)
        finished = Event()
        finish = registry.finish

        def observe_finish(session_id):
            finish(session_id)
            finished.set()

        payload = {**REQUEST, "files": [{"path": "main.py", "content": "input('ready?')"}]}
        with (
            patch("apps.execution.api.sessions", registry),
            patch("apps.execution.consumer.sessions", registry),
            patch.object(registry, "finish", side_effect=observe_finish),
        ):
            async with self.socket(await self.create(payload)) as socket:
                await self.accepted(socket)
                messages = []
                await receive_until(socket, messages, lambda: "ready?" in stream(messages, "stdout"))
            self.assertTrue(await asyncio.to_thread(finished.wait, 12))

    async def test_inactive_program_times_out(self):
        payload = {**REQUEST, "files": [{"path": "main.py", "content": "input('ready?')"}]}
        with patch(
            "apps.execution.consumer.Interaction",
            side_effect=lambda initial: Interaction(initial, idle_seconds=0.4),
        ):
            async with self.socket(await self.create(payload)) as socket:
                await self.accepted(socket)
                await self.terminal(socket, [], "TIMEOUT")

    async def test_diagnostics_and_runtime_stderr_stream_separately(self):
        invalid = {
            "language": "c", "entry_file": "main.c",
            "files": [{"path": "main.c", "content": "int main( {"}],
        }
        async with self.socket(await self.create(invalid)) as socket:
            await self.accepted(socket)
            messages = []
            await self.terminal(socket, messages, "COMPILATION_FAILED")
            self.assertIn("error:", stream(messages, "diagnostics"))
            self.assertEqual(stream(messages, "stdout") + stream(messages, "stderr"), "")

        source = (
            "import os,time; os.write(1, bytes([226])); time.sleep(.1); "
            "os.write(1, bytes([130,172])); os.write(2, b'error fixture')"
        )
        payload = {**REQUEST, "files": [{"path": "main.py", "content": source}]}
        async with self.socket(await self.create(payload)) as socket:
            await self.accepted(socket)
            messages = []
            await self.terminal(socket, messages, "COMPLETED")
            self.assertEqual(stream(messages, "stdout"), "€")
            self.assertEqual(stream(messages, "stderr"), "error fixture")
            self.assertEqual(stream(messages, "diagnostics"), "")

    async def test_completion_and_cancel_race_publish_one_terminal_result(self):
        payload = {**REQUEST, "files": [{"path": "main.py", "content": "print(input('ready?'))"}]}
        async with self.socket(await self.create(payload)) as socket:
            await self.accepted(socket)
            messages = []
            await receive_until(socket, messages, lambda: "ready?" in stream(messages, "stdout"))
            await send_json(socket, {"type": "stdin", "data": "finished\n"})
            await send_json(socket, {"type": "cancel"})
            await receive_until(socket, messages, lambda: any(m["type"] == "result" for m in messages))
            result = [m for m in messages if m["type"] == "result"]
            self.assertEqual(len(result), 1)
            self.assertIn(result[0]["state"], ("CANCELLED", "COMPLETED"))
            self.assertEqual((await socket.receive_output(timeout=3))["type"], "websocket.close")
