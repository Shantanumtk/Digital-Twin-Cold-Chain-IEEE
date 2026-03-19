"use client";

import { useState } from "react";
import { theme, stateColor } from "@/lib/theme";
import { Asset } from "@/lib/types";
import { Badge, Mono, Card, MiniBar, Ring } from "./UIComponents";
import { useTick } from "@/hooks/useTick";
import TruckSVG from "./diagrams/TruckSVG";
import RoomSVG from "./diagrams/RoomSVG";

interface Props {
  asset: Asset;
  initialTab?: string;
  onClose: () => void;
}

// Generate mock temperature history
function tempHistory(base: number): number[] {
  return Array.from({ length: 24 }, (_, i) => base + Math.sin(i / 3 + base * 0.1) * 2.5 + (i > 18 ? Math.random() * 3 : 0));
}

export default function DetailModal({ asset, initialTab = "diagram", onClose }: Props) {
  const [tab, setTab] = useState(initialTab);
  const tick = useTick(100);
  const a = asset;
  const col = stateColor(a.state);
  const isTruck = a.asset_type === "refrigerated_truck";

  const tabs = [
    { k: "diagram", i: "📐", l: "Diagram" },
    { k: "temp", i: "🌡", l: "Temperature" },
    { k: "humidity", i: "💧", l: "Humidity" },
    { k: "door", i: "🚪", l: "Door" },
    { k: "compressor", i: "⚙", l: "Compressor" },
    { k: "alerts", i: "⚠", l: "Alerts" },
    { k: "config", i: "📋", l: "Config" },
  ];

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: theme.card, borderRadius: 16, width: "min(740px, 92vw)", maxHeight: "88vh", overflow: "auto", border: `1px solid ${theme.border}` }}
      >
        {/* ─── Header ─── */}
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${theme.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: theme.text }}>{a.asset_id}</span>
              <Badge state={a.state} />
            </div>
            <div style={{ fontSize: 11, color: theme.dim, marginTop: 3 }}>
              {a.cargo || a.asset_type} · {a.profile || "default"} · {isTruck ? (a.route || "No route") : (a.site || "No site")}
            </div>
          </div>
          <div onClick={onClose} style={{ cursor: "pointer", fontSize: 18, color: theme.dim, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, background: theme.surface }}>✕</div>
        </div>

        {/* ─── Tab bar ─── */}
        <div style={{ display: "flex", gap: 3, padding: "10px 22px", borderBottom: `1px solid ${theme.border}`, flexWrap: "wrap" }}>
          {tabs.map((t) => (
            <div
              key={t.k}
              onClick={() => setTab(t.k)}
              style={{
                padding: "5px 10px", borderRadius: 7, cursor: "pointer",
                fontSize: 11, fontWeight: 500, display: "flex", alignItems: "center", gap: 4,
                background: tab === t.k ? theme.accentDim : "transparent",
                color: tab === t.k ? theme.accent : theme.muted,
                transition: "all 0.15s",
              }}
            >
              <span style={{ fontSize: 13 }}>{t.i}</span>{t.l}
            </div>
          ))}
        </div>

        {/* ─── Tab Content ─── */}
        <div style={{ padding: 22, minHeight: 280 }}>

          {/* ══════ TAB: Diagram ══════ */}
          {tab === "diagram" && (
            <div style={{ height: 230 }}>
              {isTruck ? <TruckSVG asset={a} tick={tick} /> : <RoomSVG asset={a} tick={tick} />}
            </div>
          )}

          {/* ══════ TAB: Temperature ══════ */}
          {tab === "temp" && (
            <div>
              {/* Stats row */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
                {[
                  ["Current", a.temperature_c, col],
                  ["Min (24h)", a.temperature_c - 3.2, theme.blue],
                  ["Max (24h)", a.temperature_c + 5.1, theme.warning],
                  ["Avg (24h)", a.temperature_c + 0.8, theme.muted],
                ].map(([label, val, c]) => (
                  <div key={label as string} style={{ background: theme.surface, borderRadius: 8, padding: 12, textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: theme.dim, marginBottom: 3 }}>{label as string}</div>
                    <Mono color={c as string} size={16}>{(val as number).toFixed(1)}°C</Mono>
                  </div>
                ))}
              </div>

              {/* Chart */}
              <Card style={{ padding: 16 }}>
                <div style={{ fontSize: 11, color: theme.muted, marginBottom: 8 }}>Temperature — last 24 hours</div>
                <svg viewBox="0 0 620 120" style={{ width: "100%", height: 120 }}>
                  {/* Threshold lines */}
                  <line x1="0" y1="45" x2="600" y2="45" stroke="rgba(239,68,68,0.12)" strokeDasharray="4,4" />
                  <text x="604" y="49" fill={theme.critical} fontSize="8">Critical</text>
                  <line x1="0" y1="32" x2="600" y2="32" stroke="rgba(245,158,11,0.12)" strokeDasharray="4,4" />
                  <text x="604" y="36" fill={theme.warning} fontSize="8">Warning</text>

                  {/* Data line */}
                  {(() => {
                    const data = tempHistory(a.temperature_c);
                    const mn = Math.min(...data) - 2;
                    const mx = Math.max(...data) + 2;
                    const rng = mx - mn || 1;
                    const pts = data.map((v, i) =>
                      `${(i / (data.length - 1)) * 596 + 4},${108 - ((v - mn) / rng) * 96 + 4}`
                    ).join(" ");
                    return <polyline points={pts} fill="none" stroke={theme.accent} strokeWidth="2" strokeLinejoin="round" />;
                  })()}

                  {/* X-axis labels */}
                  {["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"].map((l, i) => (
                    <text key={l} x={4 + i * 120} y="118" fill={theme.dim} fontSize="8">{l}</text>
                  ))}
                </svg>
              </Card>

              {/* Rate of change */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 12 }}>
                {[
                  ["Rate of Change", "+0.2°C/hr", a.state === "CRITICAL" ? theme.critical : theme.accent],
                  ["Time in Range", "21.5 hrs", theme.accent],
                  ["Breaches (24h)", a.state === "CRITICAL" ? "3" : "0", a.state === "CRITICAL" ? theme.critical : theme.accent],
                ].map(([l, v, c]) => (
                  <div key={l as string} style={{ background: theme.surface, borderRadius: 8, padding: "8px 12px" }}>
                    <div style={{ fontSize: 9, color: theme.dim }}>{l as string}</div>
                    <Mono color={c as string} size={14}>{v as string}</Mono>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══════ TAB: Humidity ══════ */}
          {tab === "humidity" && (
            <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
              {/* Ring gauge */}
              <div style={{ flexShrink: 0 }}>
                <Ring pct={(a.humidity || 50) / 100} color={(a.humidity || 50) > 70 ? theme.warning : theme.accent} size={110} label={`${a.humidity || 50}%`} />
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: theme.text, marginBottom: 6 }}>Relative Humidity</div>
                <div style={{ fontSize: 12, color: theme.dim, marginBottom: 8 }}>Target range: 40-60% RH</div>

                <div style={{
                  fontSize: 13, fontWeight: 500, marginBottom: 14,
                  color: (a.humidity || 50) > 70 ? theme.warning : (a.humidity || 50) < 40 ? theme.critical : theme.accent,
                }}>
                  {(a.humidity || 50) > 70 ? "⚠ Above target range" : (a.humidity || 50) < 40 ? "✕ Below target range" : "✓ Within target range"}
                </div>

                {/* Stats grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    ["Min (24h)", "38%"],
                    ["Max (24h)", `${(a.humidity || 50) + 12}%`],
                    ["Avg (24h)", `${(a.humidity || 50) - 3}%`],
                    ["Dew Point", "4.2°C"],
                  ].map(([l, v]) => (
                    <div key={l} style={{ background: theme.surface, borderRadius: 6, padding: "6px 10px" }}>
                      <div style={{ fontSize: 8, color: theme.dim }}>{l}</div>
                      <Mono size={12}>{v}</Mono>
                    </div>
                  ))}
                </div>

                {/* Humidity trend mini chart */}
                <div style={{ marginTop: 12 }}>
                  <Card style={{ padding: 12 }}>
                    <div style={{ fontSize: 10, color: theme.muted, marginBottom: 6 }}>Humidity trend (24h)</div>
                    <svg viewBox="0 0 400 60" style={{ width: "100%", height: 60 }}>
                      <rect x="0" y="15" width="400" height="25" fill="rgba(16,185,129,0.05)" rx="2" />
                      <text x="2" y="12" fontSize="7" fill={theme.dim}>60%</text>
                      <text x="2" y="48" fontSize="7" fill={theme.dim}>40%</text>
                      {(() => {
                        const base = a.humidity || 50;
                        const data = Array.from({ length: 24 }, (_, i) => base + Math.sin(i / 4) * 8 + Math.random() * 4 - 2);
                        const pts = data.map((v, i) => `${(i / 23) * 396 + 2},${55 - ((v - 30) / 50) * 50}`).join(" ");
                        return <polyline points={pts} fill="none" stroke={theme.cyan} strokeWidth="1.5" strokeLinejoin="round" />;
                      })()}
                    </svg>
                  </Card>
                </div>
              </div>
            </div>
          )}

          {/* ══════ TAB: Door ══════ */}
          {tab === "door" && (
            <div>
              {/* Status */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 12,
                  background: a.door_open ? theme.warningDim : theme.accentDim,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28,
                }}>
                  {a.door_open ? "🔓" : "🔒"}
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: a.door_open ? theme.warning : theme.accent }}>
                    {a.door_open ? "OPEN" : "CLOSED"}
                  </div>
                  <div style={{ fontSize: 12, color: theme.dim }}>Last changed 14 minutes ago</div>
                </div>
              </div>

              {/* Activity timeline */}
              <Card style={{ padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: theme.muted, marginBottom: 8 }}>Door activity today</div>
                <div style={{ display: "flex", gap: 3 }}>
                  {[false, false, true, false, true, true, false, false, false, true, false, false, false, false, true, false].map((open, i) => (
                    <div key={i} style={{
                      flex: 1, height: 28, borderRadius: 3,
                      background: open ? "rgba(245,158,11,0.25)" : "rgba(16,185,129,0.06)",
                      transition: "all 0.3s",
                    }}
                      title={`${String(6 + i).padStart(2, "0")}:00 — ${open ? "Open" : "Closed"}`}
                    />
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: theme.dim, marginTop: 4 }}>
                  <span>06:00</span><span>12:00</span><span>22:00</span>
                </div>
              </Card>

              {/* Stats */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
                {[
                  ["Opens Today", "5"],
                  ["Total Open Time", "47 min"],
                  ["Avg Open Duration", "9.4 min"],
                ].map(([l, v]) => (
                  <div key={l} style={{ background: theme.surface, borderRadius: 8, padding: "10px 14px" }}>
                    <div style={{ fontSize: 9, color: theme.dim, marginBottom: 2 }}>{l}</div>
                    <Mono size={15}>{v}</Mono>
                  </div>
                ))}
              </div>

              {/* Recent events */}
              <Card style={{ padding: 14 }}>
                <div style={{ fontSize: 11, color: theme.muted, marginBottom: 8 }}>Recent door events</div>
                {[
                  { time: "14:32", action: "Closed", duration: "12 min" },
                  { time: "14:20", action: "Opened", duration: "—" },
                  { time: "11:45", action: "Closed", duration: "8 min" },
                  { time: "11:37", action: "Opened", duration: "—" },
                  { time: "09:15", action: "Closed", duration: "15 min" },
                  { time: "09:00", action: "Opened", duration: "—" },
                ].map((ev, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: i < 5 ? `1px solid ${theme.borderLight}` : "none" }}>
                    <Mono size={10} color={theme.muted}>{ev.time}</Mono>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: ev.action === "Opened" ? theme.warning : theme.accent }} />
                    <span style={{ fontSize: 11, color: theme.text, flex: 1 }}>{ev.action}</span>
                    {ev.duration !== "—" && <span style={{ fontSize: 10, color: theme.dim }}>Duration: {ev.duration}</span>}
                  </div>
                ))}
              </Card>
            </div>
          )}

          {/* ══════ TAB: Compressor ══════ */}
          {tab === "compressor" && (
            <div>
              {/* Status */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
                <div style={{
                  width: 56, height: 56, borderRadius: "50%",
                  background: a.compressor_running ? theme.accentDim : theme.criticalDim,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24,
                }}>
                  <span style={{ display: "inline-block", animation: a.compressor_running ? "spin 2s linear infinite" : "none" }}>⟳</span>
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: a.compressor_running ? theme.accent : theme.critical }}>
                    {a.compressor_running ? "Running" : "Stopped"}
                  </div>
                  <div style={{ fontSize: 12, color: theme.dim }}>Runtime today: 18h 42m (78%)</div>
                </div>
              </div>

              {/* Metrics */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
                {[
                  ["Efficiency", "94%", theme.accent],
                  ["Cycles Today", "23", theme.text],
                  ["Avg Cycle", "48 min", theme.text],
                  ["Power Draw", "2.4 kW", theme.blue],
                ].map(([l, v, c]) => (
                  <div key={l as string} style={{ background: theme.surface, borderRadius: 8, padding: "10px 14px" }}>
                    <div style={{ fontSize: 9, color: theme.dim, marginBottom: 2 }}>{l as string}</div>
                    <Mono color={c as string} size={15}>{v as string}</Mono>
                  </div>
                ))}
              </div>

              {/* Cycle timeline */}
              <Card style={{ padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: theme.muted, marginBottom: 8 }}>Compressor cycle timeline (24h)</div>
                <div style={{ display: "flex", gap: 2, height: 28 }}>
                  {Array.from({ length: 48 }).map((_, i) => {
                    const on = Math.sin(i * 0.4) > -0.3;
                    return <div key={i} style={{ flex: 1, borderRadius: 2, background: on ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.08)" }} />;
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: theme.dim, marginTop: 4 }}>
                  <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>Now</span>
                </div>
              </Card>

              {/* Additional metrics */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {[
                  ["Total Runtime", "18h 42m", 78, theme.accent],
                  ["Idle Time", "5h 18m", 22, theme.dim],
                  ["Energy Used", "42.6 kWh", 65, theme.blue],
                ].map(([l, v, pct, c]) => (
                  <div key={l as string} style={{ background: theme.surface, borderRadius: 8, padding: "10px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 9, color: theme.dim }}>{l as string}</span>
                      <Mono size={10} color={c as string}>{v as string}</Mono>
                    </div>
                    <MiniBar pct={pct as number} color={c as string} h={4} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══════ TAB: Alerts ══════ */}
          {tab === "alerts" && (
            <div>
              {/* Mock alerts for this asset */}
              {(() => {
                const assetAlerts = [
                  ...(a.state === "CRITICAL" ? [
                    { sev: "CRITICAL", msg: `Temperature breach: ${a.temperature_c?.toFixed(1)}°C exceeds threshold`, time: "2 min ago" },
                    { sev: "CRITICAL", msg: a.compressor_running ? "Temperature rising despite compressor" : "Compressor failure detected", time: "5 min ago" },
                  ] : []),
                  ...(a.state === "WARNING" ? [
                    { sev: "WARNING", msg: a.door_open ? "Door open — temperature at risk" : `Temperature approaching warning threshold`, time: "6 min ago" },
                  ] : []),
                  ...(a.door_open ? [
                    { sev: "WARNING", msg: "Door has been open for extended period", time: "14 min ago" },
                  ] : []),
                  { sev: "INFO", msg: "Routine health check passed", time: "1h ago" },
                  { sev: "INFO", msg: "Compressor cycle completed normally", time: "2h ago" },
                  { sev: "INFO", msg: "Temperature within normal range", time: "4h ago" },
                ];

                if (assetAlerts.length === 0) {
                  return <div style={{ textAlign: "center", color: theme.dim, padding: 40, fontSize: 13 }}>No alerts for this asset</div>;
                }

                return assetAlerts.map((al, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "12px 0", borderBottom: i < assetAlerts.length - 1 ? `1px solid ${theme.borderLight}` : "none",
                  }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                      background: al.sev === "CRITICAL" ? theme.critical : al.sev === "WARNING" ? theme.warning : theme.blue,
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: theme.text }}>{al.msg}</div>
                      <div style={{ fontSize: 10, color: theme.dim, marginTop: 2 }}>{al.time}</div>
                    </div>
                    <Badge state={al.sev} small />
                  </div>
                ));
              })()}
            </div>
          )}

          {/* ══════ TAB: Config ══════ */}
          {tab === "config" && (
            <div>
              {/* Profile assignment */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 10 }}>Threshold Profile</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {["frozen_goods", "chilled_goods", "pharma", "ambient_storage"].map(p => (
                    <div key={p} style={{
                      padding: "8px 14px", borderRadius: 8, cursor: "pointer",
                      background: (a.profile || "frozen_goods") === p ? theme.accentDim : theme.surface,
                      border: `1px solid ${(a.profile || "frozen_goods") === p ? theme.accent : theme.border}`,
                      color: (a.profile || "frozen_goods") === p ? theme.accent : theme.muted,
                      fontSize: 11, fontWeight: 500,
                    }}>
                      {p.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                    </div>
                  ))}
                </div>
              </div>

              {/* Config grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                {[
                  ["Asset ID", a.asset_id],
                  ["Asset Type", isTruck ? "Refrigerated Truck" : "Cold Room"],
                  ["Profile", (a.profile || "frozen_goods").replace(/_/g, " ")],
                  ["Cargo Type", a.cargo || a.asset_type],
                  ["Warning Threshold", a.profile === "pharma" ? "2.0°C" : a.profile === "chilled_goods" ? "4.0°C" : "-10.0°C"],
                  ["Critical Threshold", a.profile === "pharma" ? "5.0°C" : a.profile === "chilled_goods" ? "8.0°C" : "-5.0°C"],
                  ["Humidity Range", "40-60%"],
                  ["Last Calibration", "2026-03-15"],
                  ...(isTruck ? [
                    ["Route", a.route || "Not assigned"],
                    ["License Plate", "CA-" + a.asset_id.replace("truck", "").toUpperCase() + "-2026"],
                  ] : [
                    ["Site", a.site || "Not assigned"],
                    ["Room Capacity", `${a.capacity || 60}%`],
                  ]),
                ].map(([k, v]) => (
                  <div key={k as string} style={{ background: theme.surface, borderRadius: 8, padding: "10px 14px" }}>
                    <div style={{ fontSize: 9, color: theme.dim, marginBottom: 2 }}>{k as string}</div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: theme.text }}>{v as string}</div>
                  </div>
                ))}
              </div>

              {/* Threshold visualization */}
              <Card style={{ padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 10 }}>Threshold Configuration</div>
                <div style={{ position: "relative", height: 60, background: theme.surface, borderRadius: 8, overflow: "hidden" }}>
                  {/* Scale */}
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 16, display: "flex", justifyContent: "space-between", padding: "0 8px", alignItems: "center" }}>
                    {[-30, -20, -10, 0, 10, 20].map(v => (
                      <span key={v} style={{ fontSize: 8, color: theme.dim }}>{v}°C</span>
                    ))}
                  </div>
                  {/* Warning zone */}
                  {(() => {
                    const warnThresh = a.profile === "pharma" ? 2 : a.profile === "chilled_goods" ? 4 : -10;
                    const critThresh = a.profile === "pharma" ? 5 : a.profile === "chilled_goods" ? 8 : -5;
                    const warnPct = ((warnThresh + 30) / 50) * 100;
                    const critPct = ((critThresh + 30) / 50) * 100;
                    const tempPct = ((a.temperature_c + 30) / 50) * 100;
                    return (
                      <>
                        <div style={{ position: "absolute", left: `${warnPct}%`, top: 0, bottom: 16, width: `${critPct - warnPct}%`, background: "rgba(245,158,11,0.1)" }} />
                        <div style={{ position: "absolute", left: `${critPct}%`, top: 0, bottom: 16, right: 0, background: "rgba(239,68,68,0.08)" }} />
                        <div style={{ position: "absolute", left: `${warnPct}%`, top: 0, bottom: 16, width: 1, background: theme.warning }} />
                        <div style={{ position: "absolute", left: `${critPct}%`, top: 0, bottom: 16, width: 1, background: theme.critical }} />
                        <div style={{ position: "absolute", left: `${Math.min(95, Math.max(2, tempPct))}%`, top: 4, width: 3, height: 32, borderRadius: 2, background: col, transform: "translateX(-50%)" }} />
                      </>
                    );
                  })()}
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 8 }}>
                  <span style={{ fontSize: 10, color: theme.accent, display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 3, background: theme.accent, display: "inline-block", borderRadius: 1 }} />Normal</span>
                  <span style={{ fontSize: 10, color: theme.warning, display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 3, background: theme.warning, display: "inline-block", borderRadius: 1 }} />Warning</span>
                  <span style={{ fontSize: 10, color: theme.critical, display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 3, background: theme.critical, display: "inline-block", borderRadius: 1 }} />Critical</span>
                </div>
              </Card>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
