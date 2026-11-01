import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

type DialInfo = { state: 'READY' | 'CONNECTED' | 'DONE' | 'EXPIRED' | 'CLOSED' | 'NOT_FOUND'; display_name?: string; expires_at?: string; tel?: string; server_time?: string };

/**
 * Opened on the phone from the PC-mode QR code. Shows what this is and a call button; the 0507 number itself is
 * only inside the button (tel: link) and disappears as soon as the call window closes.
 */
export function MobileDialPage() {
  const { token } = useParams();
  const [info, setInfo] = useState<DialInfo | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);

  // report what the phone shows about itself once (screen, timezone, language, model via UA client hints)
  useEffect(() => {
    if (!token) return;
    (async () => {
      const extra: Record<string, string | undefined> = {
        screen: `${window.screen.width}x${window.screen.height}`,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone, lang: navigator.language,
      };
      try {
        const uad = (navigator as unknown as { userAgentData?: { getHighEntropyValues: (k: string[]) => Promise<Record<string, string>> } }).userAgentData;
        if (uad) { const v = await uad.getHighEntropyValues(['model', 'platformVersion']); extra.model = v.model || undefined; extra.platformVersion = v.platformVersion || undefined; }
      } catch { /* not available */ }
      fetch(`${import.meta.env.VITE_API_BASE_URL ?? '/api'}/public/ars/dial/${encodeURIComponent(token)}/device`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(extra),
      }).catch(() => undefined);
    })();
  }, [token]);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? '/api'}/public/ars/dial/${encodeURIComponent(token ?? '')}`);
        const j = (await r.json()) as DialInfo;
        if (!stop) { if (j.server_time) setOffset(new Date(j.server_time).getTime() - Date.now()); setInfo(j); }
      } catch {
        if (!stop) setInfo({ state: 'NOT_FOUND' });
      }
    };
    void load();
    const t = setInterval(load, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [token]);

  useEffect(() => {
    if (!info?.expires_at || info.state !== 'READY') { setLeft(null); return; }
    // server clock, so the phone and the PC show the same seconds
    const tick = () => setLeft(Math.max(0, Math.floor((new Date(info.expires_at!).getTime() - (Date.now() + offset)) / 1000)));
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [info, offset]);

  const ready = info?.state === 'READY' && (left ?? 1) > 0;
  const box: React.CSSProperties = { maxWidth: 480, margin: '0 auto', padding: '32px 20px', fontFamily: 'system-ui, -apple-system, "Malgun Gothic", sans-serif', color: '#1f1f1f' };

  return (
    <div style={{ minHeight: '100vh', background: '#f5f7fb' }}>
      <div style={box}>
        <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 18 }}>발신 ARS 인증</div>
        {!info && <p>불러오는 중…</p>}
        {info && ready && (
          <>
            <p style={{ fontSize: 17, lineHeight: 1.6, background: '#fff', borderRadius: 12, padding: 18, margin: 0 }}>
              이 화면은 발신 ARS 인증 화면입니다.<br />
              ARS 인증을 진행하시려면 아래의 <b>전화걸기</b> 버튼을 눌러 전화번호가 입력되면 <b>즉시 통화 버튼</b>을 눌러 전화를 걸어 인증을 완료하세요.
            </p>
            {info.display_name && <p style={{ color: '#666', marginTop: 12 }}>요청한 서비스: {info.display_name}</p>}
            <a href={info.tel} style={{ display: 'block', textAlign: 'center', marginTop: 24, padding: '18px 0', borderRadius: 12,
              background: '#1677ff', color: '#fff', fontSize: 22, fontWeight: 700, textDecoration: 'none' }}>
              전화걸기
            </a>
            <p style={{ textAlign: 'center', marginTop: 14, color: left !== null && left <= 10 ? '#cf1322' : '#555', fontSize: 16 }}>
              남은 시간 {left ?? '-'}초
            </p>
            <p style={{ color: '#888', fontSize: 14, lineHeight: 1.5, marginTop: 20 }}>
              통화가 연결되면 컴퓨터 화면에 인증번호가 표시됩니다. 그 번호를 휴대폰 키패드로 눌러 주세요.<br />
              본인이 요청한 인증이 아니면 전화를 걸지 마세요.
            </p>
          </>
        )}
        {info && !ready && (
          <p style={{ fontSize: 17, lineHeight: 1.6, background: '#fff', borderRadius: 12, padding: 18 }}>
            {info.state === 'CONNECTED' ? '전화가 연결되었습니다. 컴퓨터 화면의 인증번호를 휴대폰 키패드로 눌러 주세요.'
              : info.state === 'DONE' ? '인증이 완료되었습니다. 이 화면을 닫아도 됩니다.'
              : info.state === 'NOT_FOUND' ? '잘못된 인증 화면 주소입니다.'
              : '인증 시간이 지났거나 이미 끝난 인증입니다. 컴퓨터에서 인증을 다시 시작해 주세요.'}
          </p>
        )}
      </div>
    </div>
  );
}
