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
  typeText: {
    fontSize: 7.5,
    color: colors.subtle,
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

const ConversationTopics = ({ data }: Props) => {
  const items = data?.items;
  if (!items?.length) return null;

  return (
    <View>
      <SectionHeading title="Conversation Topics" subtitle="Topic flows and routing" />

      {items.map((t: any, i: number) => (
        <Card key={i}>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{safe(t.name)}</Text>
              {t.description && <Text style={s.desc}>{t.description}</Text>}
              <View style={s.pillRow}>
                <Text style={s.typeText}>{safe(t.type)}</Text>
                {t.outputFormat && t.outputFormat !== "text" && (
                  <Text style={s.typeText}> · {t.outputFormat}</Text>
                )}
                {t.triggerType && t.triggerType !== "agent-chooses" && (
                  <Text style={s.typeText}> · {t.triggerType}</Text>
                )}
              </View>
            </View>
            <StatusPill label={t.phase || "MVP"} />
          </View>
        </Card>
      ))}

      <Divider />
    </View>
  );
};

export default ConversationTopics;
