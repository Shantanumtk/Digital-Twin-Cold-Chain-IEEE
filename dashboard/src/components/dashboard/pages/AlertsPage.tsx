"use client";
import { useState, useEffect } from "react";

import { theme } from "@/lib/theme";
import { Card, Badge, Mono, StatCard } from "../UIComponents";

interface Props {
  subNav: number;
  alerts: any[];
}

function ActiveAlerts({ alerts }: { alerts: any[] }) {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? alerts : alerts.filter(a => a.severity === filter.toUpperCase());

  return (
    <div>
      {/* Stat bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
        <StatCard label="Total Active" value={alerts.length} color={theme.blue} icon="🔔" />
        <StatCard label="Critical" value={alerts.filter(a => a.severity === "CRITICAL").length} color={theme.critical} icon="✕" />
        <StatCard label="Warning" value={alerts.filter(a => a.severity === "WARNING").length} color={theme.warning} icon="⚠" />
        <StatCard label="Info" value={alerts.filter(a => a.severity === "INFO").length} color={theme.accent} icon="ℹ" />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {["all", "critical", "warning", "info"].map(f => (
          <div key={f} onClick={() => setFilter(f)} style={{
            padding: "5px 12px", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 500,
            background: filter === f ? theme.accentDim : theme.surface,
            color: filter === f ? theme.accent : theme.dim,
          }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </div>
        ))}
      </div>

      {/* Alert list */}
      <Card style={{ overflow: "hidden" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: theme.dim, fontSize: 13 }}>No alerts matching this filter</div>
        ) : (
          filtered.map((al, i) => (
            <div key={al.id || i} style={{
              padding: "14px 16px", borderBottom: `1px solid ${theme.borderLight}`,
              display: "flex", gap: 12, alignItems: "flex-start",
            }}>
              <div style={{
                width: 10, height: 10, borderRadius: "50%", marginTop: 4, flexShrink: 0,
                background: al.severity === "CRITICAL" ? theme.critical : al.severity === "WARNING" ? theme.warning : theme.blue,
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: theme.text, fontWeight: 500 }}>{al.message}</div>
                <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: theme.muted }}>{al.asset_id}</span>
                  <span style={{ fontSize: 12, color: theme.dim }}>{al.timestamp || "—"}</span>
                </div>
              </div>
              <Badge state={al.severity || "INFO"} small />
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

function AlertHistory() {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(24);

  useEffect(() => {
    setLoading(true);
    fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/alerts?hours=${hours}&limit=100`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : { alerts: [] })
      .then(d => {
        const raw = Array.isArray(d) ? d : d.alerts || [];
        setHistory(raw.map((a: any) => ({
          sev: a.anomaly?.severity === "HIGH" ? "CRITICAL" : a.anomaly?.severity === "MEDIUM" ? "WARNING" : a.severity ?? "INFO",
          msg: a.anomaly?.message ?? a.message ?? a.alert_type ?? "Alert",
          asset: a.asset_id ?? "—",
          time: a.detected_at ?? a.created_at ?? null,
        })));
      })
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [hours]);

  const fmt = (iso: string) => {
    try {
      const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
      return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return iso; }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>Alert History — last {hours}h ({history.length} records)</span>
        <select value={hours} onChange={e => setHours(Number(e.target.value))}
          style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 6, padding: "4px 10px", color: theme.text, fontSize: 12 }}>
          {[6, 12, 24, 48, 72, 168].map(h => <option key={h} value={h}>Last {h}h</option>)}
        </select>
      </div>
      <Card style={{ overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: theme.dim }}>Loading...</div>
        ) : history.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: theme.dim }}>No alerts in last {hours}h</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                {["Severity", "Asset", "Message", "Triggered"].map(h => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 9, fontWeight: 600, color: theme.dim, textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
                  <td style={{ padding: "10px 12px" }}><Badge state={h.sev} small /></td>
                  <td style={{ padding: "10px 12px", color: theme.blue, fontSize: 10 }}>{h.asset}</td>
                  <td style={{ padding: "10px 12px", color: theme.text }}>{h.msg}</td>
                  <td style={{ padding: "10px 12px", color: theme.muted }}>{h.time ? fmt(h.time) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function AlertRules() {
  const rules = [
    { name: "Temperature Critical", condition: "temp > critical_threshold", action: "Notify + Auto-escalate", enabled: true, profile: "All profiles" },
    { name: "Temperature Warning", condition: "temp > warning_threshold", action: "Notify operators", enabled: true, profile: "All profiles" },
    { name: "Door Open Timeout", condition: "door_open > 5 min", action: "Notify + Log", enabled: true, profile: "All profiles" },
    { name: "Compressor Failure", condition: "compressor = OFF + temp rising", action: "Critical alert + SMS", enabled: true, profile: "All profiles" },
    { name: "Humidity Range", condition: "humidity > 70% or < 30%", action: "Warning alert", enabled: true, profile: "Pharma, Chilled" },
    { name: "Speed Anomaly", condition: "speed > 120 km/h", action: "Notify fleet manager", enabled: false, profile: "Trucks only" },
    { name: "Fuel Low", condition: "fuel < 25%", action: "Notify driver", enabled: true, profile: "Trucks only" },
    { name: "Asset Offline", condition: "no data > 60s", action: "Critical alert", enabled: true, profile: "All" },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>Alert Rules ({rules.length})</span>
        <div style={{ padding: "6px 14px", borderRadius: 8, background: theme.accent, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
          + New Rule
        </div>
      </div>
      <Card style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
              {["Rule", "Condition", "Action", "Scope", "Status"].map(h => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 9, fontWeight: 600, color: theme.dim, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${theme.borderLight}`, opacity: r.enabled ? 1 : 0.5 }}>
                <td style={{ padding: "10px 12px", fontWeight: 600, color: theme.text }}>{r.name}</td>
                <td style={{ padding: "10px 12px" }}><Mono size={10} color={theme.muted}>{r.condition}</Mono></td>
                <td style={{ padding: "10px 12px", color: theme.muted }}>{r.action}</td>
                <td style={{ padding: "10px 12px", color: theme.dim, fontSize: 10 }}>{r.profile}</td>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{
                    width: 32, height: 16, borderRadius: 8, cursor: "pointer",
                    background: r.enabled ? theme.accent : theme.dim,
                    display: "flex", alignItems: "center",
                    padding: "0 2px", justifyContent: r.enabled ? "flex-end" : "flex-start",
                  }}>
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#fff" }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Escalations() {
  const chains = [
    { name: "Tier 1 — Operator", delay: "Immediate", contacts: "On-duty operator", channel: "Dashboard + Email" },
    { name: "Tier 2 — Supervisor", delay: "After 15 min unresolved", contacts: "Shift supervisor", channel: "Email + SMS" },
    { name: "Tier 3 — Manager", delay: "After 30 min unresolved", contacts: "Operations manager", channel: "SMS + Phone" },
    { name: "Tier 4 — Emergency", delay: "After 60 min unresolved", contacts: "VP Operations", channel: "Phone call" },
  ];

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, color: theme.text, marginBottom: 12 }}>Escalation Chain</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {chains.map((c, i) => (
          <div key={c.name}>
            <Card style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: theme.muted, marginTop: 3 }}>Trigger: {c.delay}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: theme.text }}>{c.contacts}</div>
                  <div style={{ fontSize: 12, color: theme.dim }}>{c.channel}</div>
                </div>
              </div>
            </Card>
            {i < chains.length - 1 && (
              <div style={{ textAlign: "center", padding: "4px 0", color: theme.dim, fontSize: 14 }}>↓</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AlertsPage({ subNav, alerts }: Props) {
  switch (subNav) {
    case 0: return <ActiveAlerts alerts={alerts} />;
    case 1: return <AlertHistory />;
    case 2: return <AlertRules />;
    case 3: return <Escalations />;
    default: return <ActiveAlerts alerts={alerts} />;
  }
}
