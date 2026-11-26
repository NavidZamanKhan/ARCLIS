from channels.routing import URLRouter
from channels.security.websocket import OriginValidator
from django.conf import settings
from django.urls import re_path


async def close_unrouted_websocket(scope, receive, send):
    if (await receive())["type"] == "websocket.connect":
        await send({"type": "websocket.close", "code": 4404})


async def websocket_health(scope, receive, send):
    if (await receive())["type"] == "websocket.connect":
        await send({"type": "websocket.accept"})
        await send({"type": "websocket.send", "text": '{"status":"ok"}'})
        await send({"type": "websocket.close", "code": 1000})


def build_websocket_application(routes=None):
    if routes is None:
        from apps.execution.consumer import ExecutionConsumer

        routes = [
            re_path(
                r"^ws/executions/(?P<session_id>[A-Za-z0-9_-]{24})/$",
                ExecutionConsumer.as_asgi(),
            )
        ]
        if settings.RESTRICTED_DEPLOYMENT:
            routes.append(re_path(r"^ws/health/$", websocket_health))
    router = URLRouter([*routes, re_path(r"^", close_unrouted_websocket)])
    return OriginValidator(router, settings.FRONTEND_ORIGINS)
