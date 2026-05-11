---
name: mcs-init
description: Initialize a new MCS agent project with folder structure and template files.
---

# MCS Project Initializer

Create a new project folder and detect the intake path.

## Input

Provide project name:
- `/mcs-init ProjectName`

## Process

### Step 1: Create Project Folder

```
Build-Guides/[ProjectName]/
```

### Step 2: Detect Intake Path

Check what's already in the folder:

**Path A: SDR files found (`.docx`, `.md`, `.pdf` files that look like customer docs)**
```
Found SDR files in Build-Guides/[ProjectName]/:
- [list files]

Next step: Run `/mcs-research ProjectName` to identify agents and research components
```

If `.docx` files exist, convert them to `.md` using pandoc:
```
pandoc "file.docx" -t gfm -o "file.md"
```
Note: pandoc is typically at `%LOCALAPPDATA%\Pandoc\pandoc.exe` — resolve via `where pandoc` or `gcm pandoc`.

**Path B: No SDR files, start from scratch**
No template needed — `/mcs-research` will create brief.json during Phase A (agent identification).
Guide the user to describe the agent or upload docs, then run research.

### Step 3: Guide User

**If SDR files detected:**
```
## Project Initialized: [ProjectName]

**Location:** Build-Guides/[ProjectName]/

**SDR Files Found:**
- [list of converted .md files]

**Workflow:**
1. (Optional) Run `/mcs-context [CustomerName]` → Pull M365 history via WorkIQ
2. Click **Research** or run `/mcs-research [ProjectName]` → Read docs, identify agents, research components, enrich brief.json + generate evals
3. Click **Build** or run `/mcs-build [ProjectName] [agentId]` → Build in MCS
4. Click **Evaluate** or run `/mcs-eval [ProjectName] [agentId]` → Run tests
```

**If starting from scratch:**
```
## Project Initialized: [ProjectName]

**Location:** Build-Guides/[ProjectName]/

**Files Created:**
- (brief.json will be created when you run /mcs-research)

**Workflow:**
1. (Recommended) Run `/mcs-context [CustomerName]` → Pull M365 history via WorkIQ
2. Click **Research** or run `/mcs-research [ProjectName]` → Read docs, identify agents, research components, enrich brief.json + generate evals
3. Click **Build** or run `/mcs-build [ProjectName] [agentId]` → Build in MCS
4. Click **Evaluate** or run `/mcs-eval [ProjectName] [agentId]` → Run tests
```

## Output

Creates project folder, detects intake path, and guides user to next step.
