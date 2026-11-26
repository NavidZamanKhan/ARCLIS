from channels.routing import URLRouter
from channels.security.websocket import OriginValidator
from django.conf import settings
from django.urls import re_path


async def close_unrouted_websocket(scope, receive, send):
    if (await receive())["type"] == "websocket.connect":
        await send({"type": "websocket.close", "code": 4404})


def build_websocket_application(routes=()):
    router = URLRouter([*routes, re_path(r"^", close_unrouted_websocket)])
    return OriginValidator(router, settings.FRONTEND_ORIGINS)
