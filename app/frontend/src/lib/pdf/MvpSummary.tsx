import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { colors } from "./styles";
import { SectionHeading, SubHeading, BulletList, Spacer } from "./primitives";

const s = StyleSheet.create({
  emptyText: {
    fontSize: 9,
    color: colors.s400,
    fontStyle: "italic",
  },
});

interface Props {
  sectionNumber: number;
  briefData: Record<string, any>;
}

const MvpSummary = ({ sectionNumber, briefData }: Props) => {
  const caps = briefData["capabilities"]?.items ?? [];
  const tools = briefData["tools"]?.items ?? [];
  const ks = briefData["knowledge-sources"]?.items ?? [];
  const topics = briefData["conversation-topics"]?.items ?? [];
  const oq = briefData["open-questions"]?.items ?? [];

  const phaseOf = (item: any) => (item.phase || "").toLowerCase();

  // Building Now (MVP)
  const now: string[] = [];
  caps.filter((c: any) => phaseOf(c) === "mvp").forEach((c: any) => now.push(`Capability: ${c.name}`));
  tools.filter((t: any) => phaseOf(t) === "mvp").forEach((t: any) => now.push(`Integration: ${t.name}`));
  ks.filter((k: any) => phaseOf(k) === "mvp").forEach((k: any) => now.push(`Knowledge: ${k.name}`));
  topics.filter((t: any) => phaseOf(t) === "mvp").forEach((t: any) => now.push(`Topic: ${t.name}`));

  // Planned for Future
  const future: string[] = [];
  caps.filter((c: any) => phaseOf(c) === "future").forEach((c: any) => future.push(`Capability: ${c.name}`));
  tools.filter((t: any) => phaseOf(t) === "future").forEach((t: any) => future.push(`Integration: ${t.name}`));
  ks.filter((k: any) => phaseOf(k) === "future").forEach((k: any) => future.push(`Knowledge: ${k.name}`));
  topics.filter((t: any) => phaseOf(t) === "future").forEach((t: any) => future.push(`Topic: ${t.name}`));

  // Blockers
  const blockers: string[] = [];
  oq.filter((q: any) => q.status !== "resolved").forEach((q: any) => blockers.push(q.question));

  // Don't render if nothing to show
  if (now.length === 0 && future.length === 0 && blockers.length === 0) return null;

  return (
    <View>
      <SectionHeading number={sectionNumber} title="MVP Summary" />

      {now.length > 0 && (
        <>
          <SubHeading>Building Now (MVP)</SubHeading>
          <BulletList items={now} />
          <Spacer h={4} />
        </>
      )}

      {future.length > 0 && (
        <>
          <SubHeading>Planned for Future</SubHeading>
          <BulletList items={future} />
          <Spacer h={4} />
        </>
      )}

      {blockers.length > 0 && (
        <>
          <SubHeading>Blockers</SubHeading>
          <BulletList items={blockers} />
        </>
      )}

      {now.length === 0 && future.length === 0 && (
        <Text style={s.emptyText}>No phase tagging applied yet.</Text>
      )}
    </View>
  );
};

export default MvpSummary;
