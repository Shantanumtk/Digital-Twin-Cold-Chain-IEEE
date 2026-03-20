"use client";

import { useEffect, useRef, useState } from "react";
import { theme, stateColor } from "@/lib/theme";
import { Asset } from "@/lib/types";
import { Card, Badge, Mono } from "../UIComponents";

interface Props {
  assets: Asset[];
  trucks: Asset[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

// ── GPS helpers — bypasses strict Asset type, reads flat or nested GPS fields
function getLat(t: Asset): number | null {
  const a = t as any;
  return a.latitude ?? a.location?.latitude ?? null;
}
function getLng(t: Asset): number | null {
  const a = t as any;
  return a.longitude ?? a.location?.longitude ?? null;
}
function getSpeed(t: Asset): number {
  const a = t as any;
  return a.speed ?? a.location?.speed_kmh ?? 0;
}
function hasGPS(t: Asset): boolean {
  return getLat(t) !== null && getLng(t) !== null;
}

function getColor(state: string): string {
  if (state === "CRITICAL") return "#ef4444";
  if (state === "WARNING")  return "#f59e0b";
  return "#10b981";
}

function truckIconSVG(color: string, moving: boolean): string {
  const pulse = moving
    ? `<circle cx="20" cy="20" r="15" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.5">
         <animate attributeName="r" values="12;19;12" dur="1.8s" repeatCount="indefinite"/>
         <animate attributeName="opacity" values="0.6;0;0.6" dur="1.8s" repeatCount="indefinite"/>
       </circle>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">
    <circle cx="20" cy="20" r="13" fill="${color}33" stroke="${color}" stroke-width="2"/>
    ${pulse}
    <text x="20" y="26" text-anchor="middle" font-size="16">🚛</text>
  </svg>`;
  return "data:image/svg+xml;base64," + btoa(svg);
}

async function initLeaflet(el: HTMLDivElement, center: [number, number], zoom: number) {
  const L = (await import("leaflet")).default;
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
  const map = L.map(el, { center, zoom, zoomControl: true, scrollWheelZoom: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);
  return { L, map };
}

function addWarehouses(L: any, map: any) {
  [
    [34.052, -118.244, "Warehouse Alpha"],
    [34.420, -119.698, "Warehouse Beta"],
    [32.716, -117.161, "Warehouse Gamma"],
  ].forEach(([lat, lng, name]) => {
    const icon = L.divIcon({
      html: `<div style="font-size:22px;line-height:1;">🏭</div>`,
      className: "", iconSize: [28, 28], iconAnchor: [14, 14],
    });
    L.marker([lat, lng], { icon }).addTo(map).bindPopup(`<b>${name}</b>`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1: Live Tracking
// ─────────────────────────────────────────────────────────────────────────────
function LiveTracking({ trucks }: { trucks: Asset[] }) {
  const divRef     = useRef<HTMLDivElement>(null);
  const mapRef     = useRef<any>(null);
  const markersRef = useRef<Record<string, any>>({});
  const trailsRef  = useRef<Record<string, any[]>>({});
  const lRef       = useRef<any>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [ready, setReady]     = useState(false);

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    initLeaflet(divRef.current, [33.87, -118.2], 8).then(({ L, map }) => {
      lRef.current = L;
      mapRef.current = map;
      addWarehouses(L, map);
      setReady(true);
    });
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current || !lRef.current) return;
    const L = lRef.current;
    const map = mapRef.current;
    const trucksGPS = trucks.filter(hasGPS);

    if (trucksGPS.length > 0 && Object.keys(markersRef.current).length === 0) {
      map.fitBounds(
        L.latLngBounds(trucksGPS.map(t => [getLat(t), getLng(t)])),
        { padding: [60, 60], maxZoom: 11 }
      );
    }

    Object.keys(markersRef.current).forEach(id => {
      if (!trucks.find(t => t.asset_id === id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
        (trailsRef.current[id] || []).forEach((l: any) => l.remove());
        delete trailsRef.current[id];
      }
    });

    trucksGPS.forEach(truck => {
      const lat    = getLat(truck)!;
      const lng    = getLng(truck)!;
      const spd    = getSpeed(truck);
      const color  = getColor(truck.state);
      const moving = spd > 0;
      const icon = L.icon({
        iconUrl: truckIconSVG(color, moving),
        iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -22],
      });
      const popupHtml = `
        <div style="font-family:monospace;min-width:150px;">
          <b style="font-size:13px;">${truck.asset_id}</b>
          <div style="color:${color};font-weight:700;margin:3px 0;">${truck.state}</div>
          <div style="font-size:12px;line-height:1.8;">
            🌡 ${truck.temperature_c?.toFixed(1)}°C<br>
            💨 ${spd} km/h<br>
            🚪 ${truck.door_open ? "Open" : "Closed"}<br>
            ⚙️ ${truck.compressor_running ? "ON" : "OFF"}
          </div>
        </div>`;

      if (markersRef.current[truck.asset_id]) {
        const marker = markersRef.current[truck.asset_id];
        const cur = marker.getLatLng();
        if (cur.lat !== lat || cur.lng !== lng) {
          animateMarker(marker, cur, { lat, lng }, 4000);
          if (!trailsRef.current[truck.asset_id]) trailsRef.current[truck.asset_id] = [];
          const trail = trailsRef.current[truck.asset_id];
          const seg = L.polyline([[cur.lat, cur.lng], [lat, lng]], {
            color, weight: 2, opacity: 0.6,
          }).addTo(map);
          trail.push(seg);
          if (trail.length > 8) trail.shift().remove();
          trail.forEach((s: any, i: number) => s.setStyle({ opacity: ((i + 1) / trail.length) * 0.6 }));
        }
        marker.setIcon(icon);
        marker.getPopup()?.setContent(popupHtml);
      } else {
        const marker = L.marker([lat, lng], { icon }).addTo(map).bindPopup(popupHtml);
        marker.on("mouseover", () => setHovered(truck.asset_id));
        marker.on("mouseout",  () => setHovered(null));
        markersRef.current[truck.asset_id] = marker;
        trailsRef.current[truck.asset_id] = [];
      }
    });
  }, [trucks, ready]);

  function animateMarker(marker: any, from: any, to: any, dur: number) {
    const start = performance.now();
    const dLat = to.lat - from.lat;
    const dLng = to.lng - from.lng;
    function step(now: number) {
      const p = Math.min((now - start) / dur, 1);
      const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
      marker.setLatLng([from.lat + dLat * ease, from.lng + dLng * ease]);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 14, height: "calc(100vh - 140px)" }}>
      <Card style={{ padding: 0, overflow: "hidden", position: "relative" }}>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <div ref={divRef} style={{ width: "100%", height: "100%", minHeight: 500 }} />
        {!ready && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#0c1424", color: theme.muted, fontSize: 14 }}>
            Loading map...
          </div>
        )}
        <div style={{ position: "absolute", top: 10, left: 10, zIndex: 1000, background: "rgba(10,15,26,0.85)", padding: "8px 12px", borderRadius: 8, border: `1px solid ${theme.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: theme.text, marginBottom: 4 }}>
            Live Tracking — {trucks.filter(hasGPS).length} trucks
          </div>
          {[["#10b981", "Normal"], ["#f59e0b", "Warning"], ["#ef4444", "Critical"]].map(([c, l]) => (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: theme.muted, marginTop: 2 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: c, display: "inline-block" }} />
              {l}
            </div>
          ))}
        </div>
      </Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, overflow: "auto" }}>
        <Card style={{ padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Fleet Status</div>
          {trucks.map(t => (
            <div key={t.asset_id}
              style={{ padding: "8px 0", borderBottom: `1px solid ${theme.borderLight}`, opacity: hovered && hovered !== t.asset_id ? 0.4 : 1, transition: "opacity 0.2s", cursor: "pointer" }}
              onMouseEnter={() => { setHovered(t.asset_id); markersRef.current[t.asset_id]?.openPopup(); mapRef.current?.panTo(markersRef.current[t.asset_id]?.getLatLng(), { animate: true }); }}
              onMouseLeave={() => setHovered(null)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: theme.text }}>{t.asset_id}</span>
                <Badge state={t.state} small />
              </div>
              <div style={{ fontSize: 9, color: theme.dim, marginTop: 2 }}>
                {hasGPS(t) ? `${getLat(t)?.toFixed(3)}, ${getLng(t)?.toFixed(3)}` : "No GPS"}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                <Mono size={10} color={stateColor(t.state)}>{t.temperature_c?.toFixed(1)}°C</Mono>
                <Mono size={10} color={getSpeed(t) > 0 ? theme.blue : theme.dim}>{getSpeed(t)} km/h</Mono>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2: Route History
// ─────────────────────────────────────────────────────────────────────────────
function RouteHistory({ trucks }: { trucks: Asset[] }) {
  const divRef   = useRef<HTMLDivElement>(null);
  const mapRef   = useRef<any>(null);
  const lRef     = useRef<any>(null);
  const routeRef = useRef<any[]>([]);
  const [ready, setReady]       = useState(false);
  const [selected, setSelected] = useState(trucks[0]?.asset_id || "");
  const [hours, setHours]       = useState(12);
  const [loading, setLoading]   = useState(false);
  const [stats, setStats]       = useState<any>(null);

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    initLeaflet(divRef.current, [33.87, -118.2], 8).then(({ L, map }) => {
      lRef.current = L;
      mapRef.current = map;
      addWarehouses(L, map);
      setReady(true);
    });
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!ready || !selected) return;
    loadRoute(selected, hours);
  }, [ready, selected, hours]);

  async function loadRoute(assetId: string, h: number) {
    setLoading(true);
    setStats(null);
    routeRef.current.forEach(l => l.remove());
    routeRef.current = [];
    try {
      const r = await fetch(`${API_URL}/api/assets/${assetId}/location-history?hours=${h}&limit=500`);
      if (!r.ok) { setLoading(false); setStats({ count: 0 }); return; }
      const data = await r.json();
      const points: [number, number][] = (data.route || []).map((p: any) => [p.latitude, p.longitude]);
      if (points.length < 2) { setLoading(false); setStats({ count: 0 }); return; }

      const L = lRef.current;
      const map = mapRef.current;

      const line = L.polyline(points, { color: "#60a5fa", weight: 3, opacity: 0.8 }).addTo(map);
      routeRef.current.push(line);
      map.fitBounds(line.getBounds(), { padding: [40, 40] });

      const startIcon = L.divIcon({
        html: `<div style="background:#10b981;width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>`,
        className: "", iconSize: [12, 12], iconAnchor: [6, 6],
      });
      routeRef.current.push(L.marker(points[0], { icon: startIcon }).addTo(map).bindPopup("Start"));

      const truck = trucks.find(t => t.asset_id === assetId);
      const endIcon = L.icon({
        iconUrl: truckIconSVG(getColor(truck?.state || "NORMAL"), false),
        iconSize: [36, 36], iconAnchor: [18, 18],
      });
      routeRef.current.push(L.marker(points[points.length - 1], { icon: endIcon }).addTo(map).bindPopup(`${assetId} — current`));

      const step = Math.max(1, Math.floor(points.length / 8));
      for (let i = step; i < points.length - 1; i += step) {
        const [la1, lo1] = points[i - 1];
        const [la2, lo2] = points[i];
        const angle = Math.atan2(lo2 - lo1, la2 - la1) * 180 / Math.PI;
        const aIcon = L.divIcon({
          html: `<div style="transform:rotate(${angle}deg);font-size:12px;color:#60a5fa;">▶</div>`,
          className: "", iconSize: [14, 14], iconAnchor: [7, 7],
        });
        routeRef.current.push(L.marker([la2, lo2], { icon: aIcon, interactive: false }).addTo(map));
      }

      let dist = 0;
      for (let i = 1; i < points.length; i++) {
        const dlat = points[i][0] - points[i - 1][0];
        const dlng = points[i][1] - points[i - 1][1];
        dist += Math.sqrt(dlat * dlat + dlng * dlng) * 111;
      }
      const speeds = (data.route || []).map((p: any) => p.speed || 0).filter((s: number) => s > 0);
      setStats({
        count: points.length,
        dist: dist.toFixed(1),
        avgSpeed: speeds.length ? (speeds.reduce((a: number, b: number) => a + b, 0) / speeds.length).toFixed(1) : 0,
        maxSpeed: speeds.length ? Math.max(...speeds).toFixed(1) : 0,
      });
    } catch (e) {
      setStats({ count: 0 });
    }
    setLoading(false);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 14, height: "calc(100vh - 140px)" }}>
      <Card style={{ padding: 0, overflow: "hidden", position: "relative" }}>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <div ref={divRef} style={{ width: "100%", height: "100%", minHeight: 500 }} />
        {loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,15,26,0.6)", color: theme.text, fontSize: 14, zIndex: 1000 }}>
            Loading route...
          </div>
        )}
      </Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Card style={{ padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 10 }}>Route History</div>
          <div style={{ fontSize: 11, color: theme.dim, marginBottom: 4 }}>Asset</div>
          <select value={selected} onChange={e => setSelected(e.target.value)}
            style={{ width: "100%", background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 6, padding: "5px 8px", color: theme.text, fontSize: 12, marginBottom: 10 }}>
            {trucks.map(t => <option key={t.asset_id} value={t.asset_id}>{t.asset_id}</option>)}
          </select>
          <div style={{ fontSize: 11, color: theme.dim, marginBottom: 4 }}>Time window</div>
          <select value={hours} onChange={e => setHours(Number(e.target.value))}
            style={{ width: "100%", background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 6, padding: "5px 8px", color: theme.text, fontSize: 12, marginBottom: 10 }}>
            {[1, 4, 8, 12, 24, 48].map(h => <option key={h} value={h}>Last {h}h</option>)}
          </select>
          {stats && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: theme.text, marginBottom: 6 }}>Trip Stats</div>
              {stats.count === 0
                ? <div style={{ fontSize: 11, color: theme.dim }}>No GPS data in window</div>
                : [
                    ["GPS Points", stats.count],
                    ["Distance",   `${stats.dist} km`],
                    ["Avg Speed",  `${stats.avgSpeed} km/h`],
                    ["Max Speed",  `${stats.maxSpeed} km/h`],
                  ].map(([l, v]) => (
                    <div key={l as string} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${theme.borderLight}` }}>
                      <span style={{ fontSize: 11, color: theme.dim }}>{l}</span>
                      <Mono size={11}>{v}</Mono>
                    </div>
                  ))
              }
            </div>
          )}
        </Card>
        <Card style={{ padding: 12 }}>
          <div style={{ fontSize: 11, color: theme.dim, marginBottom: 6 }}>Legend</div>
          {[["#10b981", "● Start"], ["#60a5fa", "━ Trail"], ["#94a3b8", "▶ Direction"]].map(([c, l]) => (
            <div key={l} style={{ fontSize: 11, color: c, marginBottom: 3 }}>{l}</div>
          ))}
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3: Geofences
// ─────────────────────────────────────────────────────────────────────────────
const GEOFENCES = [
  { id: "gf1", name: "Warehouse Alpha Zone", lat: 34.052, lng: -118.244, radius: 8000,  color: "#3b82f6" },
  { id: "gf2", name: "Warehouse Beta Zone",  lat: 34.420, lng: -119.698, radius: 10000, color: "#8b5cf6" },
  { id: "gf3", name: "Warehouse Gamma Zone", lat: 32.716, lng: -117.161, radius: 8000,  color: "#10b981" },
  { id: "gf4", name: "LA Metro Depot",       lat: 34.100, lng: -118.350, radius: 5000,  color: "#f59e0b" },
];

function insideGF(lat: number, lng: number, gf: typeof GEOFENCES[0]): boolean {
  const R = 6371000;
  const dLat = (lat - gf.lat) * Math.PI / 180;
  const dLng = (lng - gf.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(gf.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= gf.radius;
}

function Geofences({ trucks }: { trucks: Asset[] }) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const lRef   = useRef<any>(null);
  const mRef   = useRef<Record<string, any>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    initLeaflet(divRef.current, [33.87, -118.5], 8).then(({ L, map }) => {
      lRef.current = L;
      mapRef.current = map;
      addWarehouses(L, map);
      GEOFENCES.forEach(gf => {
        L.circle([gf.lat, gf.lng], {
          radius: gf.radius, color: gf.color, fillColor: gf.color,
          fillOpacity: 0.08, weight: 2, dashArray: "6 4",
        }).addTo(map).bindPopup(`<b>${gf.name}</b><br>Radius: ${(gf.radius / 1000).toFixed(1)} km`);
        const li = L.divIcon({
          html: `<div style="background:${gf.color}22;border:1px solid ${gf.color}88;border-radius:4px;padding:2px 6px;font-size:10px;color:${gf.color};white-space:nowrap;">${gf.name}</div>`,
          className: "", iconAnchor: [60, 8],
        });
        L.marker([gf.lat - gf.radius / 111000 - 0.04, gf.lng], { icon: li, interactive: false }).addTo(map);
      });
      setReady(true);
    });
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!ready || !lRef.current || !mapRef.current) return;
    const L = lRef.current;
    const map = mapRef.current;
    Object.values(mRef.current).forEach((m: any) => m.remove());
    mRef.current = {};
    trucks.filter(hasGPS).forEach(truck => {
      const lat   = getLat(truck)!;
      const lng   = getLng(truck)!;
      const color = getColor(truck.state);
      const inside = GEOFENCES.filter(gf => insideGF(lat, lng, gf));
      const icon = L.icon({
        iconUrl: truckIconSVG(color, false),
        iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20],
      });
      const popup = `<div style="font-family:monospace;">
        <b>${truck.asset_id}</b><br>
        <span style="color:${color}">${truck.state}</span><br>
        🌡 ${truck.temperature_c?.toFixed(1)}°C<br><br>
        ${inside.length > 0
          ? `📍 Inside:<br>${inside.map(g => `&nbsp;• ${g.name}`).join("<br>")}`
          : "📍 Outside all zones"}
      </div>`;
      mRef.current[truck.asset_id] = L.marker([lat, lng], { icon }).addTo(map).bindPopup(popup);
      if (inside.length > 0) {
        L.circle([lat, lng], { radius: 300, color: "#fbbf24", fillOpacity: 0.3, weight: 2 }).addTo(map);
      }
    });
  }, [trucks, ready]);

  const trucksGPS = trucks.filter(hasGPS);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 14, height: "calc(100vh - 140px)" }}>
      <Card style={{ padding: 0, overflow: "hidden", position: "relative" }}>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <div ref={divRef} style={{ width: "100%", height: "100%", minHeight: 500 }} />
      </Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, overflow: "auto" }}>
        <Card style={{ padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Geofence Status</div>
          {GEOFENCES.map(gf => {
            const inside = trucksGPS.filter(t => insideGF(getLat(t)!, getLng(t)!, gf));
            return (
              <div key={gf.id} style={{ padding: "8px 0", borderBottom: `1px solid ${theme.borderLight}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: gf.color, display: "inline-block" }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: theme.text }}>{gf.name}</span>
                </div>
                <div style={{ fontSize: 10, color: theme.dim, marginBottom: 2 }}>
                  Radius: {(gf.radius / 1000).toFixed(1)} km
                </div>
                <div style={{ fontSize: 10, color: inside.length > 0 ? gf.color : theme.dim }}>
                  {inside.length > 0
                    ? `${inside.length} truck${inside.length > 1 ? "s" : ""}: ${inside.map(t => t.asset_id).join(", ")}`
                    : "No trucks inside"}
                </div>
              </div>
            );
          })}
        </Card>
        <Card style={{ padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Truck Zones</div>
          {trucksGPS.map(t => {
            const inside = GEOFENCES.filter(gf => insideGF(getLat(t)!, getLng(t)!, gf));
            return (
              <div key={t.asset_id} style={{ padding: "6px 0", borderBottom: `1px solid ${theme.borderLight}` }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: theme.text }}>{t.asset_id}</span>
                  <Badge state={t.state} small />
                </div>
                <div style={{ fontSize: 10, color: inside.length > 0 ? "#fbbf24" : theme.dim, marginTop: 2 }}>
                  {inside.length > 0
                    ? `In: ${inside.map(g => g.name.replace(" Zone", "")).join(", ")}`
                    : "Outside all zones"}
                </div>
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4: Heatmap
// ─────────────────────────────────────────────────────────────────────────────
function Heatmap({ trucks }: { trucks: Asset[] }) {
  const divRef  = useRef<HTMLDivElement>(null);
  const mapRef  = useRef<any>(null);
  const lRef    = useRef<any>(null);
  const heatRef = useRef<any[]>([]);
  const [ready, setReady]     = useState(false);
  const [mode, setMode]       = useState<"position" | "temperature" | "alerts">("position");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    initLeaflet(divRef.current, [33.87, -118.2], 8).then(({ L, map }) => {
      lRef.current = L;
      mapRef.current = map;
      addWarehouses(L, map);
      setReady(true);
    });
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (ready) loadHeatmap(mode);
  }, [ready, mode]);

  async function loadHeatmap(m: string) {
    if (!lRef.current || !mapRef.current) return;
    setLoading(true);
    const L = lRef.current;
    const map = mapRef.current;
    heatRef.current.forEach(c => c.remove());
    heatRef.current = [];
    const trucksGPS = trucks.filter(hasGPS);

    if (m === "position") {
      const allPts: [number, number][] = [];
      await Promise.all(trucksGPS.slice(0, 5).map(async truck => {
        try {
          const r = await fetch(`${API_URL}/api/assets/${truck.asset_id}/location-history?hours=24&limit=200`);
          if (!r.ok) return;
          const data = await r.json();
          (data.route || []).forEach((p: any) => allPts.push([p.latitude, p.longitude]));
        } catch (e) {}
      }));
      if (allPts.length === 0) trucksGPS.forEach(t => allPts.push([getLat(t)!, getLng(t)!]));
      allPts.forEach(([lat, lng]) => {
        heatRef.current.push(
          L.circle([lat, lng], { radius: 600, color: "transparent", fillColor: "#3b82f6", fillOpacity: 0.08 }).addTo(map)
        );
      });

    } else if (m === "temperature") {
      trucksGPS.forEach(truck => {
        const temp  = truck.temperature_c || 0;
        const n     = Math.max(0, Math.min(1, (temp + 25) / 50));
        const color = `rgb(${Math.round(255 * n)},0,${Math.round(255 * (1 - n))})`;
        heatRef.current.push(
          L.circle([getLat(truck)!, getLng(truck)!], {
            radius: 8000, color: "transparent", fillColor: color, fillOpacity: 0.35,
          }).addTo(map).bindPopup(`<b>${truck.asset_id}</b><br>Temp: ${temp.toFixed(1)}°C`)
        );
      });

    } else {
      await Promise.all(trucksGPS.slice(0, 5).map(async truck => {
        try {
          const r = await fetch(`${API_URL}/api/assets/${truck.asset_id}/alert-history?hours=24`);
          if (!r.ok) return;
          const data = await r.json();
          const cnt = data.total || 0;
          if (cnt > 0) {
            heatRef.current.push(
              L.circle([getLat(truck)!, getLng(truck)!], {
                radius: 2000 + cnt * 1000, color: "#ef4444", fillColor: "#ef4444",
                fillOpacity: Math.min(0.5, 0.1 * cnt), weight: 1,
              }).addTo(map).bindPopup(`<b>${truck.asset_id}</b><br>${cnt} alerts (24h)`)
            );
          }
        } catch (e) {}
        heatRef.current.push(
          L.circle([getLat(truck)!, getLng(truck)!], {
            radius: 1000, color: "transparent", fillColor: "#f59e0b", fillOpacity: 0.15,
          }).addTo(map)
        );
      }));
    }
    setLoading(false);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 14, height: "calc(100vh - 140px)" }}>
      <Card style={{ padding: 0, overflow: "hidden", position: "relative" }}>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <div ref={divRef} style={{ width: "100%", height: "100%", minHeight: 500 }} />
        {loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,15,26,0.6)", color: theme.text, fontSize: 14, zIndex: 1000 }}>
            Loading heatmap...
          </div>
        )}
      </Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Card style={{ padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 10 }}>Heatmap Mode</div>
          {([
            ["position",    "Position Density", "#3b82f6"],
            ["temperature", "Temperature",       "#ef4444"],
            ["alerts",      "Alert Density",     "#f59e0b"],
          ] as [string, string, string][]).map(([val, label, color]) => (
            <div key={val} onClick={() => setMode(val as any)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, cursor: "pointer", marginBottom: 4, background: mode === val ? `${color}22` : "transparent", border: `1px solid ${mode === val ? color : theme.border}` }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block" }} />
              <span style={{ fontSize: 12, color: mode === val ? color : theme.muted }}>{label}</span>
            </div>
          ))}
        </Card>
        <Card style={{ padding: 12 }}>
          <div style={{ fontSize: 11, color: theme.dim, lineHeight: 1.6 }}>
            {mode === "position"    && "Where trucks have spent the most time in the last 24h."}
            {mode === "temperature" && "Color-codes positions by current temperature. Blue = cold, Red = warm."}
            {mode === "alerts"      && "Alert hotspots. Larger/redder circles = more alerts in last 24h."}
          </div>
        </Card>
        <Card style={{ padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Fleet</div>
          {trucks.filter(hasGPS).map(t => (
            <div key={t.asset_id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${theme.borderLight}` }}>
              <span style={{ fontSize: 11, color: theme.text }}>{t.asset_id}</span>
              <Mono size={10} color={stateColor(t.state)}>{t.temperature_c?.toFixed(1)}°C</Mono>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
export default function MapPage({ assets, trucks }: Props) {
  const [tab, setTab] = useState(0);
  const TABS = ["Live Tracking", "Route History", "Geofences", "Heatmap"];

  return (
    <div>
      <div style={{ display: "flex", gap: 2, marginBottom: 14 }}>
        {TABS.map((t, i) => (
          <div key={t} onClick={() => setTab(i)}
            style={{ padding: "5px 14px", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 500,
              background: tab === i ? theme.accentDim : "transparent",
              color: tab === i ? theme.accent : theme.dim,
              transition: "all 0.15s" }}>
            {t}
          </div>
        ))}
      </div>
      {tab === 0 && <LiveTracking trucks={trucks} />}
      {tab === 1 && <RouteHistory trucks={trucks} />}
      {tab === 2 && <Geofences trucks={trucks} />}
      {tab === 3 && <Heatmap trucks={trucks} />}
    </div>
  );
}
