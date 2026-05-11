from __future__ import annotations

import asyncio
import os
import sys
import json
from pathlib import Path
from typing import Any

import copilot
from copilot import CopilotClient
try:
    from copilot import ExternalServerConfig, SubprocessConfig
except ImportError:  # pragma: no cover - compatibility with older SDK exports
    from copilot.client import ExternalServerConfig, SubprocessConfig
try:
    from copilot import PermissionHandler
except ImportError:  # pragma: no cover - compatibility with older SDK exports
    from copilot.session import PermissionHandler
from .tools import note_write
from .tools import note_read
from .tools import note_list
from .session_fs import create_session_fs_handler


AGENT_ID = "virtual-fs-agent"
PACKAGE_ROOT = Path(__file__).resolve().parent


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _make_session_config(config: dict[str, Any]) -> dict[str, Any]:
    try:
        return copilot.SessionConfig(**config)
    except AttributeError:
        return dict(config)
    except TypeError:
        return dict(config)


def _as_create_session_kwargs(config: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        "agent", "available_tools", "client_name", "commands", "config_dir",
        "create_session_fs_handler", "custom_agents", "default_agent", "disabled_skills",
        "enable_config_discovery", "excluded_tools", "github_token", "hooks",
        "include_sub_agent_streaming_events", "infinite_sessions", "mcp_servers",
        "model", "model_capabilities", "on_elicitation_request", "on_event",
        "on_permission_request", "on_user_input_request", "provider", "reasoning_effort",
        "session_id", "skill_directories", "streaming", "system_message", "tools",
        "working_directory",
    }
    kwargs = {key: value for key, value in dict(config).items() if key in allowed}
    model = kwargs.get("model")
    if isinstance(model, dict):
        model_name = model.get("name")
        if model_name:
            kwargs["model"] = model_name
        else:
            kwargs.pop("model", None)
        if model.get("reasoning_effort"):
            kwargs["reasoning_effort"] = model["reasoning_effort"]
    return kwargs


def _build_client() -> CopilotClient:
    github_token = None
    options_kwargs: dict[str, Any] = {
        "cli_url": None,
        "cli_path": None,
        "use_stdio": True,
        "github_token": github_token,
        "use_logged_in_user": True,
        "log_level": "warning",
        "session_idle_timeout": None,
        "session_fs": {
            "initial_cwd": str(Path.cwd()),
            "session_state_path": str(Path.cwd() / ".session-state"),
            "conventions": "windows" if os.name == "nt" else "posix",
        },
    }
    options_type = getattr(copilot, "CopilotClientOptions", None) or getattr(copilot, "ClientOptions", None)
    if options_type is not None:
        return CopilotClient(options_type(**{key: value for key, value in options_kwargs.items() if value is not None}))
    if options_kwargs.get("cli_url"):
        return CopilotClient(ExternalServerConfig(url=options_kwargs["cli_url"], session_fs=options_kwargs.get("session_fs")))
    return CopilotClient(
        SubprocessConfig(
            cli_path=options_kwargs.get("cli_path"),
            use_stdio=bool(options_kwargs.get("use_stdio", True)),
            github_token=options_kwargs.get("github_token"),
            use_logged_in_user=options_kwargs.get("use_logged_in_user"),
            log_level=options_kwargs.get("log_level", "warning"),
            session_idle_timeout_seconds=options_kwargs.get("session_idle_timeout"),
            session_fs=options_kwargs.get("session_fs"),
        )
    )


def _build_session_config() -> dict[str, Any]:
    config: dict[str, Any] = {}
    config["on_permission_request"] = PermissionHandler.approve_all
    config["model"] = {"name": "claude-sonnet-4.5"}
    config["tools"] = [note_write.tool, note_read.tool, note_list.tool]
    config["mcp_servers"] = {"filesystem": {"args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"], "command": "npx", "type": "stdio"}}
    config["working_directory"] = "."
    config["streaming"] = True
    config["include_sub_agent_streaming_events"] = False
    config["infinite_sessions"] = {"enabled": False}
    config["create_session_fs_handler"] = create_session_fs_handler
    return _make_session_config(config)


def _event_type(event: Any) -> str:
    event_type = getattr(event, "type", "")
    return str(getattr(event_type, "value", event_type))


def _event_data(event: Any) -> Any:
    return getattr(event, "data", None)


def _handle_session_event(event: Any) -> None:
    event_type = _event_type(event)
    data = _event_data(event)
    if event_type == "assistant.message":
        print(getattr(data, "content", ""), file=sys.stderr)
    elif event_type == "session.error":
        print(f"Session error: {getattr(data, 'message', data)}", file=sys.stderr)


async def _create_session(client: CopilotClient, session_config: dict[str, Any]) -> Any:
    try:
        return await client.create_session(session_config)  # type: ignore[arg-type]
    except TypeError:
        return await client.create_session(**_as_create_session_kwargs(session_config))


async def _run() -> None:
    client = _build_client()
    session = None
    inbox_task = None
    try:
        session_config = _build_session_config()
        session = await _create_session(client, session_config)
        session.on(_handle_session_event)
        initial_prompt = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("AMP_INITIAL_PROMPT")
        if initial_prompt:
            await session.send_and_wait(initial_prompt)
        elif inbox_task is not None:
            await inbox_task
        else:
            print("No initial prompt provided. Set AMP_INITIAL_PROMPT or pass argv[1].", file=sys.stderr)
    finally:
        if inbox_task is not None:
            inbox_task.cancel()
            try:
                await inbox_task
            except asyncio.CancelledError:
                pass
        if session is not None:
            disconnect = getattr(session, "disconnect", None)
            if disconnect is not None:
                await disconnect()
        stop = getattr(client, "stop", None)
        if stop is not None:
            await stop()


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Interrupted. Shutting down.", file=sys.stderr)
