from __future__ import annotations

from datetime import UTC, datetime

from copilot import SessionFsFileInfo, SessionFsProvider
from copilot.generated.rpc import SessionFSReaddirWithTypesEntry, SessionFSReaddirWithTypesEntryType


def _norm(path: str) -> str:
    clean = (path or "/").replace("\\", "/")
    if not clean.startswith("/"):
        clean = "/" + clean
    parts: list[str] = []
    for part in clean.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)
    return "/" + "/".join(parts)


class MemoryProvider(SessionFsProvider):
    def __init__(self) -> None:
        self._files: dict[str, str] = {}
        self._dirs: set[str] = {"/"}

    def _parents(self, path: str) -> list[str]:
        current = _norm(path).rsplit("/", 1)[0] or "/"
        parents = ["/"]
        if current != "/":
            acc = ""
            for part in current.strip("/").split("/"):
                acc += "/" + part
                parents.append(acc)
        return parents

    def _ensure_parent(self, path: str) -> None:
        for parent in self._parents(path):
            self._dirs.add(parent)

    async def read_file(self, path: str) -> str:
        key = _norm(path)
        if key not in self._files:
            raise FileNotFoundError(path)
        return self._files[key]

    async def write_file(self, path: str, content: str, mode: int | None = None) -> None:
        _ = mode
        key = _norm(path)
        self._ensure_parent(key)
        self._files[key] = content

    async def append_file(self, path: str, content: str, mode: int | None = None) -> None:
        _ = mode
        key = _norm(path)
        self._ensure_parent(key)
        self._files[key] = self._files.get(key, "") + content

    async def exists(self, path: str) -> bool:
        key = _norm(path)
        return key in self._files or key in self._dirs

    async def stat(self, path: str) -> SessionFsFileInfo:
        key = _norm(path)
        now = datetime.now(UTC)
        if key in self._files:
            return SessionFsFileInfo(is_file=True, is_directory=False, size=len(self._files[key]), mtime=now, birthtime=now)
        if key in self._dirs:
            return SessionFsFileInfo(is_file=False, is_directory=True, size=0, mtime=now, birthtime=now)
        raise FileNotFoundError(path)

    async def mkdir(self, path: str, recursive: bool, mode: int | None = None) -> None:
        _ = mode
        key = _norm(path)
        if recursive:
            for parent in self._parents(key + "/child"):
                self._dirs.add(parent)
        else:
            self._ensure_parent(key)
            self._dirs.add(key)

    async def readdir(self, path: str) -> list[str]:
        base = _norm(path)
        if base not in self._dirs:
            raise FileNotFoundError(path)
        prefix = "/" if base == "/" else base.rstrip("/") + "/"
        entries: set[str] = set()
        for candidate in list(self._dirs) + list(self._files):
            if candidate == base or not candidate.startswith(prefix):
                continue
            rest = candidate[len(prefix):].strip("/")
            if rest:
                entries.add(rest.split("/", 1)[0])
        return sorted(entries)

    async def readdir_with_types(self, path: str) -> list[SessionFSReaddirWithTypesEntry]:
        base = _norm(path)
        entries = []
        for name in await self.readdir(path):
            child = _norm(base.rstrip("/") + "/" + name)
            entry_type = SessionFSReaddirWithTypesEntryType.DIRECTORY if child in self._dirs else SessionFSReaddirWithTypesEntryType.FILE
            entries.append(SessionFSReaddirWithTypesEntry(name=name, type=entry_type))
        return entries

    async def rm(self, path: str, recursive: bool, force: bool) -> None:
        key = _norm(path)
        if key in self._files:
            del self._files[key]
            return
        if key not in self._dirs:
            if force:
                return
            raise FileNotFoundError(path)
        children = [p for p in list(self._files) + list(self._dirs) if p != key and p.startswith(key.rstrip("/") + "/")]
        if children and not recursive:
            raise OSError(f"directory not empty: {path}")
        for child in children:
            self._files.pop(child, None)
            self._dirs.discard(child)
        if key != "/":
            self._dirs.discard(key)

    async def rename(self, src: str, dest: str) -> None:
        source = _norm(src)
        target = _norm(dest)
        if source in self._files:
            self._ensure_parent(target)
            self._files[target] = self._files.pop(source)
            return
        if source not in self._dirs:
            raise FileNotFoundError(src)
        self._ensure_parent(target)
        for directory in sorted([d for d in self._dirs if d == source or d.startswith(source.rstrip("/") + "/")]):
            self._dirs.discard(directory)
            self._dirs.add(target + directory[len(source):])
        for file_path in sorted([f for f in self._files if f.startswith(source.rstrip("/") + "/")]):
            self._files[target + file_path[len(source):]] = self._files.pop(file_path)


def create_session_fs_handler(session: object) -> MemoryProvider:
    _ = session
    return MemoryProvider()
