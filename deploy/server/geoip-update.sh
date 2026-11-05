#!/bin/bash
# DB-IP Lite country + ASN databases (CC BY 4.0, "IP Geolocation by DB-IP", https://db-ip.com).
# Run monthly; keeps the current files if a download fails. The backend reloads changed files by itself.
set -uo pipefail
D=/opt/ars2fa/geoip; mkdir -p "$D"; cd "$D"
for kind in country asn; do
  ok=""
  for m in "$(date +%Y-%m)" "$(date -d '-1 month' +%Y-%m)"; do
    if curl -sf -m 300 -o "tmp-$kind.mmdb.gz" "https://download.db-ip.com/free/dbip-$kind-lite-$m.mmdb.gz" && gunzip -f "tmp-$kind.mmdb.gz" \
       && [ "$(stat -c %s "tmp-$kind.mmdb")" -gt 1000000 ]; then
      mv -f "tmp-$kind.mmdb" "dbip-$kind.mmdb"; ok="$m"; break
    fi
    rm -f "tmp-$kind.mmdb.gz" "tmp-$kind.mmdb"
  done
  echo "$(date '+%F %T') $kind: ${ok:-FAILED (kept previous)}"
done
chmod 644 "$D"/dbip-*.mmdb 2>/dev/null || true
