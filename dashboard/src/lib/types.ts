export interface Asset {
  asset_id: string;
  asset_type: string;
  state: string;
  temperature_c: number;
  humidity?: number;
  door_open: boolean;
  compressor_running: boolean;
  speed?: number;
  cargo?: string;
  profile?: string;
  last_update?: string;
  route?: string;
  site?: string;
  fuel?: number;
  mileage?: number;
  capacity?: number;
  power?: number;
}

export interface Alert {
  id: string;
  asset_id: string;
  severity: string;
  message: string;
  timestamp: string;
}

export interface StatsData {
  total_assets: number;
  trucks: number;
  cold_rooms: number;
  normal: number;
  warning: number;
  critical: number;
  active_alerts: number;
}

export type PageKey = "dashboard" | "monitor" | "fleet" | "rooms" | "map" | "alerts" | "simulator" | "settings";

export interface SidebarItem {
  icon: string;
  label: string;
  key: PageKey;
  badge?: boolean;
  adminOnly?: boolean;
}

export const SIDEBAR_ITEMS: SidebarItem[] = [
  { icon: "⊞", label: "Dashboard", key: "dashboard" },
  { icon: "🔬", label: "Live Monitor", key: "monitor" },
  { icon: "🚛", label: "Fleet", key: "fleet" },
  { icon: "🏭", label: "Cold Rooms", key: "rooms" },
  { icon: "🗺", label: "Live Map", key: "map" },
  { icon: "⚠", label: "Alerts", key: "alerts", badge: true },
  { icon: "🎮", label: "Simulator", key: "simulator", adminOnly: true },
  { icon: "⚙", label: "Settings", key: "settings" },
];

export const SUB_NAV_MAP: Record<PageKey, string[]> = {
  dashboard:  ["Overview", "Fleet Summary", "Room Summary", "System Health"],
  monitor:    ["All Assets", "Trucks Only", "Rooms Only", "Critical"],
  fleet:      ["All Trucks", "Active Routes", "Maintenance", "Performance"],
  rooms:      ["All Rooms", "Site Overview", "Temp Map", "Compliance"],
  map:        ["Live Tracking", "Route History", "Geofences", "Heatmap"],
  alerts:     ["Active", "History", "Rules", "Escalations"],
  simulator:  ["Command Center", "Scenario Library", "Fleet Status", "Logs"],
  settings:   ["General", "Profiles", "Notifications", "Users"],
};
