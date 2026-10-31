#!/bin/bash
# Deploys /opt/ars2fa/src.tar (+ web.tar): DB migrations, backend image/container, admin web.
# Secrets: /opt/ars2fa/.env (app) and optional /opt/ars2fa/callmix.env (CALLMIX_ID/CALLMIX_PW), both 600 root.
set -euo pipefail
cd /opt/ars2fa
rm -rf src && mkdir src && tar -xf src.tar -C src
if [ -f web.tar ]; then rm -rf /var/www/ars2fa.new && mkdir -p /var/www/ars2fa.new && tar -xf web.tar -C /var/www/ars2fa.new && rm -rf /var/www/ars2fa && mv /var/www/ars2fa.new /var/www/ars2fa && chmod -R a+rX /var/www/ars2fa; fi
DBURL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
docker run --rm --network host -v /opt/ars2fa/src:/app -v ars2fa-nm:/app/node_modules -w /app -e DATABASE_URL="$DBURL" node:22-alpine sh -c '
  set -e
  [ -f node_modules/.ok ] && cmp -s package-lock.json node_modules/.ok || { npm ci --no-audit --no-fund >/tmp/npm.log 2>&1 || { tail -20 /tmp/npm.log; exit 1; }; cp package-lock.json node_modules/.ok; }
  cd apps/backend && npx prisma migrate deploy 2>&1 | grep -E "applied|No pending|Error|error" || true'
unset DBURL
(cd src && docker build -q -t ars2fa-backend:stg -f apps/backend/Dockerfile . | tail -1)
/opt/ars2fa/run-backend.sh
