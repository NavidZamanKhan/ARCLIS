# ARCLIS

Advanced Runtime and Compiler Lab for Interactive Study

## Run the Django backend locally

From the repository root in Ubuntu under WSL 2, with Python 3.12 and its venv module installed:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
if [ ! -e .env ]; then cp .env.example .env; fi
set -a
source ./.env
set +a
python backend/manage.py check
(cd backend && python manage.py test)
python -m uvicorn --app-dir backend config.asgi:application --host 127.0.0.1 --port 8000 --ws websockets-sansio
```

The local environment file is ignored by Git. Load it only after checking its
contents, since `source` executes it as a shell script.

| Setting | Behavior |
| --- | --- |
| `DJANGO_DEBUG` | Set to `1` for local development. Otherwise debug mode is off. |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated host names. Defaults to `127.0.0.1,localhost,[::1]`. |
| `DJANGO_FRONTEND_ORIGINS` | Comma-separated browser origins for API CORS and WebSocket handshakes. Debug defaults to `http://localhost:5173,http://127.0.0.1:5173`. Outside debug mode, the default is an empty allowlist. Use exact HTTP(S) origins without paths or wildcards. |
| `DJANGO_SECRET_KEY` | Required with debug mode off. Debug mode generates an ephemeral key if this setting is empty. |
| `DJANGO_SQLITE_PATH` | Optional SQLite path. Defaults to `backend/db.sqlite3`. |

## Health endpoint

With the server running, open `http://127.0.0.1:8000/api/v1/health/` or run:

```bash
curl -i http://127.0.0.1:8000/api/v1/health/
```

`GET /api/v1/health/` returns HTTP 200 with `{"status": "ok"}`. The endpoint
checks that Django can handle a request and works without a database connection.

## API capabilities and errors

`GET /api/v1/capabilities/` lists the language identifiers used by the project
and reports whether execution, interactive input, and analysis are available.
The availability flags are currently all false.

DRF endpoints use JSON. Raised request errors preserve their HTTP status and
return `{"error": {"code": "...", "details": {...}}}`. For endpoints that accept
data, use a DRF serializer with `is_valid(raise_exception=True)`. Validation
errors use the `validation_error` code and return field or non-field errors
under `details`. Malformed JSON uses `parse_error`, and internal errors return
a generic message. The Django health endpoint retains its existing contract.

## ASGI and WebSocket routing

Uvicorn serves the Django HTTP application and routes WebSocket handshakes
through the configured origin allowlist. Every unregistered WebSocket path is
rejected during the handshake. The WebSocket test fixture is defined only in
the test suite. Interactive execution routes will be added in their own stage.
