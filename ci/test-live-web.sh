#!/usr/bin/env bash
# Host-only DOM/protocol reference checks; not Oreslang guest execution.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
command -v node >/dev/null 2>&1 || { echo 'node required for live-client host gate' >&2; exit 69; }
node --check "$root/web/ores-live.mjs"
node --check "$root/web/ores-live.test.mjs"
node "$root/web/ores-live.test.mjs"
echo 'NOT_EXECUTED: WebSocket server, Oreslang compiler and guest were not invoked'
