"use client";

import { useState } from "react";
import { theme, stateColor } from "@/lib/theme";
import { Asset } from "@/lib/types";
import { Card, Badge, Mono } from "../UIComponents";

interface Props {
  assets: Asset[];
  trucks: Asset[];
}

export default function MapPage({ assets, trucks }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  // Simulated positions
  const positions: Record<string, { x: number; y: number; label: string }> = {};
  trucks.forEach((t, i) => {
    const angle = (i / Math.max(1, trucks.length)) * Math.PI * 2 + 0.5;
    positions[t.asset_id] = {
      x: 300 + Math.cos(angle) * (80 + i * 30),
      y: 200 + Math.sin(angle) * (60 + i * 25),
      label: t.route || "Unknown",
    };
  });

  const rooms = assets.filter(a => a.asset_type === "cold_room");
  const sites = new Map<string, Asset[]>();
  rooms.forEach(r => {
    const s = r.site || "Unknown";
    if (!sites.has(s)) sites.set(s, []);
    sites.get(s)!.push(r);
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 14, height: "calc(100vh - 140px)" }}>
      {/* Map area */}
      <Card style={{ padding: 0, overflow: "hidden", position: "relative" }}>
        {/* SVG Map */}
        <svg viewBox="0 0 600 420" style={{ width: "100%", height: "100%", background: "linear-gradient(180deg, #070d1a 0%, #0c1424 100%)" }}>
          {/* Grid */}
          {Array.from({ length: 13 }).map((_, i) => (
            <line key={`h${i}`} x1="0" y1={i * 35} x2="600" y2={i * 35} stroke={theme.borderLight} strokeWidth="0.5" />
          ))}
          {Array.from({ length: 18 }).map((_, i) => (
            <line key={`v${i}`} x1={i * 35} y1="0" x2={i * 35} y2="420" stroke={theme.borderLight} strokeWidth="0.5" />
          ))}

          {/* Warehouse markers */}
          {[
            { x: 120, y: 320, name: "Warehouse Alpha" },
            { x: 420, y: 100, name: "Warehouse Beta" },
            { x: 480, y: 340, name: "Warehouse Gamma" },
          ].map((wh, i) => (
            <g key={i}>
              <rect x={wh.x - 18} y={wh.y - 14} width="36" height="28" rx="4" fill="rgba(139,92,246,0.08)" stroke={theme.purple} strokeWidth="0.8" />
              <text x={wh.x} y={wh.y + 3} textAnchor="middle" fontSize="12" fill={theme.purple}>🏭</text>
              <text x={wh.x} y={wh.y + 22} textAnchor="middle" fontSize="7" fill={theme.muted}>{wh.name}</text>
            </g>
          ))}

          {/* Radar rings around center */}
          {[60, 120, 180].map((r, i) => (
            <circle key={i} cx="300" cy="200" r={r} fill="none" stroke={theme.border} strokeWidth="0.4" strokeDasharray="3,6" />
          ))}
          <text x="300" y="200" textAnchor="middle" fontSize="8" fill={theme.dim} dominantBaseline="central">HQ</text>

          {/* Truck markers */}
          {trucks.map((t, i) => {
            const pos = positions[t.asset_id];
            if (!pos) return null;
            const col = stateColor(t.state);
            const isHovered = hovered === t.asset_id;
            return (
              <g key={t.asset_id}
                onMouseEnter={() => setHovered(t.asset_id)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer" }}
              >
                {/* Pulse ring */}
                <circle cx={pos.x} cy={pos.y} r={isHovered ? 22 : 16} fill="none" stroke={col} strokeWidth="0.8" opacity={0.3}>
                  {t.state !== "NORMAL" && <animate attributeName="r" values="16;24;16" dur="2s" repeatCount="indefinite" />}
                </circle>
                {/* Marker */}
                <circle cx={pos.x} cy={pos.y} r={isHovered ? 10 : 8} fill={`${col}30`} stroke={col} strokeWidth="1.5" />
                <text x={pos.x} y={pos.y + 1} textAnchor="middle" dominantBaseline="central" fontSize="10" fill={col}>🚛</text>
                {/* Label */}
                <text x={pos.x} y={pos.y + 20} textAnchor="middle" fontSize="8" fill={theme.text} fontWeight="600">{t.asset_id}</text>
                <text x={pos.x} y={pos.y + 29} textAnchor="middle" fontSize="7" fill={theme.muted}>{t.temperature_c?.toFixed(1)}°C</text>
                {/* Speed indicator */}
                {(t.speed || 0) > 0 && (
                  <g>
                    <line x1={pos.x + 12} y1={pos.y} x2={pos.x + 20 + (t.speed || 0) * 0.3} y2={pos.y - 3} stroke={col} strokeWidth="1" strokeLinecap="round" opacity="0.4" />
                    <text x={pos.x + 22} y={pos.y - 6} fontSize="7" fill={theme.blue}>{t.speed} km/h</text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Route lines between trucks */}
          {trucks.length >= 2 && trucks.slice(0, -1).map((t, i) => {
            const p1 = positions[t.asset_id];
            const p2 = positions[trucks[i + 1].asset_id];
            if (!p1 || !p2) return null;
            return <line key={`r${i}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={theme.border} strokeWidth="0.5" strokeDasharray="4,6" />;
          })}
        </svg>

        {/* Map overlay label */}
        <div style={{ position: "absolute", top: 10, left: 14, background: "rgba(10,15,26,0.8)", padding: "6px 10px", borderRadius: 6, border: `1px solid ${theme.border}` }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: theme.text }}>Fleet Radar</span>
          <span style={{ fontSize: 9, color: theme.dim, marginLeft: 8 }}>{trucks.length} active trucks</span>
        </div>
      </Card>

      {/* Right panel */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, overflow: "auto" }}>
        <Card style={{ padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Fleet Status</div>
          {trucks.map(t => (
            <div key={t.asset_id}
              onMouseEnter={() => setHovered(t.asset_id)}
              onMouseLeave={() => setHovered(null)}
              style={{
                padding: "8px 0", borderBottom: `1px solid ${theme.borderLight}`,
                opacity: hovered && hovered !== t.asset_id ? 0.4 : 1,
                transition: "opacity 0.2s", cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: theme.text }}>{t.asset_id}</span>
                <Badge state={t.state} small />
              </div>
              <div style={{ fontSize: 9, color: theme.dim, marginTop: 2 }}>{t.route || "Parked"}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                <Mono size={10} color={stateColor(t.state)}>{t.temperature_c?.toFixed(1)}°C</Mono>
                <Mono size={10} color={(t.speed || 0) > 0 ? theme.blue : theme.dim}>{t.speed || 0} km/h</Mono>
              </div>
            </div>
          ))}
        </Card>

        {/* Warehouses */}
        <Card style={{ padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Warehouses</div>
          {Array.from(sites.entries()).map(([site, sRooms]) => (
            <div key={site} style={{ padding: "6px 0", borderBottom: `1px solid ${theme.borderLight}` }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: theme.text }}>{site}</div>
              <div style={{ fontSize: 9, color: theme.muted }}>{sRooms.length} rooms · {sRooms.filter(r => r.state === "NORMAL").length} OK</div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
