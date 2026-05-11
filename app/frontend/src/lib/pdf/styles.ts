import { StyleSheet } from "@react-pdf/renderer";

// ── Color palette — matches the app's shadcn/tailwind theme ──────
export const colors = {
  // Neutrals (slate scale)
  foreground: "#0F172A",   // text-foreground (slate-900)
  muted: "#64748B",        // text-muted-foreground (slate-500)
  subtle: "#94A3B8",       // lighter muted (slate-400)
  border: "#E2E8F0",       // border-border (slate-200)
  card: "#FFFFFF",         // bg-card
  surface: "#F8FAFC",      // bg-surface-1 (slate-50)
  surfaceAlt: "#F1F5F9",   // bg-surface-2 (slate-100)
  white: "#FFFFFF",

  // Accent
  primary: "#3B82F6",      // primary (blue-500)
  primaryLight: "#EFF6FF", // primary/5 (blue-50)
  primaryMuted: "#DBEAFE", // primary/10 (blue-100)

  // Status
  green: "#16A34A",
  greenLight: "#F0FDF4",
  greenBorder: "#BBF7D0",
  amber: "#D97706",
  amberLight: "#FFFBEB",
  amberBorder: "#FDE68A",
  red: "#DC2626",
  redLight: "#FEF2F2",

  // Legacy — kept for MS logo
  msRed: "#F35325",
  msGreen: "#81BC06",
  msBlue: "#05A6F0",
  msYellow: "#FFBA08",
};

// ── Page dimensions (A4 in points) ────────────────────────────────
export const page = {
  width: 595.28,
  height: 841.89,
  marginTop: 50,
  marginBottom: 44,
  marginLeft: 48,
  marginRight: 48,
};

export const contentWidth = page.width - page.marginLeft - page.marginRight;

// ── Shared styles ─────────────────────────────────────────────────
export const baseStyles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: colors.foreground,
    paddingTop: page.marginTop,
    paddingBottom: page.marginBottom,
    paddingLeft: page.marginLeft,
    paddingRight: page.marginRight,
  },
  // Header (fixed on every page)
  header: {
    position: "absolute",
    top: 14,
    left: page.marginLeft,
    right: page.marginRight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  headerText: {
    fontSize: 7,
    color: colors.muted,
  },
  headerRight: {
    fontSize: 7,
    color: colors.subtle,
  },
  // Footer (fixed on every page)
  footer: {
    position: "absolute",
    bottom: 14,
    left: page.marginLeft,
    right: page.marginRight,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
    paddingTop: 6,
  },
  footerText: {
    fontSize: 6.5,
    color: colors.subtle,
  },
});
