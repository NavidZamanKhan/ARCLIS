# Presentation and viva notes

## Presentation outline

1. **Project goal.** ARCLIS combines a four-language interactive workspace
   with an inspectable C compiler front end for compiler construction labs.
2. **Workspace.** Show the Quick Run language selector, Monaco editor,
   and debug console. Open Projects to demonstrate the navigator and
   inspector. The browser stores Quick Run drafts, projects, and preferences
   for the current origin.
3. **Compiler contribution.** Follow one C function through Flex tokens,
   the Bison grammar, source-located AST nodes, scopes and symbols, and
   labeled three-address instructions. Use `sum_to` and the `&&` condition
   in the C example to show both a loop and short-circuit control flow.
4. **Native execution.** Run the same C example and then a program that asks
   for input. Explain how Django hands the job to a rootless worker and
   how the launcher separates compiler diagnostics from runtime output.
5. **Verification and limits.** Show the final test results, explain the
   educational grammar's scope, and describe the restricted HTTPS profile.
   [Architecture](architecture.md) · [Final verification](verification.md)

## Live demo

Use the [full local workspace](../README.md#start-the-full-local-workspace)
with both worker opt-ins and all five images. Confirm both features are
available at `http://127.0.0.1:8000/api/v1/capabilities/`. Open the IDE at
`http://127.0.0.1:5173` in a fresh browser profile and open **Projects**.
Use **Project actions → Upload Files** and open the example. A project with
one runnable file uses it automatically. Use **Reset Workspace → Start
empty** when switching examples. For interactive examples, type each value
in the console and press Enter.

| Example | What to show | Expected result |
| --- | --- | --- |
| [C phases](../examples/compiler_phases.c) | Select **Analyze**. Open Tokens, AST, Symbols, Diagnostics, and IR. Then select **Run**. | The report is valid, `sum_to` and its local variables appear in Symbols, and IR shows the loop and `&&` branches. Native output is `OK`. |
| [Interactive C++](../examples/interactive_sum.cpp) | Select **Run**. Send `7` at the first prompt and `5` at the second. | The console prints `Total = 12` and the run completes. |
| [Interactive Java](../examples/InteractiveSum.java) | Keep the filename `InteractiveSum.java` to match the public class. Run and send the same two values. | The console prints `Total = 12` and the run completes. |
| [Interactive Python](../examples/interactive_sum.py) | Analyze, then open Symbols to show the closure. Run and send the same inputs. | Native Python analysis shows scope flags, including the inner function's free `label`. The console prints `Total = 12`. |

For the C error walkthrough, change `return total;` inside `sum_to` to
`return missing_total;` and select **Analyze**. The syntax remains valid,
semantic analysis reports the undeclared identifier, and IR is withheld.
Click the diagnostic to jump to the identifier. **Run** reports an
independent GCC compilation failure. Undo the edit before continuing.

In the Python demo, entering `abc` instead of the first integer produces a
runtime `ValueError`. To demonstrate EOF, run again and use **Send EOF**
at the first input prompt. The resulting `EOFError` shows that the console
closed the input stream and the program observed it.

### Command-line fallback

```bash
make -C compiler_engine/c
compiler_engine/c/build/arclis-lex examples/compiler_phases.c
compiler_engine/c/build/arclis-parse --analysis examples/compiler_phases.c
```

Expand the Bison grammar in `parser.y`, then show the `symbols`, `ir`, and
result records in the CLI output. The restricted HTTPS demo can show the
workspace and its health routes while the CLI illustrates the custom C phases.

## Likely viva questions

**Where did you use Flex and Bison?** Flex generates the scanner from
`compiler_engine/c/lexer.l`. Bison generates the syntax parser from
`compiler_engine/c/parser.y`. The grammar's actions build the typed AST.
Bison is Yacc-compatible. ARCLIS invokes GNU Bison to generate the parser.
[Flex manual](https://westes.github.io/flex/manual/Introduction.html) · [GNU Bison](https://www.gnu.org/software/bison/)

**What compiler work did ARCLIS implement?** The team's C front end covers
token rules and locations, an educational grammar, AST construction, symbol
and type checks, and three-address lowering. The native Run toolchains are
GCC, G++, OpenJDK, and CPython. Python Analyze uses CPython's own analysis APIs.

**How do you handle operator precedence and dangling `else`?** Grammar levels
place multiplication below addition in the parse tree, so it groups more
tightly. Assignment is right-associative. The grammar assigns `else` higher
precedence than the unmatched `if` rule, so it attaches to the nearest
eligible `if`. The Bison build rejects unresolved conflicts.

**How does the semantic pass handle shadowing?** The analyzer resolves names
in source order through nested scopes. The function's outer scope shares its
parameters, and a nested block or `for` can introduce a name that shadows
an outer declaration. IR refers to symbol identities, so two declarations
with the same spelling remain distinct.

**Why keep an AST and an IR?** The AST represents source structure for
semantic checks and navigation. The IR makes control flow and intermediate
values explicit through temporaries, labels, branches, stores, and calls.
For example, `&&` branches past its right operand when the left is false.

**Why can Run succeed when C Analyze reports unsupported syntax?** Run uses
GCC with normal headers and C17 syntax. Analyze uses a single buffer and a
smaller grammar. Pointers, arrays, header contents, and macro expansion fall
outside the educational front end.

**How do compiler and runtime errors differ?** The trusted launcher emits
compilation diagnostics and reports whether compilation passed before the
program starts. A failed compiler phase yields `COMPILATION_FAILED`. A
nonzero program exit after successful compilation yields `RUNTIME_FAILED`.

**Why use HTTP and WebSockets together?** HTTP validates the submitted
workspace and creates a pending session. A WebSocket claims it once using
the owner token and carries input, EOF, cancellation, output, and the result.
The owner token travels in a subprotocol header.

**Where is submitted source executed?** The local worker mounts a private
input tree read-only in a short-lived rootless container. Jobs run as a
non-root UID with no external network or access to the Docker socket. CPU,
memory, PID, output, and time limits bound each job.

**Is the HTTPS demo a public execution service?** The Compose profile binds
to loopback and keeps Run and Analyze disabled. The local sandbox shares its
Linux kernel and its quotas apply to one backend process. A public service
requires dedicated workers, stronger isolation, and an abuse-control review.

**How does a diagnostic jump to the correct character?** Compiler ranges use
UTF-8 byte offsets. ARCLIS maps them to Monaco's UTF-16 positions against
the submitted source snapshot and marks the report stale after a source
change.

**What evidence supports the final result?** Use the strict Flex/Bison build,
Django sandbox tests, Vitest and Chromium regressions, native demo runs, and
HTTPS/WSS smoke checks. The final verification notes list the environment and
the observed results. [Final verification](verification.md)
