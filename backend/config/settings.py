import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from django.core.management.utils import get_random_secret_key

from .origins import parse_frontend_origins

BASE_DIR = Path(__file__).resolve().parent.parent
DEBUG = os.environ.get("DJANGO_DEBUG") == "1"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured("Set DJANGO_SECRET_KEY when debug mode is off.")
    SECRET_KEY = get_random_secret_key()

ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get(
        "DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost,[::1]"
    ).split(",")
    if host.strip()
]

FRONTEND_ORIGINS = parse_frontend_origins(
    os.environ.get(
        "DJANGO_FRONTEND_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173" if DEBUG else "",
    )
)
CORS_ALLOWED_ORIGINS = FRONTEND_ORIGINS
CORS_URLS_REGEX = r"^/api/v1/"

INSTALLED_APPS = ["apps.core", "channels", "corsheaders", "rest_framework"]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
]
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "UNAUTHENTICATED_USER": None,
    "EXCEPTION_HANDLER": "apps.core.api_errors.api_exception_handler",
}

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.environ.get("DJANGO_SQLITE_PATH") or BASE_DIR / "db.sqlite3",
    }
}
