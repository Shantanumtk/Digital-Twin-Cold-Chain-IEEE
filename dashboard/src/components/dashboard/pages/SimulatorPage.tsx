"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { theme, stateColor } from "@/lib/theme";
import { Asset } from "@/lib/types";
import { Badge, Mono, Card } from "../UIComponents";
import { useTick } from "@/hooks/useTick";
import TruckSVG from "../diagrams/TruckSVG";
import RoomSVG from "../diagrams/RoomSVG";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface Scenario {
  id: string;
  label: string;
  icon: string;
  color: string;
  desc: string;
  prompt: string;
}

interface Message { role: "user" | "ai"; text: string; }

const SCENARIOS: Scenario[] = [
  {
    id: "compressor_fail",
    label: "Compressor failure",
    icon: "⚙",
    color: theme.critical,
    desc: "Fails compressor on truck01 for 5 min",
    prompt: "Simulate a compressor failure on truck01 for 5 minutes",
  },
  {
    id: "door_sweep",
    label: "Door sweep",
    icon: "🚪",
    color: theme.warning,
    desc: "Opens all truck doors for 2 min",
    prompt: "Open the door on truck01, truck02, and truck03 for 2 minutes each",
  },
  {
    id: "power_outage",
    label: "Site1 power outage",
    icon: "⚡",
    color: theme.critical,
    desc: "Power outage at site1 for 10 min",
    prompt: "Trigger a power outage at site1 for 10 minutes",
  },
  {
    id: "fleet_scale",
    label: "Stress test fleet",
    icon: "📈",
    color: theme.blue,
    desc: "Scales fleet to 20 trucks, 10 rooms",
    prompt: "Scale the fleet to 20 trucks and 10 cold rooms",
  },
  {
    id: "status_check",
    label: "Fleet status check",
    icon: "📊",
    color: theme.accent,
    desc: "Gets current simulator status",
    prompt: "What is the current simulator status and configuration?",
  },
];

const LOG_COLORS: Record<string, string> = {
  info:    theme.accent,
  warning: theme.warning,
  error:   theme.critical,
  system:  theme.blue,
};

interface LogEntry { time: string; type: "info" | "warning" | "error" | "system"; msg: string; }

