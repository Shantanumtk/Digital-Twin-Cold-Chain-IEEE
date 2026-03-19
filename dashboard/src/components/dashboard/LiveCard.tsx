"use client";

import { theme, stateColor } from "@/lib/theme";
import { Asset } from "@/lib/types";
import { Badge, Mono } from "./UIComponents";
import { useTick } from "@/hooks/useTick";
import TruckSVG from "./diagrams/TruckSVG";
import RoomSVG from "./diagrams/RoomSVG";

interface Props {
  asset: Asset;
  onClick: (asset: Asset) => void;
}

export default function LiveCard({ asset: a, onClick }: Props) {
  const tick = useTick(100);
  const isTruck = a.asset_type === "refrigerated_truck";
  const col = stateColor(a.state);

  return (
    <div
      onClick={() => onClick(a)}
      style={{
        background: theme.card,
        border: `1px solid ${a.state === "CRITICAL" ? "rgba(239,68,68,0.2)" : a.state === "WARNING" ? "rgba(245,158,11,0.12)" : theme.border}`,
        borderRadius: 14, overflow: "hidden", cursor: "pointer",
        transition: "all 0.25s", position: "relative",
      }}
    >
      {/* Critical top glow */}
      {a.state === "CRITICAL" && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, transparent, ${theme.critical}, transparent)`,
          animation: "pulse 2s ease-in-out infinite",
        }} />
      )}

      {/* Header */}
      <div style={{ padding: "12px 16px 4px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: theme.text }}>{a.asset_id}</div>
          <div style={{ fontSize: 12, color: theme.dim, marginTop: 1 }}>
            {isTruck ? (a.route || "No route") : (a.site || "No site")} · {a.cargo || a.asset_type}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: theme.dim }}>{a.last_update || "—"}</span>
          <Badge state={a.state} small />
        </div>
      </div>

      {/* Animated SVG diagram */}
      <div style={{ height: 160, padding: "0 4px" }}>
        {isTruck ? <TruckSVG asset={a} tick={tick} /> : <RoomSVG asset={a} tick={tick} />}
      </div>

      {/* Bottom stats bar */}
      <div style={{
        padding: "8px 16px 12px",
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4,
        borderTop: `1px solid ${theme.borderLight}`,
      }}>
        {[
          { l: "Temp", v: `${a.temperature_c?.toFixed(1)}°C`, c: col },
          { l: "Humidity", v: `${(a.humidity ?? a.humidity_pct ?? 50)}%`, c: ((a.humidity ?? a.humidity_pct ?? 50)) > 70 ? theme.warning : theme.cyan },
          { l: "Door", v: a.door_open ? "Open" : "Closed", c: a.door_open ? theme.warning : theme.accent },
          {
            l: isTruck ? "Speed" : "Power",
            v: isTruck ? `${(a.speed ?? a.location?.speed_kmh ?? 0)} km/h` : (a.compressor_running ? `${a.power || 4.2} kW` : "0 kW"),
            c: isTruck ? (((a.speed ?? a.location?.speed_kmh ?? 0)) > 0 ? theme.blue : theme.dim) : (a.compressor_running ? theme.accent : theme.critical),
          },
        ].map(m => (
          <div key={m.l} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, color: theme.dim, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{m.l}</div>
            <Mono color={m.c} size={14}>{m.v}</Mono>
          </div>
        ))}
      </div>
    </div>
  );
}
