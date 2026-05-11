#!/usr/bin/env python3
"""
Generate YAML authoring constraints from ObjectModel CLI.

Takes a list of node types, queries om-cli for each, and outputs a concise
constraints document the Topic Engineer uses BEFORE generating YAML.

Usage:
    python tools/gen-constraints.py Question SendActivity ConditionGroup
    python tools/gen-constraints.py --from-file topic-plan.txt
"""

import json
import subprocess
import sys
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OM_CLI = os.path.join(SCRIPT_DIR, "om-cli", "om-cli.exe")


def query_schema(type_name: str) -> dict | None:
    try:
        result = subprocess.run(
            [OM_CLI, "schema", type_name],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            return json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
        pass
    return None


def extract_constraints(schema: dict) -> dict:
    """Extract generation-relevant constraints from a schema definition."""
    title = schema.get("title", "")
    required = schema.get("required", [])
    props = schema.get("properties", {})

    fields = []
    for name, prop in props.items():
        if name == "kind":
            continue
        field = {"name": name, "required": name in required}

        # Extract type info
        if "type" in prop:
            field["type"] = prop["type"]
        elif "$ref" in prop:
            ref = prop["$ref"].rsplit("/", 1)[-1]
            field["type"] = ref
        elif "const" in prop:
            field["type"] = f"const: {prop['const']}"
        elif "anyOf" in prop:
            options = []
            for opt in prop["anyOf"]:
                if "const" in opt:
                    options.append(str(opt["const"]))
                elif "$ref" in opt:
                    options.append(opt["$ref"].rsplit("/", 1)[-1])
                elif "type" in opt:
                    options.append(opt["type"])
            field["type"] = " | ".join(options)
        elif "oneOf" in prop:
            options = []
            for opt in prop["oneOf"]:
                if "$ref" in opt:
                    options.append(opt["$ref"].rsplit("/", 1)[-1])
                elif "type" in opt:
                    options.append(opt["type"])
            field["type"] = " | ".join(options)

        # Extract description
        if "description" in prop:
            field["description"] = prop["description"]
        if "title" in prop:
            field["title"] = prop["title"]
        if "default" in prop:
            field["default"] = prop["default"]

        fields.append(field)

    return {
        "title": title,
        "kind": schema.get("properties", {}).get("kind", {}).get("const", ""),
        "required": [f for f in required if f != "kind"],
        "fields": fields,
    }


def format_constraints(type_name: str, constraints: dict) -> str:
    """Format constraints as a concise text block."""
    lines = [f"### {type_name}"]
    if constraints["title"] and constraints["title"] != type_name:
        lines.append(f"  {constraints['title']}")

    req_set = set(constraints["required"])

    for field in constraints["fields"]:
        marker = "*" if field["name"] in req_set else " "
        type_str = field.get("type", "any")
        default = f" [default: {field['default']}]" if "default" in field else ""
        line = f"  {marker} {field['name']}: {type_str}{default}"
        lines.append(line)

    lines.append(f"  Required: {', '.join(constraints['required'])}")
    return "\n".join(lines)


def main():
    if len(sys.argv) < 2:
        print("Usage: python tools/gen-constraints.py <Type1> <Type2> ...")
        print("       python tools/gen-constraints.py --from-file <file>")
        sys.exit(1)

    if not os.path.exists(OM_CLI):
        print(f"Error: om-cli not found at {OM_CLI}", file=sys.stderr)
        print("Install .NET 10 and rebuild, or run setup.ps1 --full", file=sys.stderr)
        sys.exit(1)

    # Collect type names
    if sys.argv[1] == "--from-file":
        with open(sys.argv[2]) as f:
            types = [line.strip() for line in f if line.strip() and not line.startswith("#")]
    else:
        types = sys.argv[1:]

    print(f"# Generation Constraints ({len(types)} types)")
    print(f"# Fields marked * are REQUIRED — omitting them will cause validation errors.")
    print()

    errors = []
    for type_name in types:
        schema = query_schema(type_name)
        if schema is None:
            errors.append(type_name)
            print(f"### {type_name}")
            print(f"  ERROR: Type not found in schema")
            print()
            continue

        constraints = extract_constraints(schema)
        print(format_constraints(type_name, constraints))
        print()

    if errors:
        print(f"# WARNINGS: {len(errors)} type(s) not found: {', '.join(errors)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