export default function SimulatorPage({ subNav }: { subNav: number }) {
  const [msgs, setMsgs]         = useState<Message[]>(() => {
    try {
      const saved = sessionStorage.getItem("sim_msgs");
      return saved ? JSON.parse(saved) : [{ role: "ai", text: "Simulator ready. Type a command or pick a scenario to begin." }];
    } catch { return [{ role: "ai", text: "Simulator ready. Type a command or pick a scenario to begin." }]; }
  });
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [assets, setAssets]     = useState<Asset[]>([]);
  const [logs, setLogs]         = useState<LogEntry[]>(() => {
    try {
      const saved = sessionStorage.getItem("sim_logs");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const tick                    = useTick(100);
  const bottomRef               = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { sessionStorage.setItem("sim_msgs", JSON.stringify(msgs.slice(-50))); } catch {}
  }, [msgs]);

  useEffect(() => {
    try { sessionStorage.setItem("sim_logs", JSON.stringify(logs.slice(-100))); } catch {}
  }, [logs]);
  const logBottomRef            = useRef<HTMLDivElement>(null);

  const addLog = useCallback((type: LogEntry["type"], msg: string) => {
    const time = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    setLogs(prev => [...prev.slice(-199), { time, type, msg }]);
  }, []);

  // Poll assets every 3s
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`${API_URL}/assets`, { cache: "no-store" });
        if (!r.ok) return;
        const raw = await r.json();
        const list = Array.isArray(raw) ? raw : raw.assets || [];
        setAssets(list.map((a: any) => ({
          ...a,
          humidity: a.humidity ?? a.humidity_pct ?? null,
          speed: a.speed ?? a.location?.speed_kmh ?? 0,
          last_update: a.last_update ?? null,
        })));
      } catch {}
    };
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, loading]);
  useEffect(() => { logBottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    setMsgs(p => [...p, { role: "user", text }]);
    setInput("");
    setLoading(true);
    addLog("system", `Command: ${text}`);

    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, agent: "simulate" }),
      });
      const d = await r.json();
      const response = d.response || "No response";
      setMsgs(p => [...p, { role: "ai", text: response }]);

      // Parse response for log entries
      if (response.toLowerCase().includes("fail") || response.toLowerCase().includes("error")) {
        addLog("error", "Simulator reported an error — check agent response");
      } else if (response.toLowerCase().includes("door") || response.toLowerCase().includes("compressor") || response.toLowerCase().includes("outage")) {
        addLog("warning", "Active fault scenario running — monitor asset states");
      } else {
        addLog("info", "Command executed successfully");
      }
    } catch {
      setMsgs(p => [...p, { role: "ai", text: "Failed to reach simulator agent." }]);
      addLog("error", "Agent unreachable — check MCP_AGENT_URL");
    } finally {
      setLoading(false);
      setActiveScenario(null);
    }
  };

  const runScenario = (s: Scenario) => {
    setActiveScenario(s.id);
    addLog("system", `Scenario triggered: ${s.label}`);
    send(s.prompt);
  };

  const trucks = assets.filter(a => a.asset_type === "refrigerated_truck");
  const rooms  = assets.filter(a => a.asset_type === "cold_room");
  const critical = assets.filter(a => a.state === "CRITICAL").length;
  const warning  = assets.filter(a => a.state === "WARNING").length;

  // Sub-nav routing
  if (subNav === 1) return <ScenarioLibrary onRun={runScenario} activeScenario={activeScenario} />;
  if (subNav === 2) return <FleetStatus assets={assets} trucks={trucks} rooms={rooms} tick={tick} />;
  if (subNav === 3) return <LogsView logs={logs} />;

  // Default: Command Center (subNav === 0)
  return (
    <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 14, height: "calc(100vh - 110px)" }}>

      {/* ── Left: Chat Panel ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

        {/* Stats bar */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {[
            { label: "Assets", value: assets.length, color: theme.blue },
            { label: "Critical", value: critical, color: critical > 0 ? theme.critical : theme.accent },
            { label: "Warning",  value: warning,  color: warning > 0 ? theme.warning : theme.accent },
          ].map(s => (
            <div key={s.label} style={{ background: theme.surface, borderRadius: 8, padding: "8px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: theme.dim, textTransform: "uppercase" }}>{s.label}</div>
              <Mono color={s.color} size={20}>{s.value}</Mono>
            </div>
          ))}
        </div>

        {/* Scenario quick-launch */}
        <Card style={{ padding: 12 }}>
          <div style={{ fontSize: 11, color: theme.muted, marginBottom: 8, fontWeight: 600, textTransform: "uppercase" }}>Quick scenarios</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {SCENARIOS.map(s => (
              <button
                key={s.id}
                onClick={() => runScenario(s)}
                disabled={loading}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: activeScenario === s.id ? `${s.color}22` : theme.surface,
                  border: `1px solid ${activeScenario === s.id ? s.color : theme.border}`,
                  borderRadius: 8, padding: "7px 10px", cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading && activeScenario !== s.id ? 0.5 : 1, textAlign: "left",
                  transition: "all 0.15s",
                }}
              >
                <span style={{ fontSize: 16 }}>{s.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: s.color }}>{s.label}</div>
                  <div style={{ fontSize: 10, color: theme.dim }}>{s.desc}</div>
                </div>
                {activeScenario === s.id && loading && (
                  <div style={{ width: 10, height: 10, borderRadius: "50%", border: `2px solid ${s.color}`, borderTopColor: "transparent", animation: "spin 1s linear infinite" }} />
                )}
              </button>
            ))}
          </div>
        </Card>

        {/* Chat messages */}
        <Card style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: 0 }}>
          <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {msgs.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "88%", padding: "8px 12px", borderRadius: 10, fontSize: 12, lineHeight: 1.5,
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                  background: m.role === "user" ? theme.accentDim : theme.surface,
                  color: m.role === "user" ? theme.accent : theme.text,
                  border: `1px solid ${m.role === "user" ? theme.accent + "30" : theme.border}`,
                }}>
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ alignSelf: "flex-start", background: theme.surface, border: `1px solid ${theme.border}`, padding: "8px 12px", borderRadius: 10 }}>
                <span style={{ fontSize: 11, color: theme.muted }}>Agent processing...</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: "8px 10px", borderTop: `1px solid ${theme.border}`, display: "flex", gap: 6 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send(input)}
              placeholder="e.g. Open truck03 door for 90 seconds..."
              disabled={loading}
              style={{
                flex: 1, background: theme.surface, border: `1px solid ${theme.border}`,
                borderRadius: 8, padding: "6px 10px", color: theme.text, fontSize: 12, outline: "none",
              }}
            />
            <button
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              style={{
                background: theme.accent, border: "none", borderRadius: 8,
                padding: "6px 12px", color: "#fff", fontWeight: 600, fontSize: 12,
                cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.5 : 1,
              }}
            >↑</button>
          </div>
        </Card>
      </div>

      {/* ── Right: Live Asset Grid ── */}
      <div style={{ overflow: "auto" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 10 }}>
          Live fleet — updates every 3s
          <span style={{ fontSize: 11, fontWeight: 400, color: theme.dim, marginLeft: 8 }}>
            {assets.length} assets · watch animations react to your commands
          </span>
        </div>

        {assets.length === 0 ? (
          <div style={{ color: theme.dim, padding: 40, textAlign: "center", fontSize: 13 }}>
            No assets loaded — state engine may be offline
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 10 }}>
            {assets.map(a => (
              <AssetSimCard
                key={a.asset_id}
                asset={a}
                tick={tick}
                selected={selectedAssetId === a.asset_id}
                onSelect={() => setSelectedAssetId(prev => prev === a.asset_id ? null : a.asset_id)}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
      `}</style>
    </div>
  );
}

/* ── Asset card with animated diagram ── */
function AssetSimCard({ asset: a, tick, selected, onSelect }: { asset: Asset; tick: number; selected: boolean; onSelect: () => void }) {
  const col = stateColor(a.state);
  const isTruck = a.asset_type === "refrigerated_truck";

  return (
    <div
      onClick={onSelect}
      style={{
        background: theme.card,
        border: selected
          ? `2px solid ${stateColor(a.state)}`
          : `1px solid ${a.state === "CRITICAL" ? "rgba(239,68,68,0.25)" : a.state === "WARNING" ? "rgba(245,158,11,0.15)" : theme.border}`,
        borderRadius: 12, overflow: "hidden", position: "relative",
        cursor: "pointer",
        boxShadow: selected ? `0 0 0 3px ${stateColor(a.state)}22` : "none",
        transition: "box-shadow 0.15s, border 0.15s",
      }}
    >
      {a.state === "CRITICAL" && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, transparent, ${theme.critical}, transparent)`,
          animation: "pulse 1.5s ease-in-out infinite",
        }} />
      )}

      <div style={{ padding: "10px 14px 4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>{a.asset_id}</div>
        <Badge state={a.state} small />
      </div>

      <div style={{ height: 130, padding: "0 4px" }}>
        {isTruck ? <TruckSVG asset={a} tick={tick} /> : <RoomSVG asset={a} tick={tick} />}
      </div>

      <div style={{
        padding: "6px 14px 10px",
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4,
        borderTop: `1px solid ${theme.borderLight}`,
      }}>
        {[
          { l: "Temp", v: `${a.temperature_c?.toFixed(1)}°`, c: col },
          { l: "RH",   v: `${a.humidity ?? "—"}%`, c: theme.cyan },
          { l: "Door", v: a.door_open ? "Open" : "Closed", c: a.door_open ? theme.warning : theme.accent },
          { l: isTruck ? "Speed" : "Comp", v: isTruck ? `${a.speed ?? 0}km/h` : (a.compressor_running ? "On" : "Off"), c: isTruck ? theme.blue : (a.compressor_running ? theme.accent : theme.critical) },
        ].map(m => (
          <div key={m.l} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, color: theme.dim, textTransform: "uppercase" }}>{m.l}</div>
            <Mono color={m.c} size={11}>{m.v}</Mono>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Sub-nav 1: Scenario Library ── */
function ScenarioLibrary({ onRun, activeScenario }: { onRun: (s: Scenario) => void; activeScenario: string | null }) {
  const extended: Scenario[] = [
    ...SCENARIOS,
    { id: "pharma_breach", label: "Pharma temp breach", icon: "💊", color: "#8b5cf6", desc: "Fails pharma truck compressor for 8 min", prompt: "Simulate a compressor failure on truck04 for 8 minutes to create a pharma temperature breach" },
    { id: "cascade", label: "Cascade failure", icon: "🔥", color: theme.critical, desc: "Multiple simultaneous failures", prompt: "Simulate a compressor failure on truck02, open the door on truck03, and trigger a power outage at site2, all for 3 minutes" },
    { id: "restore_all", label: "Restore all", icon: "✅", color: theme.accent, desc: "Restores compressors + closes doors", prompt: "Restore the compressor on all trucks and close all open doors" },
    { id: "demo_mode", label: "Demo mode", icon: "🎬", color: theme.purple, desc: "Switches to 2-truck demo profile", prompt: "Switch to the demo profile with 2 trucks and 2 cold rooms" },
  ];

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 12 }}>
        Scenario Library — click any scenario to execute immediately
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
        {extended.map(s => (
          <div
            key={s.id}
            onClick={() => onRun(s)}
            style={{
              background: theme.card, border: `1px solid ${activeScenario === s.id ? s.color : theme.border}`,
              borderRadius: 12, padding: 16, cursor: "pointer", transition: "all 0.15s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8, fontSize: 18,
                background: `${s.color}18`, display: "flex", alignItems: "center", justifyContent: "center",
              }}>{s.icon}</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: s.color }}>{s.label}</div>
                <div style={{ fontSize: 11, color: theme.dim }}>{s.desc}</div>
              </div>
            </div>
            <div style={{ fontSize: 10, color: theme.dim, fontFamily: "monospace", background: theme.surface, borderRadius: 6, padding: "6px 8px", lineHeight: 1.5 }}>
              {s.prompt.length > 90 ? s.prompt.slice(0, 90) + "..." : s.prompt}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Sub-nav 2: Fleet Status ── */
function FleetStatus({ assets, trucks, rooms, tick }: { assets: Asset[]; trucks: Asset[]; rooms: Asset[]; tick: number }) {
  const critical = assets.filter(a => a.state === "CRITICAL");
  const warning  = assets.filter(a => a.state === "WARNING");

  return (
    <div>
      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 16 }}>
        {[
          { label: "Total assets", value: assets.length, color: theme.blue },
          { label: "Trucks",       value: trucks.length, color: theme.purple },
          { label: "Cold rooms",   value: rooms.length,  color: theme.cyan },
          { label: "Critical",     value: critical.length, color: critical.length > 0 ? theme.critical : theme.accent },
          { label: "Warning",      value: warning.length,  color: warning.length > 0 ? theme.warning : theme.accent },
        ].map(s => (
          <div key={s.label} style={{ background: theme.surface, borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: theme.dim, textTransform: "uppercase", marginBottom: 3 }}>{s.label}</div>
            <Mono color={s.color} size={22}>{s.value}</Mono>
          </div>
        ))}
      </div>

      {/* Critical first, then rest */}
      {critical.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.critical, marginBottom: 8 }}>Critical — immediate action required</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
            {critical.map(a => <AssetSimCard key={a.asset_id} asset={a} tick={tick} selected={false} onSelect={() => {}} />)}
          </div>
        </div>
      )}
      {warning.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.warning, marginBottom: 8 }}>Warning</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
            {warning.map(a => <AssetSimCard key={a.asset_id} asset={a} tick={tick} selected={false} onSelect={() => {}} />)}
          </div>
        </div>
      )}
      <div style={{ fontSize: 12, fontWeight: 600, color: theme.accent, marginBottom: 8 }}>Normal</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
        {assets.filter(a => a.state === "NORMAL").map(a => <AssetSimCard key={a.asset_id} asset={a} tick={tick} selected={false} onSelect={() => {}} />)}
      </div>
    </div>
  );
}

/* ── Sub-nav 3: Logs ── */
function LogsView({ logs }: { logs: LogEntry[] }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 10 }}>
        Simulator command log
        <span style={{ fontSize: 11, fontWeight: 400, color: theme.dim, marginLeft: 8 }}>{logs.length} entries</span>
      </div>
      <div style={{ background: "#060b15", borderRadius: 10, padding: 16, fontFamily: "monospace", fontSize: 12, lineHeight: 1.8, maxHeight: "calc(100vh - 200px)", overflow: "auto" }}>
        {logs.length === 0 && <div style={{ color: theme.dim }}>No commands yet. Run a scenario or send a command.</div>}
        {logs.map((l, i) => (
          <div key={i} style={{ color: LOG_COLORS[l.type] || theme.muted }}>
            <span style={{ color: theme.dim, marginRight: 10 }}>{l.time}</span>
            <span style={{ color: LOG_COLORS[l.type], marginRight: 10 }}>[{l.type.toUpperCase()}]</span>
            {l.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
