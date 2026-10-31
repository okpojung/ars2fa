#!/bin/bash
# (Re)starts the backend container with /opt/ars2fa/.env and, if present, /opt/ars2fa/callmix.env.
set -euo pipefail
cd /opt/ars2fa
ENVS=(--env-file .env); [ -f callmix.env ] && ENVS+=(--env-file callmix.env)
docker rm -f ars2fa-backend >/dev/null 2>&1 || true
docker run -d --name ars2fa-backend --restart unless-stopped --network host "${ENVS[@]}" ars2fa-backend:stg >/dev/null
for i in $(seq 1 40); do curl -sf http://127.0.0.1:3000/health >/dev/null 2>&1 && break; sleep 1; done
curl -s http://127.0.0.1:3000/health; echo
docker logs ars2fa-backend 2>&1 | grep -E "CallMix forwarding control" | tail -1 | sed -E 's/.*(CallMix forwarding control.*)/\1/; s/\x1b\[[0-9;]*m//g'
