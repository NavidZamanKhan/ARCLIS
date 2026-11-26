import os
import subprocess
from pathlib import Path
from unittest import TestCase, skipUnless
from unittest.mock import Mock, call, patch

from .sandbox import (
    DockerSandbox, SandboxError, SandboxLimits, SandboxOutcome, Toolchain, validate_engine_info,
)
from .states import ExecutionState
from .worker import WORKSPACE_PREFIX, run_job
from .workspace import InvalidWorkspace, SourceFile

ENGINE_INFO = {
    "CgroupVersion": "2",
    "CgroupDriver": "systemd",
    "SecurityOptions": ["name=rootless", "name=seccomp,profile=builtin"],
    "MemoryLimit": True,
    "SwapLimit": True,
    "CpuCfsPeriod": True,
    "CpuCfsQuota": True,
    "PidsLimit": True,
}
SOURCE = SourceFile("main.py", "print('workspace-ok')\n")

ISOLATION_FIXTURE = """
import os
from pathlib import Path

assert (os.getuid(), os.getgid()) == (65534, 65534)
status = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines())
assert int(status["CapEff"].strip(), 16) == 0
assert status["Seccomp"].strip() == "2"
assert status["NoNewPrivs"].strip() == "1"
assert sorted(os.listdir("/sys/class/net")) == ["lo"]
assert not Path("/var/run/docker.sock").exists()
assert "ARCLIS_WORKER_TEST_SECRET" not in os.environ

cgroups = Path("/sys/fs/cgroup")
quota, period = map(int, (cgroups / "cpu.max").read_text().split())
assert quota * 2 == period
assert int((cgroups / "memory.max").read_text()) == 96 * 1024 * 1024
assert int((cgroups / "memory.swap.max").read_text()) == 0
assert int((cgroups / "pids.max").read_text()) == 24

assert os.statvfs("/").f_flag & os.ST_RDONLY
assert os.statvfs("/workspace").f_flag & os.ST_RDONLY
assert Path("main.py").read_text() == "print('workspace-ok')\\n"
scratch = os.statvfs("/tmp")
assert scratch.f_blocks * scratch.f_frsize == 8 * 1024 * 1024
Path("/tmp/result").write_text("temporary")
print("isolation-ok")
"""

CPU_FIXTURE = """
from pathlib import Path
from time import process_time

stats = Path("/sys/fs/cgroup/cpu.stat")

def throttled_periods():
    return int(dict(line.split() for line in stats.read_text().splitlines())["nr_throttled"])

before = throttled_periods()
deadline = process_time() + 0.25
while process_time() < deadline:
    pass
assert throttled_periods() > before
"""

PROCESS_FIXTURE = """
import subprocess
from pathlib import Path

events = Path("/sys/fs/cgroup/pids.events")

def denied_processes():
    return int(dict(line.split() for line in events.read_text().splitlines())["max"])

before = denied_processes()
children = []
try:
    for _ in range(12):
        try:
            children.append(subprocess.Popen(["/bin/sleep", "10"]))
        except BlockingIOError:
            break
    assert 0 < len(children) < 12
    assert denied_processes() > before
finally:
    for child in children:
        child.terminate()
        child.wait(timeout=2)
"""


