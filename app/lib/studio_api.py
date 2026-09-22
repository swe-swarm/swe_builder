"""SWE Studio routes for the existing local FastAPI server."""
import asyncio
import os
import secrets
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .studio_core import Studio, StudioError, file_tree, git_info, providers, read_file, save_file, test_scripts


class WorkspaceInput(BaseModel):
    root: str = Field(min_length=1, max_length=4096)
    name: str = Field(default="", max_length=100)


class FileInput(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    content: str = Field(max_length=1024 * 1024)
    digest: str = Field(pattern=r"^[a-f0-9]{64}$")


class RunInput(BaseModel):
    action: Literal["inspect", "test", "agent"]
    provider: str = Field(default="", max_length=30)
    prompt: str = Field(default="", max_length=20000)
    script: str = Field(default="", max_length=100)


def create_studio_router(base_dir: Path, state_dir: Path | None = None):
    state = state_dir or Path(os.environ.get("SWE_STUDIO_STATE", base_dir / ".swe-studio"))
    studio = Studio(state)
    token = secrets.token_urlsafe(32)

    async def local_request(request: Request):
        # Host checks prevent DNS rebinding. Origin + per-process token protect mutations.
        if request.url.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise HTTPException(403, "Studio is available only on localhost.")
        origin = request.headers.get("origin")
        if origin:
            parsed = urlsplit(origin)
            if parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
                raise HTTPException(403, "Untrusted request origin.")
            # A same-origin request may arrive through Vite's development proxy.
            allowed_ports = {request.url.port or 80, int(os.environ.get("SWE_STUDIO_DEV_PORT", "8080"))}
            if (parsed.port or 80) not in allowed_ports:
                raise HTTPException(403, "Untrusted request origin.")
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            supplied = request.headers.get("x-studio-token", "")
            if not secrets.compare_digest(supplied, token):
                raise HTTPException(403, "Refresh Studio before making changes.")

    router = APIRouter(prefix="/api/studio", dependencies=[Depends(local_request)])

    def root(workspace_id):
        return Path(studio.workspace(workspace_id)["root"])

    @router.get("/bootstrap")
    async def bootstrap():
        return {"token": token, "suggestedRoot": str(base_dir), "providers": providers(), "workspaces": studio.workspaces()}

    @router.post("/workspaces")
    async def register(data: WorkspaceInput):
        return studio.register(data.root, data.name)

    @router.get("/workspaces/{workspace_id}")
    async def workspace(workspace_id: str):
        directory = root(workspace_id)
        tree, git = await asyncio.gather(asyncio.to_thread(file_tree, directory), asyncio.to_thread(git_info, directory))
        return {**studio.workspace(workspace_id), **tree, "git": git, "scripts": test_scripts(directory), "runs": studio.runs(workspace_id)}

    @router.get("/workspaces/{workspace_id}/file")
    async def get_file(workspace_id: str, path: str):
        return read_file(root(workspace_id), path)

    @router.put("/workspaces/{workspace_id}/file")
    async def put_file(workspace_id: str, data: FileInput):
        return save_file(root(workspace_id), data.path, data.content, data.digest)

    @router.get("/workspaces/{workspace_id}/runs")
    async def runs(workspace_id: str):
        return studio.runs(workspace_id)

    @router.post("/workspaces/{workspace_id}/runs")
    async def submit(workspace_id: str, data: RunInput):
        return studio.submit(workspace_id, data.action, data.provider, data.prompt, data.script)

    @router.get("/runs/{run_id}")
    async def run(run_id: str):
        return studio.run(run_id)

    @router.post("/runs/{run_id}/cancel")
    async def cancel(run_id: str):
        return await studio.cancel(run_id)

    return router, studio
