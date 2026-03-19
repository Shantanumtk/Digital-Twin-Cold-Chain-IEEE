"use client";

import { theme, stateColor, stateDim } from "@/lib/theme";

// ─── State Badge ───
export function Badge({ state, small }: { state: string; small?: boolean }) {
  const c = stateColor(state);
  return (
    <span style={{
      background: `${c}18`, color: c,
      fontSize: small ? 11 : 12, fontWeight: 700,
      padding: small ? "2px 5px" : "2px 7px",
      borderRadius: 3, letterSpacing: "0.04em",
      border: `1px solid ${c}25`,
    }}>
      {state}
    </span>
  );
}

// ─── Monospace text ───
export function Mono({ children, color = theme.text, size = 14 }: { children: React.ReactNode; color?: string; size?: number }) {
  return (
    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: size, color }}>
      {children}
    </span>
  );
}

// ─── Mini sparkline SVG ───
export function Sparkline({ data, color, width = 68, height = 20 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (!data || data.length < 2) return null;
  const mn = Math.min(...data), mx = Math.max(...data), r = mx - mn || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - mn) / r) * height}`).join(" ");
  return <svg width={width} height={height}><polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}

// ─── Progress bar ───
export function MiniBar({ pct, color, h = 6 }: { pct: number; color: string; h?: number }) {
  return (
    <div style={{ width: "100%", height: h, borderRadius: 3, background: "rgba(148,163,184,0.06)" }}>
      <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", borderRadius: 3, background: color, transition: "width 0.5s" }} />
    </div>
  );
}

// ─── Ring/Donut gauge ───
export function Ring({ pct, color, size = 48, label }: { pct: number; color: string; size?: number; label: string }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,163,184,0.06)" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeDasharray={`${pct * circ} ${circ}`} strokeLinecap="round" />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size < 50 ? 11 : 14, fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace" }}>
        {label}
      </div>
    </div>
  );
}

// ─── Card wrapper ───
export function Card({ children, style: s }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: theme.card, borderRadius: 10, border: `1px solid ${theme.border}`, ...s }}>
      {children}
    </div>
  );
}

// ─── Stat card ───
export function StatCard({ label, value, color, icon, sub }: { label: string; value: string | number; color: string; icon: string; sub?: string }) {
  return (
    <Card style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 11, color: theme.dim, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
        <Mono color={color} size={22}>{value}</Mono>
        {sub && <div style={{ fontSize: 11, color: theme.dim, marginTop: 2 }}>{sub}</div>}
      </div>
    </Card>
  );
}
