#!/usr/bin/env python3
"""
Drift detection: compare brief.json topic specs vs actual topic YAML files.

Detects:
  - Topics in spec but not built (missing)
  - Topics built but not in spec (extra)
  - Trigger type mismatches
  - Variable mismatches (expected vs actual)
  - Integration references in YAML not matching spec
  - YAML validation errors (via om-cli)

Usage:
    python tools/drift-detect.py <brief.json>
    python tools/drift-detect.py <brief.json> --topics-dir <path>
    python tools/drift-detect.py <brief.json> --validate
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
OM_CLI = SCRIPT_DIR / "om-cli" / "om-cli.exe"

# Map brief triggerType values to YAML kind values
TRIGGER_MAP = {
    "agent-chooses": "OnRecognizedIntent",
    "phrases": "OnRecognizedIntent",
    "fallback": "OnUnknownIntent",
    "redirect": "OnSystemRedirect",
    "escalation": "OnEscalate",
    "event": "OnEventActivity",
    "auto-start": "OnConversationStart",
    "inactivity": "OnInactivity",
}


def load_brief(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def find_topics_dir(brief_path: str, override: str | None) -> Path | None:
    if override:
        return Path(override)
    # Default: same directory as brief.json, under topics/
    brief_dir = Path(brief_path).parent
    topics_dir = brief_dir / "topics"
    if topics_dir.exists():
        return topics_dir
    return None


def parse_yaml_topic(filepath: Path) -> dict:
    """Extract key properties from a topic YAML file without a YAML parser dependency."""
    text = filepath.read_text(encoding="utf-8")
    result = {
        "file": filepath.name,
        "trigger_kind": None,
        "variables_init": [],
        "variables_read": [],
        "node_kinds": [],
        "integrations": [],
        "begin_dialogs": [],
    }

    # Extract trigger kind (beginDialog.kind)
    m = re.search(r"beginDialog:\s*\n\s+kind:\s+(\w+)", text)
    if m:
        result["trigger_kind"] = m.group(1)

    # Extract all kind values
    for m in re.finditer(r"kind:\s+(\w+)", text):
        kind = m.group(1)
        if kind not in ("AdaptiveDialog",):
            result["node_kinds"].append(kind)

    # Extract variable initializations (init:Topic.X)
    for m in re.finditer(r"init:Topic\.(\w+)", text):
        result["variables_init"].append(m.group(1))

    # Extract variable reads (Topic.X but not init:Topic.X)
    for m in re.finditer(r"(?<!init:)Topic\.(\w+)", text):
        var = m.group(1)
        if var not in result["variables_read"]:
            result["variables_read"].append(var)

    # Extract BeginDialog/ReplaceDialog targets
    for m in re.finditer(r"dialog:\s+template-content\.topic\.(\S+)", text):
        result["begin_dialogs"].append(m.group(1))

    # Extract connector references
    for m in re.finditer(r"kind:\s+InvokeConnectorAction", text):
        result["integrations"].append("connector")
    for m in re.finditer(r"kind:\s+InvokeFlowAction", text):
        result["integrations"].append("flow")
    for m in re.finditer(r"kind:\s+HttpRequestAction", text):
        result["integrations"].append("http")

    return result


def validate_yaml(filepath: Path) -> dict | None:
    """Run om-cli validate on a YAML file."""
    if not OM_CLI.exists():
        return None
    try:
        result = subprocess.run(
            [str(OM_CLI), "validate", "-f", str(filepath)],
            capture_output=True, text=True, timeout=10
        )
        return json.loads(result.stdout if result.stdout else result.stderr)
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
        return None


def detect_drift(brief_path: str, topics_dir_override: str | None = None,
                 do_validate: bool = False) -> dict:
    brief = load_brief(brief_path)
    topics_dir = find_topics_dir(brief_path, topics_dir_override)

    # Extract spec topics (MVP only)
    spec_topics = brief.get("conversations", {}).get("topics", [])
    spec_by_name = {}
    for t in spec_topics:
        if t.get("phase", "mvp") == "future":
            continue
        spec_by_name[t["name"]] = t

    report = {
        "specTopicCount": len(spec_by_name),
        "builtTopicCount": 0,
        "missing": [],
        "extra": [],
        "drifts": [],
        "validationErrors": [],
    }

    if not topics_dir or not topics_dir.exists():
        report["missing"] = list(spec_by_name.keys())
        report["error"] = f"Topics directory not found. Looked at: {topics_dir}"
        return report

    # Parse all built YAML files
    yaml_files = list(topics_dir.glob("*.yaml")) + list(topics_dir.glob("*.yml"))
    built = {}
    for yf in yaml_files:
        parsed = parse_yaml_topic(yf)
        # Use filename without extension as topic key
        name = yf.stem.replace("-", " ").replace("_", " ").title()
        built[yf.stem] = {"parsed": parsed, "guessed_name": name, "file": yf}

    report["builtTopicCount"] = len(built)

    # Match spec topics to built YAML files
    matched_files = set()
    for spec_name, spec in spec_by_name.items():
        # Try to match by schemaName or by name similarity
        match = None
        match_key = None

        schema_name = spec.get("schemaName", "")
        for key, b in built.items():
            if schema_name and schema_name.lower().replace("cr_", "") in key.lower():
                match = b
                match_key = key
                break

        if not match:
            # Fuzzy match by name
            name_lower = spec_name.lower().replace(" ", "").replace("-", "").replace("_", "")
            for key, b in built.items():
                key_lower = key.lower().replace(" ", "").replace("-", "").replace("_", "")
                if name_lower in key_lower or key_lower in name_lower:
                    match = b
                    match_key = key
                    break

        if not match:
            report["missing"].append(spec_name)
            continue

        matched_files.add(match_key)
        drifts = check_topic_drift(spec_name, spec, match["parsed"])
        if drifts:
            report["drifts"].extend(drifts)

        # Validate YAML if requested
        if do_validate:
            val_result = validate_yaml(match["file"])
            if val_result and not val_result.get("valid", True):
                for diag in val_result.get("diagnostics", []):
                    report["validationErrors"].append({
                        "topic": spec_name,
                        "file": match["file"].name,
                        "code": diag.get("Code", ""),
                        "message": diag.get("Message", ""),
                        "line": diag.get("Range", {}).get("Start", {}).get("Line"),
                    })

    # Find extra built files not in spec
    for key, b in built.items():
        if key not in matched_files:
            report["extra"].append({"file": b["file"].name, "guessedName": b["guessed_name"]})

    return report


def check_topic_drift(spec_name: str, spec: dict, parsed: dict) -> list:
    """Compare a spec topic against its parsed YAML."""
    drifts = []

    # Check trigger type
    expected_trigger = TRIGGER_MAP.get(spec.get("triggerType", ""), "")
    if expected_trigger and parsed["trigger_kind"] and parsed["trigger_kind"] != expected_trigger:
        drifts.append({
            "topic": spec_name,
            "type": "trigger_mismatch",
            "expected": f"{spec.get('triggerType')} -> {expected_trigger}",
            "actual": parsed["trigger_kind"],
        })

    # Check variables
    spec_vars = {v["name"] for v in spec.get("variables", [])}
    built_vars = set(parsed["variables_init"])
    missing_vars = spec_vars - built_vars
    extra_vars = built_vars - spec_vars

    if missing_vars:
        drifts.append({
            "topic": spec_name,
            "type": "missing_variables",
            "expected": sorted(missing_vars),
            "message": "Variables in spec but not initialized in YAML",
        })
    if extra_vars:
        drifts.append({
            "topic": spec_name,
            "type": "extra_variables",
            "actual": sorted(extra_vars),
            "message": "Variables initialized in YAML but not in spec",
        })

    # Check integrations
    spec_integrations = set(spec.get("connectedIntegrations", []))
    if spec_integrations and not parsed["integrations"]:
        drifts.append({
            "topic": spec_name,
            "type": "missing_integrations",
            "expected": sorted(spec_integrations),
            "message": "Spec references integrations but YAML has no connector/flow/http nodes",
        })

    return drifts


def format_report(report: dict) -> str:
    lines = ["# Drift Detection Report", ""]
    lines.append(f"Spec topics (MVP): {report['specTopicCount']}")
    lines.append(f"Built YAML files:  {report['builtTopicCount']}")
    lines.append("")

    if report.get("error"):
        lines.append(f"ERROR: {report['error']}")
        lines.append("")

    # Summary
    issues = len(report["missing"]) + len(report["extra"]) + len(report["drifts"]) + len(report["validationErrors"])
    if issues == 0:
        lines.append("NO DRIFT DETECTED")
        return "\n".join(lines)

    lines.append(f"ISSUES FOUND: {issues}")
    lines.append("")

    if report["missing"]:
        lines.append(f"## Missing Topics ({len(report['missing'])})")
        lines.append("Topics in spec but no matching YAML file found:")
        for name in report["missing"]:
            lines.append(f"  - {name}")
        lines.append("")

    if report["extra"]:
        lines.append(f"## Extra Topics ({len(report['extra'])})")
        lines.append("YAML files with no matching spec topic:")
        for item in report["extra"]:
            lines.append(f"  - {item['file']} (guessed: {item['guessedName']})")
        lines.append("")

    if report["drifts"]:
        lines.append(f"## Drifts ({len(report['drifts'])})")
        for d in report["drifts"]:
            lines.append(f"  [{d['topic']}] {d['type']}")
            if "expected" in d and "actual" in d:
                lines.append(f"    Expected: {d['expected']}")
                lines.append(f"    Actual:   {d['actual']}")
            elif "message" in d:
                lines.append(f"    {d['message']}")
                if "expected" in d:
                    lines.append(f"    Expected: {d['expected']}")
                if "actual" in d:
                    lines.append(f"    Actual:   {d['actual']}")
        lines.append("")

    if report["validationErrors"]:
        lines.append(f"## Validation Errors ({len(report['validationErrors'])})")
        for ve in report["validationErrors"]:
            line_info = f" (line {ve['line']})" if ve.get("line") is not None else ""
            lines.append(f"  [{ve['topic']}] {ve['file']}{line_info}: {ve['code']} — {ve['message']}")
        lines.append("")

    return "\n".join(lines)


def main():
    if len(sys.argv) < 2:
        print("Usage: python tools/drift-detect.py <brief.json> [--topics-dir <path>] [--validate] [--json]")
        sys.exit(1)

    brief_path = sys.argv[1]
    if not os.path.exists(brief_path):
        print(f"Error: Brief file not found: {brief_path}", file=sys.stderr)
        sys.exit(1)
    topics_dir = None
    do_validate = "--validate" in sys.argv
    output_json = "--json" in sys.argv

    for i, arg in enumerate(sys.argv):
        if arg == "--topics-dir" and i + 1 < len(sys.argv):
            topics_dir = sys.argv[i + 1]

    report = detect_drift(brief_path, topics_dir, do_validate)

    if output_json:
        print(json.dumps(report, indent=2))
    else:
        print(format_report(report))

    # Exit code: 0 if no drift, 1 if drift found
    issues = len(report["missing"]) + len(report["extra"]) + len(report["drifts"]) + len(report["validationErrors"])
    sys.exit(1 if issues > 0 else 0)


if __name__ == "__main__":
    main()
