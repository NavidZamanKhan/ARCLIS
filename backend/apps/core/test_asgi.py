from asgiref.testing import ApplicationCommunicator
from django.test import SimpleTestCase, override_settings
from django.urls import path

from config.routing import build_websocket_application


async def websocket_fixture(scope, receive, send):
    if (await receive())["type"] == "websocket.connect":
        await send({"type": "websocket.accept"})
        await receive()


@override_settings(FRONTEND_ORIGINS=["http://localhost:5173"])
class WebSocketRoutingTests(SimpleTestCase):
    async def exchange(self, route, origin=None):
        app = build_websocket_application([path("fixture/", websocket_fixture)])
        headers = [] if origin is None else [(b"origin", origin)]
        connection = ApplicationCommunicator(
            app, {"type": "websocket", "path": route, "headers": headers}
        )
        try:
            await connection.send_input({"type": "websocket.connect"})
            message = await connection.receive_output()
            await connection.send_input({"type": "websocket.disconnect", "code": 1000})
            await connection.wait()
            return message
        finally:
            connection.stop()

    async def test_allowed_origin_reaches_registered_route(self):
        message = await self.exchange("/fixture/", b"http://localhost:5173")

        self.assertEqual(message["type"], "websocket.accept")

    async def test_different_origin_cannot_reach_registered_route(self):
        for origin in (
            b"http://localhost:5174",
            b"https://localhost:5173",
            b"http://sub.localhost:5173",
        ):
            with self.subTest(origin=origin):
                message = await self.exchange("/fixture/", origin)
                self.assertEqual(message["type"], "websocket.close")

    async def test_missing_origin_is_rejected(self):
        message = await self.exchange("/fixture/")

        self.assertEqual(message["type"], "websocket.close")

    async def test_unregistered_route_closes_cleanly(self):
        message = await self.exchange("/unknown/", b"http://localhost:5173")

        self.assertEqual(message, {"type": "websocket.close", "code": 4404})
