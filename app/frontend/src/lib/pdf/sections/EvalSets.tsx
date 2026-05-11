import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { colors } from "../styles";
import {
  SectionHeading, SubHeading, Card, Paragraph,
  ProgressBar, Divider, Spacer, safe,
} from "../primitives";

const s = StyleSheet.create({
  setCard: {
    backgroundColor: colors.card,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: 6,
    marginBottom: 10,
  },
  setHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  setName: {
    fontSize: 10,
    fontWeight: 700,
    color: colors.foreground,
    textTransform: "capitalize",
  },
  setCount: {
    fontSize: 7.5,
    color: colors.muted,
  },
  passRate: {
    fontSize: 10,
    fontWeight: 700,
  },
  methodsBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  methodLabel: {
    fontSize: 7,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  methodBadge: {
    fontSize: 7,
    color: colors.muted,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginLeft: 4,
  },
  testRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 0.3,
    borderBottomColor: colors.border,
  },
  testDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 2,
    marginRight: 6,
  },
  testQuestion: {
    fontSize: 8,
    color: colors.foreground,
  },
  testExpected: {
    fontSize: 7.5,
    color: colors.muted,
    fontStyle: "italic",
    marginTop: 1,
  },
  testCapability: {
    fontSize: 7,
    color: colors.muted,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginTop: 2,
    alignSelf: "flex-start",
  },
  resultText: {
    fontSize: 7.5,
    fontWeight: 600,
    marginLeft: 6,
  },
});

function rateColor(rate: number | null, threshold: number): string {
  if (rate === null) return colors.muted;
  if (rate >= threshold) return colors.green;
  if (rate >= threshold * 0.7) return colors.amber;
  return colors.red;
}

function methodLabel(m: { type: string; score?: number; mode?: string }): string {
  if (m.score != null) return `${m.type} (${m.score}%)`;
  if (m.mode) return `${m.type} (${m.mode})`;
  return m.type;
}

interface Props {
  data: any;
}

const EvalSets = ({ data }: Props) => {
  const sets = data?.sets;
  if (!sets?.length) return null;

  const totalTests = sets.reduce((sum: number, es: any) => sum + (es.tests?.length ?? 0), 0);
  const totalTested = sets.reduce((sum: number, es: any) =>
    sum + (es.tests?.filter((t: any) => t.lastResult != null).length ?? 0), 0);
  const totalPassed = sets.reduce((sum: number, es: any) =>
    sum + (es.tests?.filter((t: any) => t.lastResult?.pass).length ?? 0), 0);
  const overallRate = totalTested > 0 ? Math.round((totalPassed / totalTested) * 100) : null;

  return (
    <View>
      <SectionHeading
        title="Eval Sets"
        subtitle={`${totalTests} tests across ${sets.length} sets${overallRate !== null ? ` \u00B7 ${overallRate}% overall` : ""}`}
      />

      {sets.map((set: any, si: number) => {
        const tests = set.tests ?? [];
        const tested = tests.filter((t: any) => t.lastResult != null);
        const passed = tested.filter((t: any) => t.lastResult?.pass).length;
        const rate = tested.length > 0 ? Math.round((passed / tested.length) * 100) : null;

        return (
          <View key={si} style={s.setCard}>
            {/* Set header */}
            <View style={s.setHeader} wrap={false}>
              <Text style={s.setName}>{set.name}</Text>
              <Text style={[s.setCount, { marginLeft: 6, marginRight: "auto" }]}>
                {tests.length} test{tests.length !== 1 ? "s" : ""}
              </Text>
              {rate !== null && (
                <>
                  <ProgressBar
                    value={rate}
                    width={60}
                    height={5}
                    color={rateColor(rate, set.passThreshold)}
                  />
                  <Text style={[s.passRate, { color: rateColor(rate, set.passThreshold), marginLeft: 6 }]}>
                    {rate}%
                  </Text>
                </>
              )}
              <Text style={{ fontSize: 7, color: colors.subtle, marginLeft: 8 }}>
                target: {set.passThreshold}%
              </Text>
            </View>

            {/* Methods */}
            <View style={s.methodsBar}>
              <Text style={s.methodLabel}>Methods:</Text>
              {(set.methods ?? []).map((m: any, mi: number) => (
                <Text key={mi} style={s.methodBadge}>{methodLabel(m)}</Text>
              ))}
            </View>

            {/* Tests */}
            {tests.map((t: any, ti: number) => {
              const dotColor = t.lastResult == null
                ? colors.subtle
                : t.lastResult.pass ? colors.green : colors.red;
              return (
                <View key={ti} style={s.testRow} wrap={false}>
                  <View style={[s.testDot, { backgroundColor: dotColor }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.testQuestion}>{"\u201C"}{safe(t.question)}{"\u201D"}</Text>
                    {t.expected && (
                      <Text style={s.testExpected}>Expected: {"\u201C"}{safe(t.expected)}{"\u201D"}</Text>
                    )}
                    {t.capability && <Text style={s.testCapability}>{t.capability}</Text>}
                  </View>
                  <Text style={[s.resultText, { color: dotColor }]}>
                    {t.lastResult == null ? "\u2014" : t.lastResult.pass ? "Pass" : "Fail"}
                  </Text>
                </View>
              );
            })}
          </View>
        );
      })}

      <Divider />
    </View>
  );
};

export default EvalSets;
