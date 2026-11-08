import { Alert, Button, Card, Form, Input, Result, Typography, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../../shared/api/client';

type Ars2fa = { render: (el: HTMLElement, opts: Record<string, unknown>) => { reset: () => void } };
declare global { interface Window { ARS2FA?: Ars2fa } }

function loadWidget(): Promise<Ars2fa> {
  if (window.ARS2FA) return Promise.resolve(window.ARS2FA);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/widget.js';
    s.onload = () => (window.ARS2FA ? resolve(window.ARS2FA) : reject(new Error('widget')));
    s.onerror = () => reject(new Error('widget'));
    document.head.appendChild(s);
  });
}

/** "문의하기" example: the send button turns on only after phone verification through the popup widget. */
export function WidgetDemo() {
  const box = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [verified, setVerified] = useState(false);
  const [checked, setChecked] = useState<Record<string, any> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await apiClient.get('/admin/ars/test/widget-site');
        const w = await loadWidget();
        if (!alive || !box.current) return;
        w.render(box.current, {
          siteKey: data.siteKey, purpose: '문의하기',
          onVerified: () => setVerified(true), onReset: () => setVerified(false), onFailed: () => setVerified(false),
        });
      } catch (e) { setErr((e as Error).message); }
    })();
    return () => { alive = false; };
  }, []);

  async function send() {
    const sid = (formRef.current?.querySelector('input[name="ars2fa_session"]') as HTMLInputElement | null)?.value;
    if (!sid) { message.warning('휴대폰 인증을 먼저 해 주세요.'); return; }
    // what a customer server does before sending the mail: confirm with the secret key, one use only
    const { data } = await apiClient.post('/admin/ars/test/widget-verify', { session_id: sid, consume: true });
    setChecked(data);
  }

  return (
    <Card title="웹 위젯 예제: 문의하기 (휴대폰 인증 후 메일 보내기)">
      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}
      <Alert type="info" showIcon style={{ marginBottom: 16 }}
        message="고객 사이트에 widget.js 한 줄을 넣은 것과 같은 화면입니다. [휴대폰 인증]을 누르면 팝업에서 QR → 전화 → 인증번호 입력까지 진행되고, 인증되면 [메일 보내기]가 켜집니다." />
      <form ref={formRef} onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <Form layout="vertical" component={false}>
          <Form.Item label="이름"><Input placeholder="홍길동" /></Form.Item>
          <Form.Item label="연락처 (휴대폰 인증 필수)"><div ref={box} /></Form.Item>
          <Form.Item label="문의 내용"><Input.TextArea rows={3} placeholder="문의 내용을 입력하세요." /></Form.Item>
          <Button type="primary" htmlType="submit" disabled={!verified}>메일 보내기</Button>
          {!verified && <Typography.Text type="secondary" style={{ marginLeft: 12 }}>휴대폰 인증을 마치면 켜집니다.</Typography.Text>}
        </Form>
      </form>
      {checked && (
        <Result style={{ paddingBottom: 0 }} status={checked.verified ? 'success' : 'warning'}
          title={checked.verified ? '서버 확인 완료 — 이 시점에 메일을 보냅니다 (시험이라 실제 발송은 생략)' : `서버 확인 실패: ${checked.reason}`}
          subTitle={checked.verified ? `인증된 휴대폰 ${checked.phone_masked} · 요청 사이트 ${checked.origin}` : '같은 인증으로 두 번 보낼 수 없습니다(1회용).'} />
      )}
    </Card>
  );
}