class WorkerValidationTests(TestCase):
    def test_engine_without_each_required_control_is_rejected(self):
        validate_engine_info(ENGINE_INFO)
        for key in ENGINE_INFO:
            with self.subTest(key=key), self.assertRaises(SandboxError):
                validate_engine_info({**ENGINE_INFO, key: None})

    def test_unconfined_seccomp_profile_is_rejected(self):
        with self.assertRaises(SandboxError):
            validate_engine_info(
                {**ENGINE_INFO, "SecurityOptions": ["name=rootless", "name=seccomp,profile=unconfined"]}
            )

    def test_limit_values_cannot_disable_containment(self):
        for setting in (
            {"cpu_millis": 0}, {"memory_mib": 0}, {"processes": -1},
            {"output_bytes": 0}, {"timeout_seconds": float("nan")}, {"scratch_mib": 0},
        ):
            with self.subTest(setting=setting), self.assertRaises(ValueError):
                SandboxLimits(**setting)

    def test_invalid_paths_never_reach_docker(self):
        with patch("apps.execution.worker.DockerSandbox") as docker:
            with self.assertRaises(InvalidWorkspace):
                run_job([SourceFile("../main.py", "")], Toolchain.PYTHON, ["python3"])
            docker.assert_not_called()

    def test_docker_failure_is_terminal_and_cleans_up_without_running(self):
        with patch("apps.execution.worker.DockerSandbox") as docker:
            sandbox = docker.return_value
            sandbox.verify.side_effect = SandboxError("The local daemon is unavailable.")
            result = run_job([SOURCE], Toolchain.PYTHON, ["python3", "main.py"])

        sandbox.create.assert_not_called()
        sandbox.execute.assert_not_called()
        self.assertEqual(
            result.history,
            (ExecutionState.CREATED, ExecutionState.PREPARING, ExecutionState.INTERNAL_ERROR),
        )
        self.assert_workspace_removed(result.job_id)

    def test_cleanup_failure_replaces_success_with_one_terminal_error(self):
        with patch("apps.execution.worker.DockerSandbox") as docker:
            sandbox = docker.return_value
            sandbox.execute.return_value = SandboxOutcome(ExecutionState.COMPLETED)
            sandbox.remove.side_effect = SandboxError("Docker did not confirm cleanup.")
            with self.assertLogs("apps.execution.worker", level="ERROR") as logs:
                result = run_job([SOURCE], Toolchain.PYTHON, ["python3", "main.py"])

        self.assertEqual(
            [record.getMessage() for record in logs.records],
            [f"Docker cleanup could not be confirmed for job {result.job_id}."],
        )
        self.assertEqual(
            result.history,
            (
                ExecutionState.CREATED, ExecutionState.PREPARING,
                ExecutionState.RUNNING, ExecutionState.INTERNAL_ERROR,
            ),
        )
        self.assertEqual(result.outcome.error, "Docker did not confirm cleanup.")
        self.assert_workspace_removed(result.job_id)

    def assert_workspace_removed(self, job_id):
        self.assertEqual(list(Path("/tmp").glob(f"{WORKSPACE_PREFIX}{job_id}-*")), [])


class DockerCleanupTests(TestCase):
    def setUp(self):
        self.name = "arclis-job-cleanup-fixture"
        self.remove_job = call("container", "rm", "--force", "--volumes", self.name)
        self.sandbox = DockerSandbox.__new__(DockerSandbox)
        self.command = Mock()
        self.sandbox._call = self.command

    def test_successful_cleanup_does_not_retry(self):
        self.command.return_value = subprocess.CompletedProcess([], 0)
        self.sandbox.remove(self.name)
        self.assertEqual(self.command.call_args_list, [self.remove_job])

    def test_cleanup_retries_and_accepts_already_removed_container(self):
        self.command.side_effect = [
            SandboxError("Docker control command could not be completed."),
            subprocess.CompletedProcess([], 1, stderr=f"No such container: {self.name}"),
        ]
        self.sandbox.remove(self.name)
        self.assertEqual(self.command.call_args_list, [self.remove_job, self.remove_job])

    def test_unconfirmed_cleanup_stops_after_two_attempts(self):
        self.command.return_value = subprocess.CompletedProcess([], 1, stderr="daemon unavailable")
        with self.assertRaisesRegex(SandboxError, "Docker did not confirm cleanup"):
            self.sandbox.remove(self.name)
        self.assertEqual(self.command.call_args_list, [self.remove_job, self.remove_job])


