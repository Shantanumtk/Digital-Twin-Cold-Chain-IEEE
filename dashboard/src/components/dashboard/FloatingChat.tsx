"use client";

import { useState } from "react";
import { theme } from "@/lib/theme";

export default function FloatingChat() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([{ role: "ai", text: "Hi! Ask me about fleet status, temperatures, or alerts." }]);
  const [input, setInput] = useState("");

  const send = async () => {
    if (!input.trim()) return;
    const userMsg = input;
    setMsgs(p => [...p, { role: "user", text: userMsg }]);
    setInput("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg, agent: "query" }),
      });
      const data = await res.json();
      setMsgs(p => [...p, { role: "ai", text: data.response || "No response received." }]);
    } catch {
      setMsgs(p => [...p, { role: "ai", text: "Connection error. Please try again." }]);
    }
  };

  if (!open) {
    return (
      <div onClick={() => setOpen(true)} style={{
        position: "fixed", bottom: 24, right: 24,
        width: 50, height: 50, borderRadius: "50%",
        background: `linear-gradient(135deg, ${theme.accent}, #059669)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", boxShadow: `0 4px 20px ${theme.accentGlow}`,
        zIndex: 999, fontSize: 20,
      }}>💬</div>
    );
  }

  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24,
      width: 370, height: 460, borderRadius: 16,
      background: theme.card, border: `1px solid ${theme.border}`,
      display: "flex", flexDirection: "column", zIndex: 999,
      overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
    }}>
      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${theme.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15 }}>🤖</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>AI Query Agent</span>
        </div>
        <div onClick={() => setOpen(false)} style={{ cursor: "pointer", color: theme.dim, fontSize: 14, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, background: theme.surface }}>✕</div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === "ai" ? "flex-start" : "flex-end",
            background: m.role === "ai" ? theme.surface : theme.accentDim,
            color: theme.text, padding: "8px 12px", borderRadius: 10,
            fontSize: 12, maxWidth: "85%", lineHeight: 1.5,
            whiteSpace: "pre-wrap",
          }}>
            {m.text}
          </div>
        ))}
      </div>

      {/* Input */}
      <div style={{ padding: 10, borderTop: `1px solid ${theme.border}`, display: "flex", gap: 6 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask about your fleet..."
          style={{
            flex: 1, background: theme.surface, border: `1px solid ${theme.border}`,
            borderRadius: 8, padding: "7px 10px", color: theme.text, fontSize: 12, outline: "none",
          }}
        />
        <button onClick={send} style={{
          background: theme.accent, border: "none", borderRadius: 8,
          padding: "7px 12px", color: "#fff", fontWeight: 600, fontSize: 12, cursor: "pointer",
        }}>Send</button>
      </div>
    </div>
  );
}
