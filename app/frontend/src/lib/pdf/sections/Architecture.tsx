import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { colors } from "../styles";
import {
  SectionHeading, SubHeading, Card, BulletList,
  Callout, Divider, safe,
} from "../primitives";

// Must match dashboard ArchitectureSection.tsx definitions
const SOLUTION_TYPES = [
  { value: "agent", label: "Agent", desc: "Copilot Studio agent", color: colors.primary, bg: colors.primaryLight, border: colors.primaryMuted },
  { value: "hybrid", label: "Hybrid", desc: "Agent + Power Automate flows", color: "#d97706", bg: "#fffbeb", border: "#f59e0b" },
  { value: "flow", label: "Power Automate Flow", desc: "Automation only — no agent needed", color: "#7c3aed", bg: "#f3e8ff", border: "#a855f7" },
  { value: "not-recommended", label: "Not Recommended", desc: "Beyond MCS capabilities", color: "#dc2626", bg: "#fef2f2", border: "#ef4444" },
];

const ARCH_TYPES = [
  { value: "single-agent", label: "Single-Agent", desc: "One agent handles everything" },
  { value: "multi-agent", label: "Multi-Agent", desc: "Orchestrator routes to specialists" },
  { value: "connected-agent", label: "Connected-Agent", desc: "Agents linked across solutions" },
];

const s = StyleSheet.create({
  // Option card (used for both solution type and architecture type selectors)
  optionRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  optionCard: {
    flex: 1,
    borderWidth: 0.5,
    borderRadius: 5,
    padding: 7,
    marginRight: 5,
  },
  optionCardLast: {
    marginRight: 0,
  },
  optionLabel: {
    fontSize: 8.5,
    fontWeight: 700,
    marginBottom: 1,
  },
  optionDesc: {
    fontSize: 7,
    color: colors.muted,
  },
  selectedBadge: {
    fontSize: 6.5,
    fontWeight: 700,
    color: "#fff",
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    alignSelf: "flex-start",
    marginTop: 3,
  },
  // Summary + reasoning
  reasoningCard: {
    borderWidth: 0.5,
    borderRadius: 6,
    padding: 10,
    marginBottom: 6,
  },
  scoreText: {
    fontSize: 10,
    fontWeight: 700,
  },
  // Factor row
  factorRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 3,
    borderBottomWidth: 0.3,
    borderBottomColor: colors.border,
  },
  factorToggle: {
    width: 14,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  factorName: {
    fontSize: 8,
    fontWeight: 600,
    color: colors.foreground,
    flex: 1,
  },
  factorNotes: {
    fontSize: 7,
    color: colors.muted,
    flex: 2,
  },
  // Alt recommendation
  altRecCard: {
    backgroundColor: "#fffbeb",
    borderWidth: 0.5,
    borderColor: "#f59e0b",
    borderRadius: 6,
    padding: 10,
    marginBottom: 6,
  },
  altRecLabel: {
    fontSize: 8,
    fontWeight: 700,
    color: "#d97706",
    marginBottom: 2,
  },
  // Specialist agents
  agentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 2,
  },
  agentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginTop: 3,
    marginRight: 6,
  },
  agentName: {
    fontSize: 9,
    fontWeight: 600,
    color: colors.foreground,
  },
  agentRole: {
    fontSize: 8,
    color: colors.muted,
    lineHeight: 1.4,
  },
  agentMeta: {
    fontSize: 7.5,
    color: colors.muted,
    fontStyle: "italic",
  },
});

interface Props {
  data: any;
}

/** Split a paragraph string into bullet-point lines. Handles non-string input safely. */
function toBullets(text: any): string[] {
  if (text == null) return [];
  if (typeof text !== "string") return [String(text)];
  if (!text.trim()) return [];
  const lines = text.split(/\n/).map((l: string) => l.replace(/^[\s\-\u2022*]+/, "").trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  return text.split(/\.\s+/).map((seg: string) => seg.replace(/\.$/, "").trim()).filter(Boolean);
}

/** Render a row of option cards with the selected one highlighted. */
const OptionSelector = ({ options, selected, selectedColor }: {
  options: Array<{ value: string; label: string; desc: string; color?: string; bg?: string; border?: string }>;
  selected: string;
  selectedColor?: string;
}) => (
  <View style={s.optionRow} wrap={false}>
    {options.map((opt, i) => {
      const isSelected = opt.value === selected;
      const accent = opt.color || selectedColor || colors.primary;
      return (
        <View
          key={opt.value}
          style={[
            s.optionCard,
            i === options.length - 1 ? s.optionCardLast : {},
            {
              backgroundColor: isSelected ? (opt.bg || colors.primaryLight) : colors.card,
              borderColor: isSelected ? (opt.border || accent) : colors.border,
              borderWidth: isSelected ? 1.5 : 0.5,
            },
          ]}
        >
          <Text style={[s.optionLabel, { color: isSelected ? accent : colors.muted }]}>{opt.label}</Text>
          <Text style={s.optionDesc}>{opt.desc}</Text>
          {isSelected && (
            <Text style={[s.selectedBadge, { backgroundColor: accent }]}>SELECTED</Text>
          )}
        </View>
      );
    })}
  </View>
);

/** Render scoring factors as a compact toggle list matching the app. */
const FactorTable = ({ factors, title, total }: {
  factors: Array<{ factor: string; score: boolean | number; notes?: string }>;
  title: string;
  total: number;
}) => {
  if (!factors?.length) return null;
  const yesCount = factors.filter((f) => f.score).length;
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
        <Text style={{ fontSize: 8, fontWeight: 700, color: colors.muted }}>{title}</Text>
        <Text style={[s.scoreText, { color: colors.foreground }]}>{yesCount}/{total}</Text>
      </View>
      {factors.map((f, i) => (
        <View key={i} style={s.factorRow}>
          <View style={[s.factorToggle, { backgroundColor: f.score ? colors.primary : colors.border }]} />
          <Text style={s.factorName}>{safe(f.factor)}</Text>
          {f.notes ? <Text style={s.factorNotes}>{safe(f.notes)}</Text> : null}
        </View>
      ))}
    </Card>
  );
};

