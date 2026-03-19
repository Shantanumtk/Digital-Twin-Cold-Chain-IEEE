#!/bin/bash
# =============================================================================
# Cold Chain Dashboard — Fix Field Mapping + Font Sizes
# =============================================================================
# Run from project root:  bash setup-dashboard-fix.sh
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'
log() { echo -e "${BLUE}[FIX] $1${NC}"; }
done_log() { echo -e "${GREEN}[FIX] ✓ $1${NC}"; }

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Dashboard Fix — Field Mapping + Font Sizes           ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""

if [ ! -f "dashboard/src/lib/theme.ts" ]; then
  echo "Error: Run from project root"
  exit 1
fi

cd dashboard

# =============================================================================
# Fix 1: page.tsx — Fix API field mapping in data fetch
# =============================================================================
log "Fixing page.tsx — API field mapping + data normalization..."

python3 << 'PYEOF'
content = open("src/app/page.tsx").read()

# Find the section where assets are set and add normalization
old = '''if (assetsRes) setAssets(Array.isArray(assetsRes) ? assetsRes : assetsRes.assets || []);'''
new = '''if (assetsRes) {
        const raw = Array.isArray(assetsRes) ? assetsRes : assetsRes.assets || [];
        setAssets(raw.map((a: any) => ({
          ...a,
          humidity: a.humidity ?? a.humidity_pct ?? null,
          speed: a.speed ?? a.location?.speed_kmh ?? 0,
          last_update: a.last_update ?? (a.updated_at ? new Date(a.updated_at).toLocaleTimeString() : null),
          route: a.route ?? (a.location ? `${a.location.latitude?.toFixed(2)}, ${a.location.longitude?.toFixed(2)}` : null),
          site: a.site ?? a.warehouse ?? null,
          fuel: a.fuel ?? a.fuel_pct ?? null,
          mileage: a.mileage ?? a.odometer_km ?? null,
          capacity: a.capacity ?? a.capacity_pct ?? null,
          power: a.power ?? a.power_kw ?? null,
        })));
      }'''
if old in content:
    content = content.replace(old, new)
    print("  ✓ Asset normalization added")
else:
    print("  → Asset normalization already applied or code differs")

# Fix stats mapping
old2 = '''if (statsRes) setStats(statsRes);'''
new2 = '''if (statsRes) {
        setStats({
          total_assets: statsRes.total_assets ?? 0,
          trucks: statsRes.asset_types?.refrigerated_truck ?? statsRes.trucks ?? 0,
          cold_rooms: statsRes.asset_types?.cold_room ?? statsRes.cold_rooms ?? 0,
          normal: statsRes.state_counts?.NORMAL ?? statsRes.normal ?? 0,
          warning: statsRes.state_counts?.WARNING ?? statsRes.warning ?? 0,
          critical: statsRes.state_counts?.CRITICAL ?? statsRes.critical ?? 0,
          active_alerts: statsRes.active_alerts ?? 0,
        });
      }'''
if old2 in content:
    content = content.replace(old2, new2)
    print("  ✓ Stats normalization added")
else:
    print("  → Stats normalization already applied or code differs")

# Fix alerts mapping
old3 = '''if (alertsRes) setAlerts(Array.isArray(alertsRes) ? alertsRes : alertsRes.alerts || []);'''
new3 = '''if (alertsRes) {
        const rawAlerts = Array.isArray(alertsRes) ? alertsRes : alertsRes.alerts || [];
        setAlerts(rawAlerts.map((al: any) => ({
          ...al,
          severity: al.severity ?? al.level ?? al.sev ?? "INFO",
          message: al.message ?? al.msg ?? al.description ?? "Alert",
          timestamp: al.timestamp ?? al.created_at ?? al.time ?? null,
        })));
      }'''
if old3 in content:
    content = content.replace(old3, new3)
    print("  ✓ Alert normalization added")
else:
    print("  → Alert normalization already applied or code differs")

open("src/app/page.tsx", "w").write(content)
print("  ✓ page.tsx updated")
PYEOF
done_log "page.tsx field mapping fixed"

# =============================================================================
# Fix 2: UIComponents.tsx — Bump all font sizes
# =============================================================================
log "Fixing UIComponents.tsx — Bigger fonts..."

python3 << 'PYEOF'
content = open("src/components/dashboard/UIComponents.tsx").read()

