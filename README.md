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
python backend/manage.py runserver 127.0.0.1:8000
```

The local environment file is ignored by Git. Load it only after checking its
contents, since `source` executes it as a shell script.

| Setting | Behavior |
| --- | --- |
| `DJANGO_DEBUG` | Set to `1` for local development. Otherwise debug mode is off. |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated host names. Defaults to `127.0.0.1,localhost,[::1]`. |
| `DJANGO_SECRET_KEY` | Required with debug mode off. Debug mode generates an ephemeral key if this setting is empty. |
| `DJANGO_SQLITE_PATH` | Optional SQLite path. Defaults to `backend/db.sqlite3`. |

## Health endpoint

With the server running, open `http://127.0.0.1:8000/api/v1/health/` or run:

```bash
curl -i http://127.0.0.1:8000/api/v1/health/
```

`GET /api/v1/health/` returns HTTP 200 with `{"status": "ok"}`. The endpoint
checks that Django can handle a request and works without a database connection.