const Architecture = ({ data }: Props) => {
  if (!data) return null;

  const selectedSolType = data.solutionType || "agent";
  const solTypeObj = SOLUTION_TYPES.find((t) => t.value === selectedSolType);
  const isNonAgent = selectedSolType === "flow" || selectedSolType === "not-recommended";
  const solTypeScore = data.solutionTypeScore ?? 0;

  const selectedArchType = data.pattern || "single-agent";
  const archTypeObj = ARCH_TYPES.find((t) => t.value === selectedArchType);
  const archScore = data.scoring?.length > 0
    ? data.scoring.reduce((sum: number, f: any) => sum + (f.score ? 1 : 0), 0)
    : null;

  return (
    <View>
      <SectionHeading title="Architecture" subtitle="Solution type, design pattern, channels, and triggers" />

      {/* ── Solution Type: show all options, highlight selected ── */}
      <SubHeading>Solution Type</SubHeading>
      <OptionSelector options={SOLUTION_TYPES} selected={selectedSolType} />

      {/* Score + reasoning */}
      {solTypeObj && (
        <View style={[s.reasoningCard, {
          backgroundColor: solTypeObj.bg,
          borderColor: solTypeObj.border,
        }]} wrap={false}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={[s.scoreText, { color: solTypeObj.color }]}>
              {solTypeObj.label} — {solTypeScore}/5
            </Text>
          </View>
          {data.solutionTypeReason && <BulletList items={toBullets(data.solutionTypeReason)} />}
        </View>
      )}

      {/* Solution type scoring factors */}
      {data.solutionTypeFactors?.length > 0 && (
        <FactorTable
          factors={data.solutionTypeFactors}
          title="Scoring Factors"
          total={5}
        />
      )}

      {/* Alternative recommendation */}
      {data.alternativeRecommendation && isNonAgent && (
        <View style={s.altRecCard} wrap={false}>
          <Text style={s.altRecLabel}>Recommended Alternative</Text>
          <BulletList items={toBullets(data.alternativeRecommendation)} />
        </View>
      )}

      {/* ── Architecture Type: show all options, highlight selected ── */}
      {!isNonAgent && (
        <>
          <SubHeading>Architecture Type</SubHeading>
          <OptionSelector options={ARCH_TYPES} selected={selectedArchType} selectedColor={colors.primary} />

          {/* Score + reasoning */}
          {archTypeObj && (
            <View style={[s.reasoningCard, {
              backgroundColor: colors.primaryLight,
              borderColor: colors.primaryMuted,
            }]} wrap={false}>
              <Text style={[s.scoreText, { color: colors.primary }]}>
                {archTypeObj.label}{archScore != null ? ` — ${archScore}/6` : ""}
              </Text>
              {data.patternReasoning && <BulletList items={toBullets(data.patternReasoning)} />}
            </View>
          )}

          {/* Architecture scoring factors */}
          {data.scoring?.length > 0 && (
            <FactorTable
              factors={data.scoring}
              title="Scoring Factors"
              total={6}
            />
          )}
        </>
      )}

      {/* ── Triggers ── */}
      {data.triggers?.length > 0 && (
        <>
          <SubHeading>Triggers</SubHeading>
          <Card>
            <BulletList items={data.triggers.map((t: any) =>
              `${safe(t.type)}${t.description ? ` — ${t.description}` : ""}`
            )} />
          </Card>
        </>
      )}

      {/* ── Channels ── */}
      {data.channels?.length > 0 && (
        <>
          <SubHeading>Channels</SubHeading>
          <Card>
            <BulletList items={data.channels.map((c: any) =>
              `${safe(c.name)}${c.reason ? ` — ${c.reason}` : ""}`
            )} />
          </Card>
        </>
      )}

      {/* ── Specialist Agents ── */}
      {data.childAgents?.length > 0 && (
        <>
          <SubHeading>Specialist Agents</SubHeading>
          {data.childAgents.map((c: any, i: number) => (
            <Card key={i}>
              <View style={s.agentRow}>
                <View style={s.agentDot} />
                <View style={{ flex: 1 }}>
                  <Text style={s.agentName}>{safe(c.name)}</Text>
                  <Text style={s.agentRole}>{safe(c.role)}</Text>
                  {c.routingRule && <Text style={s.agentMeta}>Route: {safe(c.routingRule)}</Text>}
                  {c.model && <Text style={s.agentMeta}>Model: {safe(c.model)}</Text>}
                </View>
              </View>
            </Card>
          ))}
        </>
      )}

      <Divider />
    </View>
  );
};

export default Architecture;
