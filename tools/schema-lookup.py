#!/usr/bin/env python3
"""
MCS Schema Lookup Tool

Token-efficient utility to query the Copilot Studio authoring schema (200KB+)
without loading it into context. Use this to validate YAML node kinds, check
required properties, resolve $ref chains, and verify entity references.

Usage:
    python schema-lookup.py lookup <definition_name>    # Get single definition
    python schema-lookup.py search <search_term>        # Find matching definitions
    python schema-lookup.py resolve <definition_name>   # Fully expand all $refs
    python schema-lookup.py kinds                       # List all valid 'kind' values
    python schema-lookup.py entities                    # List all prebuilt entities
    python schema-lookup.py validate <yaml_file>        # Validate kind values in a YAML file

Adapted from Copilot Studio Lab project. Path resolution updated for this repo.
"""

import sys
import json
import os
import re
from pathlib import Path


class SchemaLookup:
    def __init__(self, schema_file_path):
        """Initialize the schema lookup with the given schema file."""
        self.schema_file_path = schema_file_path
        self.schema_data = None
        self.load_schema()

    def load_schema(self):
        """Load the JSON schema file."""
        try:
            with open(self.schema_file_path, 'r', encoding='utf-8') as f:
                self.schema_data = json.load(f)
        except FileNotFoundError:
            print(f"Error: Schema file not found at {self.schema_file_path}")
            sys.exit(1)
        except json.JSONDecodeError as e:
            print(f"Error: Invalid JSON in schema file: {e}")
            sys.exit(1)

    def lookup(self, definition_name):
        """Look up a specific definition in the schema."""
        if not self.schema_data or 'definitions' not in self.schema_data:
            print("Error: No definitions found in schema")
            return None

        definitions = self.schema_data['definitions']
        if definition_name in definitions:
            return definitions[definition_name]
        else:
            # Try case-insensitive match
            for key in definitions:
                if key.lower() == definition_name.lower():
                    print(f"(matched as '{key}')")
                    return definitions[key]
            print(f"Error: Definition '{definition_name}' not found")
            return None

    def search(self, search_term):
        """Search for definitions containing the search term in their name."""
        if not self.schema_data or 'definitions' not in self.schema_data:
            print("Error: No definitions found in schema")
            return []

        definitions = self.schema_data['definitions']
        matching_definitions = []

        for def_name in definitions.keys():
            if search_term.lower() in def_name.lower():
                matching_definitions.append(def_name)

        return sorted(matching_definitions)

    def resolve_refs(self, obj, visited=None):
        """Recursively resolve $ref references in a JSON object."""
        if visited is None:
            visited = set()

        if isinstance(obj, dict):
            if '$ref' in obj:
                ref_path = obj['$ref']
                if ref_path.startswith('#/definitions/'):
                    def_name = ref_path[len('#/definitions/'):]

                    # Prevent infinite recursion
                    if def_name in visited:
                        return {"$ref": ref_path, "_circular_reference": True}

                    visited.add(def_name)
                    definition = self.lookup(def_name)
                    if definition:
                        resolved = self.resolve_refs(definition, visited.copy())
                        visited.discard(def_name)
                        return resolved
                    else:
                        return obj
                else:
                    return obj
            else:
                resolved_obj = {}
                for key, value in obj.items():
                    resolved_obj[key] = self.resolve_refs(value, visited)
                return resolved_obj
        elif isinstance(obj, list):
            return [self.resolve_refs(item, visited) for item in obj]
        else:
            return obj

    def resolve(self, definition_name):
        """Resolve a definition with all $ref references expanded."""
        definition = self.lookup(definition_name)
        if definition is None:
            return None

        return self.resolve_refs(definition)

    def get_kinds(self):
        """Get all available 'kind' discriminator values from the schema."""
        if not self.schema_data or 'definitions' not in self.schema_data:
            print("Error: No definitions found in schema")
            return []

        kinds = set()
        definitions = self.schema_data['definitions']

        def extract_kinds_from_obj(obj):
            """Recursively extract kind values from an object."""
            if isinstance(obj, dict):
                if 'kind' in obj and isinstance(obj['kind'], dict) and 'const' in obj['kind']:
                    kinds.add(obj['kind']['const'])

                if 'properties' in obj and isinstance(obj['properties'], dict):
                    if 'kind' in obj['properties'] and isinstance(obj['properties']['kind'], dict):
                        if 'const' in obj['properties']['kind']:
                            kinds.add(obj['properties']['kind']['const'])

                for value in obj.values():
                    extract_kinds_from_obj(value)
            elif isinstance(obj, list):
                for item in obj:
                    extract_kinds_from_obj(item)

        for definition in definitions.values():
            extract_kinds_from_obj(definition)

        return sorted(list(kinds))

    def get_entities(self):
        """Get all prebuilt entity names from the schema."""
        if not self.schema_data or 'definitions' not in self.schema_data:
            print("Error: No definitions found in schema")
            return []

        results = self.search("PrebuiltEntity")
        # Also search for Entity definitions
        entity_defs = self.search("Entity")
        # Combine and deduplicate
        all_entities = sorted(set(results + [e for e in entity_defs if "Entity" in e]))
        return all_entities

    def validate_yaml_kinds(self, yaml_file_path):
        """Validate all 'kind:' values in a YAML file against the schema."""
        try:
            with open(yaml_file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except FileNotFoundError:
            print(f"Error: YAML file not found at {yaml_file_path}")
            return False

        # Extract all kind: values using regex (works without YAML parser)
        kind_pattern = re.compile(r'^\s*kind:\s*(\S+)', re.MULTILINE)
        found_kinds = kind_pattern.findall(content)

        if not found_kinds:
            print("No 'kind:' values found in file")
            return True

        valid_kinds = set(self.get_kinds())
        all_valid = True
        seen = set()

        for kind in found_kinds:
            if kind in seen:
                continue
            seen.add(kind)

            if kind in valid_kinds:
                print(f"  OK: {kind}")
            else:
                # Check if it's close to a valid kind (typo detection)
                close = [k for k in valid_kinds if k.lower() == kind.lower()]
                if close:
                    print(f"  WARN: {kind} (case mismatch — did you mean '{close[0]}'?)")
                else:
                    print(f"  FAIL: {kind} (not in schema)")
                    all_valid = False

        # Also check entity references
        entity_pattern = re.compile(r'^\s*entity:\s*(\S+)', re.MULTILINE)
        found_entities = entity_pattern.findall(content)

        if found_entities:
            print("\nEntity references:")
            valid_entities = set(self.get_entities())
            for entity in set(found_entities):
                if entity in valid_entities:
                    print(f"  OK: {entity}")
                else:
                    close = [e for e in valid_entities if e.lower() == entity.lower()]
                    if close:
                        print(f"  WARN: {entity} (did you mean '{close[0]}'?)")
                    else:
                        print(f"  WARN: {entity} (not found in schema — may be custom)")

        return all_valid


def get_schema_file_path():
    """Get the path to the schema file relative to the script location."""
    script_dir = Path(__file__).parent
    # Go up one level: tools -> project_root
    project_root = script_dir.parent
    schema_path = project_root / 'reference' / 'schema' / 'bot.schema.yaml-authoring.json'
    return schema_path


def main():
    if len(sys.argv) < 2:
        print("MCS Schema Lookup Tool")
        print()
        print("Usage:")
        print("  python schema-lookup.py lookup <definition_name>    # Get single definition")
        print("  python schema-lookup.py search <search_term>        # Find matching definitions")
        print("  python schema-lookup.py resolve <definition_name>   # Fully expand all $refs")
        print("  python schema-lookup.py kinds                       # List all valid 'kind' values")
        print("  python schema-lookup.py entities                    # List all prebuilt entities")
        print("  python schema-lookup.py validate <yaml_file>        # Validate kind values in YAML")
        sys.exit(1)

    command = sys.argv[1].lower()

    schema_file = get_schema_file_path()

    if not schema_file.exists():
        print(f"Error: Schema file not found at {schema_file}")
        print(f"Expected at: {schema_file.resolve()}")
        sys.exit(1)

    schema_lookup = SchemaLookup(schema_file)

    if command == 'kinds':
        results = schema_lookup.get_kinds()
        if results:
            print(f"Valid 'kind' values ({len(results)} total):")
            for kind in results:
                print(f"  {kind}")
        else:
            print("No kind discriminator values found")

    elif command == 'entities':
        results = schema_lookup.get_entities()
        if results:
            print(f"Entity definitions ({len(results)} total):")
            for entity in results:
                print(f"  {entity}")
        else:
            print("No entity definitions found")

    elif len(sys.argv) < 3:
        print("Error: Missing argument for command")
        print("Usage: python schema-lookup.py <command> <argument>")
        sys.exit(1)

    else:
        argument = sys.argv[2]

        if command == 'lookup':
            result = schema_lookup.lookup(argument)
            if result:
                print(json.dumps(result, indent=2))

        elif command == 'search':
            results = schema_lookup.search(argument)
            if results:
                print(f"Definitions matching '{argument}' ({len(results)} results):")
                for definition in results:
                    print(f"  {definition}")
            else:
                print(f"No definitions found containing '{argument}'")

        elif command == 'resolve':
            result = schema_lookup.resolve(argument)
            if result:
                print(json.dumps(result, indent=2))

        elif command == 'validate':
            yaml_path = Path(argument)
            if not yaml_path.is_absolute():
                yaml_path = Path.cwd() / yaml_path

            print(f"Validating: {yaml_path}")
            print()
            print("Kind values:")
            is_valid = schema_lookup.validate_yaml_kinds(str(yaml_path))
            print()
            if is_valid:
                print("RESULT: All kind values are valid")
            else:
                print("RESULT: Some kind values are INVALID — check above")
            sys.exit(0 if is_valid else 1)

        else:
            print(f"Unknown command: {command}")
            print("Available commands: lookup, search, resolve, kinds, entities, validate")
            sys.exit(1)


if __name__ == "__main__":
    main()
