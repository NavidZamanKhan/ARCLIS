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

## Local execution worker

The synchronous internal worker supports trusted toolchain adapters and
fixtures. Use it from Ubuntu under WSL 2 or Linux with a local rootless Docker
Engine, builtin seccomp, and systemd cgroup v2 CPU, memory, swap, and PID
controllers. The worker connects to the current Linux user's rootless Unix
socket. Web execution remains unavailable until the execution integration stages.

Build the three images from the repository root:

```bash
(
  set -e
  docker build --file docker/toolchains.Dockerfile --target c-cpp \
    --tag arclis-toolchain-c-cpp:s04 docker
  for target in java python; do
    docker build --file docker/toolchains.Dockerfile --target "$target" \
      --tag "arclis-toolchain-$target:s03" docker
  done
)
```

The base image is pinned by digest. Toolchain packages come from Ubuntu's
signed repositories. The worker uses the local images during jobs.

Each job stages up to 50 UTF-8 source files totaling 1 MiB. Paths are relative
POSIX paths with ASCII letters, digits, underscores, hyphens, and periods in
their segments and a supported source or header extension. Input is mounted
read-only. The writable scratch area is a size-limited tmpfs. Jobs run as
UID/GID 65534 with no network, no capabilities, no privilege escalation, and
a read-only root filesystem. The Docker socket stays with the orchestrator.

Default per-job limits are one CPU, 256 MiB RAM with zero swap, 64 processes,
32 MiB of scratch space, 256 KiB of combined output, and 15 seconds for
compilation, execution, and output capture. The worker reports that elapsed interval, in
milliseconds. Workspace preparation and Docker cleanup are outside that
interval. A local operator should investigate any reported cleanup
failure using the job ID and the container label `org.arclis.worker=local`.

After loading the development environment as above, run the Docker integration
tests with:

```bash
(cd backend && ARCLIS_TEST_WORKER=1 python manage.py test)
```

These tests use controlled fixtures. Public anonymous execution and production
isolation verification are separate blueprint milestones.

### C and C++ adapters

Back-end callers use `apps.execution.native.run_native` with
`NativeLanguage.C` or `NativeLanguage.CPP`, a sequence of `SourceFile` objects,
and optional `stdin` bytes. Buffered stdin accepts up to 64 KiB and ends at EOF.

The C adapter builds all submitted `.c` files with GCC in C17 mode and accepts
`.h` headers. The C++ adapter builds all `.cc`, `.cpp`, and `.cxx` files with
G++ in C++17 mode and accepts `.h`, `.hh`, `.hpp`, and `.hxx` headers.
Extensions are case-sensitive. Supply at least one translation unit and one
entry point across the selected sources. Includes can resolve relative to
each source or to the workspace root.

Compiler and linker diagnostics are returned as bytes in
`ExecutionResult.compiler_diagnostics`. Program stdout, stderr, and exit code
are in `ExecutionResult.outcome`. Diagnostics and both output streams share one
byte budget. Compiler failure has state `COMPILATION_FAILED` and no program
exit code. A running program that returns a nonzero exit has state
`RUNTIME_FAILED` and preserves its exit code.
