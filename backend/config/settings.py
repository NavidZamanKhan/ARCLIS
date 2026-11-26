import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from django.core.management.utils import get_random_secret_key

from .origins import parse_frontend_origins

BASE_DIR = Path(__file__).resolve().parent.parent
RESTRICTED_DEPLOYMENT = os.environ.get("ARCLIS_RESTRICTED_DEPLOYMENT") == "1"
DEBUG = not RESTRICTED_DEPLOYMENT and os.environ.get("DJANGO_DEBUG") == "1"
LOCAL_EXECUTION_ENABLED = DEBUG and os.environ.get("ARCLIS_ENABLE_LOCAL_EXECUTION") == "1"
LOCAL_ANALYSIS_ENABLED = DEBUG and os.environ.get("ARCLIS_ENABLE_LOCAL_ANALYSIS") == "1"
if RESTRICTED_DEPLOYMENT:
    secret_path = os.environ.get("DJANGO_SECRET_KEY_FILE")
    if not secret_path:
        raise ImproperlyConfigured("Set DJANGO_SECRET_KEY_FILE for the restricted deployment.")
    try:
        SECRET_KEY = Path(secret_path).read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError) as error:
        raise ImproperlyConfigured("The deployment secret file could not be read.") from error
    if len(SECRET_KEY) < 50 or len(set(SECRET_KEY)) < 5 or SECRET_KEY.startswith("django-insecure-"):
        raise ImproperlyConfigured("Generate a strong secret for the restricted deployment.")
else:
    SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
    if not SECRET_KEY and not DEBUG:
        raise ImproperlyConfigured("Set DJANGO_SECRET_KEY when debug mode is off.")
    if not SECRET_KEY:
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

if RESTRICTED_DEPLOYMENT:
    # The private backend receives this header exclusively from the TLS proxy.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = True
    SECURE_HSTS_SECONDS = 300
    CSRF_COOKIE_SECURE = True

INSTALLED_APPS = ["apps.core", "channels", "corsheaders", "rest_framework"]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
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
