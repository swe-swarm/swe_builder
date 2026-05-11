from __future__ import annotations

import json
from typing import Any

from copilot import define_tool
from copilot.tools import ToolInvocation
from pydantic import BaseModel, ConfigDict, Field

from ..memory_store import MEMORY_STORE


class NoteListParams(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    pass


async def _handler(params: NoteListParams, invocation: ToolInvocation) -> Any:
    data = params.model_dump(by_alias=True, exclude_none=True)
    return dict(sorted(MEMORY_STORE.items()))


tool = define_tool(
    "note_list",
    description="List all notes in the in-memory store.",
    handler=_handler,
    params_type=NoteListParams,
    overrides_built_in_tool=False,
    skip_permission=False,
)
