"""Shared readiness calculation and project-scanning utilities.

Used by server.py for the API layer. Single source of truth for
readiness calculation, stage detection, and project scanning.
"""
from __future__ import annotations  # PEP 604 union types on Python <3.10

import csv
import json
import re
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PROJECT_FILE_MAP = {
    "sdr_raw": "sdr-raw.md",
    "customer_context": "customer-context.md",
}

AGENT_FILE_MAP = {
    "brief": "brief.json",
    "evals_csv": "evals.csv",
    "evals_results": "evals-results.json",
    "build_report": "build-report.md",
}

SKIP_FOLDERS = {"topics", ".git", "__pycache__", "node_modules"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def humanize_name(folder_name: str) -> str:
    """Convert folder name to display name."""
    overrides = {
        "CDW": "CDW",
        "RoB-Manager": "RoB Manager",
        "DailyBriefing": "Daily Briefing",
    }
    if folder_name in overrides:
        return overrides[folder_name]
    name = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", folder_name)
    name = name.replace("-", " ").replace("_", " ")
    return name.title()


def _is_v2(brief: dict) -> bool:
    """Check if brief uses v2 schema (named sections) vs v1 (step1-4)."""
    return brief.get("_schema") == "2.0" or "agent" in brief


# ---------------------------------------------------------------------------
# Readiness calculation
# ---------------------------------------------------------------------------

def _count_eval_tests(brief: dict) -> int:
    """Count total tests across all eval sets."""
    return sum(len(s.get("tests", [])) for s in brief.get("evalSets", []))

def _has_eval_results(brief: dict) -> bool:
    """Check if any eval test has a lastResult."""
    for s in brief.get("evalSets", []):
        for t in s.get("tests", []):
            if t.get("lastResult"):
                return True
    # Fallback: check legacy evalResults
    return bool(brief.get("evalResults", {}).get("summary", {}).get("total", 0) > 0)

def calc_readiness(brief: dict | None) -> int:
    """Calculate brief readiness as a percentage (0-100).

    Supports both v1 (step1-4) and v2 (named sections) brief schemas.
    Uses 11 checks for v2, 10 checks for v1.
    """
    if not brief:
        return 0

    open_qs = brief.get("openQuestions", [])
    unanswered = [q for q in open_qs if q.get("question") and not q.get("answer")]
    build_status = brief.get("buildStatus", {})

    if _is_v2(brief):
        biz = brief.get("business", {})
        arch = brief.get("architecture", {})
        integ = brief.get("integrations", [])
        know = brief.get("knowledge", [])
        convos = brief.get("conversations", {})
        bounds = brief.get("boundaries", {})

        checks = [
            bool(biz.get("problemStatement") or biz.get("useCase")),
            bool(arch.get("type")),
            bool(brief.get("instructions")),
            len([i for i in integ if i.get("name")]) + len(convos.get("topics", [])) > 0,
            len([k for k in know if k.get("name")]) > 0,
            _count_eval_tests(brief) >= 5,
            bool(bounds.get("handle") or bounds.get("decline") or bounds.get("refuse")),
            len([c for c in arch.get("channels", []) if (c.get("name") if isinstance(c, dict) else c)]) > 0,
            len(unanswered) == 0,
            build_status.get("status") == "published",
            _has_eval_results(brief),
        ]
    else:
        # v1 fallback
        s1 = brief.get("step1", {})
        s2 = brief.get("step2", {})
        s3 = brief.get("step3", {})
        s4 = brief.get("step4", {})
        v1_evals = brief.get("evals", [])

        checks = [
            bool(s1.get("problem")),
            bool(s4.get("architectureRecommendation")),
            len([s for s in s3.get("systems", []) if s.get("name")]) > 0,
            len([k for k in s3.get("knowledge", []) if k.get("name")]) > 0,
            len([s for s in s2.get("scenarios", []) if s.get("userSays")]) >= 3,
            len(v1_evals) > 0,
            bool(s2.get("handle") or s2.get("decline") or s2.get("refuse")),
            len(s4.get("channels", [])) > 0,
            len(unanswered) == 0,
            bool(brief.get("instructions")),
        ]
    return round(sum(checks) / len(checks) * 100)


def is_build_ready(brief: dict | None) -> bool:
    """All 9 pre-build design checks must pass before build is allowed.

    Excludes 'Build published' and 'Eval results' (those happen AFTER build).
    """
    if not brief:
        return False

    if not _is_v2(brief):
        # v1: all 10 checks must pass — equivalent to calc_readiness == 100
        return calc_readiness(brief) == 100

    # v2: check the 9 pre-build checks (all except build published + eval results)
    biz = brief.get("business", {})
    arch = brief.get("architecture", {})
    integ = brief.get("integrations", [])
    know = brief.get("knowledge", [])
    convos = brief.get("conversations", {})
    bounds = brief.get("boundaries", {})
    open_qs = brief.get("openQuestions", [])
    unanswered = [q for q in open_qs if q.get("question") and not q.get("answer")]

    return all([
        biz.get("problemStatement") or biz.get("useCase"),
        arch.get("type"),
        brief.get("instructions"),
        len([i for i in integ if i.get("name")]) + len(convos.get("topics", [])) > 0,
        len([k for k in know if k.get("name")]) > 0,
        _count_eval_tests(brief) >= 5,
        bounds.get("handle") or bounds.get("decline") or bounds.get("refuse"),
        len([c for c in arch.get("channels", []) if (c.get("name") if isinstance(c, dict) else c)]) > 0,
        len(unanswered) == 0,
    ])


# ---------------------------------------------------------------------------
# Stage determination
# ---------------------------------------------------------------------------

def determine_stage(agents: list[dict]) -> str:
    """Determine the furthest pipeline stage from agent data.

    Stage progression: discovery -> context -> research -> build -> eval -> deployed
    Supports both v1 (step1-4) and v2 (named sections) brief schemas.
    """
    if not agents:
        return "discovery"

    best_stage = "discovery"
    stage_order = ["discovery", "context", "research", "build", "eval", "deployed"]

    for agent in agents:
        brief = agent.get("_brief")
        if not brief:
            continue

        # Check eval results (new: evalSets tests, legacy: evalResults)
        has_results = _has_eval_results(brief)
        if has_results:
            agent_stage = "eval"
        elif brief.get("buildStatus", {}).get("status") in ("published", "in_progress"):
            agent_stage = "build"
        elif _is_v2(brief):
            arch = brief.get("architecture", {})
            if brief.get("instructions") and arch.get("type"):
                agent_stage = "research"
            elif brief.get("business", {}).get("problemStatement") or brief.get("agent", {}).get("name"):
                agent_stage = "context"
            else:
                agent_stage = "discovery"
        else:
            # v1 fallback
            if brief.get("instructions") and brief.get("step4", {}).get("architectureRecommendation"):
                agent_stage = "research"
            elif brief.get("step1", {}).get("problem"):
                agent_stage = "context"
            else:
                agent_stage = "discovery"

        if stage_order.index(agent_stage) > stage_order.index(best_stage):
            best_stage = agent_stage

    return best_stage


# ---------------------------------------------------------------------------
# Agent scanning
# ---------------------------------------------------------------------------

def count_csv_rows(filepath) -> int:
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            reader = csv.reader(f)
            next(reader, None)
            return sum(1 for _ in reader)
    except Exception:
        return 0


def scan_agents(project_folder: Path) -> list[dict]:
    """Scan agents/ subfolder for per-agent brief.json files.

    Supports both v1 (step1-4) and v2 (named sections) brief schemas.
    """
    agents_dir = project_folder / "agents"
    agents = []

    if not agents_dir.exists():
        return agents

    for agent_dir in sorted(agents_dir.iterdir()):
        if not agent_dir.is_dir() or agent_dir.name.startswith("."):
            continue

        brief = None
        brief_file = agent_dir / "brief.json"
        if brief_file.exists():
            try:
                brief = json.loads(brief_file.read_text(encoding="utf-8-sig"))
            except Exception:
                pass

        readiness = calc_readiness(brief) if brief else 0

        agent_files = {}
        for key, filename in AGENT_FILE_MAP.items():
            agent_files[key] = (agent_dir / filename).exists()

        eval_count = count_csv_rows(agent_dir / "evals.csv") if agent_files.get("evals_csv") else 0

        if brief and _is_v2(brief):
            agent_sec = brief.get("agent", {})
            biz = brief.get("business", {})
            arch = brief.get("architecture", {})
            integ = brief.get("integrations", [])
            know = brief.get("knowledge", [])

            agent_name = agent_sec.get("name", "") or humanize_name(agent_dir.name)
            description = (biz.get("problemStatement", "") or biz.get("useCase", ""))[:300]
            architecture = arch.get("type", "tbd")
            architecture_score = arch.get("score", "TBD")
            tools = [i.get("name", "") for i in integ if i.get("name")][:10]
            knowledge = [k.get("name", "") for k in know if k.get("name")][:10]
        elif brief:
            s1 = brief.get("step1", {})
            s3 = brief.get("step3", {})
            s4 = brief.get("step4", {})

            agent_name = s1.get("agentName", humanize_name(agent_dir.name))
            description = s1.get("problem", "")[:300]
            architecture = s4.get("architectureRecommendation", "tbd")
            architecture_score = s4.get("architectureScore", "TBD")
            tools = [s.get("name", "") for s in s3.get("systems", []) if s.get("name")][:10]
            knowledge = [k.get("name", "") for k in s3.get("knowledge", []) if k.get("name")][:10]
        else:
            agent_name = humanize_name(agent_dir.name)
            description = ""
            architecture = "tbd"
            architecture_score = "TBD"
            tools = []
            knowledge = []

        agents.append({
            "id": agent_dir.name,
            "name": agent_name,
            "description": description,
            "architecture": architecture,
            "architecture_score": architecture_score,
            "tools": tools,
            "knowledge": knowledge,
            "has_brief": brief is not None,
            "has_instructions": bool(brief.get("instructions")) if brief else False,
            "has_evals": agent_files.get("evals_csv", False),
            "has_build_report": agent_files.get("build_report", False),
            "readiness": readiness,
            "eval_count": eval_count,
            "open_questions": len([q for q in brief.get("openQuestions", []) if q.get("question") and not q.get("answer")]) if brief else 0,
            "_brief": brief,  # internal, used by determine_stage, stripped before output
        })

    return agents


# ---------------------------------------------------------------------------
# Project scanner
# ---------------------------------------------------------------------------

def scan_project(folder: Path, base_dir: Path | None = None) -> dict:
    """Scan a project folder and return structured data.

    Args:
        folder: The project folder to scan.
        base_dir: The parent of Build-Guides/ (for relative paths). Defaults to folder.parent.parent.
    """
    if base_dir is None:
        base_dir = folder.parent.parent

    project = {
        "id": folder.name,
        "name": humanize_name(folder.name),
        "path": str(folder.relative_to(base_dir)),
        "files": {},
        "agents": [],
        "stats": {},
    }

    for key, filename in PROJECT_FILE_MAP.items():
        project["files"][key] = (folder / filename).exists()

    agents = scan_agents(folder)
    project["stage"] = determine_stage(agents)

    for agent in agents:
        agent.pop("_brief", None)

    project["agents"] = agents

    if not project["agents"]:
        docs_dir = folder / "docs"
        has_docs = docs_dir.exists() and any(docs_dir.iterdir()) if docs_dir.exists() else False

        project["agents"] = [{
            "id": folder.name,
            "name": project["name"],
            "description": "",
            "architecture": "tbd",
            "architecture_score": "TBD",
            "tools": [],
            "knowledge": [],
            "has_brief": False,
            "has_instructions": False,
            "has_evals": False,
            "has_build_report": False,
            "readiness": 0,
            "eval_count": 0,
            "open_questions": 0,
        }]

    project["stats"]["total_agents"] = len(project["agents"])
    project["stats"]["eval_count"] = sum(a.get("eval_count", 0) for a in project["agents"])

    return project
