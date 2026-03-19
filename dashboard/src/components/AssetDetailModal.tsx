'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';

type SubView = 'temperature' | 'humidity' | 'door' | 'compressor' | 'location' | 'alerts' | 'config';

const SUB_VIEWS: { id: SubView; label: string; icon: string }[] = [
  { id: 'temperature', label: 'Temperature',  icon: '🌡️' },
  { id: 'humidity',    label: 'Humidity',      icon: '💧' },
  { id: 'door',        label: 'Door Activity', icon: '🚪' },
  { id: 'compressor',  label: 'Compressor',    icon: '⚙️' },
  { id: 'location',    label: 'Location',      icon: '📍' },
  { id: 'alerts',      label: 'Alerts',        icon: '🔔' },
  { id: 'config',      label: 'Config',        icon: '📋' },
];

const STATE_COLORS: Record<string, string> = {
  NORMAL: '#22c55e', WARNING: '#f59e0b', CRITICAL: '#ef4444', UNKNOWN: '#6b7280',
};

interface Props {
  assetId: string;
  onClose: () => void;
}

export default function AssetDetailModal({ assetId, onClose }: Props) {
  const [activeView, setActiveView] = useState<SubView>('temperature');
  const [summary, setSummary]       = useState<any>(null);
  const [data, setData]             = useState<any>(null);
  const [loading, setLoading]       = useState(false);
  const [hours, setHours]           = useState(24);

  const fetchSummary = useCallback(async () => {
    const r = await fetch(`/api/assets/${assetId}/summary?hours=${hours}`);
    if (r.ok) setSummary(await r.json());
  }, [assetId, hours]);

  const fetchSubView = useCallback(async (view: SubView) => {
    setLoading(true);
    setData(null);
    try {
      const endpoints: Record<SubView, string> = {
        temperature: `/api/assets/${assetId}/telemetry?hours=${hours}&limit=500`,
        humidity:    `/api/assets/${assetId}/telemetry?hours=${hours}&limit=500`,
        door:        `/api/assets/${assetId}/door-activity?hours=${hours}`,
        compressor:  `/api/assets/${assetId}/compressor-activity?hours=${hours}`,
        location:    `/api/assets/${assetId}/location-history?hours=${Math.min(hours, 12)}`,
        alerts:      `/api/assets/${assetId}/alert-history?hours=${hours}`,
        config:      `/api/assets/${assetId}/config`,
      };
      const r = await fetch(endpoints[view]);
      if (r.ok) setData(await r.json());
    } finally {
      setLoading(false);
    }
  }, [assetId, hours]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchSubView(activeView); }, [activeView, fetchSubView]);

  const stateColor = STATE_COLORS[summary?.current_state ?? 'UNKNOWN'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold text-white">{assetId}</span>
            {summary && (
              <span className="px-3 py-1 rounded-full text-sm font-semibold"
                style={{ background: stateColor + '33', color: stateColor }}>
                {summary.current_state}
              </span>
            )}
          </div>
          {/* Hours selector */}
          <div className="flex items-center gap-3">
            <select value={hours} onChange={e => setHours(Number(e.target.value))}
              className="bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-1.5 border border-gray-600">
              {[1, 4, 12, 24, 48, 72].map(h => (
                <option key={h} value={h}>{h}h</option>
              ))}
            </select>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
          </div>
        </div>

        {/* ── Summary row ── */}
        {summary && (
          <div className="grid grid-cols-5 gap-3 px-6 py-3 border-b border-gray-700 bg-gray-800/50">
            <Stat label="Temp" value={summary.current_temperature != null ? `${summary.current_temperature.toFixed(1)}°C` : '—'} />
            <Stat label="Avg (window)" value={summary.temperature_stats?.avg != null ? `${summary.temperature_stats.avg}°C` : '—'} />
            <Stat label="Min / Max" value={summary.temperature_stats?.min != null ? `${summary.temperature_stats.min} / ${summary.temperature_stats.max}` : '—'} />
            <Stat label="Door" value={summary.door_open ? '🔴 Open' : '🟢 Closed'} />
            <Stat label="Alerts (24h)" value={String(summary.alert_count_24h ?? 0)} />
          </div>
        )}

        {/* ── Sub-view tabs ── */}
        <div className="flex gap-1 px-6 py-2 border-b border-gray-700 overflow-x-auto">
          {SUB_VIEWS.map(v => (
            <button key={v.id} onClick={() => setActiveView(v.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors
                ${activeView === v.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>
              {v.icon} {v.label}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && <div className="flex justify-center py-12 text-gray-400">Loading…</div>}
          {!loading && data && (
            <>
              {activeView === 'temperature' && <TempChart data={data.data} thresholdMin={-25} thresholdMax={-15} />}
              {activeView === 'humidity'    && <HumidityChart data={data.data} />}
              {activeView === 'door'        && <DoorTimeline data={data} />}
              {activeView === 'compressor'  && <CompressorTimeline data={data} />}
              {activeView === 'location'    && <LocationView data={data} assetId={assetId} />}
              {activeView === 'alerts'      && <AlertHistory data={data} />}
              {activeView === 'config'      && <ConfigView data={data} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-sm font-semibold text-white mt-0.5">{value}</div>
    </div>
  );
}

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

function TempChart({ data, thresholdMin, thresholdMax }: { data: any[]; thresholdMin: number; thresholdMax: number }) {
  if (!data?.length) return <Empty msg="No temperature data in this window" />;
  const mapped = data.map(d => ({ t: fmtTime(d.timestamp), temp: d.temperature }));
  return (
    <div>
      <h3 className="text-white font-semibold mb-3">Temperature History</h3>
      <LineChart width={780} height={280} data={mapped}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis dataKey="t" stroke="#9ca3af" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis stroke="#9ca3af" tick={{ fontSize: 11 }} unit="°C" />
        <Tooltip contentStyle={{ background: '#1f2937', border: 'none', color: '#fff' }} />
        <ReferenceLine y={thresholdMin} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Min', fill: '#ef4444', fontSize: 11 }} />
        <ReferenceLine y={thresholdMax} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Max', fill: '#f59e0b', fontSize: 11 }} />
        <Line type="monotone" dataKey="temp" stroke="#60a5fa" dot={false} strokeWidth={2} />
      </LineChart>
    </div>
  );
}

function HumidityChart({ data }: { data: any[] }) {
  if (!data?.length) return <Empty msg="No humidity data in this window" />;
  const mapped = data.map(d => ({ t: fmtTime(d.timestamp), hum: d.humidity }));
  return (
    <div>
      <h3 className="text-white font-semibold mb-3">Humidity History</h3>
      <LineChart width={780} height={280} data={mapped}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis dataKey="t" stroke="#9ca3af" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis stroke="#9ca3af" tick={{ fontSize: 11 }} unit="%" />
        <Tooltip contentStyle={{ background: '#1f2937', border: 'none', color: '#fff' }} />
        <Line type="monotone" dataKey="hum" stroke="#34d399" dot={false} strokeWidth={2} />
      </LineChart>
    </div>
  );
}

function DoorTimeline({ data }: { data: any }) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <StatCard title="Opens" value={String(data.open_count ?? 0)} color="text-yellow-400" />
        <StatCard title="Total Open Time" value={`${Math.round((data.total_open_seconds ?? 0) / 60)} min`} color="text-orange-400" />
        <StatCard title="Events" value={String(data.events?.length ?? 0)} color="text-blue-400" />
      </div>
      <EventTable events={data.events ?? []} cols={['timestamp','event_type','duration_seconds']} />
    </div>
  );
}

function CompressorTimeline({ data }: { data: any }) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <StatCard title="Runtime %" value={`${data.runtime_percent ?? 0}%`} color="text-green-400" />
        <StatCard title="Cycles" value={String(data.cycle_count ?? 0)} color="text-purple-400" />
        <StatCard title="Events" value={String(data.events?.length ?? 0)} color="text-blue-400" />
      </div>
      <EventTable events={data.events ?? []} cols={['timestamp','event_type','duration_seconds']} />
    </div>
  );
}

function LocationView({ data, assetId }: { data: any; assetId: string }) {
  if (!data.route?.length) return <Empty msg="No GPS data — this may be a cold room asset or no location data in window" />;
  return (
    <div>
      <p className="text-gray-400 text-sm mb-3">{data.count} GPS points over last {data.hours}h</p>
      <div className="bg-gray-800 rounded-lg p-3 text-xs text-gray-400 space-y-1 max-h-64 overflow-y-auto">
        {data.route.map((p: any, i: number) => (
          <div key={i} className="flex gap-4">
            <span>{fmtTime(p.timestamp)}</span>
            <span>{p.latitude?.toFixed(5)}, {p.longitude?.toFixed(5)}</span>
            {p.speed != null && <span>{p.speed.toFixed(1)} km/h</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function AlertHistory({ data }: { data: any }) {
  const SCOLORS: Record<string, string> = { CRITICAL: 'text-red-400', WARNING: 'text-yellow-400', INFO: 'text-blue-400' };
  return (
    <div>
      <div className="grid grid-cols-3 gap-4 mb-4">
        {Object.entries(data.severity_breakdown ?? {}).map(([sev, cnt]) => (
          <StatCard key={sev} title={sev} value={String(cnt)} color={SCOLORS[sev] ?? 'text-gray-400'} />
        ))}
      </div>
      {!data.alerts?.length && <Empty msg="No alerts in this window" />}
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {(data.alerts ?? []).map((a: any, i: number) => (
          <div key={i} className="flex gap-3 items-start bg-gray-800 rounded-lg px-3 py-2 text-sm">
            <span className={SCOLORS[a.severity] ?? 'text-gray-400'}>{a.severity}</span>
            <span className="text-gray-400">{fmtTime(a.timestamp)}</span>
            <span className="text-white">{a.message ?? a.alert_type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfigView({ data }: { data: any }) {
  return (
    <div>
      <div className="mb-3 flex gap-3 items-center">
        <span className="text-gray-400 text-sm">Profile:</span>
        <span className="text-white font-semibold">{data.profile_name}</span>
        <span className="text-gray-400 text-sm ml-4">Type:</span>
        <span className="text-blue-400 font-semibold">{data.asset_type}</span>
      </div>
      <div className="bg-gray-800 rounded-lg p-4">
        <h4 className="text-gray-400 text-xs uppercase tracking-wide mb-3">Thresholds</h4>
        <pre className="text-green-400 text-sm">{JSON.stringify(data.thresholds, null, 2)}</pre>
      </div>
    </div>
  );
}

function StatCard({ title, value, color }: { title: string; value: string; color: string }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-gray-400 text-xs mt-1">{title}</div>
    </div>
  );
}

function EventTable({ events, cols }: { events: any[]; cols: string[] }) {
  if (!events.length) return <Empty msg="No events in window" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead>
          <tr>{cols.map(c => <th key={c} className="text-gray-500 text-xs uppercase px-3 py-2">{c.replace('_', ' ')}</th>)}</tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i} className="border-t border-gray-800">
              {cols.map(c => (
                <td key={c} className="px-3 py-2 text-gray-300">
                  {c === 'timestamp' ? fmtTime(e[c]) : c === 'duration_seconds' ? `${e[c]}s` : String(e[c] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="flex justify-center py-10 text-gray-500">{msg}</div>;
}
