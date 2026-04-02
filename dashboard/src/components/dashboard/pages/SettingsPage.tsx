"use client";
import { useState, useEffect } from "react";

import { theme } from "@/lib/theme";
import { Card, Mono, MiniBar } from "../UIComponents";

interface Props {
  subNav: number;
}

function Toggle({ on, label }: { on: boolean; label: string }) {
  const [enabled, setEnabled] = useState(on);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}>
      <span style={{ fontSize: 14, color: theme.text }}>{label}</span>
      <div
        onClick={() => setEnabled(!enabled)}
        style={{
          width: 36, height: 18, borderRadius: 9, cursor: "pointer",
          background: enabled ? theme.accent : theme.dim,
          display: "flex", alignItems: "center",
          padding: "0 2px", justifyContent: enabled ? "flex-end" : "flex-start",
          transition: "all 0.2s",
        }}
      >
        <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "all 0.2s" }} />
      </div>
    </div>
  );
}

function General() {
  const [health, setHealth] = useState<any>(null);
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/health`, { cache: "no-store" });
        if (r.ok) setHealth(await r.json());
        else setHealth({ status: "unhealthy", redis: false, mongodb: false, kafka_consumer: false });
      } catch { setHealth({ status: "unreachable", redis: false, mongodb: false, kafka_consumer: false }); }
    };
    check();
    const id = setInterval(check, 10000);
    return () => clearInterval(id);
  }, []);

  const svcColor = (ok: boolean | undefined) => ok ? theme.accent : ok === false ? theme.critical : theme.dim;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <Card style={{ padding: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: theme.text, marginBottom: 14 }}>System Configuration</div>
        {[
          ["API Endpoint", process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"],
          ["MCP Agent", process.env.MCP_AGENT_URL || "http://localhost:8001"],
          ["Polling Interval", "5 seconds"],
          ["Dashboard Version", "2.0.0"],
          ["Build", "2026-03-19"],
        ].map(([k, v]) => (
          <div key={k as string} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${theme.borderLight}` }}>
            <span style={{ fontSize: 13, color: theme.muted }}>{k as string}</span>
            <Mono size={10} color={theme.text}>{v as string}</Mono>
          </div>
        ))}
      </Card>

      <Card style={{ padding: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: theme.text, marginBottom: 14 }}>Display Preferences</div>
        <Toggle on={true} label="Auto-refresh dashboard" />
        <Toggle on={true} label="Show animated diagrams" />
        <Toggle on={false} label="Compact card view" />
        <Toggle on={true} label="Show temperature trend lines" />
        <Toggle on={true} label="Sound on critical alerts" />
        <Toggle on={false} label="Dark mode (always on)" />
      </Card>

      <Card style={{ padding: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: theme.text, marginBottom: 14 }}>
          Data Pipeline Status
          {health && (
            <span style={{ marginLeft: 8, fontSize: 10, color: health.status === "healthy" ? theme.accent : theme.critical, background: health.status === "healthy" ? theme.accentDim : theme.criticalDim, padding: "2px 8px", borderRadius: 4 }}>
              {health.status === "healthy" ? "All systems operational" : health.status}
            </span>
          )}
        </div>
        {[
          ["MQTT Broker",   true,                         "Publishing telemetry"],
          ["Kafka Cluster", health?.kafka_consumer,       health?.kafka_consumer ? "Consumer active" : "Consumer down"],
          ["MongoDB",       health?.mongodb,              health?.mongodb ? "Connected" : "Unreachable"],
          ["Redis Cache",   health?.redis,                health?.redis ? "Connected" : "Unreachable"],
          ["State Engine",  health?.status === "healthy", health?.status === "healthy" ? "Healthy" : health?.status ?? "Checking..."],
          ["MCP Agent",     undefined,                    "External — check agent logs"],
        ].map(([k, ok, label]) => (
          <div key={k as string} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${theme.borderLight}` }}>
            <span style={{ fontSize: 13, color: theme.muted }}>{k as string}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: svcColor(ok as boolean | undefined) }} />
              <span style={{ fontSize: 10, color: svcColor(ok as boolean | undefined) }}>{label as string}</span>
            </div>
          </div>
        ))}
      </Card>

      <Card style={{ padding: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: theme.text, marginBottom: 14 }}>Danger Zone</div>
        <div style={{ fontSize: 13, color: theme.muted, marginBottom: 12, lineHeight: 1.5 }}>
          Actions here can affect system operation. Proceed with caution.
        </div>
        {[
          { label: "Reset Dashboard State", desc: "Clear local cache and reload", color: theme.warning },
          { label: "Restart State Engine", desc: "Requires 10s downtime", color: theme.warning },
          { label: "Clear All Alerts", desc: "Mark all active alerts as resolved", color: theme.critical },
        ].map(action => (
          <div key={action.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${theme.borderLight}` }}>
            <div>
              <div style={{ fontSize: 13, color: theme.text }}>{action.label}</div>
              <div style={{ fontSize: 11, color: theme.dim }}>{action.desc}</div>
            </div>
            <div style={{
              padding: "5px 10px", borderRadius: 6, fontSize: 10, fontWeight: 600,
              border: `1px solid ${action.color}`, color: action.color, cursor: "pointer",
            }}>
              Execute
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

function Profiles() {
  const [activeProfile, setActiveProfile] = useState<any>(null);
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/profile`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setActiveProfile(d); })
      .catch(() => {});
  }, []);

  const profiles = activeProfile ? [] : [
    { name: "Frozen Goods", temp_warn: -15, temp_crit: -10, hum_min: 30, hum_max: 60, door_warn: 60, door_crit: 180, assets: 5 },
    { name: "Chilled Goods", temp_warn: 4, temp_crit: 8, hum_min: 40, hum_max: 70, door_warn: 120, door_crit: 300, assets: 2 },
    { name: "Pharma", temp_warn: 2, temp_crit: 5, hum_min: 35, hum_max: 55, door_warn: 30, door_crit: 90, assets: 2 },
    { name: "Ambient Storage", temp_warn: 25, temp_crit: 30, hum_min: 20, hum_max: 80, door_warn: 300, door_crit: 600, assets: 1 },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <span style={{ fontSize: 16, fontWeight: 600, color: theme.text }}>Threshold Profiles</span>
          {activeProfile && (
            <span style={{ marginLeft: 10, fontSize: 11, color: theme.accent, background: theme.accentDim, padding: "2px 8px", borderRadius: 4 }}>
              Active: {activeProfile.name} · Fleet: {activeProfile.fleet?.trucks ?? "?"} trucks, {activeProfile.fleet?.cold_rooms ?? "?"} rooms
            </span>
          )}
        </div>
        <div style={{ padding: "6px 14px", borderRadius: 8, background: theme.accent, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
          + New Profile
        </div>
      </div>
      {activeProfile && (
        <Card style={{ padding: 14, marginBottom: 14, borderLeft: `3px solid ${theme.accent}`, borderRadius: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.accent, marginBottom: 6 }}>Active: {activeProfile.name}</div>
          <div style={{ fontSize: 10, color: theme.dim }}>
            Fleet: {activeProfile.fleet?.trucks ?? "?"} trucks · {activeProfile.fleet?.cold_rooms ?? "?"} cold rooms
          </div>
          <div style={{ fontSize: 10, color: theme.dim, marginTop: 4 }}>
            Thresholds: {JSON.stringify(activeProfile.asset_defaults ?? {})}
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
        {profiles.map(p => (
          <Card key={p.name} style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: theme.text }}>{p.name}</div>
              <span style={{ fontSize: 9, background: theme.surface, color: theme.muted, padding: "2px 8px", borderRadius: 4 }}>{p.assets} assets</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                ["Temp Warning", `${p.temp_warn}°C`],
                ["Temp Critical", `${p.temp_crit}°C`],
                ["Humidity Min", `${p.hum_min}%`],
                ["Humidity Max", `${p.hum_max}%`],
                ["Door Warn", `${p.door_warn}s`],
                ["Door Critical", `${p.door_crit}s`],
              ].map(([l, v]) => (
                <div key={l} style={{ background: theme.surface, borderRadius: 6, padding: "6px 10px" }}>
                  <div style={{ fontSize: 8, color: theme.dim }}>{l}</div>
                  <Mono size={12}>{v}</Mono>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <div style={{ flex: 1, padding: "5px 0", textAlign: "center", borderRadius: 6, border: `1px solid ${theme.border}`, fontSize: 10, color: theme.muted, cursor: "pointer" }}>Edit</div>
              <div style={{ flex: 1, padding: "5px 0", textAlign: "center", borderRadius: 6, border: `1px solid ${theme.border}`, fontSize: 10, color: theme.critical, cursor: "pointer" }}>Delete</div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Notifications() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <Card style={{ padding: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: theme.text, marginBottom: 14 }}>Notification Channels</div>
        <Toggle on={true} label="Dashboard notifications" />
        <Toggle on={true} label="Email alerts" />
        <Toggle on={false} label="SMS alerts" />
        <Toggle on={false} label="Slack integration" />
        <Toggle on={false} label="PagerDuty integration" />
        <Toggle on={true} label="SNS notifications" />
      </Card>

      <Card style={{ padding: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: theme.text, marginBottom: 14 }}>Email Recipients</div>
        {[
          { email: "admin@coldchain.local", role: "Admin", enabled: true },
          { email: "ops@coldchain.local", role: "Operator", enabled: true },
          { email: "manager@coldchain.local", role: "Manager", enabled: false },
        ].map(r => (
          <div key={r.email} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${theme.borderLight}` }}>
            <div>
              <div style={{ fontSize: 14, color: theme.text }}>{r.email}</div>
              <div style={{ fontSize: 11, color: theme.dim }}>{r.role}</div>
            </div>
            <span style={{ fontSize: 9, color: r.enabled ? theme.accent : theme.dim, background: r.enabled ? theme.accentDim : theme.surface, padding: "2px 6px", borderRadius: 4 }}>
              {r.enabled ? "Active" : "Disabled"}
            </span>
          </div>
        ))}
        <div style={{ marginTop: 10, padding: "6px 14px", borderRadius: 8, border: `1px dashed ${theme.border}`, textAlign: "center", fontSize: 11, color: theme.dim, cursor: "pointer" }}>
          + Add Recipient
        </div>
      </Card>

      <Card style={{ padding: 18, gridColumn: "1 / -1" }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: theme.text, marginBottom: 14 }}>Alert Severity Routing</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {[
            { sev: "Critical", channels: "Dashboard + Email + SMS", color: theme.critical },
            { sev: "Warning", channels: "Dashboard + Email", color: theme.warning },
            { sev: "Info", channels: "Dashboard only", color: theme.blue },
          ].map(s => (
            <div key={s.sev} style={{ background: theme.surface, borderRadius: 8, padding: "12px 14px", borderLeft: `3px solid ${s.color}` }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: s.color }}>{s.sev}</div>
              <div style={{ fontSize: 10, color: theme.muted, marginTop: 3 }}>{s.channels}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Users() {
  const users = [
    { name: "admin", email: "admin@coldchain.local", role: "Admin", lastLogin: "Today 14:30", status: "Active" },
    { name: "operator1", email: "ops1@coldchain.local", role: "Operator", lastLogin: "Today 09:15", status: "Active" },
    { name: "viewer", email: "viewer@coldchain.local", role: "Viewer", lastLogin: "Mar 17, 2026", status: "Active" },
    { name: "manager", email: "mgr@coldchain.local", role: "Manager", lastLogin: "Mar 15, 2026", status: "Inactive" },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: theme.text }}>User Management</span>
        <div style={{ padding: "6px 14px", borderRadius: 8, background: theme.accent, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
          + Add User
        </div>
      </div>

      <Card style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
              {["Username", "Email", "Role", "Last Login", "Status", "Actions"].map(h => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 9, fontWeight: 600, color: theme.dim, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.name} style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
                <td style={{ padding: "10px 12px", fontWeight: 600, color: theme.text }}>{u.name}</td>
                <td style={{ padding: "10px 12px", color: theme.muted }}>{u.email}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{
                    fontSize: 9, padding: "2px 6px", borderRadius: 4, fontWeight: 600,
                    background: u.role === "Admin" ? theme.purpleDim : u.role === "Manager" ? theme.blueDim : theme.accentDim,
                    color: u.role === "Admin" ? theme.purple : u.role === "Manager" ? theme.blue : theme.accent,
                  }}>{u.role}</span>
                </td>
                <td style={{ padding: "10px 12px", color: theme.muted, fontSize: 10 }}>{u.lastLogin}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{
                    fontSize: 9, padding: "2px 6px", borderRadius: 4,
                    background: u.status === "Active" ? theme.accentDim : "rgba(148,163,184,0.06)",
                    color: u.status === "Active" ? theme.accent : theme.dim,
                  }}>{u.status}</span>
                </td>
                <td style={{ padding: "10px 12px", display: "flex", gap: 8 }}>
                  <span style={{ fontSize: 10, color: theme.blue, cursor: "pointer" }}>Edit</span>
                  <span style={{ fontSize: 10, color: theme.critical, cursor: "pointer" }}>Delete</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* RBAC info */}
      <Card style={{ padding: 16, marginTop: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 10 }}>Role Permissions</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {[
            { role: "Admin", perms: "Full access, user management, system config", color: theme.purple },
            { role: "Manager", perms: "View all, manage profiles, export reports", color: theme.blue },
            { role: "Operator", perms: "View dashboard, acknowledge alerts, AI query", color: theme.accent },
            { role: "Viewer", perms: "Read-only dashboard access", color: theme.dim },
          ].map(r => (
            <div key={r.role} style={{ background: theme.surface, borderRadius: 8, padding: "10px 12px", borderTop: `2px solid ${r.color}` }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: r.color }}>{r.role}</div>
              <div style={{ fontSize: 9, color: theme.muted, marginTop: 3, lineHeight: 1.4 }}>{r.perms}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export default function SettingsPage({ subNav }: Props) {
  switch (subNav) {
    case 0: return <General />;
    case 1: return <Profiles />;
    case 2: return <Notifications />;
    case 3: return <Users />;
    default: return <General />;
  }
}