# Badge: 9/10 → 11/12
content = content.replace(
    "fontSize: small ? 9 : 10, fontWeight: 700,",
    "fontSize: small ? 11 : 12, fontWeight: 700,"
)
# Mono default: 13 → 14
content = content.replace(
    "size = 13 }: { children: React.ReactNode; color?: string; size?: number }",
    "size = 14 }: { children: React.ReactNode; color?: string; size?: number }"
)
# StatCard label: 9 → 11
content = content.replace(
    'fontSize: 9, color: theme.dim, textTransform: "uppercase"',
    'fontSize: 11, color: theme.dim, textTransform: "uppercase"'
)
# StatCard value: 18 → 22
content = content.replace(
    "<Mono color={color} size={18}>{value}</Mono>",
    "<Mono color={color} size={22}>{value}</Mono>"
)
# StatCard sub: 9 → 11
content = content.replace(
    '{sub && <div style={{ fontSize: 9, color: theme.dim, marginTop: 1 }}>{sub}</div>}',
    '{sub && <div style={{ fontSize: 11, color: theme.dim, marginTop: 2 }}>{sub}</div>}'
)
# Ring label: 9/11 → 11/14
content = content.replace(
    "fontSize: size < 50 ? 9 : 11,",
    "fontSize: size < 50 ? 11 : 14,"
)

open("src/components/dashboard/UIComponents.tsx", "w").write(content)
print("  ✓ UIComponents font sizes bumped")
PYEOF
done_log "UIComponents.tsx fonts fixed"

# =============================================================================
# Fix 3: DashboardPage.tsx — Bump table + card fonts
# =============================================================================
log "Fixing DashboardPage.tsx — Bigger fonts..."

python3 << 'PYEOF'
content = open("src/components/dashboard/pages/DashboardPage.tsx").read()

# Table header: 9 → 11
content = content.replace(
    'fontSize: 9, fontWeight: 600, color: theme.dim, textTransform: "uppercase"',
    'fontSize: 11, fontWeight: 600, color: theme.dim, textTransform: "uppercase"'
)
# Table body font: 11 → 13
content = content.replace(
    "borderCollapse: \"collapse\", fontSize: 11",
    'borderCollapse: "collapse", fontSize: 13'
)
# Asset name in table: 12 → 14
content = content.replace(
    "fontWeight: 600, color: theme.text, fontSize: 12",
    "fontWeight: 600, color: theme.text, fontSize: 14"
)
# Sparkline: make bigger
content = content.replace(
    'Sparkline data={sparkData(a)} color={stateColor(a.state)}',
    'Sparkline data={sparkData(a)} color={stateColor(a.state)} width={80} height={24}'
)
# Door/Compressor text: 10 → 12
content = content.replace(
    'a.door_open ? theme.warning : theme.accent, fontSize: 10',
    'a.door_open ? theme.warning : theme.accent, fontSize: 12'
)
content = content.replace(
    'a.compressor_running ? theme.accent : theme.critical, fontSize: 10',
    'a.compressor_running ? theme.accent : theme.critical, fontSize: 12'
)
# Updated column: 9 → 11
content = content.replace(
    'color: theme.dim, fontSize: 9',
    'color: theme.dim, fontSize: 11'
)
# Alert panel title: 11 → 13
content = content.replace(
    'fontSize: 11, fontWeight: 600, color: theme.text }}>Active Alerts',
    'fontSize: 13, fontWeight: 600, color: theme.text }}>Active Alerts'
)
# Alert text: 10/9 → 12/11
content = content.replace(
    'fontSize: 10, color: theme.text, lineHeight: 1.3',
    'fontSize: 12, color: theme.text, lineHeight: 1.4'
)
content = content.replace(
    'fontSize: 9, color: theme.dim }}>{al.asset_id}',
    'fontSize: 11, color: theme.dim }}>{al.asset_id}'
)
# Fleet card fonts: 13 → 15 name, 8 → 10 label, 11 → 13 value
content = content.replace(
    "fontSize: 13, fontWeight: 700, color: theme.text }}>{t.asset_id}",
    "fontSize: 15, fontWeight: 700, color: theme.text }}>{t.asset_id}"
)
content = content.replace(
    "fontSize: 13, fontWeight: 700, color: theme.text }}>{r.asset_id}",
    "fontSize: 15, fontWeight: 700, color: theme.text }}>{r.asset_id}"
)
# Sub-label "8" → "10"
content = content.replace(
    'fontSize: 8, color: theme.dim',
    'fontSize: 10, color: theme.dim'
)
# Route/site text: 9 → 11
content = content.replace(
    'fontSize: 9, color: theme.dim, marginTop: 6',
    'fontSize: 11, color: theme.dim, marginTop: 6'
)
# Service status: 12 → 14, 10 → 12
content = content.replace(
    'fontSize: 12, fontWeight: 600, color: theme.text }}>{sv.name}',
    'fontSize: 14, fontWeight: 600, color: theme.text }}>{sv.name}'
)
content = content.replace(
    'fontSize: 10, color: theme.muted, marginTop: 4 }}>{sv.status}',
    'fontSize: 12, color: theme.muted, marginTop: 4 }}>{sv.status}'
)
# Pipeline step text: 10 → 12
content = content.replace(
    'fontSize: 10, color: step.color, fontWeight: 500',
    'fontSize: 12, color: step.color, fontWeight: 500'
)

