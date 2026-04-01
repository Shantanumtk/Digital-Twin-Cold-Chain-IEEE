#!/bin/bash
set -e

if [ ! -f "dashboard/src/components/dashboard/pages/SimulatorPage.tsx" ]; then
  echo "ERROR: Run from project root"
  exit 1
fi

python3 << 'PYEOF'
with open("dashboard/src/components/dashboard/pages/SimulatorPage.tsx", "r") as f:
    content = f.read()

# Fix the one missed AssetSimCard in FleetStatus (Normal section)
old = '        {assets.filter(a => a.state === "NORMAL").map(a => <AssetSimCard key={a.asset_id} asset={a} tick={tick} />)}'
new = '        {assets.filter(a => a.state === "NORMAL").map(a => <AssetSimCard key={a.asset_id} asset={a} tick={tick} selected={false} onSelect={() => {}} />)}'

if old in content:
    content = content.replace(old, new, 1)
    print("Fixed NORMAL section AssetSimCard call")
else:
    # Try to find and report any remaining bare AssetSimCard usages
    import re
    bare = re.findall(r'<AssetSimCard[^/]*?tick=\{tick\}\s*/>', content)
    if bare:
        print(f"Found {len(bare)} bare calls, replacing all...")
        content = re.sub(
            r'(<AssetSimCard\s+key=\{[^}]+\}\s+asset=\{[^}]+\}\s+tick=\{tick\}\s*)/>',
            r'\1selected={false} onSelect={() => {}} />',
            content
        )
        print("All bare AssetSimCard calls patched via regex")
    else:
        print("No bare calls found — already patched or different format")

with open("dashboard/src/components/dashboard/pages/SimulatorPage.tsx", "w") as f:
    f.write(content)
PYEOF

echo "✓ Done — retry the build"