import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { colors } from "../styles";
import { SectionHeading, Card, StatusPill, Divider, safe } from "../primitives";

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  name: {
    fontSize: 9,
    fontWeight: 600,
    color: colors.foreground,
  },
  purpose: {
    fontSize: 8,
    color: colors.muted,
    marginTop: 1,
  },
  pillRow: {
    flexDirection: "row",
    gap: 4,
  },
});

interface Props {
  data: any;
}

const KnowledgeSources = ({ data }: Props) => {
  const items = data?.items;
  if (!items?.length) return null;

  return (
    <View>
      <SectionHeading title="Knowledge Sources" subtitle="Data sources the agent draws from" />

      {items.map((k: any, i: number) => (
        <Card key={i}>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{safe(k.name)}</Text>
              <Text style={s.purpose}>{safe(k.purpose)}</Text>
            </View>
            <View style={s.pillRow}>
              <StatusPill label={k.phase || "MVP"} />
              <StatusPill label={k.status || "available"} />
            </View>
          </View>
        </Card>
      ))}

      <Divider />
    </View>
  );
};

export default KnowledgeSources;
