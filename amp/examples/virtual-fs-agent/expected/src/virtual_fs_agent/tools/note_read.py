from __future__ import annotations

import json
from typing import Any

from copilot import define_tool
from copilot.tools import ToolInvocation
from pydantic import BaseModel, ConfigDict, Field

from ..memory_store import MEMORY_STORE


class NoteReadParams(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    key: str = Field(default=...)


async def _handler(params: NoteReadParams, invocation: ToolInvocation) -> Any:
    data = params.model_dump(by_alias=True, exclude_none=True)
    key = str(data.get("key") or data.get("name") or data.get("id") or "")
    if not key:
        return {"error": "memory key required"}
    return MEMORY_STORE.get(key)


tool = define_tool(
    "note_read",
    description="Read a note from the in-memory store.",
    handler=_handler,
    params_type=NoteReadParams,
    overrides_built_in_tool=False,
    skip_permission=False,
)
