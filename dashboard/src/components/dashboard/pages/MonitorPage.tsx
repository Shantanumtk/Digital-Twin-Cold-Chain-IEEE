"use client";

import { theme } from "@/lib/theme";
import { Asset } from "@/lib/types";
import LiveCard from "../LiveCard";

interface Props {
  subNav: number;
  assets: Asset[];
  trucks: Asset[];
  rooms: Asset[];
  onAssetClick: (asset: Asset, tab?: string) => void;
}

export default function MonitorPage({ subNav, assets, trucks, rooms, onAssetClick }: Props) {
  const list = subNav === 1 ? trucks : subNav === 2 ? rooms : subNav === 3 ? assets.filter(a => a.state === "CRITICAL") : assets;
  const labels = ["All Assets", "Trucks Only", "Rooms Only", "Critical Only"];

  return (
    <div>
      {/* Summary bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>
          {labels[subNav]} ({list.length})
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { label: "Normal", count: list.filter(a => a.state === "NORMAL").length, color: theme.accent },
            { label: "Warning", count: list.filter(a => a.state === "WARNING").length, color: theme.warning },
            { label: "Critical", count: list.filter(a => a.state === "CRITICAL").length, color: theme.critical },
          ].map(s => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: theme.muted }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: s.color }} />
              {s.count}
            </div>
          ))}
        </div>
      </div>

      {/* Card grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))", gap: 14 }}>
        {list.map(a => (
          <LiveCard key={a.asset_id} asset={a} onClick={(asset) => onAssetClick(asset, "diagram")} />
        ))}
      </div>

      {list.length === 0 && (
        <div style={{ textAlign: "center", color: theme.dim, padding: 60, fontSize: 13 }}>
          No assets found for this filter
        </div>
      )}
    </div>
  );
}
