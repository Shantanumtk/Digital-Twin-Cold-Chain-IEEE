export const theme = {
  bg: "#0a0f1a",
  card: "#0f1629",
  surface: "#141c30",
  sidebar: "#060b15",
  accent: "#10b981",
  accentDim: "rgba(16,185,129,0.12)",
  accentGlow: "rgba(16,185,129,0.3)",
  warning: "#f59e0b",
  warningDim: "rgba(245,158,11,0.12)",
  critical: "#ef4444",
  criticalDim: "rgba(239,68,68,0.12)",
  blue: "#3b82f6",
  blueDim: "rgba(59,130,246,0.12)",
  purple: "#8b5cf6",
  purpleDim: "rgba(139,92,246,0.12)",
  cyan: "#06b6d4",
  cyanDim: "rgba(6,182,212,0.12)",
  orange: "#f97316",
  text: "#e2e8f0",
  muted: "#94a3b8",
  dim: "#475569",
  border: "rgba(148,163,184,0.1)",
  borderLight: "rgba(148,163,184,0.05)",
} as const;

export type Theme = typeof theme;

export const stateColor = (state: string) =>
  state === "CRITICAL" ? theme.critical : state === "WARNING" ? theme.warning : theme.accent;

export const stateDim = (state: string) =>
  state === "CRITICAL" ? theme.criticalDim : state === "WARNING" ? theme.warningDim : theme.accentDim;
