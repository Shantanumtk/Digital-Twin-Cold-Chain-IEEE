#!/usr/bin/env python3
"""
Cold Chain Digital Twin — Local file patcher.

Run from the project root:
    python3 scripts/apply_patches.py

Patches applied:
  1. mcp-agent/agents/nodes.py
       - Fix state["user_query"] -> state.get("message", state.get("user_query", ""))
       - Add `all_states = all_states or []` guard before slice
  2. scripts/deploy-script.sh
       - Fix get_eks_node_ip_for_pod: resolve node hostname -> InternalIP
       - Fix /etc/mcp-agent.env: chmod 644 (not 600)
       - Fix restart-mcp-agent: use `sudo docker` throughout
       - Fix systemd ExecStop: use full /usr/bin/docker path
"""

import re
import sys
import os
from pathlib import Path

ROOT = Path(__file__).parent
NODES_FILE   = ROOT / "mcp-agent" / "agents" / "nodes.py"
DEPLOY_FILE  = ROOT / "scripts" / "deploy-script.sh"

errors = []

def patch_file(path: Path, replacements: list, label: str):
    """Apply a list of (old, new) replacements to a file."""
    if not path.exists():
        errors.append(f"  ✗ {label}: file not found at {path}")
        return

    original = path.read_text()
    patched  = original
    applied  = []
    skipped  = []

    for old, new, desc in replacements:
        if old in patched:
            patched = patched.replace(old, new)
            applied.append(desc)
        elif new in patched:
            skipped.append(f"{desc} (already applied)")
        else:
            skipped.append(f"{desc} (pattern not found)")

    if patched != original:
        path.write_text(patched)
        print(f"\n✅ {label} — {path.relative_to(ROOT)}")
        for a in applied:  print(f"   + {a}")
        for s in skipped:  print(f"   ~ {s}")
    else:
        print(f"\n⏭  {label} — no changes needed")
        for s in skipped:  print(f"   ~ {s}")


# =============================================================================
# Patch 1: mcp-agent/agents/nodes.py
# =============================================================================
nodes_patches = [
    # Fix 1a: supervisor_node query extraction
    (
        'query = state["user_query"].lower()',
        'query = state.get("message", state.get("user_query", "")).lower()',
        'supervisor_node: state["user_query"] -> safe .get("message", ...)',
    ),
    # Fix 1b: supervisor_node LLM fallback user message
    (
        '{"role": "user", "content": state["user_query"]},',
        '{"role": "user", "content": state.get("message", state.get("user_query", ""))},',
        'supervisor_node LLM fallback: state["user_query"] -> safe .get()',
    ),
    # Fix 1c: status_query_node context dict key
    (
        '"user_query": state["user_query"],',
        '"user_query": state.get("message", state.get("user_query", "")),',
        'status_query_node context: state["user_query"] -> safe .get()',
    ),
    # Fix 1d: guard all_states before slice in status_query_node
    (
        '            all_states = json.loads(raw) if isinstance(raw, str) else []\n\n            # LLM answers the question using live data',
        '            all_states = json.loads(raw) if isinstance(raw, str) else []\n            all_states = all_states or []  # guard against None\n\n            # LLM answers the question using live data',
        'status_query_node: guard all_states against None before slice',
    ),
    # Fix 1e: anomaly_classifier_node context user_query key (if present)
    (
        '"user_query": state["user_query"],',
        '"user_query": state.get("message", state.get("user_query", "")),',
        'anomaly_classifier_node context: state["user_query"] -> safe .get()',
    ),
]

patch_file(NODES_FILE, nodes_patches, "nodes.py")


