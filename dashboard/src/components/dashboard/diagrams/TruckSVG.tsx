"use client";

import { theme, stateColor } from "@/lib/theme";
import { Asset } from "@/lib/types";

interface Props {
  asset: Asset;
  tick: number;
}

export default function TruckSVG({ asset: a, tick }: Props) {
  const col = stateColor(a.state);
  const id = a.asset_id.replace(/[^a-zA-Z0-9]/g, "");

  return (
    <svg viewBox="0 0 420 180" style={{ width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id={`tb${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id={`tc${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity="0.1" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Trailer */}
      <rect x="30" y="42" width="230" height="95" rx="5" fill={`url(#tb${id})`} stroke={theme.border} strokeWidth="1" />
      <rect x="32" y="44" width="226" height="91" rx="4" fill={`url(#tc${id})`} />

      {/* Cab */}
      <rect x="260" y="55" width="75" height="82" rx="5" fill={`url(#tb${id})`} stroke={theme.border} strokeWidth="1" />
      <line x1="260" y1="55" x2="260" y2="137" stroke={theme.border} strokeWidth="1.5" />
      <rect x="298" y="68" width="28" height="18" rx="3" fill="#0c1220" stroke={theme.dim} strokeWidth="0.5" />
      <rect x="300" y="70" width="24" height="14" rx="2" fill="rgba(59,130,246,0.06)" />

      {/* Wheels */}
      {[[90, 144, 14], [210, 144, 14], [298, 144, 12]].map(([cx, cy, r], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r={r} fill="#0c1220" stroke={theme.dim} strokeWidth="1" />
          <circle cx={cx} cy={cy} r={r - 5} fill="#0f172a" stroke={theme.dim} strokeWidth="0.5" />
          <circle cx={cx} cy={cy} r={2.5} fill={theme.dim} />
        </g>
      ))}

      {/* Status LED */}
      <circle cx="325" cy="72" r="4" fill={col}>
        {a.state !== "NORMAL" && <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite" />}
      </circle>

      {/* Door */}
      {a.door_open ? (
        <g>
          <rect x="32" y="32" width="226" height="10" rx="2" fill={theme.warningDim} stroke={theme.warning} strokeWidth="0.5" />
          <text x="145" y="28" textAnchor="middle" fontSize="8" fill={theme.warning} fontWeight="600" fontFamily="monospace">
            DOOR OPEN
            <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite" />
          </text>
        </g>
      ) : (
        <rect x="32" y="42" width="226" height="3" rx="1" fill={theme.dim} opacity="0.15" />
      )}

      {/* Compressor */}
      <g transform="translate(55, 60)">
        <rect x="-12" y="-10" width="36" height="36" rx="5" fill="rgba(148,163,184,0.03)" stroke={a.compressor_running ? theme.accent : theme.critical} strokeWidth="0.6" opacity="0.5" />
        <g transform="translate(6, 8)">
          {a.compressor_running ? (
            <g style={{ animation: "spin 1.5s linear infinite", transformOrigin: "0px 0px" }}>
              {[0, 60, 120, 180, 240, 300].map((an, i) => (
                <line key={i} x1="0" y1="0" x2={Math.cos(an * Math.PI / 180) * 9} y2={Math.sin(an * Math.PI / 180) * 9} stroke={theme.accent} strokeWidth="2" strokeLinecap="round" />
              ))}
            </g>
          ) : (
            <g>
              {[0, 60, 120, 180, 240, 300].map((an, i) => (
                <line key={i} x1="0" y1="0" x2={Math.cos(an * Math.PI / 180) * 9} y2={Math.sin(an * Math.PI / 180) * 9} stroke={theme.critical} strokeWidth="2" strokeLinecap="round" opacity="0.3" />
              ))}
            </g>
          )}
          <circle cx="0" cy="0" r="2.5" fill={a.compressor_running ? theme.accent : theme.critical} />
        </g>
        <text x="6" y="32" textAnchor="middle" fontSize="7" fill={a.compressor_running ? theme.accent : theme.critical} fontFamily="monospace" fontWeight="600">
          {a.compressor_running ? "ON" : "OFF"}
        </text>
      </g>

      {/* Temperature display */}
      <g transform="translate(120, 60)">
        <rect x="0" y="0" width="88" height="54" rx="5" fill="rgba(6,182,212,0.04)" stroke={theme.border} strokeWidth="0.5" />
        <text x="44" y="24" textAnchor="middle" fontSize="24" fill={col} fontFamily="'JetBrains Mono', monospace" fontWeight="700">
          {a.temperature_c?.toFixed(1)}°
        </text>
        <text x="44" y="36" textAnchor="middle" fontSize="7" fill={theme.muted} fontFamily="monospace">CELSIUS</text>
        <rect x="8" y="42" width="72" height="4" rx="2" fill="rgba(148,163,184,0.06)" />
        <rect x="8" y="42" width={Math.min(72, Math.max(3, ((a.temperature_c + 25) / 35) * 72))} height="4" rx="2" fill={col} opacity="0.5" />
      </g>

      {/* Humidity */}
      <g transform="translate(222, 65)">
        <rect x="0" y="0" width="30" height="40" rx="4" fill="rgba(148,163,184,0.02)" stroke={theme.border} strokeWidth="0.4" />
        <text x="15" y="14" textAnchor="middle" fontSize="6" fill={theme.dim} fontFamily="monospace">RH%</text>
        <text x="15" y="30" textAnchor="middle" fontSize="14" fill={(a.humidity || 50) > 70 ? theme.warning : theme.cyan} fontFamily="'JetBrains Mono', monospace" fontWeight="600">
          {a.humidity || 50}
        </text>
      </g>

      {/* Speed */}
      <g transform="translate(270, 95)">
        <rect x="0" y="0" width="55" height="34" rx="4" fill="rgba(148,163,184,0.02)" stroke={theme.border} strokeWidth="0.4" />
        <text x="28" y="12" textAnchor="middle" fontSize="6" fill={theme.dim} fontFamily="monospace">SPEED</text>
        <text x="28" y="27" textAnchor="middle" fontSize="14" fill={(a.speed || 0) > 0 ? theme.blue : theme.dim} fontFamily="'JetBrains Mono', monospace" fontWeight="600">
          {a.speed || 0}
        </text>
      </g>

      {/* Exhaust */}
      {a.compressor_running && (
        <g opacity={0.15 + Math.abs(Math.sin(tick * 0.2)) * 0.2}>
          {[0, 7, 14].map((o, i) => (
            <circle key={i} cx={335 + o} cy={132 - Math.sin(tick * 0.3) * 2 * (i + 1) * 0.3} r={1.5 + i * 0.6} fill={theme.dim} opacity={0.3 - i * 0.08} />
          ))}
        </g>
      )}
    </svg>
  );
}
