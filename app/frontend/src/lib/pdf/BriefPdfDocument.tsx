import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { baseStyles, colors } from "./styles";
import { MsLogo, ProgressBar, Spacer, MetricCard } from "./primitives";
import Overview from "./sections/Overview";
import Architecture from "./sections/Architecture";
import Instructions from "./sections/Instructions";
import Capabilities from "./sections/Capabilities";
import Integrations from "./sections/Integrations";
import KnowledgeSources from "./sections/KnowledgeSources";
import ConversationTopics from "./sections/ConversationTopics";
import ScopeBoundaries from "./sections/ScopeBoundaries";
import Decisions from "./sections/Decisions";
import EvalSets from "./sections/EvalSets";
import OpenQuestions from "./sections/OpenQuestions";
import type { Agent } from "@/types";

const s = StyleSheet.create({
  // Inline header block (replaces cover page)
  titleBlock: {
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  agentName: {
    fontSize: 22,
    fontWeight: 700,
    color: colors.foreground,
    marginBottom: 2,
  },
  description: {
    fontSize: 9,
    color: colors.muted,
    lineHeight: 1.5,
    marginBottom: 10,
    maxWidth: 400,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  metaText: {
    fontSize: 8,
    color: colors.muted,
  },
  readinessLabel: {
    fontSize: 8,
    fontWeight: 600,
    color: colors.muted,
  },
  readinessValue: {
    fontSize: 8,
    fontWeight: 700,
    color: colors.primary,
  },
  // Exec summary metrics
  metricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginVertical: 10,
  },
});

// ── Page Header (repeated) ──────────────────────────────────────

const Header = ({ agentName }: { agentName: string }) => (
  <View style={baseStyles.header} fixed>
    <View style={baseStyles.headerLeft}>
      <MsLogo size={10} />
      <Text style={baseStyles.headerText}>Microsoft</Text>
    </View>
    <Text style={baseStyles.headerRight}>{agentName} — Agent Brief</Text>
  </View>
);

// ── Page Footer (repeated) ──────────────────────────────────────

const Footer = () => {
  const date = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return (
    <View style={baseStyles.footer} fixed>
      <Text style={baseStyles.footerText}>{date}</Text>
      <Text style={baseStyles.footerText}>Confidential</Text>
      <Text
        style={baseStyles.footerText}
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  );
};

// ── Inline Title Block (replaces cover page) ─────────────────────

const TitleBlock = ({ agent, briefData }: { agent: Agent; briefData: Record<string, any> }) => {
  const desc = agent.description || briefData["overview"]?.description || "";
  const date = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return (
    <View style={s.titleBlock} wrap={false}>
      <Text style={s.agentName}>{agent.name}</Text>
      {desc ? <Text style={s.description}>{desc}</Text> : null}
      <View style={s.metaRow}>
        <Text style={s.metaText}>{date}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={s.readinessLabel}>Readiness</Text>
          <ProgressBar value={agent.readiness} width={100} height={6} />
          <Text style={s.readinessValue}>{agent.readiness}%</Text>
        </View>
      </View>
    </View>
  );
};

// ── Exec Summary Metrics ─────────────────────────────────────────

const ExecMetrics = ({ briefData }: { briefData: Record<string, any> }) => {
  const caps = briefData["capabilities"]?.items ?? [];
  const tools = briefData["tools"]?.items ?? [];
  const ks = briefData["knowledge-sources"]?.items ?? [];
  const evalSets = briefData["eval-sets"]?.sets ?? [];

  const mvpCaps = caps.filter((c: any) => (c.phase || "").toLowerCase() === "mvp");
  const totalTests = evalSets.reduce((sum: number, es: any) => sum + (es.tests?.length ?? 0), 0);
  const testedTests = evalSets.reduce(
    (sum: number, es: any) => sum + (es.tests?.filter((t: any) => t.lastResult != null).length ?? 0), 0);
  const passedTests = evalSets.reduce(
    (sum: number, es: any) => sum + (es.tests?.filter((t: any) => t.lastResult?.pass).length ?? 0), 0);
  const passRate = testedTests > 0 ? Math.round((passedTests / testedTests) * 100) : null;

  return (
    <View style={s.metricsRow}>
      <MetricCard value={caps.length} label={`Capabilities${mvpCaps.length > 0 ? `\n(${mvpCaps.length} MVP)` : ""}`} />
      <MetricCard value={tools.length} label="Integrations" />
      <MetricCard value={ks.length} label={"Knowledge\nSources"} />
      <MetricCard value={totalTests} label={`Eval Tests${passRate !== null ? `\n(${passRate}% pass)` : ""}`} />
    </View>
  );
};

// ── Main Document ────────────────────────────────────────────────

interface Props {
  agent: Agent;
  briefData: Record<string, any>;
}

const BriefPdfDocument = ({ agent, briefData }: Props) => {
  return (
    <Document
      title={`${agent.name} — Agent Brief`}
      author="Microsoft Copilot Studio"
      subject="Agent Brief"
    >
      <Page size="A4" style={baseStyles.page} wrap>
        <Header agentName={agent.name} />
        <Footer />

        <TitleBlock agent={agent} briefData={briefData} />
        <ExecMetrics briefData={briefData} />

        <Overview data={briefData["overview"]} />
        <Architecture data={briefData["architecture"]} />
        <Instructions data={briefData["instructions"]} />
        <Capabilities data={briefData["capabilities"]} />
        <Integrations data={briefData["tools"]} />
        <KnowledgeSources data={briefData["knowledge-sources"]} />
        <ConversationTopics data={briefData["conversation-topics"]} />
        <ScopeBoundaries data={briefData["scope-boundaries"]} />
        <Decisions data={briefData["decisions"]} />
        <EvalSets data={briefData["eval-sets"]} />
        <OpenQuestions data={briefData["open-questions"]} />
      </Page>
    </Document>
  );
};

export default BriefPdfDocument;
