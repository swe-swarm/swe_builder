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
  meta: {
    fontSize: 8,
    color: colors.muted,
    marginTop: 1,
  },
  notes: {
    fontSize: 7.5,
    color: colors.subtle,
    marginTop: 1,
  },
});

interface Props {
  data: any;
}

const Integrations = ({ data }: Props) => {
  const items = data?.items;
  if (!items?.length) return null;

  return (
    <View>
      <SectionHeading title="Tools" subtitle="Connected systems, actions, and services" />

      {items.map((t: any, i: number) => (
        <Card key={i}>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{safe(t.name)}</Text>
              <Text style={s.meta}>
                {safe(t.type)}{t.auth ? ` \u00B7 ${t.auth}` : ""}
              </Text>
              {t.notes && <Text style={s.notes}>{t.notes}</Text>}
            </View>
            <StatusPill label={t.phase || "MVP"} />
          </View>
        </Card>
      ))}

      <Divider />
    </View>
  );
};

export default Integrations;
