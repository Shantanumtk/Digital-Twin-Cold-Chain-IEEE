"use client";

import { theme, stateColor } from "@/lib/theme";
import { Asset } from "@/lib/types";

interface Props {
  asset: Asset;
  tick: number;
}

export default function RoomSVG({ asset: a, tick }: Props) {
  const col = stateColor(a.state);
  const id = a.asset_id.replace(/[^a-zA-Z0-9]/g, "");

  return (
    <svg viewBox="0 0 420 180" style={{ width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id={`rw${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a2540" />
          <stop offset="100%" stopColor="#0e1525" />
        </linearGradient>
        <linearGradient id={`rm${id}`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={col} stopOpacity="0.05" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Room shell */}
      <rect x="20" y="20" width="380" height="140" rx="4" fill={`url(#rw${id})`} stroke={theme.border} strokeWidth="1" />
      <rect x="22" y="22" width="376" height="136" rx="3" fill={`url(#rm${id})`} />

      {/* Walls + floor */}
      <rect x="20" y="20" width="12" height="140" fill="rgba(30,41,59,0.6)" />
      <rect x="388" y="20" width="12" height="140" fill="rgba(30,41,59,0.6)" />
      <rect x="20" y="158" width="380" height="6" fill="#0c1220" />

      {/* Status LED */}
      <circle cx="36" cy="30" r="3" fill={col}>
        {a.state !== "NORMAL" && <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite" />}
      </circle>

      {/* Temp panel */}
      <g transform="translate(44, 32)">
        <rect x="0" y="0" width="70" height="54" rx="4" fill="rgba(148,163,184,0.02)" stroke={theme.border} strokeWidth="0.5" />
        <rect x="6" y="4" width="58" height="22" rx="2" fill="rgba(6,182,212,0.04)" stroke="rgba(6,182,212,0.12)" strokeWidth="0.5" />
        <text x="35" y="20" textAnchor="middle" fontSize="14" fill={col} fontFamily="'JetBrains Mono', monospace" fontWeight="700">
          {a.temperature_c?.toFixed(1)}°C
        </text>
        <text x="35" y="36" textAnchor="middle" fontSize="7" fill={theme.dim} fontFamily="monospace">
          SETPOINT {a.profile === "pharma" ? "2.0°" : "-18°"}
        </text>
        <rect x="6" y="42" width="58" height="4" rx="2" fill="rgba(148,163,184,0.06)" />
        <rect x="6" y="42" width={Math.min(58, Math.max(3, ((a.temperature_c + 25) / 40) * 58))} height="4" rx="2" fill={col} opacity="0.5" />
      </g>

      {/* Humidity panel */}
      <g transform="translate(124, 32)">
        <rect x="0" y="0" width="52" height="54" rx="4" fill="rgba(148,163,184,0.02)" stroke={theme.border} strokeWidth="0.5" />
        <text x="26" y="16" textAnchor="middle" fontSize="7" fill={theme.dim} fontFamily="monospace">HUMIDITY</text>
        <text x="26" y="38" textAnchor="middle" fontSize="18" fill={(a.humidity || 50) > 70 ? theme.warning : theme.cyan} fontFamily="'JetBrains Mono', monospace" fontWeight="600">
          {a.humidity || 50}%
        </text>
      </g>

      {/* Compressor */}
      <g transform="translate(362, 36)">
        <rect x="-20" y="-8" width="40" height="52" rx="4" fill="rgba(16,185,129,0.04)" stroke={a.compressor_running ? theme.accent : theme.critical} strokeWidth="0.5" opacity="0.6" />
        <g transform="translate(0, 14)">
          {a.compressor_running ? (
            <g style={{ animation: "spin 2s linear infinite", transformOrigin: "0px 0px" }}>
              {[0, 45, 90, 135, 180, 225, 270, 315].map((an, i) => (
                <line key={i} x1="0" y1="0" x2={Math.cos(an * Math.PI / 180) * 11} y2={Math.sin(an * Math.PI / 180) * 11} stroke={theme.accent} strokeWidth="1.5" strokeLinecap="round" />
              ))}
            </g>
          ) : (
            <g>
              {[0, 45, 90, 135, 180, 225, 270, 315].map((an, i) => (
                <line key={i} x1="0" y1="0" x2={Math.cos(an * Math.PI / 180) * 11} y2={Math.sin(an * Math.PI / 180) * 11} stroke={theme.critical} strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
              ))}
            </g>
          )}
          <circle cx="0" cy="0" r="3" fill={a.compressor_running ? theme.accent : theme.critical} />
        </g>
        <text x="0" y="38" textAnchor="middle" fontSize="7" fill={a.compressor_running ? theme.accent : theme.critical} fontFamily="monospace" fontWeight="600">
          {a.compressor_running ? "COOLING" : "OFF"}
        </text>
      </g>

      {/* Door */}
      {a.door_open ? (
        <g>
          <rect x="200" y="55" width="22" height="100" rx="2" fill={theme.warningDim} stroke={theme.warning} strokeWidth="0.8" />
          <rect x="213" y="98" width="3" height="12" rx="1" fill={theme.warning} opacity="0.5" />
          {[0, 1, 2].map(i => (
            <line key={i} x1={228 + i * 14} y1="75" x2={228 + i * 14} y2="135" stroke={theme.warning} strokeWidth="0.5" strokeDasharray="2,4" opacity={0.2 - i * 0.05}>
              <animate attributeName="opacity" values={`${0.2 - i * 0.05};0.05;${0.2 - i * 0.05}`} dur="2s" repeatCount="indefinite" />
            </line>
          ))}
          <text x="240" y="48" textAnchor="middle" fontSize="8" fill={theme.warning} fontFamily="monospace" fontWeight="600">
            DOOR OPEN
            <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite" />
          </text>
        </g>
      ) : (
        <g>
          <rect x="200" y="55" width="52" height="100" rx="3" fill="rgba(148,163,184,0.015)" stroke={theme.dim} strokeWidth="0.6" />
          <line x1="226" y1="55" x2="226" y2="155" stroke={theme.dim} strokeWidth="0.4" />
          <rect x="237" y="98" width="3" height="12" rx="1" fill={theme.dim} opacity="0.3" />
          <text x="226" y="48" textAnchor="middle" fontSize="7" fill={theme.dim} fontFamily="monospace">SEALED</text>
        </g>
      )}

      {/* Cold mist particles */}
      {a.compressor_running && (
        <g opacity={0.1 + Math.abs(Math.sin(tick * 0.15)) * 0.12}>
          {Array.from({ length: 8 }).map((_, i) => (
            <circle key={i} cx={60 + i * 38 + Math.sin(tick * 0.08 + i) * 4} cy={130 + Math.sin(tick * 0.15 + i * 0.5) * 5} r={1 + Math.sin(tick * 0.25 + i) * 0.4} fill={theme.cyan} />
          ))}
        </g>
      )}

      {/* Cargo boxes */}
      {[[50, 105, 30, 44], [270, 95, 40, 54], [150, 115, 24, 34]].map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx="2" fill="rgba(148,163,184,0.015)" stroke={theme.border} strokeWidth="0.4" strokeDasharray="3,3" />
      ))}
    </svg>
  );
}
