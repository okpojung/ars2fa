#!/bin/bash
# usage: echo PASSWORD | admin-passwd.sh EMAIL   -> create SUPER_ADMIN or reset password (stdin only, never argv)
set -euo pipefail
EMAIL="$1"; [[ "$EMAIL" =~ ^[^@[:space:]\']+@[^@[:space:]\']+$ ]] || { echo "bad email"; exit 2; }
if [ -t 0 ]; then IFS= read -rsp "new password (8+ chars, letter+digit+symbol): " PW; echo; else IFS= read -r PW; fi; PW="${PW%$'\r'}"
R_A='[A-Za-z]'; R_D='[0-9]'; R_S='[^A-Za-z0-9[:space:]]'; R_W='[[:space:]]'
if [ ${#PW} -lt 8 ] || [ ${#PW} -gt 64 ] || ! [[ $PW =~ $R_A ]] || ! [[ $PW =~ $R_D ]] || ! [[ $PW =~ $R_S ]] || [[ $PW =~ $R_W ]]; then echo "password rule: 8+ chars, letter+digit+symbol, no spaces"; exit 3; fi
HASH=$(printf '%s' "$PW" | docker run --rm -i -w /app/apps/backend --entrypoint node ars2fa-backend:stg -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(require('bcryptjs').hashSync(d,12)))")
unset PW
[[ "$HASH" == \$2* ]] || { echo "hash failed"; exit 4; }
docker exec -i ars2fa-postgres psql -U ars2fa -d ars2fa -q -v ON_ERROR_STOP=1 -v email="$EMAIL" -v h="$HASH" <<'SQL'
INSERT INTO "AdminUser"(id, email, "passwordHash", name, role, status, "createdAt", "updatedAt")
VALUES (md5(random()::text), :'email', :'h', '대표 관리자', 'SUPER_ADMIN', 'ACTIVE', now(), now())
ON CONFLICT (email) DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", status = 'ACTIVE', "updatedAt" = now();
SQL
echo "OK $EMAIL"
