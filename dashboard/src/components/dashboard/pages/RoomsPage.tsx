"use client";

import { theme, stateColor } from "@/lib/theme";
import { Asset } from "@/lib/types";
import LiveCard from "../LiveCard";
import { Card, Badge, Mono, MiniBar, Ring } from "../UIComponents";

interface Props {
  subNav: number;
  rooms: Asset[];
  onAssetClick: (asset: Asset, tab?: string) => void;
}

function AllRooms({ rooms, onAssetClick }: { rooms: Asset[]; onAssetClick: (a: Asset) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))", gap: 14 }}>
      {rooms.map(a => <LiveCard key={a.asset_id} asset={a} onClick={(asset) => onAssetClick(asset)} />)}
      {rooms.length === 0 && <div style={{ color: theme.dim, padding: 40 }}>No rooms loaded</div>}
    </div>
  );
}

function SiteOverview({ rooms }: { rooms: Asset[] }) {
  const sites = new Map<string, Asset[]>();
  rooms.forEach(r => {
    const site = r.site || "Unknown Site";
    if (!sites.has(site)) sites.set(site, []);
    sites.get(site)!.push(r);
  });

  return (
    <div>
      {Array.from(sites.entries()).map(([site, siteRooms]) => (
        <div key={site} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: theme.text, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>🏭</span> {site}
            <span style={{ fontSize: 12, color: theme.dim, fontWeight: 400 }}>({siteRooms.length} rooms)</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
            {siteRooms.map(r => (
              <Card key={r.asset_id} style={{ padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>{r.asset_id}</span>
                  <Badge state={r.state} small />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  <div><span style={{ fontSize: 8, color: theme.dim }}>Temp </span><Mono size={11} color={stateColor(r.state)}>{r.temperature_c?.toFixed(1)}°C</Mono></div>
                  <div><span style={{ fontSize: 8, color: theme.dim }}>RH </span><Mono size={11} color={(r.humidity || 50) > 70 ? theme.warning : theme.cyan}>{r.humidity || 50}%</Mono></div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
      {rooms.length === 0 && <div style={{ color: theme.dim, padding: 40 }}>No rooms loaded</div>}
    </div>
  );
}

function TempMap({ rooms }: { rooms: Asset[] }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: theme.muted, marginBottom: 12 }}>Temperature heatmap across all rooms</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
        {rooms.map(r => {
          const temp = r.temperature_c || 0;
          const col = stateColor(r.state);
          const intensity = Math.min(1, Math.max(0.2, (temp + 25) / 40));
          return (
            <Card key={r.asset_id} style={{ padding: 16, textAlign: "center", background: `${col}${Math.floor(intensity * 25).toString(16).padStart(2, "0")}` }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: col, fontFamily: "'JetBrains Mono', monospace" }}>
                {temp.toFixed(1)}°
              </div>
              <div style={{ fontSize: 12, color: theme.muted, marginTop: 4 }}>{r.asset_id}</div>
              <div style={{ fontSize: 11, color: theme.dim }}>{r.site || "—"}</div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Compliance({ rooms }: { rooms: Asset[] }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
        {[
          { l: "Compliant", v: rooms.filter(r => r.state === "NORMAL").length, c: theme.accent },
          { l: "Warning", v: rooms.filter(r => r.state === "WARNING").length, c: theme.warning },
          { l: "Non-Compliant", v: rooms.filter(r => r.state === "CRITICAL").length, c: theme.critical },
          { l: "Total Rooms", v: rooms.length, c: theme.blue },
        ].map(s => (
          <Card key={s.l} style={{ padding: 14, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: theme.dim, marginBottom: 4 }}>{s.l}</div>
            <Ring pct={rooms.length > 0 ? s.v / rooms.length : 0} color={s.c} size={56} label={String(s.v)} />
          </Card>
        ))}
      </div>

      <Card style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
              {["Room", "Site", "State", "Temp", "Humidity", "Door", "Compliance"].map(h => (
                <th key={h} style={{ padding: "9px 10px", textAlign: "left", fontSize: 9, fontWeight: 600, color: theme.dim, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rooms.map(r => {
              const sla = r.state === "NORMAL" ? 98 : r.state === "WARNING" ? 82 : 45;
              return (
                <tr key={r.asset_id} style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
                  <td style={{ padding: "9px 10px", fontWeight: 600, color: theme.text }}>{r.asset_id}</td>
                  <td style={{ padding: "9px 10px", color: theme.muted, fontSize: 10 }}>{r.site || "—"}</td>
                  <td style={{ padding: "9px 10px" }}><Badge state={r.state} small /></td>
                  <td style={{ padding: "9px 10px" }}><Mono size={11} color={stateColor(r.state)}>{r.temperature_c?.toFixed(1)}°C</Mono></td>
                  <td style={{ padding: "9px 10px", color: theme.muted }}>{r.humidity || 50}%</td>
                  <td style={{ padding: "9px 10px", color: r.door_open ? theme.warning : theme.accent, fontSize: 10 }}>{r.door_open ? "Open" : "Closed"}</td>
                  <td style={{ padding: "9px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <MiniBar pct={sla} color={sla > 90 ? theme.accent : sla > 70 ? theme.warning : theme.critical} h={4} />
                      <Mono size={10} color={sla > 90 ? theme.accent : sla > 70 ? theme.warning : theme.critical}>{sla}%</Mono>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export default function RoomsPage({ subNav, rooms, onAssetClick }: Props) {
  switch (subNav) {
    case 0: return <AllRooms rooms={rooms} onAssetClick={onAssetClick} />;
    case 1: return <SiteOverview rooms={rooms} />;
    case 2: return <TempMap rooms={rooms} />;
    case 3: return <Compliance rooms={rooms} />;
    default: return <AllRooms rooms={rooms} onAssetClick={onAssetClick} />;
  }
}
