import os

from channels.routing import ProtocolTypeRouter
from django.core.asgi import get_asgi_application

from .routing import build_websocket_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

application = ProtocolTypeRouter(
    {
        "http": get_asgi_application(),
        "websocket": build_websocket_application(),
    }
)