# Fix humidity display — use normalized field
content = content.replace(
    '{a.humidity ?? "—"}%',
    '{a.humidity != null ? Math.round(a.humidity) : "—"}%'
)

# Fix last_update display
content = content.replace(
    '{a.last_update || "—"}',
    '{a.last_update || "Live"}'
)

open("src/components/dashboard/pages/DashboardPage.tsx", "w").write(content)
print("  ✓ DashboardPage font sizes + field refs fixed")
PYEOF
done_log "DashboardPage.tsx fixed"

# =============================================================================
# Fix 4: Sidebar.tsx — Bigger fonts + icons
# =============================================================================
log "Fixing Sidebar.tsx — Bigger fonts..."

python3 << 'PYEOF'
content = open("src/components/dashboard/Sidebar.tsx").read()

# Icon size: 16 → 20
content = content.replace(
    "fontSize: 16, flexShrink: 0",
    "fontSize: 20, flexShrink: 0"
)
# Label: 12 → 14
content = content.replace(
    "fontSize: 12, fontWeight: 500, whiteSpace: \"nowrap\"",
    'fontSize: 14, fontWeight: 500, whiteSpace: "nowrap"'
)
# Logo text: 13 → 15
content = content.replace(
    'fontSize: 13, fontWeight: 700, color: theme.text',
    'fontSize: 15, fontWeight: 700, color: theme.text'
)
# User name: 11 → 13
content = content.replace(
    'fontSize: 11, fontWeight: 600, color: theme.text',
    'fontSize: 13, fontWeight: 600, color: theme.text'
)
# User sub: 9 → 11
content = content.replace(
    'fontSize: 9, color: theme.dim',
    'fontSize: 11, color: theme.dim'
)

open("src/components/dashboard/Sidebar.tsx", "w").write(content)
print("  ✓ Sidebar font sizes bumped")
PYEOF
done_log "Sidebar.tsx fixed"

# =============================================================================
# Fix 5: TopNav.tsx — Bigger fonts
# =============================================================================
log "Fixing TopNav.tsx — Bigger fonts..."

python3 << 'PYEOF'
content = open("src/components/dashboard/TopNav.tsx").read()

# Page label: 14 → 18
content = content.replace(
    "fontSize: 14, fontWeight: 700, color: theme.text",
    "fontSize: 18, fontWeight: 700, color: theme.text"
)
# Sub-nav items: 11 → 13
content = content.replace(
    "fontSize: 11, fontWeight: 500,",
    "fontSize: 13, fontWeight: 500,"
)
# Status text: 10 → 12
content = content.replace(
    'fontSize: 10, color: theme.accent, fontWeight: 500',
    'fontSize: 12, color: theme.accent, fontWeight: 500'
)
# Profile text: 11 → 13
content = content.replace(
    'fontSize: 11, color: theme.dim',
    'fontSize: 13, color: theme.dim'
)

open("src/components/dashboard/TopNav.tsx", "w").write(content)
print("  ✓ TopNav font sizes bumped")
PYEOF
done_log "TopNav.tsx fixed"

# =============================================================================
# Fix 6: LiveCard.tsx — Bigger fonts
# =============================================================================
log "Fixing LiveCard.tsx — Bigger fonts..."

python3 << 'PYEOF'
content = open("src/components/dashboard/LiveCard.tsx").read()

