"use client";

import { useState } from "react";
import { theme } from "@/lib/theme";
import { SIDEBAR_ITEMS, PageKey } from "@/lib/types";
import { signOut } from "next-auth/react";

interface SidebarProps {
  activePage: PageKey;
  onPageChange: (page: PageKey) => void;
}

export default function Sidebar({ activePage, onPageChange }: SidebarProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      style={{
        width: expanded ? 190 : 60,
        background: theme.sidebar,
        borderRight: `1px solid ${theme.border}`,
        display: "flex",
        flexDirection: "column",
        alignItems: expanded ? "stretch" : "center",
        padding: "14px 6px",
        transition: "width 0.2s ease",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px", marginBottom: 20, minHeight: 36 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: `linear-gradient(135deg, ${theme.accent}, #059669)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0,
        }}>❄</div>
        {expanded && <span style={{ fontSize: 13, fontWeight: 700, color: theme.text, whiteSpace: "nowrap" }}>ColdChain DT</span>}
      </div>

      {/* Nav Items */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        {SIDEBAR_ITEMS.map((item) => (
          <div
            key={item.key}
            onClick={() => onPageChange(item.key)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: expanded ? "9px 10px" : "9px 0",
              justifyContent: expanded ? "flex-start" : "center",
              borderRadius: 9, cursor: "pointer",
              background: activePage === item.key ? theme.accentDim : "transparent",
              color: activePage === item.key ? theme.accent : theme.dim,
              transition: "all 0.15s", position: "relative",
            }}
          >
            <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
            {expanded && <span style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>{item.label}</span>}
            {item.badge && (
              <span style={{
                position: "absolute", top: expanded ? 7 : 5, right: expanded ? 8 : 8,
                width: 7, height: 7, borderRadius: "50%", background: theme.critical,
              }} />
            )}
          </div>
        ))}
      </div>

      {/* User / Logout */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: expanded ? "9px 10px" : "9px 0",
        justifyContent: expanded ? "flex-start" : "center",
        borderTop: `1px solid ${theme.border}`,
        paddingTop: 14, marginTop: 6,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: "50%", background: theme.surface,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, flexShrink: 0, cursor: "pointer",
        }}
          onClick={() => signOut({ callbackUrl: "/login" })}
          title="Logout"
        >👤</div>
        {expanded && (
          <div style={{ cursor: "pointer" }} onClick={() => signOut({ callbackUrl: "/login" })}>
            <div style={{ fontSize: 11, fontWeight: 600, color: theme.text }}>Admin</div>
            <div style={{ fontSize: 9, color: theme.dim }}>Click to logout</div>
          </div>
        )}
      </div>
    </div>
  );
}
