#!/bin/bash
# Concurrent call monitor for ars2fa (runs on the PBX host as systemd service ars2fa-trunk-monitor).
# Every 2 s counts SKB SIP trunk channels and all Asterisk calls; every 6 s posts current + peak to the backend.
set -uo pipefail
KEY=$(grep '^INTERNAL_API_KEY=' /opt/ars2fa/.env | cut -d= -f2-)
HDR=/run/ars2fa-trunk.hdr; umask 077; printf 'x-internal-key: %s\n' "$KEY" > "$HDR"; unset KEY
TRUNK_PREFIX=${TRUNK_PREFIX:-PJSIP/skb-trunk-}
tp=0; op=0; n=0; maxcalls=""
while true; do
  ch=$(asterisk -rx 'core show channels concise' 2>/dev/null)
  trunk=$(printf '%s\n' "$ch" | grep -c "^${TRUNK_PREFIX}" || true)
  total=$(asterisk -rx 'core show channels count' 2>/dev/null | awk '/active call/{print $1; exit}')
  total=${total:-0}
  (( trunk > tp )) && tp=$trunk; (( total > op )) && op=$total
  n=$((n+1))
  if (( n % 30 == 1 )); then
    maxcalls=$(asterisk -rx 'core show settings' 2>/dev/null | awk -F: '/Maximum calls/{gsub(/[^0-9].*/,"",$2); gsub(/ /,"",$2); print $2; exit}' | tr -dc '0-9')
  fi
  if (( n % 3 == 0 )); then
    curl -s -m 3 -o /dev/null -H @"$HDR" -H 'content-type: application/json' \
      -d "{\"trunk\":$trunk,\"total\":$total,\"trunkPeak\":$tp,\"totalPeak\":$op${maxcalls:+,\"maxcalls\":$maxcalls}}" \
      http://127.0.0.1:3000/internal/pbx/trunk || true
    tp=0; op=0
  fi
  sleep 2
done