# Asset name: 14 → 16
content = content.replace(
    'fontSize: 14, fontWeight: 700, color: theme.text',
    'fontSize: 16, fontWeight: 700, color: theme.text'
)
# Sub text: 10 → 12
content = content.replace(
    'fontSize: 10, color: theme.dim, marginTop: 1',
    'fontSize: 12, color: theme.dim, marginTop: 1'
)
# Update time: 9 → 11
content = content.replace(
    'fontSize: 9, color: theme.dim',
    'fontSize: 11, color: theme.dim'
)
# Bottom stats label: 8 → 10
content = content.replace(
    'fontSize: 8, color: theme.dim, textTransform: "uppercase"',
    'fontSize: 10, color: theme.dim, textTransform: "uppercase"'
)
# Bottom stats value: 12 → 14
content = content.replace(
    '<Mono color={m.c} size={12}>{m.v}</Mono>',
    '<Mono color={m.c} size={14}>{m.v}</Mono>'
)

# Fix field references for speed/humidity
content = content.replace(
    "a.speed || 0",
    "(a.speed ?? a.location?.speed_kmh ?? 0)"
)
content = content.replace(
    "a.humidity || 50",
    "(a.humidity ?? a.humidity_pct ?? 50)"
)

open("src/components/dashboard/LiveCard.tsx", "w").write(content)
print("  ✓ LiveCard font sizes + field refs fixed")
PYEOF
done_log "LiveCard.tsx fixed"

# =============================================================================
# Fix 7: DetailModal.tsx — Bigger fonts
# =============================================================================
log "Fixing DetailModal.tsx — Bigger fonts..."

python3 << 'PYEOF'
content = open("src/components/dashboard/DetailModal.tsx").read()

# Asset name: 17 → 20
content = content.replace(
    'fontSize: 17, fontWeight: 700, color: theme.text',
    'fontSize: 20, fontWeight: 700, color: theme.text'
)
# Sub info: 11 → 13
content = content.replace(
    'fontSize: 11, color: theme.dim, marginTop: 3',
    'fontSize: 13, color: theme.dim, marginTop: 3'
)
# Tab labels: 11 → 13
content = content.replace(
    'fontSize: 11, fontWeight: 500, display: "flex"',
    'fontSize: 13, fontWeight: 500, display: "flex"'
)
# Tab icon: 13 → 15
content = content.replace(
    "fontSize: 13 }}>{t.i}",
    "fontSize: 15 }}>{t.i}"
)

open("src/components/dashboard/DetailModal.tsx", "w").write(content)
print("  ✓ DetailModal font sizes bumped")
PYEOF
done_log "DetailModal.tsx fixed"

# =============================================================================
# Fix 8: MonitorPage, FleetPage, RoomsPage — font bumps
# =============================================================================
log "Fixing Monitor/Fleet/Rooms pages..."

python3 << 'PYEOF'
# MonitorPage
content = open("src/components/dashboard/pages/MonitorPage.tsx").read()
content = content.replace("fontSize: 13, fontWeight: 600", "fontSize: 16, fontWeight: 600")
content = content.replace("fontSize: 11, color: theme.muted", "fontSize: 13, color: theme.muted")
open("src/components/dashboard/pages/MonitorPage.tsx", "w").write(content)
print("  ✓ MonitorPage fonts fixed")

# FleetPage
content = open("src/components/dashboard/pages/FleetPage.tsx").read()
content = content.replace("fontSize: 13, fontWeight: 600, color: theme.text", "fontSize: 15, fontWeight: 600, color: theme.text")
content = content.replace("fontSize: 12, fontWeight: 600, color: theme.text", "fontSize: 14, fontWeight: 600, color: theme.text")
content = content.replace("fontSize: 11, color: theme.muted", "fontSize: 13, color: theme.muted")
content = content.replace("fontSize: 9, color: theme.dim", "fontSize: 11, color: theme.dim")
content = content.replace("fontSize: 10, color: theme.dim", "fontSize: 12, color: theme.dim")
open("src/components/dashboard/pages/FleetPage.tsx", "w").write(content)
print("  ✓ FleetPage fonts fixed")

# RoomsPage
content = open("src/components/dashboard/pages/RoomsPage.tsx").read()
content = content.replace("fontSize: 14, fontWeight: 600, color: theme.text", "fontSize: 16, fontWeight: 600, color: theme.text")
content = content.replace("fontSize: 12, fontWeight: 600, color: theme.text", "fontSize: 14, fontWeight: 600, color: theme.text")
content = content.replace("fontSize: 11, color: theme.muted", "fontSize: 13, color: theme.muted")
content = content.replace("fontSize: 9, color: theme.dim", "fontSize: 11, color: theme.dim")
content = content.replace("fontSize: 10, color: theme.dim", "fontSize: 12, color: theme.dim")
content = content.replace("fontSize: 10, color: theme.muted", "fontSize: 12, color: theme.muted")
open("src/components/dashboard/pages/RoomsPage.tsx", "w").write(content)
print("  ✓ RoomsPage fonts fixed")
PYEOF
done_log "Monitor/Fleet/Rooms fonts fixed"

