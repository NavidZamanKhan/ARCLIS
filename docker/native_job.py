"""Run trusted compiler arguments, then replace this process with the program."""

import os
import signal
import struct
import subprocess
import sys

PROGRAM = "/tmp/arclis-program"
STDIN_FILE = "/workspace/.arclis-stdin"
HEADER = struct.Struct(">4sBI")


def report(phase, diagnostics):
    sys.stdout.buffer.write(HEADER.pack(b"ARC1", phase, len(diagnostics)))
    sys.stdout.buffer.write(diagnostics)
    sys.stdout.buffer.flush()


def main():
    cap = int(sys.argv[1])
    with subprocess.Popen(
        sys.argv[2:],
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

    with open(STDIN_FILE, "rb") as source:
        os.dup2(source.fileno(), 0)
    report(0, diagnostics)
    os.execv(PROGRAM, [PROGRAM])


if __name__ == "__main__":
    sys.exit(main())
