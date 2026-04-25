"use client";

import { useState } from "react";
import { theme } from "@/lib/theme";

export default function FloatingChat() {
  const [open, setOpen]           = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [msgs, setMsgs]           = useState([{ role: "ai", text: "Hi! Ask me about fleet status, temperatures, or alerts." }]);
  const [input, setInput]         = useState("");

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

  const panelStyle: React.CSSProperties = maximized
    ? {
        position: "fixed", bottom: open && !maximized ? 492 : 24, right: 24,
        width: 700, height: "80vh",
        borderRadius: 18, background: theme.card,
        border: "1px solid " + theme.border,
        display: "flex", flexDirection: "column",
        zIndex: 1001, overflow: "hidden",
        boxShadow: "0 12px 60px rgba(0,0,0,0.7)",
        transition: "all 0.25s cubic-bezier(0.4,0,0.2,1)",
      }
    : {
        position: "fixed", bottom: 88, right: 84,
        width: 370, height: 460,
        borderRadius: 16, background: theme.card,
        border: "1px solid " + theme.border,
        display: "flex", flexDirection: "column",
        zIndex: 1001, overflow: "hidden",
        boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
        transition: "all 0.25s cubic-bezier(0.4,0,0.2,1)",
      };

  return (
    <>
      {/* Bubble toggle button */}
      <div
        onClick={() => {
          setOpen(o => !o);
          if (maximized && open) setMaximized(false);
        }}
        style={{
          position: "fixed", bottom: open && !maximized ? 492 : 24, right: 24,
          width: 50, height: 50, borderRadius: "50%",
          background: "linear-gradient(135deg, " + theme.accent + ", #059669)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", boxShadow: "0 4px 20px " + theme.accentGlow,
          zIndex: 1002, fontSize: 18, fontWeight: 700,
          userSelect: "none", color: "#fff",
          transition: "transform 0.2s",
        }}
        title={open ? "Close chat" : "Open AI Agent"}
      >
        {open ? "x" : "AI"}
      </div>

      {/* Chat panel */}
      {open && (
        <div style={panelStyle}>

          {/* Header */}
          <div style={{
            padding: "12px 16px",
            borderBottom: "1px solid " + theme.border,
            display: "flex", justifyContent: "space-between", alignItems: "center",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>
                AI Query Agent
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {/* Maximize / Restore */}
              <div
                onClick={() => setMaximized(m => !m)}
                title={maximized ? "Restore default size" : "Expand"}
                style={{
                  cursor: "pointer", color: theme.muted,
                  width: 28, height: 28,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  borderRadius: 6, background: theme.surface,
                  fontSize: 13, fontWeight: 700, userSelect: "none",
                  border: "1px solid " + theme.border,
                }}
              >
                {maximized ? "[-]" : "[+]"}
              </div>

              {/* Close */}
              <div
                onClick={() => { setOpen(false); setMaximized(false); }}
                title="Close"
                style={{
                  cursor: "pointer", color: theme.dim,
                  width: 28, height: 28,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  borderRadius: 6, background: theme.surface,
                  fontSize: 13, userSelect: "none",
                  border: "1px solid " + theme.border,
                }}
              >
                x
              </div>
            </div>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflow: "auto", padding: 12,
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            {msgs.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === "ai" ? "flex-start" : "flex-end",
                background: m.role === "ai" ? theme.surface : theme.accentDim,
                color: theme.text,
                padding: "8px 12px", borderRadius: 10,
                fontSize: maximized ? 13 : 12,
                maxWidth: "85%", lineHeight: 1.5,
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {m.text}
              </div>
            ))}
          </div>

          {/* Input */}
          <div style={{
            padding: 10, borderTop: "1px solid " + theme.border,
            display: "flex", gap: 6, flexShrink: 0,
          }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
              placeholder="Ask about your fleet..."
              style={{
                flex: 1, background: theme.surface,
                border: "1px solid " + theme.border,
                borderRadius: 8, padding: "7px 10px",
                color: theme.text, fontSize: 12, outline: "none",
              }}
            />
            <button onClick={send} style={{
              background: theme.accent, border: "none",
              borderRadius: 8, padding: "7px 14px",
              color: "#fff", fontWeight: 600, fontSize: 12, cursor: "pointer",
            }}>
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
