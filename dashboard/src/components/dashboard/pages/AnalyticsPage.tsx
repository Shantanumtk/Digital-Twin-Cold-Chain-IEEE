"use client";
import { useState, useEffect } from "react";

import { theme, stateColor } from "@/lib/theme";
import { Asset } from "@/lib/types";
import { Card, Mono, MiniBar, Ring, Sparkline, StatCard } from "../UIComponents";

interface Props {
  subNav: number;
  assets: Asset[];
  trucks: Asset[];
  rooms: Asset[];
  stats: any;
}

function sparkData(base: number): number[] {
  return Array.from({ length: 12 }, (_, i) => base + Math.sin(i / 2.5 + base * 0.1) * 2.5);
}

// ─── Sub-nav 0: Temp Trends ───
function TempTrends({ assets, trucks, rooms }: { assets: Asset[]; trucks: Asset[]; rooms: Asset[] }) {
  const allTemps = assets.map(a => a.temperature_c || 0).filter(t => t !== 0);
  const avg = allTemps.length > 0 ? allTemps.reduce((s, t) => s + t, 0) / allTemps.length : 0;
  const coldest = allTemps.length > 0 ? Math.min(...allTemps) : 0;
  const warmest = allTemps.length > 0 ? Math.max(...allTemps) : 0;
  const breaches = assets.filter(a => a.state === "CRITICAL").length;

  return (
    <div>
      {/* Top stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
        <StatCard label="Fleet Average" value={`${avg.toFixed(1)}°C`} color={theme.blue} icon="📊" sub="Last 24h" />
        <StatCard label="Coldest Asset" value={`${coldest.toFixed(1)}°C`} color={theme.cyan} icon="❄" />
        <StatCard label="Warmest Asset" value={`${warmest.toFixed(1)}°C`} color={theme.warning} icon="🔥" />
        <StatCard label="Active Breaches" value={breaches} color={breaches > 0 ? theme.critical : theme.accent} icon="⚠" />
      </div>

      {/* Multi-line fleet chart */}
      <Card style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 10 }}>Temperature Trends — All Assets (24h)</div>
        <svg viewBox="0 0 640 140" style={{ width: "100%", height: 140 }}>
          {/* Grid lines */}
          {[-25, -20, -15, -10, -5, 0, 5, 10].map((v, i) => (
            <g key={v}>
              <line x1="32" y1={8 + i * 16.5} x2="630" y2={8 + i * 16.5} stroke={theme.borderLight} />
              <text x="28" y={12 + i * 16.5} fill={theme.dim} fontSize="7" textAnchor="end">{v}°</text>
            </g>
          ))}
          {/* Asset lines */}
          {assets.slice(0, 8).map((a, di) => {
            const colors = [theme.accent, theme.warning, theme.critical, theme.blue, theme.purple, theme.cyan, theme.orange, "#a78bfa"];
            const data = sparkData(a.temperature_c);
            const pts = data.map((v, i) => {
              const x = 32 + (i / (data.length - 1)) * 598;
              const y = 8 + ((-25 - v) / (-25 - 10)) * 132;
              return `${x},${Math.max(4, Math.min(136, y))}`;
            }).join(" ");
            return <polyline key={di} points={pts} fill="none" stroke={colors[di % colors.length]} strokeWidth="1.5" strokeLinejoin="round" opacity="0.7" />;
          })}
          {/* X labels */}
          {["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "Now"].map((l, i) => (
            <text key={l} x={32 + i * 100} y="138" fill={theme.dim} fontSize="7">{l}</text>
          ))}
        </svg>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 6, flexWrap: "wrap" }}>
          {assets.slice(0, 8).map((a, i) => {
            const colors = [theme.accent, theme.warning, theme.critical, theme.blue, theme.purple, theme.cyan, theme.orange, "#a78bfa"];
            return <span key={a.asset_id} style={{ fontSize: 9, color: theme.muted, display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 3, borderRadius: 1, background: colors[i % colors.length], display: "inline-block" }} />{a.asset_id}</span>;
          })}
        </div>
      </Card>

      {/* Temperature distribution */}
      <Card style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 10 }}>Temperature Distribution</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }}>
          {[
            { range: "<-20", count: assets.filter(a => a.temperature_c < -20).length, c: theme.blue },
            { range: "-20 to -15", count: assets.filter(a => a.temperature_c >= -20 && a.temperature_c < -15).length, c: theme.cyan },
            { range: "-15 to -10", count: assets.filter(a => a.temperature_c >= -15 && a.temperature_c < -10).length, c: theme.accent },
            { range: "-10 to -5", count: assets.filter(a => a.temperature_c >= -10 && a.temperature_c < -5).length, c: theme.accent },
            { range: "-5 to 0", count: assets.filter(a => a.temperature_c >= -5 && a.temperature_c < 0).length, c: theme.warning },
            { range: "0 to 5", count: assets.filter(a => a.temperature_c >= 0 && a.temperature_c < 5).length, c: theme.warning },
            { range: "5 to 10", count: assets.filter(a => a.temperature_c >= 5 && a.temperature_c < 10).length, c: theme.critical },
            { range: ">10", count: assets.filter(a => a.temperature_c >= 10).length, c: theme.critical },
          ].map((b) => {
            const maxCount = Math.max(1, ...assets.map(() => 3));
            const h = Math.max(4, (b.count / maxCount) * 70);
            return (
              <div key={b.range} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <Mono size={9} color={b.c}>{b.count}</Mono>
                <div style={{ width: "100%", height: h, background: b.c, borderRadius: "3px 3px 0 0", opacity: 0.6, transition: "height 0.5s" }} />
                <span style={{ fontSize: 7, color: theme.dim, textAlign: "center", lineHeight: 1.1 }}>{b.range}</span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Per-asset sparkline cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
        {assets.map(a => (
          <Card key={a.asset_id} style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>{a.asset_id}</div>
              <Mono color={stateColor(a.state)} size={14}>{a.temperature_c?.toFixed(1)}°C</Mono>
            </div>
            <Sparkline data={sparkData(a.temperature_c)} color={stateColor(a.state)} width={60} height={24} />
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Sub-nav 1: Fleet Efficiency ───
function FleetEfficiency({ trucks, rooms, assets }: { trucks: Asset[]; rooms: Asset[]; assets: Asset[] }) {
  const compRunning = assets.filter(a => a.compressor_running).length;
  const doorsOpen = assets.filter(a => a.door_open).length;
  const avgFuel = trucks.length > 0 ? trucks.reduce((s, t) => s + (t.fuel || 50), 0) / trucks.length : 0;

  return (
    <div>
      {/* Top metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 16 }}>
        <StatCard label="Compressors On" value={`${compRunning}/${assets.length}`} color={theme.accent} icon="⚙" />
        <StatCard label="Doors Open" value={doorsOpen} color={doorsOpen > 0 ? theme.warning : theme.accent} icon="🚪" />
        <StatCard label="Avg Fuel" value={`${avgFuel.toFixed(0)}%`} color={avgFuel < 40 ? theme.warning : theme.accent} icon="⛽" />
        <StatCard label="Uptime" value="97.8%" color={theme.accent} icon="⏱" />
        <StatCard label="Energy Today" value="186 kWh" color={theme.blue} icon="⚡" />
      </div>

      {/* Compressor cycles chart */}
      <Card style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 10 }}>Compressor Cycles per Asset (24h)</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 90 }}>
          {assets.map(a => {
            const cycles = a.compressor_running ? Math.floor(Math.random() * 15 + 10) : 0;
            const maxCycles = 30;
            return (
              <div key={a.asset_id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <Mono size={8} color={a.compressor_running ? theme.accent : theme.critical}>{cycles}</Mono>
                <div style={{ width: "100%", height: (cycles / maxCycles) * 80, background: a.compressor_running ? theme.accent : theme.critical, borderRadius: "3px 3px 0 0", opacity: 0.5, minHeight: 2 }} />
                <span style={{ fontSize: 7, color: theme.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%", textAlign: "center" }}>
                  {a.asset_id.replace("site", "S").replace("-room", "R").replace("truck", "T")}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Door open duration chart */}
      <Card style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 10 }}>Door Open Duration (minutes today)</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 80 }}>
          {assets.map(a => {
            const mins = a.door_open ? Math.floor(Math.random() * 40 + 20) : Math.floor(Math.random() * 10);
            const maxMins = 60;
            return (
              <div key={a.asset_id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <Mono size={8} color={mins > 30 ? theme.warning : theme.accent}>{mins}m</Mono>
                <div style={{ width: "100%", height: Math.max(2, (mins / maxMins) * 70), background: mins > 30 ? theme.warning : theme.accent, borderRadius: "3px 3px 0 0", opacity: 0.5 }} />
                <span style={{ fontSize: 7, color: theme.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%", textAlign: "center" }}>
                  {a.asset_id.replace("site", "S").replace("-room", "R").replace("truck", "T")}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Per-truck efficiency */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {trucks.map(t => {
          const eff = t.compressor_running ? Math.floor(Math.random() * 8 + 88) : 0;
          return (
            <Card key={t.asset_id} style={{ padding: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 8 }}>{t.asset_id}</div>
              {[
                ["Compressor Eff.", `${eff}%`, eff, eff > 90 ? theme.accent : theme.warning],
                ["Fuel Level", `${t.fuel || 50}%`, t.fuel || 50, (t.fuel || 50) < 40 ? theme.warning : theme.accent],
                ["Uptime", "98.2%", 98, theme.accent],
              ].map(([l, v, p, c]) => (
                <div key={l as string} style={{ marginBottom: 5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginBottom: 2 }}>
                    <span style={{ color: theme.dim }}>{l as string}</span>
                    <Mono size={9} color={c as string}>{v as string}</Mono>
                  </div>
                  <MiniBar pct={p as number} color={c as string} h={3} />
                </div>
              ))}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Sub-nav 2: SLA Compliance ───
function SLACompliance({ assets }: { assets: Asset[] }) {
  const [weekAlerts, setWeekAlerts] = useState<any[]>([]);
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/alerts?hours=168&limit=500`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : { alerts: [] })
      .then(d => setWeekAlerts(Array.isArray(d) ? d : d.alerts || []))
      .catch(() => {});
  }, []);
  const normal = assets.filter(a => a.state === "NORMAL").length;
  const warning = assets.filter(a => a.state === "WARNING").length;
  const critical = assets.filter(a => a.state === "CRITICAL").length;
  const totalSLA = assets.length > 0 ? ((normal / assets.length) * 100) : 100;

  return (
    <div>
      {/* Ring gauges */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
        {[
          { l: "Overall SLA", pct: totalSLA / 100, c: totalSLA > 90 ? theme.accent : totalSLA > 70 ? theme.warning : theme.critical, label: `${totalSLA.toFixed(0)}%` },
          { l: "Temp Compliance", pct: (normal + warning * 0.5) / Math.max(1, assets.length), c: theme.accent, label: `${(((normal + warning * 0.5) / Math.max(1, assets.length)) * 100).toFixed(0)}%` },
          { l: "Door Compliance", pct: assets.filter(a => !a.door_open).length / Math.max(1, assets.length), c: theme.blue, label: `${((assets.filter(a => !a.door_open).length / Math.max(1, assets.length)) * 100).toFixed(0)}%` },
          { l: "Compressor Health", pct: assets.filter(a => a.compressor_running).length / Math.max(1, assets.length), c: theme.purple, label: `${((assets.filter(a => a.compressor_running).length / Math.max(1, assets.length)) * 100).toFixed(0)}%` },
        ].map(r => (
          <Card key={r.l} style={{ padding: 14, textAlign: "center" }}>
            <Ring pct={r.pct} color={r.c} size={64} label={r.label} />
            <div style={{ fontSize: 12, color: theme.muted, marginTop: 6 }}>{r.l}</div>
          </Card>
        ))}
      </div>

      {/* Per-asset SLA bars */}
      <Card style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 10 }}>Per-Asset SLA Compliance</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {assets.map(a => {
            const sla = a.state === "NORMAL" ? 98 + Math.random() * 2 : a.state === "WARNING" ? 75 + Math.random() * 10 : 30 + Math.random() * 20;
            const c = sla > 90 ? theme.accent : sla > 70 ? theme.warning : theme.critical;
            return (
              <div key={a.asset_id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 80, fontSize: 11, fontWeight: 500, color: theme.text, flexShrink: 0 }}>{a.asset_id}</span>
                <div style={{ flex: 1 }}><MiniBar pct={sla} color={c} h={8} /></div>
                <Mono size={11} color={c}>{sla.toFixed(1)}%</Mono>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Incidents chart (7 days) */}
      <Card style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 10 }}>Incidents — Last 7 Days</div>
        {(() => {
          const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
          const now = new Date();
          const dayBuckets = Array.from({length: 7}, (_, i) => {
            const d = new Date(now);
            d.setDate(d.getDate() - (6 - i));
            return { label: days[d.getDay()], date: d.toDateString(), warn: 0, crit: 0 };
          });
          weekAlerts.forEach((a: any) => {
            const ts = a.detected_at ?? a.created_at;
            if (!ts) return;
            const d = new Date(ts.endsWith("Z") ? ts : ts + "Z");
            const bucket = dayBuckets.find(b => b.date === d.toDateString());
            if (!bucket) return;
            const sev = a.anomaly?.severity ?? a.severity ?? "";
            if (sev === "HIGH" || sev === "CRITICAL") bucket.crit++;
            else bucket.warn++;
          });
          const maxVal = Math.max(1, ...dayBuckets.map(b => b.warn + b.crit));
          const barW = 40;
          return (
            <svg viewBox="0 0 500 100" style={{ width: "100%", height: 100 }}>
              {dayBuckets.map((b, i) => {
                const x = 20 + i * 68;
                const wH = Math.round((b.warn / maxVal) * 70);
                const cH = Math.round((b.crit / maxVal) * 70);
                return (
                  <g key={b.label}>
                    <rect x={x} y={90 - wH - cH} width={barW} height={wH} fill={theme.warning} opacity="0.5" rx="2" />
                    <rect x={x} y={90 - cH} width={barW} height={cH} fill={theme.critical} opacity="0.5" rx="2" />
                    <text x={x + barW / 2} y="98" textAnchor="middle" fill={theme.dim} fontSize="8">{b.label}</text>
                  </g>
                );
              })}
            </svg>
          );
        })()}
        <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 4 }}>
          <span style={{ fontSize: 10, color: theme.warning, display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, background: theme.warning, opacity: 0.5, borderRadius: 2, display: "inline-block" }} />Warnings</span>
          <span style={{ fontSize: 10, color: theme.critical, display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, background: theme.critical, opacity: 0.5, borderRadius: 2, display: "inline-block" }} />Critical</span>
        </div>
      </Card>

      {/* Incident detail cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {[
          { type: "Temp Breach", count: critical, icon: "🌡", c: theme.critical },
          { type: "Door Violation", count: assets.filter(a => a.door_open).length, icon: "🚪", c: theme.warning },
          { type: "Compressor Down", count: assets.filter(a => !a.compressor_running).length, icon: "⚙", c: theme.critical },
          { type: "SLA Breaches", count: Math.max(0, critical + Math.floor(warning * 0.3)), icon: "📋", c: theme.orange },
        ].map(ic => (
          <Card key={ic.type} style={{ padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `${ic.c}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{ic.icon}</div>
            <div>
              <div style={{ fontSize: 11, color: theme.dim }}>{ic.type}</div>
              <Mono color={ic.c} size={20}>{ic.count}</Mono>
              <div style={{ fontSize: 11, color: theme.dim }}>today</div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Sub-nav 3: Reports ───
function Reports() {
  const reports = [
    { type: "Daily Operations", desc: "Full fleet status, temperature ranges, incidents, and SLA summary", format: "PDF", icon: "📋", color: theme.accent },
    { type: "Weekly Compliance", desc: "7-day temperature compliance, door metrics, maintenance log", format: "PDF", icon: "📊", color: theme.blue },
    { type: "Monthly Analytics", desc: "Monthly trends, fleet performance, energy usage, recommendations", format: "XLSX", icon: "📈", color: theme.purple },
  ];

  const history = [
    { name: "Daily_Ops_2026-03-18.pdf", date: "Mar 18, 2026", size: "2.4 MB", status: "Ready" },
    { name: "Daily_Ops_2026-03-17.pdf", date: "Mar 17, 2026", size: "2.1 MB", status: "Ready" },
    { name: "Weekly_Compliance_W11.pdf", date: "Mar 16, 2026", size: "4.8 MB", status: "Ready" },
    { name: "Daily_Ops_2026-03-16.pdf", date: "Mar 16, 2026", size: "2.3 MB", status: "Ready" },
    { name: "Monthly_Analytics_Feb.xlsx", date: "Mar 1, 2026", size: "8.2 MB", status: "Ready" },
    { name: "Weekly_Compliance_W10.pdf", date: "Mar 9, 2026", size: "4.5 MB", status: "Ready" },
  ];

  return (
    <div>
      {/* Report generators */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        {reports.map(r => (
          <Card key={r.type} style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `${r.color}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{r.icon}</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>{r.type}</div>
                <div style={{ fontSize: 11, color: theme.dim }}>{r.format} format</div>
              </div>
            </div>
            <div style={{ fontSize: 13, color: theme.muted, marginBottom: 12, lineHeight: 1.4 }}>{r.desc}</div>
            <div style={{
              padding: "8px 14px", borderRadius: 8, textAlign: "center",
              background: r.color, color: "#fff", fontSize: 11, fontWeight: 600,
              cursor: "pointer", opacity: 0.85,
            }}>
              Generate Report
            </div>
          </Card>
        ))}
      </div>

      {/* Export history */}
      <Card style={{ overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${theme.border}` }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>Export History</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
              {["Report Name", "Generated", "Size", "Status", "Action"].map(h => (
                <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontSize: 9, fontWeight: 600, color: theme.dim, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
                <td style={{ padding: "9px 12px", fontWeight: 500, color: theme.text }}>{h.name}</td>
                <td style={{ padding: "9px 12px", color: theme.muted }}>{h.date}</td>
                <td style={{ padding: "9px 12px", color: theme.muted }}>{h.size}</td>
                <td style={{ padding: "9px 12px" }}>
                  <span style={{ fontSize: 9, background: theme.accentDim, color: theme.accent, padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>{h.status}</span>
                </td>
                <td style={{ padding: "9px 12px" }}>
                  <span style={{ fontSize: 10, color: theme.blue, cursor: "pointer" }}>Download</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ─── Main Analytics Page ───
export default function AnalyticsPage({ subNav, assets, trucks, rooms, stats }: Props) {
  switch (subNav) {
    case 0: return <TempTrends assets={assets} trucks={trucks} rooms={rooms} />;
    case 1: return <FleetEfficiency trucks={trucks} rooms={rooms} assets={assets} />;
    case 2: return <SLACompliance assets={assets} />;
    case 3: return <Reports />;
    default: return <TempTrends assets={assets} trucks={trucks} rooms={rooms} />;
  }
}
