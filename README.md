# ARCLIS

Advanced Runtime and Compiler Lab for Interactive Study

## Run the frontend locally

Open an Ubuntu WSL login shell with Node.js 24.15 or later in the Node 24
line. From the repository root:

```bash
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173` for the workspace. The navigator starts with C,
C++, Java, and Python samples. Use the project’s plus button or an item's
context menu to create, rename, delete, upload, or download files. Open a file
by clicking its name, or use the jump bar to switch files and locate their
folders. Monaco keeps edits and cursor positions through tab switches,
renames, and reopening closed tabs. The browser saves workspace files,
open tabs, and the selected execution target in IndexedDB. Panel layout,
theme, and editor preferences are saved locally. Use **Reset Workspace** in
the project menu to restore the original samples after confirmation.
Download a file to keep a separate copy of its current contents.

Choose a source entry file under **Execution target** in the inspector.
Targets identify one toolchain and its entry file. Java uses the class name
derived from the package and filename. C and C++ targets compile sources in
the entry file's folder and can include compatible headers from the workspace.
Keep separate native programs in separate folders. Java and Python submissions
include files of the selected language throughout the workspace.
Uploads accept UTF-8 source files with supported extensions and safe relative
paths, with a 1 MiB per-upload batch limit and up to 50 project source files.

Start the loopback backend as described in [Interactive sessions](#interactive-sessions-on-loopback),
then use **Run** on the workspace toolbar. The browser submits the current
editor contents to `http://127.0.0.1:8000`. In **Console**, wait for the program's
prompt and submit a line with Enter or **Send**. Use **Send EOF** to finish
standard input and **Stop** to request cancellation. **Build log** shows
compiler messages, and **Execution details** shows the target, result, exit
code when available, and duration. The console displays program-supplied
control sequences as text.

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

Switch the navigator to Symbols to jump to a sample declaration. The editor header opens Find,
Replace, and Go to line. Use Ctrl+M to toggle whether Tab indents or moves
focus. The inspector saves line-number and indentation preferences in the
browser. The toolbar toggles the navigator, inspector, and
debug panel. Drag a separator or focus it and use the arrow keys to resize
its panel. Home and End move the panel to its minimum and maximum sizes.
Narrow windows stack the panels vertically.

The View menu opens the design system preview or resets the workspace layout
after confirmation. Graphite and Silver work in both views, and the browser
saves the selected theme locally. The workspace editor accepts Monaco
diagnostic markers keyed by filename. Backend execution and compiler
diagnostics will be connected in a later stage.

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
to the requesting client. Execution and interactive input are available
only on the enabled loopback development server. Analysis remains unavailable.

DRF endpoints use JSON. Raised request errors preserve their HTTP status and
return `{"error": {"code": "...", "details": {...}}}`. For endpoints that accept
data, use a DRF serializer with `is_valid(raise_exception=True)`. Validation
errors use the `validation_error` code and return field or non-field errors
under `details`. Malformed JSON uses `parse_error`, and internal errors return
a generic message. The Django health endpoint retains its existing contract.

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
