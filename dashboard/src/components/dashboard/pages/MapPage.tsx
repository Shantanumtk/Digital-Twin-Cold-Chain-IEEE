"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { theme, stateColor } from "@/lib/theme";
import { Asset } from "@/lib/types";
import { Card, Badge, Mono } from "../UIComponents";

interface Props {
  assets: Asset[];
  trucks: Asset[];
}

// ── State color hex for Leaflet markers ──────────────────────────────────────
function getMarkerColor(state: string): string {
  if (state === "CRITICAL") return "#ef4444";
  if (state === "WARNING")  return "#f59e0b";
  return "#10b981";
}

// ── Build SVG truck icon as data URL ─────────────────────────────────────────
function truckIconSVG(color: string, isMoving: boolean): string {
  const pulse = isMoving ? `
    <circle cx="20" cy="20" r="16" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.4">
      <animate attributeName="r" values="14;20;14" dur="2s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite"/>
    </circle>` : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="14" fill="${color}22" stroke="${color}" stroke-width="1.5"/>
    ${pulse}
    <text x="20" y="25" text-anchor="middle" font-size="16">🚛</text>
  </svg>`;
  return "data:image/svg+xml;base64," + btoa(svg);
}

export default function MapPage({ assets, trucks }: Props) {
  const mapRef     = useRef<any>(null);
  const mapDivRef  = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Record<string, any>>({});
  const trailsRef  = useRef<Record<string, any[]>>({});
  const lRef       = useRef<any>(null);   // Leaflet lib
  const [hovered, setHovered] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // ── Load Leaflet once (client-side only) ────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || mapRef.current) return;

    import("leaflet").then((L) => {
      lRef.current = L.default || L;
      const Lx = lRef.current;

      // Fix default icon paths broken by webpack
      delete (Lx.Icon.Default.prototype as any)._getIconUrl;
      Lx.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      if (!mapDivRef.current) return;

      const map = Lx.map(mapDivRef.current, {
        center: [34.05, -118.25],
        zoom: 9,
        zoomControl: true,
        scrollWheelZoom: true,
      });

      Lx.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // Warehouse markers
      const warehouses = [
        { lat: 34.052, lng: -118.244, name: "Warehouse Alpha" },
        { lat: 34.420, lng: -119.698, name: "Warehouse Beta"  },
        { lat: 32.716, lng: -117.161, name: "Warehouse Gamma" },
      ];
      warehouses.forEach((wh) => {
        const icon = Lx.divIcon({
          html: `<div style="font-size:24px;line-height:1;">🏭</div>`,
          className: "",
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        Lx.marker([wh.lat, wh.lng], { icon })
          .addTo(map)
          .bindPopup(`<b>${wh.name}</b>`);
      });

      mapRef.current = map;
      setMapReady(true);
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // ── Update animated truck markers whenever trucks data changes ───────────
  useEffect(() => {
    if (!mapReady || !mapRef.current || !lRef.current) return;
    const Lx  = lRef.current;
    const map = mapRef.current;

    const trucksWithGPS = trucks.filter(
      (t) => t.location?.latitude && t.location?.longitude
    );

    // Auto-fit map to truck positions on first load
    if (trucksWithGPS.length > 0 && Object.keys(markersRef.current).length === 0) {
      const bounds = Lx.latLngBounds(
        trucksWithGPS.map((t) => [t.location!.latitude, t.location!.longitude])
      );
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 11 });
    }

    // Remove markers for trucks that are gone
    Object.keys(markersRef.current).forEach((id) => {
      if (!trucks.find((t) => t.asset_id === id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
        // Remove trail lines
        (trailsRef.current[id] || []).forEach((l: any) => l.remove());
        delete trailsRef.current[id];
      }
    });

    trucksWithGPS.forEach((truck) => {
      const lat   = truck.location!.latitude;
      const lng   = truck.location!.longitude;
      const color = getMarkerColor(truck.state);
      const moving = (truck.speed || 0) > 0;

      const icon = Lx.icon({
        iconUrl:     truckIconSVG(color, moving),
        iconSize:    [40, 40],
        iconAnchor:  [20, 20],
        popupAnchor: [0, -20],
      });

      const popupContent = `
        <div style="min-width:160px;font-family:monospace;">
          <b style="font-size:14px;">${truck.asset_id}</b>
          <div style="margin-top:6px;">
            <span style="color:${color};font-weight:700;">${truck.state}</span>
          </div>
          <div style="margin-top:4px;font-size:12px;">
            🌡 ${truck.temperature_c?.toFixed(1)}°C<br/>
            💨 ${truck.speed || 0} km/h<br/>
            🚪 ${truck.door_open ? "Door OPEN" : "Door closed"}<br/>
            ⚙️ Compressor: ${truck.compressor_running ? "ON" : "OFF"}
          </div>
        </div>`;

      if (markersRef.current[truck.asset_id]) {
        // Smoothly animate existing marker to new position
        const marker = markersRef.current[truck.asset_id];
        const current = marker.getLatLng();
        const target  = Lx.latLng(lat, lng);

        // Only animate if position actually changed
        if (current.lat !== lat || current.lng !== lng) {
          animateMarker(marker, current, target, 4000);

          // Update trail
          if (!trailsRef.current[truck.asset_id]) {
            trailsRef.current[truck.asset_id] = [];
          }
          const trail = trailsRef.current[truck.asset_id];

          // Add new trail segment
          const segment = Lx.polyline([[current.lat, current.lng], [lat, lng]], {
            color,
            weight: 2,
            opacity: 0.6,
            dashArray: moving ? undefined : "4 4",
          }).addTo(map);
          trail.push(segment);

          // Keep only last 8 trail segments
          if (trail.length > 8) {
            const old = trail.shift();
            old.remove();
          }

          // Fade older trail segments
          trail.forEach((seg: any, i: number) => {
            seg.setStyle({ opacity: ((i + 1) / trail.length) * 0.6 });
          });
        }

        // Always update icon (state/speed may have changed)
        marker.setIcon(icon);
        marker.getPopup()?.setContent(popupContent);
      } else {
        // Create new marker
        const marker = Lx.marker([lat, lng], { icon })
          .addTo(map)
          .bindPopup(popupContent);

        marker.on("mouseover", () => setHovered(truck.asset_id));
        marker.on("mouseout",  () => setHovered(null));
        marker.on("click",     () => marker.openPopup());

        markersRef.current[truck.asset_id] = marker;
        trailsRef.current[truck.asset_id]  = [];
      }
    });
  }, [trucks, mapReady]);

  // ── Smooth marker animation between two LatLng points ───────────────────
  function animateMarker(marker: any, from: any, to: any, duration: number) {
    const startTime = performance.now();
    const startLat  = from.lat;
    const startLng  = from.lng;
    const dLat      = to.lat - startLat;
    const dLng      = to.lng - startLng;

    function step(now: number) {
      const elapsed  = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease in-out
      const t = progress < 0.5
        ? 2 * progress * progress
        : -1 + (4 - 2 * progress) * progress;

      marker.setLatLng([startLat + dLat * t, startLng + dLng * t]);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  const rooms = assets.filter((a) => a.asset_type === "cold_room");
  const sites = new Map<string, Asset[]>();
  rooms.forEach((r) => {
    const s = r.site || "Unknown";
    if (!sites.has(s)) sites.set(s, []);
    sites.get(s)!.push(r);
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 14, height: "calc(100vh - 140px)" }}>

      {/* ── Map container ── */}
      <Card style={{ padding: 0, overflow: "hidden", position: "relative" }}>
        {/* Leaflet CSS */}
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        />

        <div
          ref={mapDivRef}
          style={{ width: "100%", height: "100%", minHeight: 500, background: "#0c1424" }}
        />

        {/* Loading overlay */}
        {!mapReady && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#0c1424", color: theme.muted, fontSize: 14,
          }}>
            Loading map...
          </div>
        )}

        {/* Legend overlay */}
        {mapReady && (
          <div style={{
            position: "absolute", top: 10, left: 10, zIndex: 1000,
            background: "rgba(10,15,26,0.85)", padding: "8px 12px",
            borderRadius: 8, border: `1px solid ${theme.border}`,
            backdropFilter: "blur(4px)",
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: theme.text, marginBottom: 4 }}>
              Fleet Radar — {trucks.filter(t => t.location?.latitude).length} trucks
            </div>
            <div style={{ display: "flex", gap: 10, fontSize: 10, color: theme.muted }}>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
                Normal
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />
                Warning
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
                Critical
              </span>
            </div>
          </div>
        )}
      </Card>

      {/* ── Right panel ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, overflow: "auto" }}>
        <Card style={{ padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 8 }}>
            Fleet Status
          </div>
          {trucks.map((t) => (
            <div
              key={t.asset_id}
              style={{
                padding: "8px 0",
                borderBottom: `1px solid ${theme.borderLight}`,
                opacity: hovered && hovered !== t.asset_id ? 0.4 : 1,
                transition: "opacity 0.2s",
                cursor: "pointer",
              }}
              onMouseEnter={() => {
                setHovered(t.asset_id);
                // Pan map to this truck
                const marker = markersRef.current[t.asset_id];
                if (marker && mapRef.current) {
                  mapRef.current.panTo(marker.getLatLng(), { animate: true, duration: 0.5 });
                  marker.openPopup();
                }
              }}
              onMouseLeave={() => setHovered(null)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: theme.text }}>{t.asset_id}</span>
                <Badge state={t.state} small />
              </div>
              <div style={{ fontSize: 9, color: theme.dim, marginTop: 2 }}>
                {t.location
                  ? `${t.location.latitude.toFixed(3)}, ${t.location.longitude.toFixed(3)}`
                  : "No GPS"}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                <Mono size={10} color={stateColor(t.state)}>{t.temperature_c?.toFixed(1)}°C</Mono>
                <Mono size={10} color={(t.speed || 0) > 0 ? theme.blue : theme.dim}>
                  {t.speed || 0} km/h
                </Mono>
              </div>
            </div>
          ))}
          {trucks.length === 0 && (
            <div style={{ fontSize: 11, color: theme.dim, padding: "10px 0" }}>No trucks</div>
          )}
        </Card>

        <Card style={{ padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 8 }}>
            Warehouses
          </div>
          {Array.from(sites.entries()).map(([site, sRooms]) => (
            <div key={site} style={{ padding: "6px 0", borderBottom: `1px solid ${theme.borderLight}` }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: theme.text }}>{site}</div>
              <div style={{ fontSize: 9, color: theme.muted }}>
                {sRooms.length} rooms · {sRooms.filter((r) => r.state === "NORMAL").length} OK
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
