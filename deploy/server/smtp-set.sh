#!/bin/bash
# Reads 6 lines on stdin: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, FORM_TEST_MAIL_TO.
# Writes them to /opt/ars2fa/.env (600) and restarts the backend. Prints OK or an error.
set -euo pipefail
python3 - <<'PY'
import sys, re, os
vals = [sys.stdin.readline().rstrip('\r\n') for _ in range(6)]
keys = ['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','MAIL_FROM','FORM_TEST_MAIL_TO']
if not vals[0] or not vals[2] or not vals[3] or not re.fullmatch(r'\d{2,5}', vals[1] or ''):
    print('ERR missing host/port/user/password'); sys.exit(1)
if any('\n' in v for v in vals): print('ERR bad value'); sys.exit(1)
p = '/opt/ars2fa/.env'
lines = [l for l in open(p).read().splitlines() if not any(l.startswith(k + '=') for k in keys)]
lines += [f'{k}={v}' for k, v in zip(keys, vals) if v]
open(p, 'w').write('\n'.join(lines) + '\n'); os.chmod(p, 0o600)
PY
/opt/ars2fa/run-backend.sh >/dev/null 2>&1
curl -sf https://127.0.0.1:9447/api/public/form-test/config -k -H 'Host: ars2fa.baro.me' 2>/dev/null | grep -q '"mailEnabled":true' && echo OK || { curl -sf http://127.0.0.1:3000/api/public/form-test/config | grep -q '"mailEnabled":true' && echo OK || echo 'ERR backend did not pick up the settings'; }