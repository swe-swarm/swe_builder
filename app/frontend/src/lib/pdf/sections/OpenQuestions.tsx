import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { colors } from "../styles";
import { SectionHeading, Card, StatusPill, safe } from "../primitives";

const s = StyleSheet.create({
  question: {
    fontSize: 9,
    fontWeight: 700,
    color: colors.foreground,
    marginBottom: 4,
    lineHeight: 1.4,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: {
    fontSize: 7,
    color: colors.muted,
  },
  resolution: {
    fontSize: 8,
    color: colors.foreground,
    fontStyle: "italic",
    marginTop: 4,
    lineHeight: 1.4,
  },
});

interface Props {
  data: any;
}

const OpenQuestions = ({ data }: Props) => {
  const items = data?.items;
  if (!items?.length) return null;

  return (
    <View>
      <SectionHeading title="Open Questions" subtitle="Unresolved questions and decisions" />

      {items.map((q: any, i: number) => {
        const resolved = q.status === "resolved";
        const notes = q.notes || q.assignee || "";
        return (
          <Card key={i} accentColor={resolved ? colors.green : colors.amber}>
            <Text style={s.question}>{safe(q.question)}</Text>
            <View style={s.metaRow}>
              <StatusPill label={resolved ? "resolved" : "open"} />
              {q.priority && <Text style={s.metaText}>Priority: {q.priority}</Text>}
              {notes ? <Text style={s.metaText}>Notes: {notes}</Text> : null}
            </View>
            {resolved && q.resolution && (
              <Text style={s.resolution}>{q.resolution}</Text>
            )}
          </Card>
        );
      })}
    </View>
  );
};

export default OpenQuestions;
