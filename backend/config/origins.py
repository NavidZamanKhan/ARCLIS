from urllib.parse import urlsplit

from django.core.exceptions import ImproperlyConfigured


def parse_frontend_origins(value):
    origins = []
    for origin in value.split(","):
        origin = origin.strip()
        if not origin:
            continue

        try:
            parsed = urlsplit(origin)
            if (
                parsed.scheme in ("http", "https")
                and parsed.hostname
                and not parsed.hostname.startswith(".")
                and parsed.username is None
                and "*" not in origin
                and not any(character.isspace() for character in origin)
                and origin == f"{parsed.scheme}://{parsed.netloc}"
                and (parsed.port is None or parsed.port > 0)
                and not parsed.netloc.endswith(":")
            ):
                origins.append(origin)
                continue
        except ValueError:
            pass

        raise ImproperlyConfigured(
            "DJANGO_FRONTEND_ORIGINS must contain explicit HTTP(S) origins."
        )
    return origins