@skipUnless(os.environ.get("ARCLIS_TEST_WORKER") == "1", "Requires rootless Docker and images")
class DockerWorkerTests(TestCase):
    def assert_outcome(self, result, expected):
        self.assertEqual(list(Path("/tmp").glob(f"{WORKSPACE_PREFIX}{result.job_id}-*")), [])
        remaining = subprocess.check_output(
            [
                "docker", "--host", f"unix:///run/user/{os.getuid()}/docker.sock",
                "container", "ls", "--all", "--quiet", "--filter",
                f"name=^/arclis-job-{result.job_id}$",
            ],
            text=True,
            timeout=10,
        )
        self.assertEqual(remaining.strip(), "")
        self.assertEqual(result.outcome.state, expected, result.outcome)
        self.assertEqual(
            result.history,
            (ExecutionState.CREATED, ExecutionState.PREPARING, ExecutionState.RUNNING, expected),
        )

    def test_toolchain_images_run_trusted_commands(self):
        for toolchain, command, expected in (
            (Toolchain.C_CPP, ["gcc", "--version"], b"gcc"),
            (Toolchain.C_CPP, ["g++", "--version"], b"g++"),
            (Toolchain.JAVA, ["javac", "-version"], b"javac"),
            (Toolchain.JAVA, ["java", "--version"], b"openjdk"),
            (Toolchain.PYTHON, ["python3", "main.py"], b"workspace-ok"),
        ):
            with self.subTest(command=command):
                result = run_job([SOURCE], toolchain, command)
                self.assert_outcome(result, ExecutionState.COMPLETED)
                self.assertIn(expected, result.outcome.stdout + result.outcome.stderr)
                self.assertEqual(result.outcome.exit_code, 0)

    def test_effective_isolation_controls(self):
        limits = SandboxLimits(cpu_millis=500, memory_mib=96, processes=24, scratch_mib=8)
        with patch.dict(
            os.environ,
            {
                "ARCLIS_WORKER_TEST_SECRET": "synthetic-test-marker",
                "DOCKER_HOST": "tcp://127.0.0.1:1",
            },
        ):
            result = run_job([SOURCE], Toolchain.PYTHON, ["python3", "-c", ISOLATION_FIXTURE], limits)

        self.assert_outcome(result, ExecutionState.COMPLETED)
        self.assertEqual(result.outcome.stdout, b"isolation-ok\n")

    def test_cpu_quota_throttles_trusted_computation(self):
        result = run_job(
            [SOURCE], Toolchain.PYTHON, ["python3", "-I", "-c", CPU_FIXTURE],
            SandboxLimits(cpu_millis=250, timeout_seconds=5),
        )
        self.assert_outcome(result, ExecutionState.COMPLETED)

    def test_process_limit_denies_additional_children(self):
        result = run_job(
            [SOURCE], Toolchain.PYTHON, ["python3", "-I", "-c", PROCESS_FIXTURE],
            SandboxLimits(processes=8, timeout_seconds=5),
        )
        self.assert_outcome(result, ExecutionState.COMPLETED)

    def test_nonzero_exit_keeps_stderr(self):
        result = run_job(
            [SOURCE], Toolchain.PYTHON,
            ["python3", "-c", "import sys; sys.stderr.write('fixture-error'); sys.exit(7)"],
        )
        self.assert_outcome(result, ExecutionState.RUNTIME_FAILED)
        self.assertEqual(result.outcome.exit_code, 7)
        self.assertEqual(result.outcome.stderr, b"fixture-error")

    def test_missing_executable_reports_container_exit_and_cleans_up(self):
        result = run_job([SOURCE], Toolchain.PYTHON, ["/missing-arclis-fixture-command"])

        self.assert_outcome(result, ExecutionState.RUNTIME_FAILED)
        self.assertEqual(result.outcome.exit_code, 127)
        self.assertIn(b"/missing-arclis-fixture-command", result.outcome.stderr)

    def test_timeout_stops_the_job(self):
        result = run_job(
            [SOURCE], Toolchain.PYTHON,
            ["python3", "-u", "-c", "import time; print('started'); time.sleep(20)"],
            SandboxLimits(timeout_seconds=4),
        )
        self.assert_outcome(result, ExecutionState.TIMEOUT)
        self.assertEqual(result.outcome.stdout, b"started\n")

    def test_output_is_capped_across_both_streams(self):
        result = run_job(
            [SOURCE], Toolchain.PYTHON,
            ["python3", "-c", "import os; os.write(1, b'a'*512); os.write(2, b'b'*512)"],
            SandboxLimits(output_bytes=768),
        )
        self.assert_outcome(result, ExecutionState.RESOURCE_LIMIT_EXCEEDED)
        self.assertEqual(len(result.outcome.stdout) + len(result.outcome.stderr), 768)

    def test_memory_limit_is_enforced(self):
        result = run_job(
            [SOURCE], Toolchain.PYTHON,
            ["python3", "-c", "blocks = [bytearray(b'x' * (1024**2)) for _ in range(96)]"],
            SandboxLimits(memory_mib=64),
        )
        self.assert_outcome(result, ExecutionState.RESOURCE_LIMIT_EXCEEDED)
