import React from "react";
import { View, Text, Svg, Rect, StyleSheet } from "@react-pdf/renderer";
import { colors } from "./styles";

const s = StyleSheet.create({
  // Section heading — matches app's h2 + subtitle pattern
  sectionHeading: {
    marginBottom: 10,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: colors.foreground,
    marginBottom: 2,
  },
  sectionSubtitle: {
    fontSize: 8,
    color: colors.muted,
  },
  // Sub heading
  subHeading: {
    fontSize: 10,
    fontWeight: 600,
    color: colors.foreground,
    marginTop: 8,
    marginBottom: 4,
  },
  // Paragraph
  paragraph: {
    fontSize: 9,
    color: colors.foreground,
    lineHeight: 1.5,
    marginBottom: 4,
  },
  // Bullet list
  bulletRow: {
    flexDirection: "row",
    marginBottom: 3,
    paddingLeft: 2,
  },
  bulletDot: {
    width: 4,
    fontSize: 9,
    color: colors.primary,
    marginRight: 6,
  },
  bulletText: {
    flex: 1,
    fontSize: 9,
    color: colors.foreground,
    lineHeight: 1.5,
  },
  // Card — matches app's rounded-lg border border-border bg-card p-4
  card: {
    backgroundColor: colors.card,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 10,
    marginBottom: 6,
  },
  // Callout — matches app's blockquote/callout style
  calloutBox: {
    backgroundColor: colors.surfaceAlt,
    borderLeftWidth: 2,
    borderLeftColor: colors.primary,
    borderRadius: 4,
    padding: 10,
    marginVertical: 6,
  },
  calloutText: {
    fontSize: 8.5,
    color: colors.muted,
    lineHeight: 1.5,
    fontStyle: "italic",
  },
  // Key-value
  kvRow: {
    flexDirection: "row",
    marginBottom: 4,
    alignItems: "baseline",
  },
  kvLabel: {
    fontSize: 7.5,
    fontWeight: 700,
    color: colors.muted,
    textTransform: "uppercase",
    width: 80,
    letterSpacing: 0.5,
  },
  kvValue: {
    flex: 1,
    fontSize: 9.5,
    color: colors.foreground,
  },
  // Divider
  divider: {
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
    marginVertical: 14,
  },
  // Table — light headers matching app's clean look
  tableHeader: {
    flexDirection: "row",
    backgroundColor: colors.surfaceAlt,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderWidth: 0.5,
    borderColor: colors.border,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  tableHeaderCell: {
    fontSize: 7.5,
    fontWeight: 700,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: colors.border,
  },
  tableRowAlt: {
    backgroundColor: colors.surface,
  },
  tableRowLast: {
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  tableCell: {
    fontSize: 8,
    color: colors.foreground,
    lineHeight: 1.4,
  },
  tableCellMuted: {
    fontSize: 8,
    color: colors.muted,
  },
  // Status pill — matches app's StatusBadge
  pill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  pillText: {
    fontSize: 6.5,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  // Code block
  codeBlock: {
    fontFamily: "Courier",
    fontSize: 7.5,
    color: colors.foreground,
    backgroundColor: colors.surface,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 12,
    lineHeight: 1.6,
    marginVertical: 6,
  },
});

// ── Section Heading — clean title + optional subtitle ─────────────

export const SectionHeading = ({ title, subtitle }: { title: string; subtitle?: string; number?: number }) => (
  <View style={s.sectionHeading} wrap={false}>
    <Text style={s.sectionTitle}>{title}</Text>
    {subtitle && <Text style={s.sectionSubtitle}>{subtitle}</Text>}
  </View>
);

// ── Sub Heading ───────────────────────────────────────────────────

export const SubHeading = ({ children }: { children: string }) => (
  <Text style={s.subHeading}>{children}</Text>
);

// ── Paragraph ─────────────────────────────────────────────────────

export const Paragraph = ({
  children,
  italic,
  bold,
  color,
  size,
}: {
  children: string;
  italic?: boolean;
  bold?: boolean;
  color?: string;
  size?: number;
}) => (
  <Text
    style={[
      s.paragraph,
      italic && { fontStyle: "italic" },
      bold && { fontWeight: 700 },
      color ? { color } : undefined,
      size ? { fontSize: size } : undefined,
    ]}
  >
    {children}
  </Text>
);

// ── Card — bordered container matching app cards ──────────────────

export const Card = ({
  children,
  accentColor,
  allowWrap,
}: {
  children: React.ReactNode;
  accentColor?: string;
  allowWrap?: boolean;
}) => (
  <View
    style={[
      s.card,
      accentColor ? { borderLeftWidth: 3, borderLeftColor: accentColor } : undefined,
    ]}
    wrap={allowWrap !== false}
  >
    {children}
  </View>
);

// ── Bullet List ───────────────────────────────────────────────────

export const BulletList = ({ items, dotColor }: { items: any[]; dotColor?: string }) => (
  <View style={{ marginVertical: 4 }}>
    {(items || []).filter((v) => v != null && v !== false).map((item, i) => (
      <View key={i} style={s.bulletRow}>
        <Text style={[s.bulletDot, dotColor ? { color: dotColor } : undefined]}>{"\u2022"}</Text>
        <Text style={s.bulletText}>{safe(item)}</Text>
      </View>
    ))}
  </View>
);

// ── Data Table ────────────────────────────────────────────────────

interface Column {
  header: string;
  flex: number;
}

export const DataTable = ({
  columns,
  rows,
}: {
  columns: Column[];
  rows: string[][];
}) => (
  <View style={{ marginVertical: 6 }}>
    <View style={s.tableHeader} wrap={false}>
      {columns.map((col, i) => (
        <View key={i} style={{ flex: col.flex }}>
          <Text style={s.tableHeaderCell}>{col.header}</Text>
        </View>
      ))}
    </View>
    {rows.map((row, ri) => (
      <View
        key={ri}
        style={[
          s.tableRow,
          ri % 2 === 1 && s.tableRowAlt,
          ri === rows.length - 1 && s.tableRowLast,
        ]}
        wrap={false}
      >
        {row.map((cell, ci) => (
          <View key={ci} style={{ flex: columns[ci]?.flex ?? 1 }}>
            <Text style={ci === 0 ? [s.tableCell, { fontWeight: 600 }] : s.tableCell}>{cell}</Text>
          </View>
        ))}
      </View>
    ))}
  </View>
);

// ── Callout Box ───────────────────────────────────────────────────

export const Callout = ({ children }: { children: string }) => (
  <View style={s.calloutBox} wrap={false}>
    <Text style={s.calloutText}>{children}</Text>
  </View>
);

// ── Key-Value Row ─────────────────────────────────────────────────

export const KeyValue = ({ label, value }: { label: string; value: string }) => (
  <View style={s.kvRow}>
    <Text style={s.kvLabel}>{label}</Text>
    <Text style={s.kvValue}>{safe(value)}</Text>
  </View>
);

// ── Progress Bar (SVG) ────────────────────────────────────────────

export const ProgressBar = ({
  value,
  width = 120,
  height = 8,
  color = colors.primary,
  bgColor = colors.border,
}: {
  value: number;
  width?: number;
  height?: number;
  color?: string;
  bgColor?: string;
}) => {
  const clamped = Math.max(0, Math.min(100, value));
  const fillWidth = (clamped / 100) * width;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Rect x={0} y={0} width={width} height={height} rx={4} ry={4} fill={bgColor} />
      {fillWidth > 0 && (
        <Rect x={0} y={0} width={fillWidth} height={height} rx={4} ry={4} fill={color} />
      )}
    </Svg>
  );
};

// ── Status Pill — matches app's badge style ───────────────────────

const pillConfig: Record<string, { bg: string; text: string }> = {
  mvp: { bg: colors.primaryMuted, text: colors.primary },
  future: { bg: colors.surfaceAlt, text: colors.muted },
  passing: { bg: colors.greenLight, text: colors.green },
  failing: { bg: colors.redLight, text: colors.red },
  building: { bg: colors.amberLight, text: colors.amber },
  not_started: { bg: colors.surfaceAlt, text: colors.subtle },
  draft: { bg: colors.surfaceAlt, text: colors.muted },
  researched: { bg: colors.amberLight, text: colors.amber },
  ready: { bg: colors.primaryMuted, text: colors.primary },
  built: { bg: colors.greenLight, text: colors.green },
  available: { bg: colors.greenLight, text: colors.green },
  confirmed: { bg: colors.greenLight, text: colors.green },
  overridden: { bg: colors.primaryMuted, text: colors.primary },
  pending: { bg: colors.amberLight, text: colors.amber },
  resolved: { bg: colors.greenLight, text: colors.green },
  open: { bg: colors.amberLight, text: colors.amber },
};

export const StatusPill = ({ label }: { label: string }) => {
  const config = pillConfig[label.toLowerCase()] ?? { bg: colors.surfaceAlt, text: colors.muted };
  return (
    <View style={[s.pill, { backgroundColor: config.bg }]} wrap={false}>
      <Text style={[s.pillText, { color: config.text }]}>{label}</Text>
    </View>
  );
};

// ── Status Dot ────────────────────────────────────────────────────

export const StatusDot = ({ status }: { status: string }) => {
  const dotColors: Record<string, string> = {
    passing: colors.green,
    failing: colors.red,
    building: colors.amber,
    not_started: colors.subtle,
  };
  const fill = dotColors[status] ?? colors.subtle;
  return (
    <Svg width={8} height={8} viewBox="0 0 8 8" style={{ marginRight: 4 }}>
      <Rect x={1} y={1} width={6} height={6} rx={3} ry={3} fill={fill} />
    </Svg>
  );
};

// ── Code Block ────────────────────────────────────────────────────

export const CodeBlock = ({ children }: { children: string }) => (
  <Text style={s.codeBlock}>{children}</Text>
);

// ── Divider ───────────────────────────────────────────────────────

export const Divider = () => <View style={s.divider} />;

// ── Microsoft Logo (SVG) ──────────────────────────────────────────

export const MsLogo = ({ size = 14 }: { size?: number }) => {
  const gap = size * 0.12;
  const sq = (size - gap) / 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Rect x={0} y={0} width={sq} height={sq} fill={colors.msRed} />
      <Rect x={sq + gap} y={0} width={sq} height={sq} fill={colors.msGreen} />
      <Rect x={0} y={sq + gap} width={sq} height={sq} fill={colors.msBlue} />
      <Rect x={sq + gap} y={sq + gap} width={sq} height={sq} fill={colors.msYellow} />
    </Svg>
  );
};

// ── Metric Card (for executive summary) ───────────────────────────

export const MetricCard = ({ value, label }: { value: string | number; label: string }) => (
  <View
    style={{
      width: "23%",
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      borderRadius: 6,
      padding: 10,
      alignItems: "center",
    }}
    wrap={false}
  >
    <Text style={{ fontSize: 18, fontWeight: 700, color: colors.primary, marginBottom: 2 }}>
      {value}
    </Text>
    <Text style={{ fontSize: 7, fontWeight: 600, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "center" }}>
      {label}
    </Text>
  </View>
);

// ── Helpers ───────────────────────────────────────────────────────

export const safe = (v: any): string =>
  v != null && v !== "" ? String(v) : "\u2014";

export const Spacer = ({ h = 8 }: { h?: number }) => (
  <View style={{ height: h }} />
);
