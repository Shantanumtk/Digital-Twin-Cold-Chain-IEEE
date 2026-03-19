"use client";

import { theme } from "@/lib/theme";
import { SUB_NAV_MAP, PageKey } from "@/lib/types";

interface TopNavProps {
  page: PageKey;
  subNav: number;
  onSubNavChange: (index: number) => void;
  profileName?: string;
}

export default function TopNav({ page, subNav, onSubNavChange, profileName = "demo" }: TopNavProps) {
  const items = SUB_NAV_MAP[page] || [];
  const pageLabel = page === "monitor" ? "Live Monitor" : page.charAt(0).toUpperCase() + page.slice(1);

  return (
    <div style={{
      height: 48, borderBottom: `1px solid ${theme.border}`,
      display: "flex", alignItems: "center", padding: "0 20px", gap: 3, flexShrink: 0,
    }}>
      <span style={{ fontSize: 18, fontWeight: 700, color: theme.text, marginRight: 16 }}>{pageLabel}</span>

      {items.map((item, i) => (
        <div
          key={item}
          onClick={() => onSubNavChange(i)}
          style={{
            padding: "5px 12px", borderRadius: 7, cursor: "pointer",
            fontSize: 13, fontWeight: 500,
            background: subNav === i ? theme.accentDim : "transparent",
            color: subNav === i ? theme.accent : theme.dim,
            transition: "all 0.15s",
          }}
        >
          {item}
        </div>
      ))}

      {/* Right side status */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: theme.accent, boxShadow: `0 0 6px ${theme.accentGlow}` }} />
        <span style={{ fontSize: 12, color: theme.accent, fontWeight: 500 }}>Online</span>
        <div style={{ width: 1, height: 18, background: theme.border, margin: "0 4px" }} />
        <span style={{ fontSize: 13, color: theme.dim }}>Profile: {profileName}</span>
      </div>
    </div>
  );
}