# =============================================================================
# Fix 9: AnalyticsPage — font bumps
# =============================================================================
log "Fixing AnalyticsPage..."

python3 << 'PYEOF'
content = open("src/components/dashboard/pages/AnalyticsPage.tsx").read()
content = content.replace("fontSize: 12, fontWeight: 600, color: theme.text", "fontSize: 14, fontWeight: 600, color: theme.text")
content = content.replace("fontSize: 11, fontWeight: 600, color: theme.text", "fontSize: 13, fontWeight: 600, color: theme.text")
content = content.replace("fontSize: 9, color: theme.dim", "fontSize: 11, color: theme.dim")
content = content.replace("fontSize: 10, color: theme.muted", "fontSize: 12, color: theme.muted")
content = content.replace("fontSize: 11, color: theme.muted", "fontSize: 13, color: theme.muted")
content = content.replace("fontSize: 13, fontWeight: 600, color: theme.text", "fontSize: 15, fontWeight: 600, color: theme.text")
open("src/components/dashboard/pages/AnalyticsPage.tsx", "w").write(content)
print("  ✓ AnalyticsPage fonts fixed")
PYEOF
done_log "AnalyticsPage fixed"

# =============================================================================
# Fix 10: AlertsPage + SettingsPage — font bumps
# =============================================================================
log "Fixing AlertsPage + SettingsPage..."

python3 << 'PYEOF'
# AlertsPage
content = open("src/components/dashboard/pages/AlertsPage.tsx").read()
content = content.replace("fontSize: 13, color: theme.text, fontWeight: 500", "fontSize: 14, color: theme.text, fontWeight: 500")
content = content.replace("fontSize: 10, color: theme.muted", "fontSize: 12, color: theme.muted")
content = content.replace("fontSize: 10, color: theme.dim", "fontSize: 12, color: theme.dim")
content = content.replace("fontSize: 11, fontWeight: 500,", "fontSize: 13, fontWeight: 500,")
content = content.replace("fontSize: 13, fontWeight: 600, color: theme.text", "fontSize: 15, fontWeight: 600, color: theme.text")
open("src/components/dashboard/pages/AlertsPage.tsx", "w").write(content)
print("  ✓ AlertsPage fonts fixed")

# SettingsPage
content = open("src/components/dashboard/pages/SettingsPage.tsx").read()
content = content.replace("fontSize: 12, color: theme.text", "fontSize: 14, color: theme.text")
content = content.replace("fontSize: 11, color: theme.muted", "fontSize: 13, color: theme.muted")
content = content.replace("fontSize: 11, color: theme.text", "fontSize: 13, color: theme.text")
content = content.replace("fontSize: 14, fontWeight: 600, color: theme.text", "fontSize: 16, fontWeight: 600, color: theme.text")
content = content.replace("fontSize: 9, color: theme.dim", "fontSize: 11, color: theme.dim")
content = content.replace("fontSize: 10, color: theme.dim", "fontSize: 12, color: theme.dim")
open("src/components/dashboard/pages/SettingsPage.tsx", "w").write(content)
print("  ✓ SettingsPage fonts fixed")
PYEOF
done_log "AlertsPage + SettingsPage fixed"

# =============================================================================
# Summary
# =============================================================================
cd ..

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Fix Complete!                                        ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}✓${NC} Field mapping fixed in page.tsx:"
echo -e "      humidity_pct → humidity"
echo -e "      location.speed_kmh → speed"
echo -e "      updated_at → last_update (formatted)"
echo -e "      state_counts.NORMAL → normal (stats)"
echo -e "      asset_types.refrigerated_truck → trucks (stats)"
echo ""
echo -e "  ${GREEN}✓${NC} Font sizes bumped across ALL 12 files:"
echo -e "      Labels: 8-9px → 10-11px"
echo -e "      Body text: 10-11px → 12-13px"
echo -e "      Headings: 12-14px → 15-18px"
echo -e "      Values: 13-18px → 14-22px"
echo ""
echo -e "  ${BLUE}Now push + redeploy:${NC}"
echo -e "    git add -A && git commit -m 'Fix field mapping + font sizes' && git push"
echo ""