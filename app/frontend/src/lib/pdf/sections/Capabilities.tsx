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
  desc: {
    fontSize: 8,
    color: colors.muted,
    marginTop: 1,
  },
});

interface Props {
  data: any;
}

const Capabilities = ({ data }: Props) => {
  const items = data?.items;
  if (!items?.length) return null;

  return (
    <View>
      <SectionHeading title="Capabilities" subtitle="Features this agent can perform" />

      {items.map((c: any, i: number) => (
        <Card key={i}>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{safe(c.name)}</Text>
              <Text style={s.desc}>{safe(c.description)}</Text>
            </View>
            <StatusPill label={c.phase || "MVP"} />
          </View>
        </Card>
      ))}

      <Divider />
    </View>
  );
};

export default Capabilities;
