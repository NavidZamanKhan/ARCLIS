"""Run trusted compiler arguments, then replace this process with the program."""

import os
import signal
import struct
import subprocess
import sys

STDIN_FILE = "/workspace/.arclis-stdin"
HEADER = struct.Struct(">4sBI")


def report(phase, diagnostics):
    sys.stdout.buffer.write(HEADER.pack(b"ARC1", phase, len(diagnostics)))
    sys.stdout.buffer.write(diagnostics)
    sys.stdout.buffer.flush()


def main():
    args = sys.argv[1:]
    interactive = args[0] == "--interactive"
    if interactive:
        args = args[1:]
    cap = int(args[0])
    runtime_start = 2 + int(args[1])
    command = args[runtime_start:]
    with subprocess.Popen(
        args[2:runtime_start],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    ) as compiler:
        diagnostics = compiler.stdout.read(cap + 1)
        if len(diagnostics) > cap:
            try:
                os.killpg(compiler.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            report(2, diagnostics[:cap])
            return 1
        if compiler.wait() != 0:
            report(1, diagnostics)
            return 1

    if not interactive:
        with open(STDIN_FILE, "rb") as source:
            os.dup2(source.fileno(), 0)
    report(0, diagnostics)
    os.execvp(command[0], command)


if __name__ == "__main__":
    sys.exit(main())
