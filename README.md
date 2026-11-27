# ARCLIS

Advanced Runtime and Compiler Lab for Interactive Study

ARCLIS is a browser IDE for C, C++, Java, and Python with an interactive
console and a compiler-phase inspector. The educational C analyzer exposes
tokens, a syntax tree, symbols, diagnostics, and three-address intermediate
code. Run uses the language's native toolchain inside a local sandbox.

- [Start the full local workspace](#start-the-full-local-workspace) for editing, Run, and Analyze.
- [Run the restricted HTTPS deployment](#run-the-restricted-https-deployment) for the editor and workspace with the worker features disabled.
- [Architecture and API contract](docs/architecture.md) covers the components, supported C grammar, and runtime boundaries.
- [Presentation and viva notes](docs/presentation.md) walk through the runnable examples in [`examples/`](examples/).
- [Final verification](docs/verification.md) records the checks and known limits.

## Start the full local workspace

Use Ubuntu 24.04 on Linux or WSL 2, Git, Python 3.12 with `venv`, Node.js
24.15 or later in the Node 24 line, and a recent Chromium browser. For Run
and Analyze, use rootless Docker Engine with builtin seccomp, systemd cgroup
v2, and working CPU, memory, swap, and PID controllers. GNU Make, a C17
compiler, Flex, and Bison 3.8 or later are needed for the separate C command-line
build. Execution toolchains come from the images built below.

In an Ubuntu terminal, clone the repository and prepare the five images and
backend dependencies. The commands use the currently configured rootless daemon.

```bash
git clone https://github.com/NavidZamanKhan/ARCLIS.git
cd ARCLIS
systemctl --user start docker
docker info --format '{{.CgroupDriver}} / cgroup v{{.CgroupVersion}}'
(
  set -e
  for target in c-cpp java python; do
    docker build --file docker/toolchains.Dockerfile --target "$target" \
      --tag "arclis-toolchain-$target:s06" docker
  done
  docker build --file docker/analyzer.Dockerfile \
    --tag arclis-toolchain-c-analyzer:s18 compiler_engine/c
  docker build --file docker/toolchains.Dockerfile --target python-analyzer \
    --tag arclis-toolchain-python-analyzer:s19 docker
)
```

After the images build, install the backend and start the loopback server.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
if [ ! -e .env ]; then cp .env.example .env; fi
set -a
source ./.env
set +a
ARCLIS_ENABLE_LOCAL_EXECUTION=1 ARCLIS_ENABLE_LOCAL_ANALYSIS=1 \
  python -m uvicorn --app-dir backend config.asgi:application --host 127.0.0.1 --port 8000 \
  --workers 1 --no-proxy-headers --ws websockets-sansio --ws-max-size 24576 --ws-max-queue 16
```

In a second Ubuntu terminal, use the [frontend commands](#run-the-frontend-locally),
then open `http://127.0.0.1:5173`. Check the backend at
`http://127.0.0.1:8000/api/v1/health/` and inspect
`/api/v1/capabilities/` on the same backend if the worker features are unavailable.
Dependency versions are pinned in [`backend/requirements.txt`](backend/requirements.txt)
and locked in [`frontend/package-lock.json`](frontend/package-lock.json).

## Run the restricted HTTPS deployment

This profile serves the Vite production build with Nginx and runs Django
through Uvicorn on a private Docker network. The demo listens on loopback at
`https://localhost:8443`. It supports editing and workspace persistence in the
browser. The deployment disables execution and analysis even if their local
opt-ins are set. Use the development setup below for compiler features.

From the repository root on Linux or Ubuntu under WSL 2, start rootless
Docker Engine with systemd cgroup v2 and Docker Compose. Generate a Django
key and a 30-day localhost TLS certificate on the Linux filesystem:

```bash
export ARCLIS_DEPLOY_SECRETS_DIR="$HOME/.local/share/arclis-demo"
(
  set -eu
  umask 077
  install -d -m 700 "$ARCLIS_DEPLOY_SECRETS_DIR"
  cd "$ARCLIS_DEPLOY_SECRETS_DIR"
  if [ ! -e django.key ]; then openssl rand -hex 32 > django.key; fi
  if [ ! -e localhost.key ] && [ ! -e localhost.crt ]; then
    openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj /CN=localhost \
      -addext 'subjectAltName=DNS:localhost' \
      -addext 'basicConstraints=critical,CA:FALSE' \
      -addext 'extendedKeyUsage=serverAuth' \
      -addext 'keyUsage=critical,digitalSignature,keyEncipherment' \
      -keyout localhost.key -out localhost.crt
  fi
  chmod 444 django.key localhost.key localhost.crt
)
docker compose -f deployment/compose.yaml up --build --wait
```

Keep the secrets directory at mode `0700`. Compose mounts the files read-only
in the service that uses them. Mode `0444` lets the non-root processes read
their mounts, and the host directory restricts access to its owner. Keep the
directory outside the checkout. [Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/)

The certificate is self-signed. Verify its fingerprint with
`openssl x509 -in "$ARCLIS_DEPLOY_SECRETS_DIR/localhost.crt" -noout -fingerprint -sha256`
when trusting it for a local browser session. With the backend virtual
environment active, run the deployment smoke check with certificate validation:

```bash
python deployment/smoke.py "$ARCLIS_DEPLOY_SECRETS_DIR/localhost.crt"
docker compose -f deployment/compose.yaml exec backend python manage.py check --deploy
docker compose -f deployment/compose.yaml ps
docker compose -f deployment/compose.yaml logs --tail=50
```

The smoke check verifies the port 8080 redirect, HTTPS headers, host and origin
policy, HTTP health and capabilities, the 2 MiB body limit, disabled worker
routes, and the `/ws/health/` WSS handshake. The health socket sends one JSON
status and closes. Django reports HSTS subdomain and preload warnings for
this localhost profile. The five-minute HSTS policy applies to the demo host.
[Django deployment checks](https://docs.djangoproject.com/en/5.2/ref/checks/#security)

Both services have health checks, log rotation, and CPU, memory, and PID
limits. Nginx limits API and WebSocket traffic to 10 requests per second per
source address with a burst of 20, and up to 12 concurrent requests or
connections in those routes. Rootless loopback forwarding may group clients
under one address. `compose ps` reports service health, and `compose logs`
shows startup failures and request status. The backend uses an in-memory
SQLite database. The frontend stores projects in the current browser origin.

On WSL 2, keep an Ubuntu terminal open while using the demo. Run
`docker compose -f deployment/compose.yaml wait` in that terminal to tie its
lifetime to the containers. [WSL service lifecycle](https://learn.microsoft.com/en-us/windows/wsl/systemd/#how-does-enabling-systemd-affect-wsl-architecture)

Stop the demo with `docker compose -f deployment/compose.yaml down`. Keep the
certificate and key pair together when renewing them and recreate the edge
container to load the renewed files. Public execution requires dedicated
worker infrastructure and a separate isolation review, as described below.

## Run the frontend locally

Open an Ubuntu WSL login shell with Node.js 24.15 or later in the Node 24
line. From the repository root:

```bash
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173` and choose C, C++, Java, or Python in **Quick Run**.
Each language starts with a blank draft on the first visit. ARCLIS creates
the source filename automatically. For Java, use a class named `Main` without
a package declaration. The browser restores each language's last draft and
selection. Use **Examples** to insert a sample explicitly.

The editor suggests keywords, common library names, snippets, and words from
the current file. Press **Ctrl+Space** to open suggestions and **Tab** to
accept one. In Java, type **sout** and press **Tab** to insert
`System.out.println();` with the cursor inside the parentheses.

Start the [loopback backend](#interactive-sessions-on-loopback), then press
**Ctrl+Enter** or select **Run**. ARCLIS submits the current editor contents
to `http://127.0.0.1:8000`.
When the program prompts, type at the cursor in **Console** and press Enter.
Pasted text appears one line at a time as you submit it. Use Ctrl+D or **Send EOF** to
close standard input after sending the staged text. **Stop** cancels the run.
An interactive run times out after 30 seconds without submitted input or
program output. Flush prompts from your program when it writes them without
a line break. **Build log** shows
compiler messages and links recognized errors to the source. **Execution
details** shows the result, exit code when available, and duration. If the
backend is offline or execution is disabled, start the enabled loopback
backend and use **View → Retry services**. A worker startup error is a
separate result. Check rootless Docker and the requested toolchain image.

Open **Projects** to access files, folders, uploads, and multi-file runs. A
saved workspace from an earlier version opens here with its files, tabs, and
entry selection. A new project starts empty. Use the plus button or a file's
context menu to manage files. The browser stores Projects and Quick Run drafts
in separate IndexedDB records. Download a project file to keep a separate
copy of its current contents.

**Run** follows the open runnable source file. While editing a header, the
project uses its selected entry file. Choosing an **Execution target** in
the inspector or a file's context menu opens that source. A project with
one runnable file uses it automatically. C and C++ runs compile compatible
sources in the entry file's folder and can include headers from the workspace. Java uses the
entry file's folder path and filename to derive its main class. Java and
Python runs include project files of the selected language. Uploads accept
UTF-8 source files, up to 1 MiB per upload and 50 source files per project.

The navigator's **Search** finds text across open and closed project files.
Select a result to jump to its match. **Issues** shows recognized GCC, G++,
javac, and Python compiler diagnostics at their source locations and marks
them in the editor. A changed or renamed file marks its old issues as stale.
Diagnostics without a column jump to the start of the reported line. The
full compiler output remains in **Build log**.

The inspector's **File** view shows the current path, encoding, size, and line
count. **Build** shows the selected target's toolchain and sandbox limits
alongside the latest execution status. Use Ctrl or Cmd with Shift+F for
workspace search, S to flush pending saves, Enter to run, and Shift+Enter
to stop.

The editor header opens Find, Replace, and Go to line. Use Ctrl+M to toggle
whether Tab indents or moves focus. **View → Editor preferences** opens the
saved editor settings. In Projects, the toolbar toggles all three panels.
Drag a separator or focus it and use the arrow keys to resize its panel.
Home and End move the panel to its minimum and maximum sizes. Narrow
windows stack the panels vertically.

The View menu opens the design system preview or resets the workspace layout
after confirmation. Graphite and Silver work in both views, and the browser
saves the selected theme locally. The workspace editor accepts Monaco
diagnostic markers keyed by filename. Run and Analyze attach supported
diagnostics to the submitted editor snapshot.

Run `npm test` for frontend tests and `npm run build` to produce
`frontend/dist/`, including Monaco's worker. The theme tokens, including the
syntax palette, live in `frontend/src/styles/tokens.css`.

## Run the educational C lexer in WSL

From the repository root, build the scanner with GNU Flex, Make, and a C17
compiler. Pass the path to a C source file or pipe source through stdin.

```bash
make -C compiler_engine/c build/arclis-lex
printf 'int main(void) { return 0; }\n' | compiler_engine/c/build/arclis-lex
compiler_engine/c/build/arclis-lex path/to/source.c
make -C compiler_engine/c test
```

The command emits one JSON record per token or error, followed by an EOF
record. Each record has a kind, lexeme and end-exclusive range. Lines and
UTF-8 byte columns start at 1. Byte offsets start at 0. CRLF and bare CR each
count as one newline, tabs count as one byte, and a leading UTF-8 BOM affects
the byte offsets alone. Invalid UTF-8 bytes in diagnostic lexemes are escaped
in the JSON.

The scanner recognizes the basic C types and control-flow keywords, `static`,
ASCII identifiers, C-style numeric and quoted literals, operators, delimiters,
comments, and simple quoted or angle-bracket includes. Includes are emitted as
tokens, and the lexer reports unsupported directives, malformed literals, and
unexpected characters. The command exits with 0 for successful tokenization,
1 for lexical diagnostics, or 2 for a command or I/O error. This scanner is
part of the educational compiler and runs independently of native execution.
## Run the educational C syntax analyzer in WSL

The syntax analyzer builds on the scanner and requires GNU Bison 3.8 or
later. It accepts files or stdin through the same command convention.

~~~bash
make -C compiler_engine/c
compiler_engine/c/build/arclis-parse path/to/source.c
printf 'int main(void) { return 1 + 2 * 3; }\n' | compiler_engine/c/build/arclis-parse
make -C compiler_engine/c test
~~~

The grammar covers simple global and local declarations, function prototypes
and definitions, blocks, if/else, while, for, return, and file-scope includes.
Expressions support calls, parentheses, increment and decrement, arithmetic,
comparisons, logical operators, assignment, and comma expressions. Assignment
groups from the right. Arithmetic groups from the left within each precedence
level. An else attaches to the closest unmatched if. The analyzer also accepts
empty or comment-only files.

The parser emits JSON Lines diagnostics with lexical or syntax phases and the
same source range format as the scanner. A final syntax-result record includes
validity and the diagnostic count. It exits with 0 for valid syntax, 1 for
invalid syntax, or 2 for a driver or parser resource error. Pointer declarators,
arrays, member access, and other unsupported syntax produce diagnostics.
Use `--semantic` to add type and scope checks.

Make writes the Bison state report to compiler_engine/c/build/parser.output.
The build treats unresolved shift/reduce and reduce/reduce conflicts as errors.
The test target uses Python 3 and runs scanner, parser, AST, semantic, and IR fixtures.

### Print the abstract syntax tree

~~~bash
compiler_engine/c/build/arclis-parse --ast path/to/source.c
printf 'int main(void) { return 1 + 2 * 3; }\n' | compiler_engine/c/build/arclis-parse --ast
~~~

Successful runs add one JSON Lines record with `kind: "ast"` and a
`root` Program node. The final syntax-result record uses the same format
as the syntax-only command. Failed parses emit diagnostics and the final
result. AST mode limits input to 1 MiB, trees to 4,096 nodes, and nesting
to 128 nodes along any branch. The node and input limits bound JSON size.

Every node has `kind` and an end-exclusive `range` in lexer coordinates.
The Program spans the full input, including leading and trailing layout.
Lists preserve source order. Optional children and unnamed parameters
use JSON null. Literal text preserves source spelling and escape sequences.

| Node kind | Additional JSON fields |
| --- | --- |
| Program, Block | `items` |
| IncludeDirective | `text` |
| FunctionDeclaration | `name`, `returnType`, `static`, `parameters`, `body` |
| Parameter | `type`, `name` |
| VariableDeclaration | `type`, `static`, `declarators` |
| Declarator | `name`, `initializer` |
| Assignment, BinaryExpression | `operator`, `left`, `right` |
| UnaryExpression | `operator`, `operand`, `postfix` |
| Identifier | `name` |
| Literal | `literalKind`, `text` |
| StringLiteral | `segments`, an ordered list of string Literal nodes |
| CallExpression | `callee`, `arguments` |
| IfStatement | `condition`, `thenBranch`, `elseBranch` |
| WhileStatement | `condition`, `body` |
| ForStatement | `initializer`, `condition`, `step`, `body` |
| ReturnStatement, ParenthesizedExpression, ExpressionStatement | `expression` |
| EmptyStatement | Contains the common node fields |

### Check types and scopes

```bash
compiler_engine/c/build/arclis-parse --semantic path/to/source.c
printf 'int twice(int n) { return n * 2; }\n' | compiler_engine/c/build/arclis-parse --semantic
```

This mode uses the AST input, node, and depth limits. After the syntax-result
record, it emits source-located diagnostics with `phase: "semantic"`, one
`symbols` record, and a final `semantic-result` with `valid` and `diagnostics`.
The symbol table is available even when the semantic pass finds errors. A
failed parse skips the pass and sets the semantic result's `valid` field to
null. Exit codes are 0 for success, 1 for source errors, and 2 for input or
resource errors.

The `symbols` record contains ordered `scopes` and `symbols` arrays. Scope
IDs are one-based. Each scope includes its kind, parent's ID (null at file
scope), and source range. Each symbol includes its name, kind, type, scope ID,
static flag, and first declaration range. `definitionRange` identifies the
explicit definition when one exists. It is null for prototype-only functions,
prototype parameters, and objects with only tentative declarations. Function
symbols also include `parameterTypes`. Entries follow source order and
compatible redeclarations keep the original entry.

Declarations become visible in source order. A function definition shares its
outer block scope with its parameters. Nested blocks and `for` loops can
shadow outer names. Compatible file-scope declarations share a symbol. The
pass checks numeric conversions, modifiable assignment targets, operators,
conditions, the count and types of call arguments, and return statements.

The educational subset treats both `()` and `(void)` as zero parameters.
Include directives are preserved by the parser. Header contents, implicit
library declarations, constant initializer rules, and return-path analysis
are outside this pass. String literals support truth tests and comparisons
with other string literals. Numeric types accept numeric values.

### Generate three-address intermediate code

```bash
compiler_engine/c/build/arclis-parse --ir path/to/source.c
printf 'int f(void) { return 1 + 2 * 3; }\n' | compiler_engine/c/build/arclis-parse --ir
```

This mode emits the same syntax, diagnostics, and symbol records as
`--semantic`. A successful analysis adds an `ir` record and an `ir-result`
with `generated: true`. Lexical, syntax, or semantic errors leave only
`ir-result` with `generated: false` after the analysis records. Exit codes
and AST limits are the same as in semantic mode. Instructions are built
within a bounded buffer before serialization.

Each instruction has `op` and an end-exclusive source `range`. The
`initializers` array contains zero-initialized storage and explicit
initialization for file-scope and block-static objects. The `instructions`
array contains function bodies. `function` and `end-function` delimit each
definition. Prototypes are represented in the symbol table. An explicit
`return` supplies its value or null for a void return.

| Instructions | Operands and fields |
| --- | --- |
| `global`, `local`, `function`, `end-function` | `symbol` |
| `parameter` | `symbol`, zero-based `index` |
| `load`, `store` | `result` and `source`, or `target` and `value` |
| `binary`, `unary` | `result`, `operator`, and `left` and `right` or `operand` |
| `move`, `truth` | `result`, `value` |
| `label`, `jump` | `label` or `target` |
| `branch-zero`, `branch-nonzero` | `value`, `target`. The other path falls through. |
| `argument`, `call` | `callSite` links indexed argument `value`s to a `callee`, `argumentCount`, and optional `result`. |
| `return` | `value` |

Operands distinguish temporary results, symbols, and literals. Symbol IDs
are one-based positions in the preceding `symbols` array. Temporary, label,
and call-site IDs are unique within their own sequences. Literal operands
retain their spelling. Concatenated strings carry an ordered `segments`
array. Stores, parameters, and returns use the declared types in the symbol
table to describe conversions. The generator uses left-to-right order when
the subset leaves evaluation order unspecified, and emits branches to
preserve `&&` and `||` short-circuiting. The output is an educational
representation of the analyzed source for inspection.

## Analyze C in the workspace

Build the analyzer image on the rootless Docker worker in Ubuntu under WSL 2.
Run these commands from the repository root with the backend environment loaded.

```bash
docker build --file docker/analyzer.Dockerfile \
    --tag arclis-toolchain-c-analyzer:s18 compiler_engine/c
ARCLIS_ENABLE_LOCAL_ANALYSIS=1 python -m uvicorn --app-dir backend \
    config.asgi:application --host 127.0.0.1 --port 8000 --no-proxy-headers
```

Open a C source or header in the workspace and select **Analyze**. The right
inspector shows tokens, the AST, symbols, diagnostics, and intermediate code.
Expand AST nodes to see their children and select a result to jump to its
source range. Diagnostics also appear in Monaco. Editing, renaming, or
deleting the analyzed file marks its snapshot stale and clears its markers.
**Run** uses the native toolchain for the Quick Run language or project entry.

For a complete report, try `int main(void) { return 1 + 2 * 3; }` in a C
buffer. The starter sample calls `printf` through a system header. The
educational analyzer reads a single buffer and reports undeclared names
from headers as semantic diagnostics.

`POST /api/v1/analysis/` accepts a JSON `source` string and optional `language`
(`c` by default, or `python`). Successful requests
return HTTP 200 with `syntax_valid`, `semantic_valid`, `tokens`, `ast`,
`scopes`, `symbols`, `diagnostics`, and `ir`. This includes source with
diagnostics. An unavailable AST or IR is null. The local DEBUG opt-in and
origin checks apply independently from execution. The endpoint analyzes up to
64 KiB of UTF-8 source, with one in-flight worker per backend process, a
5-second analyzer deadline, and a 2 MiB combined worker output limit. The
compiler still applies its AST node and nesting limits. A size or resource
limit receives a structured error.

The dedicated container uses the scanner and `arclis-parse --analysis`, which
collects AST, semantics, and IR in one parse. It reads a fixed, read-only input
file and starts no submitted program.

### Analyze Python in the workspace

Build the dedicated Python 3.12 analyzer image from the repository root.

```bash
docker build --file docker/toolchains.Dockerfile --target python-analyzer \
    --tag arclis-toolchain-python-analyzer:s19 docker
```

Use the same loopback backend opt-in, open a `.py` file, and select **Analyze**.
The inspector labels these results **Native Python 3.12**. Tokens and the AST
come from `tokenize` and `ast`, with original UTF-8 source ranges. Symbols and
scope flags come from `symtable`. Python symbol rows jump to their owning
scope. Native compiler checks report invalid constructs such as a module-level
`return`. The analyzer operates on the editor's UTF-8 buffer. Intermediate
code is available for educational C analysis. C++ and Java use compiler
diagnostics from **Run**.

On the local toolchains, G++ returned JSON compiler diagnostics and a class
layout dump, and `javac -Xprint` returned type and member declarations. These
outputs cover parts of the analysis workflow. The workspace analysis service
currently supports C and Python reports.

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
python -m uvicorn --app-dir backend config.asgi:application --host 127.0.0.1 --port 8000 \
  --workers 1 --no-proxy-headers --ws websockets-sansio --ws-max-size 24576 --ws-max-queue 16
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
| `ARCLIS_ENABLE_LOCAL_EXECUTION` and `ARCLIS_ENABLE_LOCAL_ANALYSIS` | Independent opt-ins for debug mode on loopback. The restricted deployment turns both off. |

## Health endpoint

With the server running, open `http://127.0.0.1:8000/api/v1/health/` or run:

```bash
curl -i http://127.0.0.1:8000/api/v1/health/
```

`GET /api/v1/health/` returns HTTP 200 with `{"status": "ok"}`. The endpoint
checks that Django can handle a request and works without a database connection.

## API capabilities and errors

`GET /api/v1/capabilities/` lists the language identifiers used by the project
and reports whether execution, interactive input, and analysis are available
to the requesting client. The enabled loopback development server can provide
interactive execution and analysis. When analysis is enabled, `analysis.languages`
lists its supported languages.

DRF endpoints use JSON. Raised request errors preserve their HTTP status and
return `{"error": {"code": "...", "details": {...}}}`. For endpoints that accept
data, use a DRF serializer with `is_valid(raise_exception=True)`. Validation
errors use the `validation_error` code and return field or non-field errors
under `details`. Malformed JSON uses `parse_error`, and internal errors return
a generic message. The Django health endpoint retains its existing contract.

## Workspace shortcuts, templates, and test cases

- In Projects, press Ctrl+P or Cmd+P for **Quick Open**. Filter by filename or path, move
  with the arrow keys, and press Enter to open the selected file.
- Press Shift+F10 on a navigator row to open its file menu. Source files can
  be selected as the execution target. Files and folders support **Copy Path**.
- Choose a **Two-number sum** template in **New File** to create a C, C++, Java,
  or Python exercise. The dialog defaults to a dedicated folder and selects the
  new source as the execution target.
- For a two-number sum template, select a case in **Debug → Test cases** and choose **Run case**. The app sends
  the predefined input and EOF, then compares displayed stdout with the expected
  output, including line breaks. See program output in **Console** and compiler
  messages in **Build log**.
- In the **File** inspector, adjust font size, word wrap, minimap, line numbers,
  and indentation. **Reset editor preferences** restores the defaults.
- **Reset Workspace** starts empty by default and offers **Restore sample files**. Confirming
  clears the current execution and analysis and preserves editor preferences.

## Run the browser integration suite

Run this suite in Ubuntu under WSL 2 with the backend Python virtual
environment active and the rootless Docker engine available. Build the
C/C++, Java, and Python execution images, plus the C and Python analyzer
images, using the commands in this README.

```bash
cd frontend
npm ci
npx playwright install chromium --only-shell
npm run test:e2e
```

The command builds the frontend and starts a Vite preview on loopback port
5173 and Uvicorn on loopback port 8000. Both ports need to be free. Playwright
uses fresh browser contexts, enables the local API opt-ins for the suite,
and stops both servers on exit. Failure screenshots are written to
`frontend/test-results/`.

The suite exercises all four languages from a blank Quick Run draft and in
multi-file projects. It tests direct console entry, pasted lines, EOF, exact
source submission after edits, separate draft recovery, compiler and runtime
errors, cancellation, service failures, and the C and Python analysis inspectors.

The S21 verification on Ubuntu 24.04 under WSL 2 passed all 11 browser
workflows twice with `npm run test:e2e -- --repeat-each=2`. The same checkout
passed all 85 Docker-enabled Django tests, 37 frontend tests, 55 compiler
fixtures, and two C API tests. Both preview servers shut down, and the rootless
Docker job containers and temporary workspaces were cleared.

S20 added six browser workflows for the runnable templates and test cases,
keyboard navigation, path copying, workspace reset, and editor preferences.
All 17 browser workflows passed together.

## ASGI and WebSocket routing

Uvicorn serves the Django HTTP application and routes WebSocket handshakes
through the configured origin allowlist. Unregistered WebSocket paths are
rejected during the handshake.

## Local execution worker

The synchronous internal worker supports trusted toolchain adapters and
fixtures. Use it from Ubuntu under WSL 2 or Linux with a local rootless Docker
Engine, builtin seccomp, and systemd cgroup v2 CPU, memory, swap, and PID
controllers. The worker connects to the current Linux user's rootless Unix socket.

Build the three images from the repository root:

```bash
(
  set -e
  for target in c-cpp java python; do
    docker build --file docker/toolchains.Dockerfile --target "$target" \
      --tag "arclis-toolchain-$target:s06" docker
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

Default non-interactive execution limits are one CPU, 256 MiB RAM (384 MiB
for Java), zero swap, 64 processes, 32 MiB of scratch space, 256 KiB of
combined output, and 15 seconds for compilation, execution, and output
capture. The worker reports that elapsed interval in
milliseconds. Workspace preparation and Docker cleanup are outside that
interval. The worker retries unconfirmed container removal once. If cleanup
still fails, it returns an internal error and logs the job ID. Local operators
can use the job ID and the label `org.arclis.worker=local` to investigate.

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

### Java adapter

Back-end callers use `apps.execution.java.run_java` with the fully qualified
main class, the submitted `SourceFile` objects, and optional buffered stdin.
For example, `lab.Main` uses `lab/Main.java` with a `package lab;` declaration.
Use case-sensitive `.java` paths with ASCII identifiers starting with a letter
or underscore. The adapter compiles all submitted Java sources with annotation
processing disabled and runs the selected class from job-local scratch.

Java defaults to 384 MiB of container memory with a minimum of 192 MiB. The
compiler and runtime each limit their heap to one third of that container
budget. They share the job's time and output budgets.

### Python adapter

Back-end callers use `apps.execution.python.run_python` with an exact submitted
`.py` entry path, the submitted `SourceFile` objects, and optional buffered
stdin. The adapter syntax-checks every submitted file before executing the
entry with CPython. Syntax errors return `COMPILATION_FAILED` with diagnostics.
Uncaught runtime exceptions return `RUNTIME_FAILED` with the program's stderr
and exit code.

Imports can use the entry file's directory, the workspace root, and the
standard library. The interpreter starts with a clean environment, site
packages disabled, and bytecode writes disabled.

### Interactive sessions on loopback

After building all `:s06` images and loading the local development settings,
set `ARCLIS_ENABLE_LOCAL_EXECUTION=1` and start Uvicorn with the loopback,
single-worker, and proxy-header options above. Keep this service local. The
execution flag is off by default and requires Django debug mode.

Send a JSON `POST /api/v1/executions/` using the following shape. Java also
requires `main_class` and a matching entry path. An optional `stdin` field
queues text before the first WebSocket message.

```json
{
  "language": "python",
  "entry_file": "main.py",
  "files": [{"path": "main.py", "content": "print(input('Name? '))"}],
  "interactive": true
}
```

The HTTP 201 response contains `id`, `owner_token`, `websocket_path`, and
`expires_in`. Open the returned path using the WebSocket subprotocols
`["arclis.v1", "owner.<owner_token>"]` from a configured frontend origin.
The server selects `arclis.v1`. Keep the owner token out of URLs and logs.
The token can claim the session once, within 30 seconds. The job starts
after the socket accepts, so the client can receive the first prompt.

| Direction | Messages |
| --- | --- |
| Client | `{"type":"stdin","data":"Ada\n"}`, `{"type":"eof"}`, `{"type":"cancel"}` |
| Server | `status` with `state`, `diagnostics`/`stdout`/`stderr` with UTF-8 `data`, `error` with `code` and `message`, and one terminal `result` with `state`, `exit_code`, and `execution_time_ms` |

Flush prompts in the program before reading input. Stdin is a pipe, and the
streams are decoded as UTF-8 with replacement for invalid bytes. The worker
bounds compile time, total interactive time (120 seconds), runtime inactivity
(30 seconds), output, and input (4 KiB per message, 64 KiB per job). The
server admits up to eight unclaimed sessions and two active jobs. Disconnect
and cancellation stop the job and trigger container and workspace cleanup.

### S22 worker audit

On Ubuntu 24.04 under WSL 2 with rootless Docker 29.10.1 and systemd cgroup
v2, trusted fixtures verified CPU throttling, memory and swap limits,
process creation limits, combined output limits, timeouts, and cleanup. The
fixtures also confirmed loopback-only container networking, read-only root and
source mounts, bounded scratch space, non-root execution, seccomp, and the
absence of the Docker socket and a synthetic host environment marker.
[Rootless cgroup requirements](https://docs.docker.com/engine/security/rootless/tips/#limiting-resources)

The backend and browser regressions cover one-time session ownership, origin and
loopback checks, invalid paths and workspace collisions, bounded request and
input handling, cancellation, and disconnect cleanup. With Django debug mode
off and both local opt-ins set, capabilities reported both features disabled,
execution and analysis POSTs returned 404, and an execution WebSocket handshake
was rejected. Health remained available.

Public code execution remains disabled. The verified rootless containers
share the worker host's Linux kernel, and the session capacity limits apply
to a single process. The public deployment gate requires evaluating stronger
isolation such as gVisor or microVMs on dedicated worker infrastructure,
with resource and admission quotas, monitoring, and cleanup verification on
that infrastructure. [gVisor security model](https://gvisor.dev/docs/architecture_guide/security/)

The deployment profile needs HTTPS and WSS, an explicit host and origin
policy, and an upstream request-body limit because Django's ASGI handler can
buffer the body before the endpoint parser runs. Django's deployment check on
the local settings reported clickjacking, CSRF, HSTS, and HTTPS redirect
warnings. Review the applicable controls at the production application and
proxy before exposing the service. [Django deployment checklist](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/)

#### Local execution timings

On the same host, each toolchain ran a trusted program that printed `42`.
The benchmark ran one warm-up job and five sequential measured jobs per
toolchain with prebuilt images. Wall time spans the prepared job's `run()`
call through workspace cleanup. Attach time is the worker-reported interval
for container start, compilation, execution, and output capture. The final
column is the median of the paired differences and includes staging, Docker
control calls, and cleanup. All times are in milliseconds.

| Language | Median wall | Wall range | Median attach | Median wall minus attach |
| --- | ---: | ---: | ---: | ---: |
| C | 492 | 467–578 | 285 | 204 |
| C++ | 735 | 693–770 | 535 | 191 |
| Java | 1727 | 1627–2219 | 1529 | 207 |
| Python | 494 | 487–523 | 288 | 201 |