# =============================================================================
# Patch 2: scripts/deploy-script.sh
# =============================================================================
deploy_patches = [
    # Fix 2a: get_eks_node_ip_for_pod — resolve hostname to InternalIP
    (
        '''get_eks_node_ip_for_pod() {
  local pattern="$1"
  local ns="${2:-$NAMESPACE}"
  kubectl get pod -n "$ns" -o wide 2>/dev/null \\
    | grep "$pattern" \\
    | awk '{print $7}' \\
    | head -1
}''',
        '''get_eks_node_ip_for_pod() {
  # Returns the private IP of the EKS node running the matched pod.
  # kubectl get pod -o wide column 7 is the NODE NAME (hostname), not IP.
  # We resolve node name -> InternalIP via a separate kubectl get node call.
  local pattern="$1"
  local ns="${2:-$NAMESPACE}"

  # Step 1: get the node NAME from the pod listing
  local node_name
  node_name=$(kubectl get pod -n "$ns" -o wide 2>/dev/null \\
    | grep "$pattern" \\
    | awk \'{print $7}\' \\
    | head -1)

  if [ -z "$node_name" ] || [ "$node_name" = "<none>" ]; then
    echo ""
    return 0
  fi

  # Step 2: resolve node name -> InternalIP
  kubectl get node "$node_name" \\
    -o jsonpath=\'{.status.addresses[?(@.type=="InternalIP")].address}\' 2>/dev/null \\
    || echo ""
}''',
        'deploy-script: fix get_eks_node_ip_for_pod to resolve hostname -> IP',
    ),

    # Fix 2b: chmod 600 -> chmod 644 for /etc/mcp-agent.env
    (
        'sudo chmod 600 /etc/mcp-agent.env\necho \'Wrote /etc/mcp-agent.env\'',
        'sudo chmod 644 /etc/mcp-agent.env\nsudo chown root:root /etc/mcp-agent.env\necho \'Wrote /etc/mcp-agent.env\'',
        'deploy-script: chmod 644 (not 600) so docker --env-file can read it',
    ),

    # Fix 2c: restart-mcp-agent script — add sudo to all docker commands
    (
        '''echo "Restarting mcp-agent..."
docker stop mcp-agent 2>/dev/null || true
docker rm   mcp-agent 2>/dev/null || true
docker run -d \\''',
        '''echo "Restarting mcp-agent..."
sudo docker stop mcp-agent 2>/dev/null || true
sudo docker rm   mcp-agent 2>/dev/null || true
sudo docker run -d \\''',
        'deploy-script: restart-mcp-agent uses sudo docker throughout',
    ),

    # Fix 2d: restart-mcp-agent docker ps line
    (
        "docker ps --filter name=mcp-agent --format 'table {{.Names}}\\t{{.Status}}'",
        "sudo docker ps --filter name=mcp-agent --format 'table {{.Names}}\\t{{.Status}}'",
        'deploy-script: restart-mcp-agent docker ps -> sudo docker ps',
    ),

    # Fix 2e: systemd ExecStop full path
    (
        'ExecStop=docker stop mcp-agent',
        'ExecStop=/usr/bin/docker stop mcp-agent',
        'deploy-script: systemd ExecStop uses full /usr/bin/docker path',
    ),

    # Fix 2f: build+start block sudo docker
    (
        'docker build -t mcp-agent:latest . 2>&1 | tail -3\n\n# Use the installed restart script (reads from /etc/mcp-agent.env)\necho "  Starting container via restart-mcp-agent..."\n/usr/local/bin/restart-mcp-agent',
        'sudo docker build -t mcp-agent:latest . 2>&1 | tail -3\n\n# Use the installed restart script (reads from /etc/mcp-agent.env)\necho "  Starting container via restart-mcp-agent..."\nsudo /usr/local/bin/restart-mcp-agent',
        'deploy-script: build+start block uses sudo docker',
    ),

    # Fix 2g: verify env vars inside container
    (
        'docker exec mcp-agent env | grep -E "REDIS_HOST|KAFKA_BOOTSTRAP|OPENAI_BASE_URL" | sort',
        'sudo docker exec mcp-agent env | grep -E "REDIS_HOST|KAFKA_BOOTSTRAP|OPENAI_BASE_URL" | sort',
        'deploy-script: docker exec -> sudo docker exec',
    ),

    # Fix 2h: docker logs in start block
    (
        "docker logs mcp-agent --tail 5",
        "sudo docker logs mcp-agent --tail 5",
        'deploy-script: docker logs -> sudo docker logs',
    ),

    # Fix 2i: log_done hint messages
    (
        'log_done "/etc/mcp-agent.env written (chmod 600 — readable by docker)"',
        'log_done "/etc/mcp-agent.env written (chmod 644 — readable by docker)"',
        'deploy-script: update log message to reflect chmod 644',
    ),
]

patch_file(DEPLOY_FILE, deploy_patches, "deploy-script.sh")


# =============================================================================
# Summary
# =============================================================================
print("\n" + "="*60)
if errors:
    print("ERRORS:")
    for e in errors:
        print(e)
    sys.exit(1)
else:
    print("All patches applied. Now run:")
    print()
    print("  git add mcp-agent/agents/nodes.py scripts/deploy-script.sh")
    print('  git commit -m "fix: user_query->message in nodes, chmod 644 env file, sudo docker, SG node IP resolution"')
    print("  git push")