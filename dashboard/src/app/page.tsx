"use client";

import { useState, useEffect } from "react";
import { theme } from "@/lib/theme";
import { PageKey } from "@/lib/types";
import Sidebar from "@/components/dashboard/Sidebar";
import TopNav from "@/components/dashboard/TopNav";
import DashboardPage from "@/components/dashboard/pages/DashboardPage";
import MonitorPage from "@/components/dashboard/pages/MonitorPage";
import FleetPage from "@/components/dashboard/pages/FleetPage";
import RoomsPage from "@/components/dashboard/pages/RoomsPage";
import MapPage from "@/components/dashboard/pages/MapPage";
import AlertsPage from "@/components/dashboard/pages/AlertsPage";
import AnalyticsPage from "@/components/dashboard/pages/AnalyticsPage";
import SettingsPage from "@/components/dashboard/pages/SettingsPage";
import FloatingChat from "@/components/dashboard/FloatingChat";
import DetailModal from "@/components/dashboard/DetailModal";
import { Asset } from "@/lib/types";

// API helper
const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

async function fetchData(endpoint: string) {
  try {
    const res = await fetch(`${API_URL}${endpoint}`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default function HomePage() {
  const [page, setPage] = useState<PageKey>("dashboard");
  const [subNav, setSubNav] = useState(0);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [detailTab, setDetailTab] = useState("diagram");

  // Live data
  const [assets, setAssets] = useState<Asset[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);

  // Fetch data on interval
  useEffect(() => {
    const load = async () => {
      const [statsRes, assetsRes, alertsRes] = await Promise.all([
        fetchData("/stats"),
        fetchData("/assets"),
        fetchData("/alerts?limit=20"),
      ]);
      if (statsRes) setStats(statsRes);
      if (assetsRes) setAssets(Array.isArray(assetsRes) ? assetsRes : assetsRes.assets || []);
      if (alertsRes) setAlerts(Array.isArray(alertsRes) ? alertsRes : alertsRes.alerts || []);
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const handlePageChange = (newPage: PageKey) => {
    setPage(newPage);
    setSubNav(0);
  };

  const openDetail = (asset: Asset, tab = "diagram") => {
    setSelectedAsset(asset);
    setDetailTab(tab);
  };

  const trucks = assets.filter((a) => a.asset_type === "refrigerated_truck");
  const rooms = assets.filter((a) => a.asset_type === "cold_room");

  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return <DashboardPage subNav={subNav} assets={assets} trucks={trucks} rooms={rooms} stats={stats} alerts={alerts} onAssetClick={openDetail} />;
      case "monitor":
        return <MonitorPage subNav={subNav} assets={assets} trucks={trucks} rooms={rooms} onAssetClick={openDetail} />;
      case "fleet":
        return <FleetPage subNav={subNav} trucks={trucks} onAssetClick={openDetail} />;
      case "rooms":
        return <RoomsPage subNav={subNav} rooms={rooms} onAssetClick={openDetail} />;
      case "map":
        return <MapPage assets={assets} trucks={trucks} />;
      case "alerts":
        return <AlertsPage subNav={subNav} alerts={alerts} />;
      case "analytics":
        return <AnalyticsPage subNav={subNav} assets={assets} trucks={trucks} rooms={rooms} stats={stats} />;
      case "settings":
        return <SettingsPage subNav={subNav} />;
      default:
        return <DashboardPage subNav={0} assets={assets} trucks={trucks} rooms={rooms} stats={stats} alerts={alerts} onAssetClick={openDetail} />;
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: theme.bg, overflow: "hidden" }}>
      <Sidebar activePage={page} onPageChange={handlePageChange} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <TopNav page={page} subNav={subNav} onSubNavChange={setSubNav} />

        <div style={{ flex: 1, overflow: "auto", padding: 18 }}>
          {renderPage()}
        </div>
      </div>

      <FloatingChat />
      {selectedAsset && (
        <DetailModal
          asset={selectedAsset}
          initialTab={detailTab}
          onClose={() => setSelectedAsset(null)}
        />
      )}
    </div>
  );
}
