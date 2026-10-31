#!/bin/bash
# usage: echo PASSWORD | callmix-setup.sh [ID]   (password via stdin only)
# Checks the CallMix login against a number that is NOT in the account (050700000000), so no setting changes,
# then stores CALLMIX_ID/CALLMIX_PW in /opt/ars2fa/callmix.env (600 root) and restarts the backend.
set -euo pipefail
ID="${1:-baros7}"
if [ -t 0 ]; then IFS= read -rsp "CallMix password: " PW; echo; else IFS= read -r PW; fi; PW="${PW%$'\r'}"
[ -n "$PW" ] || { echo "empty password"; exit 2; }
case "$PW" in *$'\n'*) echo "bad password"; exit 2;; esac
RES=$(printf 'id=%s&vn=050700000000&rn=07051901900&linkYn=n&colorRing=0&callMent=0&pw=' "$ID" | cat - <(printf '%s' "$PW" | python3 -c 'import sys,urllib.parse;sys.stdout.write(urllib.parse.quote(sys.stdin.read(),safe=""))') \
  | curl -s -m 15 -X POST https://m.callmix.co.kr/cmxapi/vnMapping -H 'content-type: application/x-www-form-urlencoded; charset=utf-8' --data-binary @-)
MSG=$(printf '%s' "$RES" | python3 -c 'import sys,json;j=json.load(sys.stdin);print(j.get("resCd",""),j.get("resMsg",""))' 2>/dev/null || echo "BAD_RESPONSE")
if printf '%s' "$MSG" | grep -q "패스워드가 틀렸"; then unset PW; echo "WRONG_PASSWORD"; exit 3; fi
if [ "$MSG" = "BAD_RESPONSE" ] || [ -z "$MSG" ]; then unset PW; echo "CALLMIX_UNREACHABLE"; exit 4; fi
umask 077
printf 'CALLMIX_ID=%s\nCALLMIX_PW=%s\n' "$ID" "$PW" > /opt/ars2fa/callmix.env.new
unset PW
chmod 600 /opt/ars2fa/callmix.env.new && mv /opt/ars2fa/callmix.env.new /opt/ars2fa/callmix.env
echo "LOGIN_OK (check reply: $MSG)"
/opt/ars2fa/run-backend.sh >/opt/ars2fa/last-restart.log 2>&1 && tail -1 /opt/ars2fa/last-restart.log
