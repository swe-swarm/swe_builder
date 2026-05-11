#!/usr/bin/env python3
"""
Semantic gates for MCS topic YAML validation.

Five gates that catch errors om-cli's structural validation misses:
  1. PowerFx function validation — flags unknown functions
  2. Topic cross-references — BeginDialog/ReplaceDialog targets exist
  3. Variable flow — read-before-init, double-init
  4. Channel compatibility — card features vs channel limits
  5. Connector references — InvokeConnectorAction vs configured tools

Usage:
    python tools/semantic-gates.py <file.yaml>                          # Gates 1,3 (single file)
    python tools/semantic-gates.py <file.yaml> --brief <brief.json>     # All 5 gates
    python tools/semantic-gates.py --dir <topics/> --brief <brief.json> # All files + cross-refs
    python tools/semantic-gates.py <file.yaml> --gates 1,3,4            # Specific gates only
"""

import json
import os
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
CATALOG_PATH = SCRIPT_DIR / "powerfx-catalog.json"

# ---------------------------------------------------------------------------
# Gate 1: PowerFx Function Catalog
# ---------------------------------------------------------------------------
# Loaded from powerfx-catalog.json (official MS Learn Copilot Studio reference).
# Refresh the catalog by updating the JSON file -- no code changes needed.
# Source: https://learn.microsoft.com/power-platform/power-fx/formula-reference-copilot-studio


def _load_powerfx_catalog() -> set[str]:
    """Load PowerFx function catalog from JSON, with case-insensitive lookup."""
    functions = set()
    if CATALOG_PATH.exists():
        try:
            with open(CATALOG_PATH) as f:
                data = json.load(f)
            for fn in data.get("functions", []):
                functions.add(fn)           # Original case (e.g., "DateAdd")
                functions.add(fn.lower())   # Allow lowercase (e.g., "dateadd")
        except (json.JSONDecodeError, KeyError):
            pass
    if not functions:
        # Minimal fallback if catalog file is missing
        functions = {"If", "And", "Or", "Not", "Text", "Value", "Blank", "Concatenate",
                     "if", "and", "or", "not", "text", "value", "blank", "concatenate"}
    return functions


POWERFX_FUNCTIONS = _load_powerfx_catalog()


# ---------------------------------------------------------------------------
# Gate 4: Channel Compatibility Rules
# ---------------------------------------------------------------------------

CHANNEL_RULES = {
    "teams": {
        "max_card_version": "1.5",
        "blocked_actions": ["Action.Execute"],
        "max_card_size_kb": 28,
        "max_actions": 6,
        "notes": "No standalone Image cards",
    },
    "webchat": {
        "max_card_version": "1.6",
        "blocked_actions": ["Action.Execute"],
        "max_card_size_kb": 100,
        "max_actions": 10,
        "notes": "",
    },
    "whatsapp": {
        "max_card_version": "1.3",
        "blocked_actions": ["Action.Execute", "Action.ShowCard", "Action.ToggleVisibility"],
        "max_actions": 3,
        "max_card_size_kb": 10,
        "notes": "Only Input.ChoiceSet supported, max 3 Action.Submit",
    },
    "m365-copilot": {
        "max_card_version": "1.5",
        "blocked_actions": ["Action.Execute"],
        "max_card_size_kb": 28,
        "max_actions": 6,
        "notes": "Limited card support",
    },
}


def extract_powerfx_functions(text: str) -> list[dict]:
    """Extract function calls from PowerFx expressions in YAML."""
    findings = []
    lines = text.split("\n")
    for i, line in enumerate(lines, 1):
        # Find expressions starting with =
        for match in re.finditer(r'=\s*(.+?)(?:\s*$|")', line):
            expr = match.group(1)
            # Extract function calls: FunctionName(
            for fn_match in re.finditer(r'\b([A-Za-z_]\w*)\s*\(', expr):
                fn_name = fn_match.group(1)
                # Skip variable scope prefixes and common non-function identifiers
                if fn_name in ("Topic", "System", "Global", "User", "init", "Environment"):
                    continue
                # Skip lowercase identifiers that look like variable names (not PowerFx functions)
                if fn_name[0].islower() and fn_name not in POWERFX_FUNCTIONS:
                    continue
                findings.append({"function": fn_name, "line": i, "expression": expr.strip()})
    return findings


def gate1_powerfx(text: str) -> list[dict]:
    """Gate 1: PowerFx function validation."""
    issues = []
    for call in extract_powerfx_functions(text):
        if call["function"] not in POWERFX_FUNCTIONS:
            issues.append({
                "gate": 1,
                "severity": "warning",
                "type": "unknown_function",
                "message": f"Unknown PowerFx function: {call['function']}()",
                "line": call["line"],
                "detail": call["expression"],
            })
    return issues


