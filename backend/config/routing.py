from channels.routing import URLRouter
from channels.security.websocket import OriginValidator
from django.conf import settings
from django.urls import re_path


async def close_unrouted_websocket(scope, receive, send):
    if (await receive())["type"] == "websocket.connect":
        await send({"type": "websocket.close", "code": 4404})


def build_websocket_application(routes=None):
    if routes is None:
        from apps.execution.consumer import ExecutionConsumer

        routes = [
            re_path(
                r"^ws/executions/(?P<session_id>[A-Za-z0-9_-]{24})/$",
                ExecutionConsumer.as_asgi(),
            )
        ]
    router = URLRouter([*routes, re_path(r"^", close_unrouted_websocket)])
    return OriginValidator(router, settings.FRONTEND_ORIGINS)
