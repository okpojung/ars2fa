import { Button, Progress, QRCode, Result, Spin, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FAIL_REASON_LABEL } from '../admin/AdminDashboardPage';

type PopupState = {
  state: string; session_id?: string; origin?: string | null; display_name?: string; fail_reason?: string | null;
  expires_at?: string; server_time?: string; phone_masked?: string | null; dial_page_url?: string;
  pc_code?: string; code_expires_at?: string | null; code_seconds?: number;
};

/** Seconds left until `iso` on the server clock. */
function useLeft(iso: string | null | undefined, offset: number) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!iso) { setLeft(null); return; }
    const tick = () => setLeft(Math.max(0, Math.floor((new Date(iso).getTime() - (Date.now() + offset)) / 1000)));
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [iso, offset]);
  return left;
}

/** Popup opened by widget.js on a customer site: QR -> code (DTMF on the phone) -> result posted back to the page. */
export function WidgetPopupPage() {
  const { token } = useParams();
  const [d, setD] = useState<PopupState | null>(null);
  const [offset, setOffset] = useState(0);
  const posted = useRef(false);
  const final = d && ['VERIFIED', 'FAILED', 'EXPIRED', 'CANCELED', 'NOT_FOUND'].includes(d.state);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/public/ars/widget/${encodeURIComponent(token ?? '')}`);
        const j = (await r.json()) as PopupState;
        if (stop) return;
        if (j.server_time) setOffset(new Date(j.server_time).getTime() - Date.now());
        setD(j);
      } catch { /* retry on next tick */ }
    };
    void load();
    const t = setInterval(() => { if (!posted.current) void load(); }, 1000);
    return () => { stop = true; clearInterval(t); };
  }, [token]);

  // tell the page (only its registered origin) and close shortly after a final state
  useEffect(() => {
    if (!d || !final || posted.current || d.state === 'NOT_FOUND') return;
    posted.current = true;
    const msg = { type: 'ars2fa:result', status: d.state, sessionId: d.session_id, phoneMasked: d.phone_masked ?? null, reason: d.fail_reason ?? null };
    try { if (window.opener && d.origin) window.opener.postMessage(msg, d.origin); } catch { /* opener gone */ }
    if (d.state === 'VERIFIED') setTimeout(() => window.close(), 2500);
  }, [d, final]);

  const callLeft = useLeft(d?.state === 'PENDING' ? d.expires_at : null, offset);
  const codeLeft = useLeft(d?.state === 'CALL_CONFIRMED' ? d.code_expires_at : null, offset);
  const codeTotal = d?.code_seconds ?? 15;
  const box: React.CSSProperties = { maxWidth: 420, margin: '0 auto', padding: '20px 20px 28px', fontFamily: 'system-ui, "Malgun Gothic", sans-serif', textAlign: 'center' };

  return (
    <div style={box}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>발신 ARS 휴대폰 인증</Typography.Title>
      {d?.display_name && <Typography.Text type="secondary">{d.display_name}</Typography.Text>}
      {!d && <div style={{ padding: 60 }}><Spin /></div>}

      {d?.state === 'PENDING' && d.dial_page_url && (
        <>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '18px 0 12px' }}><QRCode value={d.dial_page_url} size={220} /></div>
          <Typography.Paragraph style={{ fontSize: 15, marginBottom: 6 }}>
            휴대폰 카메라로 QR을 찍고 <b>전화걸기</b>를 누른 뒤, 번호가 입력되면 바로 <b>통화</b>를 누르세요.
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
            전화가 연결되면 이 창에 인증번호가 나타납니다. 그 번호를 휴대폰 키패드로 누르세요.
          </Typography.Paragraph>
          <div style={{ fontSize: 16, color: callLeft !== null && callLeft <= 10 ? '#cf1322' : '#333' }}>남은 시간 {callLeft ?? '-'}초</div>
        </>
      )}

      {d?.state === 'CALL_CONFIRMED' && (
        <>
          <Typography.Paragraph style={{ fontSize: 16, marginTop: 18 }}>휴대폰 키패드로 아래 숫자를 누르세요</Typography.Paragraph>
          <div style={{ fontSize: 60, fontWeight: 700, letterSpacing: 18, fontFamily: 'monospace', margin: '6px 0 18px' }}>{d.pc_code}</div>
          <Progress type="circle" size={100} percent={Math.round(((codeLeft ?? 0) / codeTotal) * 100)} format={() => `${codeLeft ?? 0}초`}
            status={codeLeft !== null && codeLeft <= 5 ? 'exception' : 'active'} />
          <Typography.Paragraph type="secondary" style={{ marginTop: 14, fontSize: 13 }}>{codeTotal}초 안에 누르지 않으면 처음부터 다시 해야 합니다.</Typography.Paragraph>
        </>
      )}

      {d?.state === 'VERIFIED' && <Result status="success" title="휴대폰 인증 완료" subTitle={`${d.phone_masked ?? ''} · 이 창은 곧 닫힙니다.`} />}
      {d && ['FAILED', 'EXPIRED', 'CANCELED'].includes(d.state) && (
        <Result status="error" title="인증하지 못했습니다" subTitle={FAIL_REASON_LABEL[d.fail_reason ?? ''] ?? '다시 시도해 주세요.'}
          extra={<Button onClick={() => window.close()}>닫기</Button>} />
      )}
      {d?.state === 'NOT_FOUND' && <Result status="warning" title="잘못된 인증 창입니다" extra={<Button onClick={() => window.close()}>닫기</Button>} />}
    </div>
  );
}
