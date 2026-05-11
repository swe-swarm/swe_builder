import { BRIEF_SECTIONS } from "@/config/briefSections";
import type { Agent } from "@/types";

/**
 * Generates a clean markdown report from brief data.
 */
export function generateBriefReport(agent: Agent, briefData: Record<string, any>): string {
  const lines: string[] = [];
  const hr = "\n---\n";

  lines.push(`# ${agent.name} — Agent Brief`);
  lines.push(`> ${agent.description}`);
  lines.push(`> **Status:** ${agent.status} · **Readiness:** ${agent.readiness}%`);
  lines.push(hr);

  // Business Context
  const bc = briefData["business-context"];
  if (bc) {
    lines.push("## Business Context\n");
    lines.push(`### Problem Statement\n${bc.problemStatement}\n`);
    if (bc.challenges?.length) {
      lines.push("### Key Challenges");
      bc.challenges.forEach((c: string) => lines.push(`- ${c}`));
      lines.push("");
    }
    if (bc.benefits?.length) {
      lines.push("### Expected Benefits");
      bc.benefits.forEach((b: string) => lines.push(`- ${b}`));
      lines.push("");
    }
    if (bc.successCriteria?.length) {
      lines.push("### Success Criteria\n");
      lines.push("| Metric | Target | Current |");
      lines.push("|--------|--------|---------|");
      bc.successCriteria.forEach((s: any) => lines.push(`| ${s.metric} | ${s.target} | ${s.current} |`));
      lines.push("");
    }
    if (bc.stakeholders?.length) {
      lines.push("### Stakeholders\n");
      bc.stakeholders.forEach((s: any) => lines.push(`- **${s.name}** — ${s.role} (${s.type})`));
      lines.push("");
    }
    lines.push(hr);
  }

  // Agent Identity
  const ai = briefData["agent-identity"];
  if (ai) {
    lines.push("## Agent Identity\n");
    lines.push(`**Name:** ${ai.name}\n`);
    lines.push(`**Description:** ${ai.description}\n`);
    lines.push(`### Persona\n${ai.persona}\n`);
    if (ai.targetUsers?.length) {
      lines.push("### Target Users");
      ai.targetUsers.forEach((u: string) => lines.push(`- ${u}`));
      lines.push("");
    }
    lines.push(hr);
  }

  // Architecture
  const arch = briefData["architecture"];
  if (arch) {
    lines.push("## Architecture\n");
    lines.push(`**Pattern:** ${arch.pattern}\n`);
    if (arch.patternReasoning) lines.push(`> ${arch.patternReasoning}\n`);
    if (arch.triggers?.length) {
      lines.push("### Triggers");
      arch.triggers.forEach((t: any) => lines.push(`- **${t.type}:** ${t.description}`));
      lines.push("");
    }
    if (arch.childAgents?.length) {
      lines.push("### Child Agents");
      arch.childAgents.forEach((c: any) => lines.push(`- **${c.name}:** ${c.role}`));
      lines.push("");
    }
    if (arch.scoring?.length) {
      lines.push("### Complexity Scoring\n");
      lines.push("| Factor | Score | Notes |");
      lines.push("|--------|-------|-------|");
      arch.scoring.forEach((s: any) => lines.push(`| ${s.factor} | ${s.score}/10 | ${s.notes} |`));
      lines.push("");
    }
    lines.push(hr);
  }

  // Instructions
  const inst = briefData["instructions"];
  if (inst) {
    lines.push("## Instructions\n");
    lines.push("```");
    lines.push(inst.systemPrompt || "");
    lines.push("```\n");
    lines.push(hr);
  }

  // Capabilities
  const caps = briefData["capabilities"];
  if (caps?.items?.length) {
    lines.push("## Capabilities\n");
    lines.push("| Capability | Description | Phase | Enabled |");
    lines.push("|------------|-------------|-------|---------|");
    caps.items.forEach((c: any) => lines.push(`| ${c.name} | ${c.description} | ${c.tag} | ${c.enabled ? "✅" : "—"} |`));
    lines.push("");
    lines.push(hr);
  }

  // Tools / Integrations
  const tools = briefData["tools"];
  if (tools?.items?.length) {
    lines.push("## Integrations\n");
    lines.push("| Tool | Type | Auth |");
    lines.push("|------|------|------|");
    tools.items.forEach((t: any) => lines.push(`| ${t.name} | ${t.type} | ${t.auth} |`));
    lines.push("");
    lines.push(hr);
  }

  // Knowledge Sources
  const ks = briefData["knowledge-sources"];
  if (ks?.items?.length) {
    lines.push("## Knowledge Sources\n");
    lines.push("| Source | Purpose | Location | Phase | Status |");
    lines.push("|--------|---------|----------|-------|--------|");
    ks.items.forEach((k: any) => lines.push(`| ${k.name} | ${k.purpose} | ${k.location} | ${k.phase} | ${k.status} |`));
    lines.push("");
    lines.push(hr);
  }

  // Conversation Topics
  const ct = briefData["conversation-topics"];
  if (ct?.items?.length) {
    lines.push("## Conversation Topics\n");
    ct.items.forEach((t: any) => {
      lines.push(`### ${t.name} (${t.type}, ${t.phase})`);
      lines.push(`${t.description}\n`);
      if (t.flowDescription) {
        lines.push("**Flow:**");
        lines.push("```");
        lines.push(t.flowDescription);
        lines.push("```\n");
      }
    });
    lines.push(hr);
  }

  // Scope & Boundaries
  const sb = briefData["scope-boundaries"];
  if (sb) {
    lines.push("## Scope & Boundaries\n");
    if (sb.handles?.length) {
      lines.push("### ✅ Handles");
      sb.handles.forEach((h: string) => lines.push(`- ${h}`));
      lines.push("");
    }
    if (sb.politelyDeclines?.length) {
      lines.push("### 🔶 Politely Declines");
      sb.politelyDeclines.forEach((d: string) => lines.push(`- ${d}`));
      lines.push("");
    }
    if (sb.hardRefuses?.length) {
      lines.push("### 🚫 Hard Refuses");
      sb.hardRefuses.forEach((r: string) => lines.push(`- ${r}`));
      lines.push("");
    }
    lines.push(hr);
  }

  // Eval Sets
  const es = briefData["eval-sets"];
  if (es?.sets?.length) {
    lines.push("## Eval Sets\n");
    for (const set of es.sets) {
      const tested = set.tests?.filter((t: any) => t.lastResult != null) ?? [];
      const passed = tested.filter((t: any) => t.lastResult?.pass).length;
      const rate = tested.length > 0 ? Math.round((passed / tested.length) * 100) : null;
      const rateStr = rate !== null ? ` — ${rate}% pass rate` : "";

      lines.push(`### ${set.name.charAt(0).toUpperCase() + set.name.slice(1)} (target: ${set.passThreshold}%${rateStr})`);
      lines.push(`> ${set.description}\n`);
      lines.push(`**Methods:** ${(set.methods ?? []).map((m: any) => {
        if (m.score != null) return `${m.type} (${m.score}%)`;
        if (m.mode) return `${m.type} (${m.mode})`;
        return m.type;
      }).join(", ")}\n`);

      if (set.tests?.length) {
        lines.push("| Question | Expected | Capability | Result |");
        lines.push("|----------|----------|------------|--------|");
        set.tests.forEach((t: any) => {
          const result = t.lastResult == null ? "—" : t.lastResult.pass ? "Pass" : "Fail";
          lines.push(`| ${t.question} | ${t.expected || "—"} | ${t.capability || "—"} | ${result} |`);
        });
        lines.push("");
      }
    }
    lines.push(hr);
  }

  // Open Questions
  const oq = briefData["open-questions"];
  if (oq?.items?.length) {
    lines.push("## Open Questions\n");
    oq.items.forEach((q: any) => {
      const resolved = q.status === "resolved" ? ` ✅ *${q.resolution}*` : "";
      lines.push(`- **${q.question}** — Assignee: ${q.assignee}${resolved}`);
    });
    lines.push("");
  }

  // Footer
  lines.push(hr);
  lines.push(`*Generated on ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}*`);

  return lines.join("\n");
}

/**
 * Downloads a string as a file.
 */
export function downloadFile(content: string, filename: string, mimeType = "text/markdown") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
