from __future__ import annotations

import json
from typing import Any

from copilot import define_tool
from copilot.tools import ToolInvocation
from pydantic import BaseModel, ConfigDict, Field

from ..memory_store import MEMORY_STORE


class NoteWriteParams(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    key: str = Field(default=...)
    value: str = Field(default=...)


async def _handler(params: NoteWriteParams, invocation: ToolInvocation) -> Any:
    data = params.model_dump(by_alias=True, exclude_none=True)
    key = str(data.get("key") or data.get("name") or data.get("id") or "")
    if not key:
        return {"error": "memory key required"}
    value = data.get("value", data)
    MEMORY_STORE[key] = value
    return {"key": key, "value": value}


tool = define_tool(
    "note_write",
    description="Write a note to the in-memory store.",
    handler=_handler,
    params_type=NoteWriteParams,
    overrides_built_in_tool=False,
    skip_permission=False,
)