def gate2_cross_references(text: str, all_topic_schemas: set[str] | None = None) -> list[dict]:
    """Gate 2: Topic cross-reference validation."""
    issues = []
    for match in re.finditer(r'dialog:\s+template-content\.topic\.(\S+)', text):
        target = match.group(1)
        line = text[:match.start()].count("\n") + 1
        if all_topic_schemas is not None and target not in all_topic_schemas:
            issues.append({
                "gate": 2,
                "severity": "error",
                "type": "broken_cross_reference",
                "message": f"BeginDialog/ReplaceDialog target not found: {target}",
                "line": line,
                "detail": f"Known topics: {sorted(all_topic_schemas) if all_topic_schemas else 'none'}",
            })
    return issues


def gate3_variable_flow(text: str) -> list[dict]:
    """Gate 3: Variable flow analysis."""
    issues = []
    lines = text.split("\n")

    # Track variable initialization and read order
    inits = {}   # var_name -> first init line
    reads = {}   # var_name -> first read line

    for i, line in enumerate(lines, 1):
        # Detect init:Topic.X
        for match in re.finditer(r'init:Topic\.(\w+)', line):
            var = match.group(1)
            if var in inits:
                issues.append({
                    "gate": 3,
                    "severity": "warning",
                    "type": "double_init",
                    "message": f"Variable Topic.{var} initialized twice (first at line {inits[var]})",
                    "line": i,
                })
            else:
                inits[var] = i

        # Detect reads of Topic.X (but not init:Topic.X, not in variable: declarations)
        stripped = line.strip()
        if stripped.startswith("variable:"):
            continue
        for match in re.finditer(r'(?<!init:)(?<!variable:\s)Topic\.(\w+)', line):
            var = match.group(1)
            if var not in reads:
                reads[var] = i

    # Check for reads before init
    for var, read_line in reads.items():
        if var in inits and read_line < inits[var]:
            issues.append({
                "gate": 3,
                "severity": "error",
                "type": "read_before_init",
                "message": f"Topic.{var} read at line {read_line} before init at line {inits[var]}",
                "line": read_line,
            })

    return issues


def gate4_channel_compat(text: str, channels: list[str] | None = None) -> list[dict]:
    """Gate 4: Channel compatibility checks for adaptive cards."""
    issues = []
    if not channels:
        channels = ["teams", "webchat"]  # Default check targets

    # Extract card content
    card_sections = re.findall(r'card(?:Content)?:\s*[|>]?-?\s*\n((?:\s+.*\n)*)', text)
    card_text = "\n".join(card_sections) if card_sections else ""

    # Also check inline card JSON
    for match in re.finditer(r'"type"\s*:\s*"AdaptiveCard"', text):
        start = max(0, match.start() - 500)
        end = min(len(text), match.end() + 2000)
        card_text += text[start:end]

    if not card_text:
        return issues

    for channel in channels:
        rules = CHANNEL_RULES.get(channel, {})
        if not rules:
            continue

        # Check blocked actions
        for action in rules.get("blocked_actions", []):
            for match in re.finditer(re.escape(f'"{action}"'), card_text):
                line = text[:text.find(action)].count("\n") + 1 if action in text else 0
                issues.append({
                    "gate": 4,
                    "severity": "error",
                    "type": "blocked_card_action",
                    "message": f"{action} not supported on {channel}",
                    "line": line,
                    "detail": rules.get("notes", ""),
                })

        # Check card version
        max_ver = rules.get("max_card_version", "1.6")
        for match in re.finditer(r'"version"\s*:\s*"(\d+\.\d+)"', card_text):
            ver = match.group(1)
            if tuple(int(x) for x in ver.split(".")) > tuple(int(x) for x in max_ver.split(".")):
                line = text[:text.find(match.group(0))].count("\n") + 1 if match.group(0) in text else 0
                issues.append({
                    "gate": 4,
                    "severity": "error",
                    "type": "card_version_too_high",
                    "message": f"Card version {ver} exceeds {channel} max ({max_ver})",
                    "line": line,
                })

    # Estimate card size (rough)
    if len(card_text.encode("utf-8")) > 28 * 1024:
        issues.append({
            "gate": 4,
            "severity": "warning",
            "type": "card_too_large",
            "message": f"Card content ~{len(card_text.encode('utf-8')) // 1024}KB may exceed Teams 28KB limit",
            "line": 0,
        })

    return issues


