import asyncio
import codecs
import json
import logging
from queue import Empty

from channels.generic.websocket import AsyncWebsocketConsumer

from .api import local_execution_allowed
from .interaction import InputRejected, Interaction
from .sessions import SUBPROTOCOL, SessionCapacityError, sessions
from .states import ExecutionState

MAX_MESSAGE_BYTES = 24 * 1024
logger = logging.getLogger(__name__)


class ExecutionConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.interaction = None
        self.closed = False
        self.finished = False
        client = self.scope.get("client")
        protocols = self.scope.get("subprotocols", ())
        tokens = [protocol.removeprefix("owner.") for protocol in protocols
                  if protocol.startswith("owner.")]
        if (
            not client or not local_execution_allowed(client[0])
            or SUBPROTOCOL not in protocols or len(tokens) != 1
        ):
            await self.close(code=4404)
            return
        try:
            session = sessions.claim(self.scope["url_route"]["kwargs"]["session_id"], tokens[0])
        except SessionCapacityError:
            await self.close(code=4429)
            return
        if session is None:
            await self.close(code=4404)
            return

        self.interaction = Interaction(session.stdin)
        self.input_order = asyncio.Lock()
        try:
            await self.accept(subprotocol=SUBPROTOCOL)
        except BaseException:
            sessions.finish(session.id)
            raise
        self.stream = asyncio.create_task(self._stream(session))

    async def receive(self, text_data=None, bytes_data=None):
        if self.interaction is None or self.closed or self.finished:
            return
        async with self.input_order:
            if not self.closed and not self.finished:
                await self._receive_message(text_data)

    async def _receive_message(self, text_data):
        request_id = None
        try:
            if (
                text_data is None or len(text_data) > MAX_MESSAGE_BYTES
                or len(text_data.encode("utf-8")) > MAX_MESSAGE_BYTES
            ):
                raise ValueError
            message = json.loads(text_data)
            if not isinstance(message, dict):
                raise ValueError
            if "request_id" in message:
                request_id = message.pop("request_id")
                if (
                    type(request_id) is not int or not 1 <= request_id <= 2**53 - 1
                    or message.get("type") not in ("stdin", "eof")
                ):
                    raise ValueError
            if message == {"type": "cancel"}:
                if self.interaction.stop():
                    await self._send_packet({"type": "status", "state": ExecutionState.CANCELLING})
            elif message == {"type": "eof"}:
                self.interaction.end_input()
            elif set(message) == {"type", "data"} and message["type"] == "stdin":
                if not isinstance(message["data"], str):
                    raise ValueError
                self.interaction.send_input(message["data"].encode("utf-8"))
            else:
                raise ValueError
            if request_id is not None:
                await self._send_packet({"type": "input_ack", "request_id": request_id})
        except InputRejected as error:
            reply = {"type": "error", "code": "stdin_rejected", "message": str(error)}
            if request_id is not None:
                reply["request_id"] = request_id
            await self._send_packet(reply)
        except (ValueError, RecursionError):
            await self._send_packet(
                {"type": "error", "code": "invalid_message", "message": "Invalid execution message."}
            )

    async def disconnect(self, close_code):
        self.closed = True
        if self.interaction is not None:
            self.interaction.stop()

    def _execute(self, session):
        try:
            return session.job.run(interaction=self.interaction)
        except Exception:
            logger.exception("Unexpected local execution worker failure.")
            return None
        finally:
            sessions.finish(session.id)

    async def _stream(self, session):
        decoders = {name: codecs.getincrementaldecoder("utf-8")(errors="replace")
                    for name in ("stdout", "stderr", "diagnostics")}
        worker = asyncio.create_task(asyncio.to_thread(self._execute, session))
        try:
            while not self.closed and (not worker.done() or not self.interaction.events.empty()):
                try:
                    kind, data = self.interaction.events.get_nowait()
                except Empty:
                    await asyncio.sleep(0.015)
                    continue
                async with self.input_order:
                    if kind == "status":
                        await self._send_packet({"type": "status", "state": data})
                    else:
                        text = decoders[kind].decode(data)
                        if text:
                            await self._send_packet({"type": kind, "data": text})
            result = await asyncio.shield(worker)
            async with self.input_order:
                self.finished = True
            if self.closed:
                return
            for kind, decoder in decoders.items():
                text = decoder.decode(b"", final=True)
                if text:
                    await self._send_packet({"type": kind, "data": text})
            outcome = result.outcome if result is not None else None
            packet = {
                "type": "result",
                "state": outcome.state if outcome else ExecutionState.INTERNAL_ERROR,
                "exit_code": outcome.exit_code if outcome else None,
                "execution_time_ms": outcome.duration_ms if outcome else 0,
            }
            if packet["state"] == ExecutionState.INTERNAL_ERROR:
                packet["message"] = "The local execution worker failed."
                if outcome and outcome.error_code == "worker_unavailable":
                    packet["code"] = outcome.error_code
                    packet["message"] = (
                        "The local execution worker is unavailable. Check rootless Docker and the toolchain image."
                    )
            if await self._send_packet(packet):
                await self.close()
        finally:
            self.interaction.stop()

    async def _send_packet(self, packet):
        if self.closed:
            return False
        try:
            await asyncio.wait_for(self.send(text_data=json.dumps(packet)), timeout=2)
        except (OSError, RuntimeError, TimeoutError):
            self.closed = True
            self.interaction.stop()
            return False
        return True
