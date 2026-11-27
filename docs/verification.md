# Final verification

The 27 November 2026 review used a clean source copy on Ubuntu 24.04 under
WSL 2, a new Python virtual environment, and a fresh frontend install. The
host provided Python 3.12.3, Node 24.22.3, Flex 2.6.4, Bison 3.8.2, and
rootless Docker 29.10.1 with systemd cgroup v2.

## Replay

Use the [local setup](../README.md#start-the-full-local-workspace) to build
the three execution images and both analyzer images. Load the documented
development environment and activate the Python virtual environment. Keep
loopback ports 5173 and 8000 free for Playwright's test servers.

```bash
python -m pip check
python backend/manage.py check
make -C compiler_engine/c all test CFLAGS='-std=c17 -Wall -Wextra -Wpedantic -Werror -O2'
(cd backend && ARCLIS_TEST_WORKER=1 python manage.py test)
(cd frontend && npm ci && npm test && npx playwright install chromium --only-shell && npm run test:e2e)
git fsck --full --no-dangling
git shortlog -sne HEAD
```

For the deployed profile, start the [restricted HTTPS demo](../README.md#run-the-restricted-https-deployment)
and point the smoke check at its public localhost certificate.

```bash
python deployment/smoke.py "$ARCLIS_DEPLOY_SECRETS_DIR/localhost.crt"
```

## Observed results

| Check | Result |
| --- | --- |
| Setup and packaging | Fresh Python and npm installs, all five toolchain image builds, `pip check`, and Django system checks passed. The npm runtime advisory count was zero at verification. |
| Educational C | Strict C17 build passed with zero unresolved Bison conflicts. All 55 fixtures and two C API tests passed. The C demo produced tokens, AST, symbols, and IR on the command line. |
| Backend | All 90 Docker-enabled tests passed. They cover the native and analyzer paths, resource controls, ownership and origins, input handling, cancellation, and cleanup. |
| Frontend | All 38 Vitest tests and the production build passed. All 17 committed Chromium workflows passed. |
| Academic demos | Four additional Chromium runs uploaded and ran the actual example files. C printed `OK`. C++, Java, and Python each returned `Total = 12` from two console inputs. The C and Python analysis views were checked. |
| Error walkthroughs | The changed C example produced a source-located semantic error and a separate native compile failure. The Python example exposed its free variable and produced the documented invalid-input and EOF errors. |
| Visual review | Chromium captures covered the desktop Graphite editor and C IR inspector, the 500 px Silver workspace and Quick Open, and the design-system preview. |
| Restricted deployment | Nginx syntax, both container health checks, certificate-validating HTTPS/WSS smoke tests, separated file-mounted secrets, disabled worker routes, and service limits passed. |
| Cleanup | The test servers stopped. No labeled execution containers or temporary job workspaces remained. |

The repository audit checked Git object integrity, tracked source organization,
and author and committer identities for Navid Zaman Khan and Sadman Sakib Khan.
Generated files, credentials, and local development records stay outside the
tracked submission. Use the Git history for contribution attribution.

## Quick Run and console remediation

The same WSL setup passed 91 Docker-enabled Django tests, 41 Vitest tests,
the production frontend build, and 25 Chromium workflows. The strict C17
build still passed all 55 compiler fixtures and two C API tests.

Chromium submitted the four audit programs from blank Quick Run drafts,
verified the submitted source and automatic entry filename, and typed into
xterm while each program was waiting. Every program produced the expected
output and exited with code zero. Additional runs verified immediate edits,
multiline paste and EOF, independent draft and project recovery, service
retry, source-linked diagnostics, and cancellation. A legacy Projects record
reopened on localhost, and the Quick Run layout fit at widths of 375, 500,
and 1440 pixels.

The restricted HTTPS/WSS smoke checks and Chromium's disabled Run and
Analyze controls passed on a separate loopback Compose instance.

## Known limits

- The custom compiler covers the documented C subset. Native toolchains
  handle the full Run path and C++ and Java diagnostics. Python Analyze
  uses CPython analysis APIs and has no educational IR output.
- Projects and preferences are stored in the current browser origin. Reload
  recovery depends on browser storage availability. Build and analysis
  results live in the current page session.
- The Vite build reports a roughly 930 kB gzipped Monaco entry chunk.
- The restricted deployment uses a self-signed certificate. Django's
  deploy check reports the two localhost HSTS warnings for subdomain scope
  and preload. Public execution is disabled pending a dedicated worker
  environment and stronger isolation review.