def gate5_connector_refs(text: str, configured_tools: set[str] | None = None) -> list[dict]:
    """Gate 5: Connector/tool reference validation."""
    issues = []
    if configured_tools is None:
        return issues  # Can't validate without brief context

    # Find InvokeConnectorAction references
    for match in re.finditer(r'kind:\s+InvokeConnectorAction', text):
        line = text[:match.start()].count("\n") + 1
        # Try to find the connectionReference or actionName nearby
        context = text[match.start():match.start() + 500]
        ref_match = re.search(r'connectionReference:\s+(\S+)', context)
        action_match = re.search(r'actionName:\s+(\S+)', context)

        ref_name = ref_match.group(1) if ref_match else "unknown"
        if ref_name != "unknown" and ref_name not in configured_tools:
            issues.append({
                "gate": 5,
                "severity": "error",
                "type": "unknown_connector",
                "message": f"Connector reference '{ref_name}' not found in configured tools",
                "line": line,
                "detail": f"Configured: {sorted(configured_tools)}",
            })

    # Find InvokeFlowAction references
    for match in re.finditer(r'kind:\s+InvokeFlowAction', text):
        line = text[:match.start()].count("\n") + 1
        context = text[match.start():match.start() + 500]
        flow_match = re.search(r'flowId:\s+(\S+)', context)
        flow_name = flow_match.group(1) if flow_match else "unknown"
        if flow_name != "unknown" and flow_name not in configured_tools:
            issues.append({
                "gate": 5,
                "severity": "warning",
                "type": "unverified_flow",
                "message": f"Flow reference '{flow_name}' not verified against configured tools",
                "line": line,
            })

    return issues


def load_brief_context(brief_path: str) -> dict:
    """Extract semantic gate context from brief.json."""
    with open(brief_path) as f:
        brief = json.load(f)

    context = {
        "channels": [],
        "tools": set(),
        "topic_schemas": set(),
    }

    # Channels
    for ch in brief.get("channels", {}).get("primary", []):
        if isinstance(ch, str):
            context["channels"].append(ch.lower())
        elif isinstance(ch, dict):
            context["channels"].append(ch.get("channel", "").lower())

    # Tools/integrations
    for tool in brief.get("integrations", []):
        if isinstance(tool, dict):
            name = tool.get("name", "")
            if name:
                context["tools"].add(name)
            connector = tool.get("connector", "")
            if connector:
                context["tools"].add(connector)

    # Topic schema names
    for topic in brief.get("conversations", {}).get("topics", []):
        schema = topic.get("schemaName", "")
        if schema:
            context["topic_schemas"].add(schema)

    return context


def run_gates(filepath: str, brief_path: str | None = None,
              gate_filter: set[int] | None = None) -> list[dict]:
    """Run all applicable semantic gates on a YAML file."""
    text = Path(filepath).read_text(encoding="utf-8")
    all_issues = []

    # Load brief context if available
    context = load_brief_context(brief_path) if brief_path else {}

    gates_to_run = gate_filter or {1, 2, 3, 4, 5}

    if 1 in gates_to_run:
        all_issues.extend(gate1_powerfx(text))

    if 2 in gates_to_run:
        schemas = context.get("topic_schemas") if context else None
        all_issues.extend(gate2_cross_references(text, schemas))

    if 3 in gates_to_run:
        all_issues.extend(gate3_variable_flow(text))

    if 4 in gates_to_run:
        channels = context.get("channels") if context else None
        all_issues.extend(gate4_channel_compat(text, channels))

    if 5 in gates_to_run:
        tools = context.get("tools") if context else None
        all_issues.extend(gate5_connector_refs(text, tools))

    return all_issues


def suggest_fix(issue: dict) -> str | None:
    """Generate an auto-fix suggestion for an issue."""
    t = issue["type"]

    if t == "unknown_function":
        fn = issue["message"].split(":")[1].strip().rstrip("()")
        # Check for close matches in catalog
        fn_lower = fn.lower()
        close = [f for f in POWERFX_FUNCTIONS if f.lower().startswith(fn_lower[:3]) and f[0].isupper()]
        if close:
            return f"Did you mean: {', '.join(sorted(set(close))[:5])}?"
        return f"Remove or replace {fn}() -- not in Copilot Studio Power Fx catalog."

    if t == "read_before_init":
        # Extract variable name from message
        m = re.search(r'Topic\.(\w+)', issue["message"])
        if m:
            var = m.group(1)
            return f"Add `init:Topic.{var}` in a SetVariable node BEFORE line {issue['line']}."
        return None

    if t == "double_init":
        m = re.search(r'Topic\.(\w+)', issue["message"])
        if m:
            var = m.group(1)
            return f"Remove duplicate init -- use `Topic.{var}` (without init:) for subsequent assignments."
        return None

    if t == "broken_cross_reference":
        return "Check the target topic's schemaName or create the missing topic."

    if t == "blocked_card_action":
        action = issue["message"].split(" not ")[0]
        if "Execute" in action:
            return "Replace Action.Execute with Action.Submit (supported in MCS)."
        if "ShowCard" in action:
            return "Move ShowCard content to a separate message or use ToggleVisibility."
        return f"Remove {action} for this channel."

    if t == "card_version_too_high":
        m = re.search(r'max \((\d+\.\d+)\)', issue["message"])
        target = m.group(1) if m else "1.5"
        return f'Change card version to "{target}" for compatibility.'

    if t == "card_too_large":
        return "Simplify the card: reduce body elements, split into multiple cards, or use a carousel."

    if t == "unknown_connector":
        return "Check the connector name in MCS Tools tab. It may differ from brief.json (e.g., 'Jira' vs 'Atlassian Jira Cloud')."

    if t == "unverified_flow":
        return "Verify the flow exists in Power Automate and is shared with the agent."

    return None


