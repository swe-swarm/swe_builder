import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { colors } from "../styles";
import { SectionHeading, Card, BulletList, Divider } from "../primitives";

const s = StyleSheet.create({
  label: {
    fontSize: 7.5,
    fontWeight: 700,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  problemText: {
    fontSize: 9,
    color: colors.foreground,
    lineHeight: 1.5,
  },
  twoCol: {
    flexDirection: "row",
    gap: 8,
  },
  col: {
    flex: 1,
  },
});

interface Props {
  data: any;
}

const Overview = ({ data }: Props) => {
  if (!data) return null;
  return (
    <View>
      <SectionHeading title="Overview" subtitle="Problem statement and target users" />

      {/* Problem Statement */}
      {data.problemStatement && (
        <Card>
          <Text style={s.label}>Problem Statement</Text>
          <Text style={s.problemText}>{data.problemStatement}</Text>
        </Card>
      )}

      {/* Target Users */}
      {data.targetUsers?.length > 0 && (
        <Card>
          <Text style={s.label}>Target Users</Text>
          <BulletList items={data.targetUsers} />
        </Card>
      )}

      {/* Challenges & Benefits side by side */}
      {(data.challenges?.length > 0 || data.benefits?.length > 0) && (
        <View style={s.twoCol}>
          {data.challenges?.length > 0 && (
            <View style={s.col}>
              <Card accentColor={colors.red}>
                <Text style={s.label}>Challenges</Text>
                <BulletList items={data.challenges} dotColor={colors.red} />
              </Card>
            </View>
          )}
          {data.benefits?.length > 0 && (
            <View style={s.col}>
              <Card accentColor={colors.green}>
                <Text style={s.label}>Benefits</Text>
                <BulletList items={data.benefits} dotColor={colors.green} />
              </Card>
            </View>
          )}
        </View>
      )}

      <Divider />
    </View>
  );
};

export default Overview;
