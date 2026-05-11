import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { colors } from "../styles";
import { SectionHeading, Card, Divider, safe } from "../primitives";

const s = StyleSheet.create({
  // Category badge — small colored pill
  categoryBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  categoryText: {
    fontSize: 6.5,
    fontWeight: 700,
  },
  statusBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  statusText: {
    fontSize: 6.5,
    fontWeight: 700,
  },
  badgeRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  title: {
    fontSize: 10,
    fontWeight: 700,
    color: colors.foreground,
    marginBottom: 2,
  },
  context: {
    fontSize: 8,
    color: colors.muted,
    lineHeight: 1.5,
    marginBottom: 8,
  },
  // Options
  optionCard: {
    backgroundColor: colors.surface,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: 4,
    padding: 8,
    marginBottom: 4,
  },
  optionSelected: {
    backgroundColor: colors.greenLight,
    borderColor: colors.greenBorder,
  },
  optionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  optionLabel: {
    fontSize: 8.5,
    fontWeight: 600,
    color: colors.foreground,
  },
  optionTag: {
    fontSize: 6,
    fontWeight: 700,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    marginLeft: 4,
  },
  optionSummary: {
    fontSize: 7.5,
    color: colors.muted,
    lineHeight: 1.4,
  },
  prosConsRow: {
    flexDirection: "row",
    marginTop: 4,
  },
  proConItem: {
    fontSize: 7,
    color: colors.foreground,
    lineHeight: 1.4,
  },
  metaRow: {
    flexDirection: "row",
    marginTop: 3,
  },
  metaText: {
    fontSize: 7,
    color: colors.subtle,
    marginRight: 8,
  },
  pendingBanner: {
    backgroundColor: colors.amberLight,
    borderWidth: 0.5,
    borderColor: colors.amberBorder,
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  pendingText: {
    fontSize: 8,
    fontWeight: 700,
    color: colors.amber,
  },
});

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  integration: { bg: "#DBEAFE", text: "#2563EB" },
  architecture: { bg: "#F3E8FF", text: "#9333EA" },
  model: { bg: "#FEF3C7", text: "#D97706" },
  infrastructure: { bg: "#FFEDD5", text: "#EA580C" },
  "topic-implementation": { bg: "#CCFBF1", text: "#0D9488" },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: colors.amberLight, text: colors.amber },
  confirmed: { bg: colors.greenLight, text: colors.green },
  overridden: { bg: colors.primaryLight, text: colors.primary },
};

interface Props {
  data: any;
}

const Decisions = ({ data }: Props) => {
  const items = data?.items;
  if (!items?.length) return null;

  const pending = items.filter((d: any) => d.status === "pending");

  return (
    <View>
      <SectionHeading
        title="Decisions"
        subtitle="Research findings and selected approaches"
      />

      {pending.length > 0 && (
        <View style={s.pendingBanner} wrap={false}>
          <Text style={s.pendingText}>
            {pending.length} pending decision{pending.length > 1 ? "s" : ""} require resolution before build.
          </Text>
        </View>
      )}

      {items.map((d: any, i: number) => {
        const catColor = CATEGORY_COLORS[d.category] ?? { bg: colors.surfaceAlt, text: colors.muted };
        const statColor = STATUS_COLORS[d.status] ?? STATUS_COLORS.pending;
        const accentColor = d.status === "pending" ? colors.amber : d.status === "overridden" ? colors.primary : colors.green;

        return (
          <Card key={i} accentColor={accentColor} allowWrap>
            {/* Badges */}
            <View style={s.badgeRow}>
              <View style={[s.categoryBadge, { backgroundColor: catColor.bg }]}>
                <Text style={[s.categoryText, { color: catColor.text }]}>{d.category}</Text>
              </View>
              <View style={[s.statusBadge, { backgroundColor: statColor.bg, marginLeft: 4 }]}>
                <Text style={[s.statusText, { color: statColor.text }]}>{(d.status || "pending").toUpperCase()}</Text>
              </View>
            </View>

            <Text style={s.title}>{safe(d.title)}</Text>
            {d.context && <Text style={s.context}>{d.context}</Text>}

            {/* Options */}
            {(d.options ?? []).map((o: any, oi: number) => {
              const isSelected = o.id === d.selectedOptionId;
              const isRecommended = o.id === d.recommendedOptionId;
              return (
                <View key={oi} style={[s.optionCard, isSelected && s.optionSelected]} wrap={false}>
                  <View style={s.optionHeader}>
                    <Text style={s.optionLabel}>{safe(o.label)}</Text>
                    {isSelected && (
                      <Text style={[s.optionTag, { backgroundColor: colors.greenBorder, color: colors.green }]}>
                        SELECTED
                      </Text>
                    )}
                    {isRecommended && !isSelected && (
                      <Text style={[s.optionTag, { backgroundColor: colors.amberBorder, color: colors.amber }]}>
                        REC
                      </Text>
                    )}
                  </View>
                  <Text style={s.optionSummary}>{safe(o.summary)}</Text>

                  {/* Pros/Cons for selected */}
                  {isSelected && (o.pros?.length > 0 || o.cons?.length > 0) && (
                    <View style={s.prosConsRow}>
                      {o.pros?.length > 0 && (
                        <View style={{ flex: 1 }}>
                          {o.pros.map((p: string, pi: number) => (
                            <Text key={pi} style={s.proConItem}>{"\u2713"} {p}</Text>
                          ))}
                        </View>
                      )}
                      {o.cons?.length > 0 && (
                        <View style={{ flex: 1, marginLeft: 8 }}>
                          {o.cons.map((c: string, ci: number) => (
                            <Text key={ci} style={s.proConItem}>{"\u2717"} {c}</Text>
                          ))}
                        </View>
                      )}
                    </View>
                  )}

                  {/* Meta */}
                  <View style={s.metaRow}>
                    {o.confidence && <Text style={s.metaText}>{o.confidence} confidence</Text>}
                    {o.cost && <Text style={s.metaText}>Cost: {o.cost}</Text>}
                    {o.effort && <Text style={s.metaText}>Effort: {o.effort}</Text>}
                  </View>
                </View>
              );
            })}
          </Card>
        );
      })}

      <Divider />
    </View>
  );
};

export default Decisions;
