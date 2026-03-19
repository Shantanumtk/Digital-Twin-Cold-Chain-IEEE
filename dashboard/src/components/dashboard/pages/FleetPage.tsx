"use client";

import { theme, stateColor } from "@/lib/theme";
import { Asset } from "@/lib/types";
import LiveCard from "../LiveCard";
import { Card, Badge, Mono, MiniBar } from "../UIComponents";

interface Props {
  subNav: number;
  trucks: Asset[];
  onAssetClick: (asset: Asset, tab?: string) => void;
}

function AllTrucks({ trucks, onAssetClick }: { trucks: Asset[]; onAssetClick: (a: Asset) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))", gap: 14 }}>
      {trucks.map(a => <LiveCard key={a.asset_id} asset={a} onClick={(asset) => onAssetClick(asset)} />)}
      {trucks.length === 0 && <div style={{ color: theme.dim, padding: 40 }}>No trucks loaded</div>}
    </div>
  );
}

function ActiveRoutes({ trucks }: { trucks: Asset[] }) {
  const active = trucks.filter(t => (t.speed || 0) > 0);
  const stopped = trucks.filter(t => (t.speed || 0) === 0);
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 10 }}>
        In Transit ({active.length})
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10, marginBottom: 20 }}>
        {active.map(t => (
          <Card key={t.asset_id} style={{ padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{t.asset_id}</span>
              <Badge state={t.state} small />
            </div>
            <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>{t.route || "Unknown route"}</div>
            <div style={{ display: "flex", gap: 16 }}>
              <div><span style={{ fontSize: 9, color: theme.dim }}>Speed </span><Mono color={theme.blue} size={12}>{t.speed} km/h</Mono></div>
              <div><span style={{ fontSize: 9, color: theme.dim }}>Temp </span><Mono color={stateColor(t.state)} size={12}>{t.temperature_c?.toFixed(1)}°C</Mono></div>
            </div>
          </Card>
        ))}
        {active.length === 0 && <div style={{ color: theme.dim, padding: 20 }}>No trucks in transit</div>}
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 10 }}>
        Stopped ({stopped.length})
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
        {stopped.map(t => (
          <Card key={t.asset_id} style={{ padding: 14, opacity: 0.7 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>{t.asset_id}</span>
              <Badge state={t.state} small />
            </div>
            <div style={{ fontSize: 10, color: theme.dim }}>{t.route || "Parked"} · {t.temperature_c?.toFixed(1)}°C</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Maintenance({ trucks }: { trucks: Asset[] }) {
  return (
    <div>
      <Card style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
              {["Truck", "State", "Mileage", "Fuel", "Compressor", "Next Service"].map(h => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 9, fontWeight: 600, color: theme.dim, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trucks.map(t => (
              <tr key={t.asset_id} style={{ borderBottom: `1px solid ${theme.borderLight}` }}>
                <td style={{ padding: "10px 12px", fontWeight: 600, color: theme.text }}>{t.asset_id}</td>
                <td style={{ padding: "10px 12px" }}><Badge state={t.state} small /></td>
                <td style={{ padding: "10px 12px" }}><Mono size={11}>{((t.mileage || 10000) / 1000).toFixed(0)}k km</Mono></td>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <MiniBar pct={t.fuel || 50} color={(t.fuel || 50) < 40 ? theme.warning : theme.accent} h={4} />
                    <Mono size={10} color={(t.fuel || 50) < 40 ? theme.warning : theme.text}>{t.fuel || 50}%</Mono>
                  </div>
                </td>
                <td style={{ padding: "10px 12px", color: t.compressor_running ? theme.accent : theme.critical, fontSize: 10 }}>
                  {t.compressor_running ? "Running" : "Off"}
                </td>
                <td style={{ padding: "10px 12px", color: theme.muted, fontSize: 10 }}>—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Performance({ trucks }: { trucks: Asset[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
      {trucks.map(t => {
        const efficiency = t.compressor_running ? Math.floor(Math.random() * 10 + 88) : 0;
        const runtime = t.compressor_running ? Math.floor(Math.random() * 6 + 16) : 0;
        return (
          <Card key={t.asset_id} style={{ padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{t.asset_id}</span>
              <Badge state={t.state} small />
            </div>
            {[
              ["Compressor Efficiency", `${efficiency}%`, efficiency, efficiency > 90 ? theme.accent : theme.warning],
              ["Runtime Today", `${runtime}h`, (runtime / 24) * 100, theme.blue],
              ["Fuel Level", `${t.fuel || 50}%`, t.fuel || 50, (t.fuel || 50) < 40 ? theme.warning : theme.accent],
            ].map(([label, value, pct, color]) => (
              <div key={label as string} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginBottom: 2 }}>
                  <span style={{ color: theme.dim }}>{label as string}</span>
                  <Mono size={9} color={color as string}>{value as string}</Mono>
                </div>
                <MiniBar pct={pct as number} color={color as string} h={4} />
              </div>
            ))}
          </Card>
        );
      })}
    </div>
  );
}

export default function FleetPage({ subNav, trucks, onAssetClick }: Props) {
  switch (subNav) {
    case 0: return <AllTrucks trucks={trucks} onAssetClick={onAssetClick} />;
    case 1: return <ActiveRoutes trucks={trucks} />;
    case 2: return <Maintenance trucks={trucks} />;
    case 3: return <Performance trucks={trucks} />;
    default: return <AllTrucks trucks={trucks} onAssetClick={onAssetClick} />;
  }
}
