"use client";

import { theme, stateColor } from "@/lib/theme";
import { Asset } from "@/lib/types";
import { Badge, Mono, Sparkline, Card, StatCard, MiniBar, Ring } from "../UIComponents";

interface Props {
  subNav: number;
  assets: Asset[];
  trucks: Asset[];
  rooms: Asset[];
  stats: any;
  alerts: any[];
  onAssetClick: (asset: Asset, tab?: string) => void;
}

// ─── Generate fake sparkline data from temp ───
function sparkData(asset: Asset): number[] {
  const base = asset.temperature_c || -18;
  return Array.from({ length: 12 }, (_, i) => base + Math.sin(i / 2.5 + base) * 2.5);
}

// ─── Sub-nav 0: Overview ───
function Overview({ assets, stats, alerts, onAssetClick }: Omit<Props, "subNav" | "trucks" | "rooms">) {
  const nc = assets.filter(a => a.state === "NORMAL").length;
  const wc = assets.filter(a => a.state === "WARNING").length;
  const cc = assets.filter(a => a.state === "CRITICAL").length;
  const tc = assets.filter(a => a.asset_type === "refrigerated_truck").length;
  const rc = assets.filter(a => a.asset_type === "cold_room").length;

  return (
    <div>
      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 16 }}>
        <StatCard label="Total Assets" value={assets.length || stats?.total_assets || 0} color={theme.blue} icon="📦" />
        <StatCard label="Trucks" value={tc || stats?.trucks || 0} color={theme.purple} icon="🚛" />
        <StatCard label="Cold Rooms" value={rc || stats?.cold_rooms || 0} color={theme.cyan} icon="🏭" />
        <StatCard label="Normal" value={nc || stats?.normal || 0} color={theme.accent} icon="✓" />
        <StatCard label="Warning" value={wc || stats?.warning || 0} color={theme.warning} icon="⚠" />
        <StatCard label="Critical" value={cc || stats?.critical || 0} color={theme.critical} icon="✕" />
      </div>

      {/* Table + Alerts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 12 }}>
        {/* Asset table */}
        <Card style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                {["Asset", "State", "Temp", "RH", "Door", "Compressor", "Trend", "Updated"].map(h => (
                  <th key={h} style={{ padding: "9px 10px", textAlign: "left", fontSize: 11, fontWeight: 600, color: theme.dim, textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assets.map(a => (
                <tr key={a.asset_id} onClick={() => onAssetClick(a)} style={{ borderBottom: `1px solid ${theme.borderLight}`, cursor: "pointer" }}>
                  <td style={{ padding: "9px 10px", fontWeight: 600, color: theme.text, fontSize: 14 }}>{a.asset_id}</td>
                  <td style={{ padding: "9px 10px" }}><Badge state={a.state} small /></td>
                  <td style={{ padding: "9px 10px" }}><Mono color={stateColor(a.state)} size={11}>{a.temperature_c?.toFixed(1)}°</Mono></td>
                  <td style={{ padding: "9px 10px", color: theme.muted }}>{a.humidity != null ? Math.round(a.humidity) : "—"}%</td>
                  <td style={{ padding: "9px 10px", color: a.door_open ? theme.warning : theme.accent, fontSize: 12 }}>{a.door_open ? "Open" : "Closed"}</td>
                  <td style={{ padding: "9px 10px", color: a.compressor_running ? theme.accent : theme.critical, fontSize: 12 }}>{a.compressor_running ? "On" : "Off"}</td>
                  <td style={{ padding: "9px 10px" }}><Sparkline data={sparkData(a)} color={stateColor(a.state)} width={80} height={24} /></td>
                  <td style={{ padding: "9px 10px", color: theme.dim, fontSize: 11 }}>{a.last_update || "Live"}</td>
                </tr>
              ))}
              {assets.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 30, textAlign: "center", color: theme.dim }}>No assets loaded yet...</td></tr>
              )}
            </tbody>
          </table>
        </Card>

        {/* Alerts panel */}
        <Card style={{ overflow: "hidden", alignSelf: "flex-start" }}>
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${theme.border}`, display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>Active Alerts</span>
            <span style={{ fontSize: 9, background: theme.criticalDim, color: theme.critical, padding: "2px 6px", borderRadius: 8, fontWeight: 600 }}>{alerts.length}</span>
          </div>
          {alerts.slice(0, 8).map((al, i) => (
            <div key={al.id || i} style={{ padding: "8px 12px", borderBottom: `1px solid ${theme.borderLight}`, display: "flex", gap: 8 }}>
              <div style={{
                width: 5, height: 5, borderRadius: "50%", marginTop: 5, flexShrink: 0,
                background: al.severity === "CRITICAL" ? theme.critical : al.severity === "WARNING" ? theme.warning : theme.blue,
              }} />
              <div>
                <div style={{ fontSize: 12, color: theme.text, lineHeight: 1.4 }}>{al.message}</div>
                <div style={{ fontSize: 11, color: theme.dim }}>{al.asset_id} · {al.timestamp || "—"}</div>
              </div>
            </div>
          ))}
          {alerts.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: theme.dim, fontSize: 11 }}>No active alerts</div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── Sub-nav 1: Fleet Summary ───
function FleetSummary({ trucks, onAssetClick }: { trucks: Asset[]; onAssetClick: (a: Asset) => void }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10, marginBottom: 16 }}>
        {trucks.map(t => (
          <Card key={t.asset_id} style={{ padding: 14, cursor: "pointer" }} >
            <div onClick={() => onAssetClick(t)} >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: theme.text }}>{t.asset_id}</span>
                <Badge state={t.state} small />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                <div><div style={{ fontSize: 10, color: theme.dim }}>Temp</div><Mono color={stateColor(t.state)} size={11}>{t.temperature_c?.toFixed(1)}°C</Mono></div>
                <div><div style={{ fontSize: 10, color: theme.dim }}>Speed</div><Mono color={t.speed && t.speed > 0 ? theme.blue : theme.dim} size={11}>{t.speed || 0} km/h</Mono></div>
                <div><div style={{ fontSize: 10, color: theme.dim }}>Fuel</div><Mono color={(t.fuel || 50) < 40 ? theme.warning : theme.accent} size={11}>{t.fuel || 50}%</Mono></div>
                <div><div style={{ fontSize: 10, color: theme.dim }}>Mileage</div><Mono color={theme.muted} size={11}>{((t.mileage || 10000) / 1000).toFixed(0)}k</Mono></div>
              </div>
              <MiniBar pct={t.fuel || 50} color={(t.fuel || 50) < 40 ? theme.warning : theme.accent} />
              <div style={{ fontSize: 11, color: theme.dim, marginTop: 6 }}>{t.route || "No route assigned"}</div>
            </div>
          </Card>
        ))}
        {trucks.length === 0 && <div style={{ color: theme.dim, padding: 30 }}>No trucks loaded</div>}
      </div>

      {/* Temperature trend placeholder */}
      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 10 }}>Fleet Temperature Trends (24h)</div>
        <svg viewBox="0 0 620 130" style={{ width: "100%", height: 130 }}>
          <line x1="30" y1="120" x2="610" y2="120" stroke={theme.border} strokeWidth="0.5" />
          {[-20, -15, -10, -5, 0, 5].map((v, i) => (
            <g key={v}>
              <line x1="30" y1={10 + i * 22} x2="610" y2={10 + i * 22} stroke={theme.borderLight} />
              <text x="26" y={14 + i * 22} fill={theme.dim} fontSize="8" textAnchor="end">{v}°</text>
            </g>
          ))}
          {trucks.slice(0, 4).map((t, di) => {
            const colors = [theme.accent, theme.warning, theme.critical, theme.blue];
            const data = sparkData(t);
            const pts = data.map((v, i) => {
              const x = 30 + (i / (data.length - 1)) * 580;
              const y = 10 + ((-20 - v) / (-20 - 5)) * 110;
              return `${x},${Math.max(10, Math.min(120, y))}`;
            }).join(" ");
            return <polyline key={di} points={pts} fill="none" stroke={colors[di]} strokeWidth="1.5" strokeLinejoin="round" opacity="0.8" />;
          })}
        </svg>
        <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 6 }}>
          {trucks.slice(0, 4).map((t, i) => {
            const colors = [theme.accent, theme.warning, theme.critical, theme.blue];
            return <span key={t.asset_id} style={{ fontSize: 10, color: theme.muted, display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 3, borderRadius: 1, background: colors[i], display: "inline-block" }} />{t.asset_id}</span>;
          })}
        </div>
      </Card>
    </div>
  );
}

// ─── Sub-nav 2: Room Summary ───
function RoomSummary({ rooms, onAssetClick }: { rooms: Asset[]; onAssetClick: (a: Asset) => void }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10, marginBottom: 16 }}>
        {rooms.map(r => (
          <Card key={r.asset_id} style={{ padding: 14, cursor: "pointer" }}>
            <div onClick={() => onAssetClick(r)}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: theme.text }}>{r.asset_id}</span>
                <Badge state={r.state} small />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                <div><div style={{ fontSize: 10, color: theme.dim }}>Temp</div><Mono color={stateColor(r.state)} size={11}>{r.temperature_c?.toFixed(1)}°C</Mono></div>
                <div><div style={{ fontSize: 10, color: theme.dim }}>Humidity</div><Mono color={(r.humidity || 50) > 70 ? theme.warning : theme.cyan} size={11}>{r.humidity || 50}%</Mono></div>
                <div><div style={{ fontSize: 10, color: theme.dim }}>Capacity</div><Mono color={(r.capacity || 60) > 85 ? theme.warning : theme.accent} size={11}>{r.capacity || 60}%</Mono></div>
                <div><div style={{ fontSize: 10, color: theme.dim }}>Power</div><Mono color={r.compressor_running ? theme.blue : theme.critical} size={11}>{r.power || (r.compressor_running ? "4.2" : "0")} kW</Mono></div>
              </div>
              <MiniBar pct={r.capacity || 60} color={(r.capacity || 60) > 85 ? theme.warning : theme.accent} />
              <div style={{ fontSize: 11, color: theme.dim, marginTop: 6 }}>{r.site || "No site assigned"}</div>
            </div>
          </Card>
        ))}
        {rooms.length === 0 && <div style={{ color: theme.dim, padding: 30 }}>No rooms loaded</div>}
      </div>

      {/* Capacity bar chart */}
      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 12 }}>Room Capacity Utilization</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 100 }}>
          {rooms.map((r) => {
            const cap = r.capacity || Math.floor(Math.random() * 50 + 40);
            const c = cap > 85 ? theme.warning : theme.accent;
            return (
              <div key={r.asset_id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <Mono size={9} color={c}>{cap}%</Mono>
                <div style={{ width: "100%", height: `${cap}%`, background: c, borderRadius: "3px 3px 0 0", minHeight: 4, transition: "height 0.5s" }} />
                <span style={{ fontSize: 10, color: theme.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                  {r.asset_id.replace("site", "S").replace("-room", "R")}
                </span>
              </div>
            );
          })}
          {rooms.length === 0 && <div style={{ color: theme.dim, flex: 1, textAlign: "center" }}>No data</div>}
        </div>
      </Card>
    </div>
  );
}

// ─── Sub-nav 3: System Health ───
function SystemHealth() {
  const services = [
    { name: "MQTT Broker", status: "Connected", color: theme.accent },
    { name: "Kafka Cluster", status: "3 partitions healthy", color: theme.accent },
    { name: "MongoDB", status: "Replica set OK", color: theme.accent },
    { name: "Redis Cache", status: "Connected", color: theme.accent },
  ];

  const metrics = [
    { label: "State Engine", value: "45 msg/s", color: theme.accent },
    { label: "Ingestion", value: "120 msg/s", color: theme.blue },
    { label: "Bridge Latency", value: "12ms", color: theme.accent },
    { label: "API Latency", value: "38ms", color: theme.accent },
    { label: "Dashboard FPS", value: "60", color: theme.accent },
    { label: "MCP Agent", value: "3.2s avg", color: theme.warning },
    { label: "Kafka Lag", value: "0", color: theme.accent },
    { label: "Redis Memory", value: "24 MB", color: theme.blue },
    { label: "MongoDB Ops", value: "85/s", color: theme.accent },
  ];

  return (
    <div>
      {/* Service status */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
        {services.map(sv => (
          <Card key={sv.name} style={{ padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: sv.color }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>{sv.name}</span>
            </div>
            <div style={{ fontSize: 12, color: theme.muted, marginTop: 4 }}>{sv.status}</div>
          </Card>
        ))}
      </div>

      {/* Throughput metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
        {metrics.map(m => (
          <Card key={m.label} style={{ padding: 12 }}>
            <div style={{ fontSize: 9, color: theme.dim }}>{m.label}</div>
            <Mono color={m.color} size={16}>{m.value}</Mono>
          </Card>
        ))}
      </div>

      {/* Pipeline diagram */}
      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 12 }}>Data Pipeline</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
          {[
            { name: "Sensors", icon: "📡", color: theme.blue },
            { name: "→", icon: "", color: theme.dim },
            { name: "MQTT", icon: "📨", color: theme.purple },
            { name: "→", icon: "", color: theme.dim },
            { name: "Bridge", icon: "🔗", color: theme.cyan },
            { name: "→", icon: "", color: theme.dim },
            { name: "Kafka", icon: "📊", color: theme.orange },
            { name: "→", icon: "", color: theme.dim },
            { name: "Ingestion", icon: "💾", color: theme.blue },
            { name: "→", icon: "", color: theme.dim },
            { name: "MongoDB", icon: "🗄", color: theme.accent },
            { name: "→", icon: "", color: theme.dim },
            { name: "State Engine", icon: "⚡", color: theme.warning },
            { name: "→", icon: "", color: theme.dim },
            { name: "Redis", icon: "🔴", color: theme.critical },
            { name: "→", icon: "", color: theme.dim },
            { name: "Dashboard", icon: "📱", color: theme.accent },
          ].map((step, i) =>
            step.icon ? (
              <div key={i} style={{
                background: theme.surface, borderRadius: 8, padding: "8px 12px",
                display: "flex", alignItems: "center", gap: 6,
                border: `1px solid ${theme.border}`,
              }}>
                <span style={{ fontSize: 14 }}>{step.icon}</span>
                <span style={{ fontSize: 12, color: step.color, fontWeight: 500 }}>{step.name}</span>
              </div>
            ) : (
              <span key={i} style={{ color: theme.dim, fontSize: 14 }}>→</span>
            )
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Main Dashboard Page ───
export default function DashboardPage({ subNav, assets, trucks, rooms, stats, alerts, onAssetClick }: Props) {
  switch (subNav) {
    case 0:
      return <Overview assets={assets} stats={stats} alerts={alerts} onAssetClick={onAssetClick} />;
    case 1:
      return <FleetSummary trucks={trucks} onAssetClick={onAssetClick} />;
    case 2:
      return <RoomSummary rooms={rooms} onAssetClick={onAssetClick} />;
    case 3:
      return <SystemHealth />;
    default:
      return <Overview assets={assets} stats={stats} alerts={alerts} onAssetClick={onAssetClick} />;
  }
}