def format_report(filepath: str, issues: list[dict], show_fixes: bool = False) -> str:
    lines = [f"# Semantic Gates: {Path(filepath).name}", ""]

    if not issues:
        lines.append("ALL GATES PASSED")
        return "\n".join(lines)

    errors = [i for i in issues if i["severity"] == "error"]
    warnings = [i for i in issues if i["severity"] == "warning"]
    lines.append(f"ISSUES: {len(errors)} error(s), {len(warnings)} warning(s)")
    lines.append("")

    gate_names = {1: "PowerFx", 2: "Cross-References", 3: "Variable Flow",
                  4: "Channel Compat", 5: "Connector Refs"}

    # Group by gate
    by_gate = {}
    for issue in issues:
        g = issue["gate"]
        by_gate.setdefault(g, []).append(issue)

    for gate_num in sorted(by_gate.keys()):
        gate_issues = by_gate[gate_num]
        lines.append(f"## Gate {gate_num}: {gate_names.get(gate_num, '?')} ({len(gate_issues)} issue(s))")
        for issue in gate_issues:
            sev = "ERROR" if issue["severity"] == "error" else "WARN"
            line_info = f" (line {issue['line']})" if issue.get("line") else ""
            lines.append(f"  [{sev}]{line_info} {issue['message']}")
            if "detail" in issue:
                lines.append(f"         {issue['detail']}")
            if show_fixes:
                fix = suggest_fix(issue)
                if fix:
                    lines.append(f"         FIX: {fix}")
        lines.append("")

    return "\n".join(lines)


def main():
    if len(sys.argv) < 2:
        print("Usage: python tools/semantic-gates.py <file.yaml> [--brief <brief.json>] [--dir <topics/>] [--gates 1,3,4] [--fix] [--json]")
        sys.exit(1)

    # Parse args
    brief_path = None
    topics_dir = None
    gate_filter = None
    output_json = "--json" in sys.argv
    show_fixes = "--fix" in sys.argv
    files = []

    i = 1
    while i < len(sys.argv):
        arg = sys.argv[i]
        if arg == "--brief" and i + 1 < len(sys.argv):
            brief_path = sys.argv[i + 1]
            i += 2
        elif arg == "--dir" and i + 1 < len(sys.argv):
            topics_dir = sys.argv[i + 1]
            i += 2
        elif arg == "--gates" and i + 1 < len(sys.argv):
            gate_filter = {int(g) for g in sys.argv[i + 1].split(",")}
            i += 2
        elif arg in ("--json", "--fix"):
            i += 1
        elif not arg.startswith("--"):
            files.append(arg)
            i += 1
        else:
            i += 1

    # Collect files
    if topics_dir:
        td = Path(topics_dir)
        files.extend(str(f) for f in td.glob("*.yaml"))
        files.extend(str(f) for f in td.glob("*.yml"))

    if not files:
        print("Error: No YAML files specified", file=sys.stderr)
        sys.exit(1)

    all_results = {}
    total_errors = 0
    total_warnings = 0

    for filepath in files:
        if not os.path.exists(filepath):
            print(f"Warning: {filepath} not found, skipping", file=sys.stderr)
            continue
        issues = run_gates(filepath, brief_path, gate_filter)
        all_results[filepath] = issues
        total_errors += sum(1 for i in issues if i["severity"] == "error")
        total_warnings += sum(1 for i in issues if i["severity"] == "warning")

    if output_json:
        if show_fixes:
            for filepath, issues in all_results.items():
                for issue in issues:
                    fix = suggest_fix(issue)
                    if fix:
                        issue["fix"] = fix
        print(json.dumps(all_results, indent=2, default=str))
    else:
        for filepath, issues in all_results.items():
            print(format_report(filepath, issues, show_fixes))

    sys.exit(1 if total_errors > 0 else 0)


if __name__ == "__main__":
    main()
