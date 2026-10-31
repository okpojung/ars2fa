#!/usr/bin/env python3
"""Initial pool stop: sets every DYNAMIC pool number to forwarding OFF (linkYn=n, coloring/comment 0,
rn = its assigned SKB 070, shopName ARS인증) through CallMix vnMapping, one at a time.
usage: callmix-bulk-off.py LOGFILE [LIMIT] [--only VN,VN]   (credentials from /opt/ars2fa/callmix.env)"""
import json, subprocess, sys, time, urllib.parse, urllib.request
env = dict(l.rstrip('\n').split('=', 1) for l in open('/opt/ars2fa/callmix.env') if '=' in l)
log = sys.argv[1]; limit = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 10**6
only = set(sys.argv[sys.argv.index('--only') + 1].split(',')) if '--only' in sys.argv else None
done = set()
try:
    for l in open(log):
        j = json.loads(l)
        if j.get('resCd') == 'SUCCESS': done.add(j['vn'])
except FileNotFoundError: pass
rows = subprocess.run(['docker', 'exec', 'ars2fa-postgres', 'psql', '-U', 'ars2fa', '-d', 'ars2fa', '-tAc',
    "SELECT vn||','||rn FROM \"VirtualNumber\" WHERE routing='DYNAMIC' ORDER BY ordinal"], capture_output=True, text=True, check=True).stdout.split()
todo = [r.split(',') for r in rows if r.split(',')[0] not in done and (only is None or r.split(',')[0] in only)][:limit]
ok = fail = 0
with open(log, 'a') as out:
    for vn, rn in todo:
        body = urllib.parse.urlencode({'id': env['CALLMIX_ID'], 'pw': env['CALLMIX_PW'], 'vn': vn, 'rn': rn, 'linkYn': 'n',
            'shopName': 'ARS인증', 'colorRing': '0', 'callMent': '0'}).encode()
        t = time.time()
        try:
            req = urllib.request.Request('https://m.callmix.co.kr/cmxapi/vnMapping', data=body,
                headers={'content-type': 'application/x-www-form-urlencoded; charset=utf-8'})
            j = json.loads(urllib.request.urlopen(req, timeout=10).read().decode('utf-8'))
            res = {'resCd': j.get('resCd'), 'resMsg': j.get('resMsg')}
        except Exception as e:
            res = {'resCd': 'ERROR', 'resMsg': str(e)[:200]}
        res.update(vn=vn, rn=rn, ms=int((time.time() - t) * 1000), at=time.strftime('%H:%M:%S'))
        out.write(json.dumps(res, ensure_ascii=False) + '\n'); out.flush()
        if res['resCd'] == 'SUCCESS': ok += 1
        else: fail += 1
        if res['resMsg'] and '패스워드' in res['resMsg']: print('LOGIN FAILED, stop'); break
        time.sleep(0.5)
print(json.dumps({'sent': ok + fail, 'success': ok, 'failed': fail, 'already_done': len(done)}))
