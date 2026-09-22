"""Local SWE Studio workspace and run services. No model calls during discovery."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

MAX_FILE = 1024 * 1024
MAX_LOG = 2 * 1024 * 1024
SKIP = {".git", ".swe-studio", ".venv", "venv", "node_modules", "dist", "build", "__pycache__", ".next", ".cache"}
SENSITIVE = re.compile(r"^(\.env(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?|auth\.json|.*\.(pem|key|pfx|p12))$", re.I)
ACTIVE = {"queued", "running"}


class StudioError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def checked_file(root: Path, relative: str) -> Path:
    # Validate lexical components before resolving: even in-root symlinks are excluded.
    if not relative or "\\" in relative or ":" in relative or "\x00" in relative:
        raise StudioError("Choose a relative workspace file.")
    parts = relative.split("/")
    if any(p in {"", ".", ".."} or p in SKIP or SENSITIVE.match(p) for p in parts):
        raise StudioError("This path is outside the editable workspace.", 403)
    current = root
    for part in parts:
        current = current / part
        if current.is_symlink():
            raise StudioError("Symbolic links are not opened by Studio.", 403)
    if not current.resolve().is_relative_to(root.resolve()):
        raise StudioError("Path is outside the workspace.", 403)
    if not current.is_file():
        raise StudioError("File not found.", 404)
    if current.stat().st_size > MAX_FILE:
        raise StudioError("The editor supports files up to 1 MiB.", 413)
    return current


def file_tree(root: Path) -> dict:
    files = []
    truncated = False
    for directory, dirs, names in os.walk(root, followlinks=False):
        parent = Path(directory)
        depth = len(parent.relative_to(root).parts)
        dirs[:] = sorted(d for d in dirs if d not in SKIP and not d.startswith(".") and not SENSITIVE.match(d)
                         and not (parent / d).is_symlink()) if depth < 12 else []
        for name in sorted(names):
            path = parent / name
            if name.startswith(".") or SENSITIVE.match(name) or path.is_symlink():
                continue
            try:
                if not path.is_file():
                    continue
                files.append({"path": path.relative_to(root).as_posix(), "size": path.stat().st_size})
            except OSError:
                continue
            if len(files) >= 1500:
                truncated = True
                break
        if truncated:
            break
    return {"files": files, "truncated": truncated}


def read_file(root: Path, relative: str) -> dict:
    raw = checked_file(root, relative).read_bytes()
    if b"\x00" in raw:
        raise StudioError("Binary files cannot be opened in the text editor.", 415)
    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise StudioError("The editor supports UTF-8 text files.", 415)
    return {"path": relative, "content": content, "digest": sha(raw)}


def save_file(root: Path, relative: str, content: str, expected: str) -> dict:
    target = checked_file(root, relative)
    data = content.encode("utf-8")
    if len(data) > MAX_FILE:
        raise StudioError("The editor supports files up to 1 MiB.", 413)
    if sha(target.read_bytes()) != expected:
        raise StudioError("The file changed on disk. Reload it before saving your edits.", 409)
    # Replace atomically and preserve permissions. External agent edits are checked again.
    fd, temporary = tempfile.mkstemp(prefix=".studio-save-", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, target.stat().st_mode)
        if sha(target.read_bytes()) != expected:
            raise StudioError("The file changed while saving. Reload it first.", 409)
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return {"path": relative, "content": content, "digest": sha(data)}


def git_info(root: Path) -> dict:
    git = shutil.which("git")
    if not git:
        return {"available": False, "branch": None, "status": "Git is not installed.", "diff": "", "truncated": False}
    def run(*args: str) -> str:
        result = subprocess.run([git, "--no-optional-locks", "-c", "core.fsmonitor=false", *args],
                                cwd=root, capture_output=True, timeout=10)
        if result.returncode:
            raise StudioError(result.stderr.decode("utf-8", errors="replace").strip() or "Git command failed.")
        return result.stdout.decode("utf-8", errors="replace")
    try:
        top = Path(run("rev-parse", "--show-toplevel").strip()).resolve()
        if top != root.resolve():
            return {"available": False, "branch": None, "status": "Open the repository root to review Git changes.", "diff": "", "truncated": False}
        branch = run("branch", "--show-current").strip() or "detached HEAD"
        status = run("status", "--short", "--untracked-files=normal")
        working = run("diff", "--no-ext-diff", "--no-textconv", "--", ".")
        staged = run("diff", "--cached", "--no-ext-diff", "--no-textconv", "--", ".")
        diff = ("# Working tree\n" + working if working else "") + ("\n# Staged\n" + staged if staged else "")
        return {"available": True, "branch": branch, "status": status[:100000], "diff": diff[:MAX_FILE], "truncated": len(diff) > MAX_FILE}
    except (StudioError, subprocess.TimeoutExpired) as error:
        return {"available": False, "branch": None, "status": str(error), "diff": "", "truncated": False}


def executable(name: str) -> str | None:
    override = os.environ.get(f"SWE_STUDIO_{name.upper()}_BIN")
    candidate = override or shutil.which(name)
    if not candidate:
        return None
    path = Path(candidate)
    # Windows shell wrappers would implicitly invoke cmd.exe; require native executables.
    if path.suffix.lower() in {".bat", ".cmd"} or not path.is_file() or not os.access(path, os.X_OK):
        return None
    return str(path.resolve())


def npm_command() -> list[str] | None:
    npm = shutil.which("npm")
    node = executable("node")
    if not npm:
        return None
    if os.name != "nt":
        return [npm]
    if node:
        for cli in [Path(npm).parent / "node_modules/npm/bin/npm-cli.js", Path(node).parent / "node_modules/npm/bin/npm-cli.js"]:
            if cli.is_file():
                return [node, str(cli)]
    return None


def providers() -> list[dict]:
    result = []
    for key, label in [("copilot", "GitHub Copilot"), ("claude", "Claude Code"), ("nemo", "NemoSwarm")]:
        present = bool(executable(key))
        if key == "nemo" and os.environ.get("SWE_STUDIO_NEMO_ENTRY"):
            present = bool(executable("node") and Path(os.environ["SWE_STUDIO_NEMO_ENTRY"]).is_file())
        result.append({"id": key, "name": label, "available": present,
                       "detail": "Installed · sign-in checked when a task runs" if present else "Not installed on this host"})
    return result


def test_scripts(root: Path) -> list[str]:
    try:
        manifest = checked_file(root, "package.json")
        scripts = json.loads(manifest.read_text(encoding="utf-8")).get("scripts", {})
        return sorted(k for k, value in scripts.items() if isinstance(value, str) and re.fullmatch(r"(?:test|check|lint|typecheck)(?::[a-zA-Z0-9_-]+)*", k))
    except (OSError, ValueError, StudioError, AttributeError):
        return []


def run_command(root: Path, action: str, provider: str, prompt: str, script: str) -> list[str] | None:
    if action == "inspect":
        return None
    if action == "test":
        if script not in test_scripts(root):
            raise StudioError("Choose a check from this repository's package.json.")
        npm = npm_command()
        if not npm:
            raise StudioError("Node.js and npm are required to run package scripts.", 503)
        return [*npm, "run", script]
    if action != "agent" or provider not in {"copilot", "claude", "nemo"}:
        raise StudioError("Unknown task action or agent runtime.")
    if not prompt.strip():
        raise StudioError("Describe the task first.")
    if provider == "nemo" and os.environ.get("SWE_STUDIO_NEMO_ENTRY"):
        entry = Path(os.environ["SWE_STUDIO_NEMO_ENTRY"])
        node = executable("node")
        if not node or not entry.is_absolute() or not entry.is_file():
            raise StudioError("SWE_STUDIO_NEMO_ENTRY must point to an installed Nemo bin/nemo.js.", 503)
        command = [node, str(entry)]
    else:
        binary = executable(provider)
        if not binary:
            raise StudioError(f"{provider} is unavailable on this host. Install its CLI first.", 503)
        command = [binary]
    # Preserve native profile permissions. Never add bypass, YOLO, or allow-all flags.
    if provider == "claude":
        return [*command, "--print", "--permission-mode", "default", "--", prompt]
    if provider == "copilot":
        return [*command, "--prompt", prompt]
    return [*command, "--prompt", prompt, "--output-format", "text", "--no-color"]


class Studio:
    def __init__(self, state: Path):
        self.state = state
        state.mkdir(parents=True, exist_ok=True)
        self.tasks: dict[str, asyncio.Task] = {}
        self.processes: dict[str, asyncio.subprocess.Process] = {}
        with self.db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, root TEXT UNIQUE NOT NULL, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
                    action TEXT NOT NULL, provider TEXT NOT NULL, prompt TEXT NOT NULL, script TEXT NOT NULL,
                    status TEXT NOT NULL, created REAL NOT NULL, finished REAL, exit_code INTEGER);
                CREATE UNIQUE INDEX IF NOT EXISTS one_active_run ON runs(workspace_id) WHERE status IN ('queued','running');
            """)
            # Never replay a process with an unknown outcome after a server restart.
            db.execute("UPDATE runs SET status='interrupted', finished=? WHERE status IN ('queued','running')", (time.time(),))

    @contextmanager
    def db(self):
        connection = sqlite3.connect(self.state / "studio.sqlite", timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def workspaces(self) -> list[dict]:
        with self.db() as db:
            return [dict(row) for row in db.execute("SELECT * FROM workspaces ORDER BY created DESC")]

    def register(self, root: str, name: str) -> dict:
        path = Path(root).expanduser()
        if not path.is_absolute() or not path.is_dir():
            raise StudioError("Enter an existing absolute folder path on the server's machine.")
        path = path.resolve()
        if path == Path(path.anchor) or path == Path.home().resolve():
            raise StudioError("Open a project folder, not a drive root or your entire home directory.")
        with self.db() as db:
            db.execute("INSERT OR IGNORE INTO workspaces VALUES(?,?,?,?)", (uuid.uuid4().hex, name.strip() or path.name, str(path), time.time()))
            return dict(db.execute("SELECT * FROM workspaces WHERE root=?", (str(path),)).fetchone())

    def workspace(self, workspace_id: str) -> dict:
        with self.db() as db:
            row = db.execute("SELECT * FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
        if not row:
            raise StudioError("Workspace not found.", 404)
        if not Path(row["root"]).is_dir():
            raise StudioError("The workspace folder is no longer available.", 410)
        return dict(row)

    def runs(self, workspace_id: str) -> list[dict]:
        self.workspace(workspace_id)
        with self.db() as db:
            return [dict(row) for row in db.execute("SELECT * FROM runs WHERE workspace_id=? ORDER BY created DESC LIMIT 100", (workspace_id,))]

    def run(self, run_id: str) -> dict:
        with self.db() as db:
            row = db.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            raise StudioError("Task not found.", 404)
        logfile = self.state / f"{run_id}.log"
        output = logfile.read_text(encoding="utf-8", errors="replace") if logfile.is_file() else ""
        return {**dict(row), "output": output[-150000:], "outputTruncated": len(output) > 150000}

    def submit(self, workspace_id: str, action: str, provider: str, prompt: str, script: str) -> dict:
        root = Path(self.workspace(workspace_id)["root"])
        command = run_command(root, action, provider, prompt, script)
        if action != "agent":
            provider, prompt = "", ""
        if action != "test":
            script = ""
        run_id = uuid.uuid4().hex
        try:
            with self.db() as db:
                db.execute("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?)", (run_id, workspace_id, action, provider, prompt, script, "queued", time.time(), None, None))
        except sqlite3.IntegrityError:
            raise StudioError("A task is already active in this workspace. Stop it or wait for completion.", 409)
        task = asyncio.create_task(self.execute(run_id, root, command))
        self.tasks[run_id] = task
        task.add_done_callback(lambda _: self.tasks.pop(run_id, None))
        return self.run(run_id)

    def update(self, run_id: str, status: str, code: int | None = None):
        with self.db() as db:
            db.execute("UPDATE runs SET status=?, finished=?, exit_code=? WHERE id=?", (status, None if status in ACTIVE else time.time(), code, run_id))

    async def stop_process(self, process):
        # A parent can exit while descendants still hold stdout open. Always reap
        # the POSIX process group, including children that ignore SIGTERM.
        if os.name != "nt":
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                return
            try:
                await asyncio.wait_for(process.wait(), 2)
            except asyncio.TimeoutError:
                pass
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await process.wait()
            return
        if process.returncode is not None:
            return
        try:
            if os.name == "nt":
                # taskkill /T includes children spawned by package managers and agent CLIs.
                killer = await asyncio.create_subprocess_exec("taskkill", "/PID", str(process.pid), "/T", "/F", stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
                await killer.wait()
            else:
                os.killpg(process.pid, signal.SIGTERM)
            await asyncio.wait_for(process.wait(), 2)
        except (ProcessLookupError, asyncio.TimeoutError):
            if process.returncode is None:
                if os.name != "nt":
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                else:
                    process.kill()
                await process.wait()

    async def execute(self, run_id: str, root: Path, command: list[str] | None):
        process = None
        status, code = "failed", None
        with (self.state / f"{run_id}.log").open("w", encoding="utf-8") as log:
            def write(text):
                log.write(text)
                log.flush()
            try:
                if self.run(run_id)["status"] == "cancelled":
                    return
                self.update(run_id, "running")
                if command is None:
                    tree = await asyncio.to_thread(file_tree, root)
                    git = await asyncio.to_thread(git_info, root)
                    write(f"Workspace: {root.name}\nIndexed files: {len(tree['files'])}{' (limit reached)' if tree['truncated'] else ''}\n")
                    write(f"Branch: {git['branch'] or 'not a repository root'}\n\nChanges\n{git['status'] or 'Working tree clean'}\n")
                    write("\nAvailable package checks\n" + ("\n".join(test_scripts(root)) or "No supported npm scripts detected.") + "\n")
                    write("\nInspection complete. No model was called and no project files were changed.\n")
                    status, code = "succeeded", 0
                else:
                    write(f"Starting {self.run(run_id)['action']} in {root.name}\n\n")
                    options = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
                    process = await asyncio.create_subprocess_exec(*command, cwd=root, stdin=asyncio.subprocess.DEVNULL,
                        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                        env={**os.environ, "NO_COLOR": "1", "CI": "1"}, **options)
                    self.processes[run_id] = process
                    async def drain():
                        size = 0
                        while chunk := await process.stdout.read(4096):
                            size += len(chunk)
                            if size > MAX_LOG:
                                raise StudioError("Output exceeded 2 MiB; the task was stopped.")
                            write(chunk.decode("utf-8", errors="replace"))
                        return await process.wait()
                    code = await asyncio.wait_for(drain(), 900)
                    status = "succeeded" if code == 0 else "failed"
                    write(f"\n\nProcess exited with code {code}. Review changes and checks before accepting the result.\n")
            except asyncio.CancelledError:
                status = "cancelled"
                write("\nTask cancelled. Any existing file changes remain available for review.\n")
            except asyncio.TimeoutError:
                write("\nTask exceeded the 15-minute limit and was stopped.\n")
            except Exception as error:
                write(f"\nTask failed: {error}\n")
            finally:
                if process:
                    await self.stop_process(process)
                self.processes.pop(run_id, None)
                self.update(run_id, status, code)

    async def cancel(self, run_id: str) -> dict:
        run = self.run(run_id)
        if run["status"] in ACTIVE:
            self.update(run_id, "cancelled")
            task = self.tasks.get(run_id)
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        return self.run(run_id)

    async def close(self):
        for run_id in list(self.tasks):
            await self.cancel(run_id)
