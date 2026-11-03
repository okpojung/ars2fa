import { Alert, Button, Card, Grid, Input, Result, Typography } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, LoadingOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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

/** Same practical syntax check as the server (local@domain.tld). */
function emailFormatOk(e: string) {
  if (e.length > 254) return false;
  const m = /^([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64})@([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)$/.exec(e);
  return !!m && !m[1].startsWith('.') && !m[1].endsWith('.') && !m[1].includes('..') && /\.[A-Za-z]{2,}$/.test(m[2]);
}

type EmailState = { s: 'empty' | 'format' | 'checking' | 'ok' | 'bad'; msg?: string };
const EMAIL_REASON: Record<string, string> = {
  format: '이메일 주소 형식이 올바르지 않습니다.',
  domain: '존재하지 않는 도메인입니다. @ 뒤 주소를 확인해 주세요.',
  no_mail_server: '이 도메인은 메일을 받지 않습니다.',
};

function Check({ ok, busy, label }: { ok: boolean | null; busy?: boolean; label: string }) {
  const icon = busy ? <LoadingOutlined style={{ color: '#1677ff' }} />
    : ok === true ? <CheckCircleFilled style={{ color: '#52c41a' }} />
    : ok === false ? <CloseCircleFilled style={{ color: '#ff4d4f' }} />
    : <MinusCircleOutlined style={{ color: '#bfbfbf' }} />;
  return <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, lineHeight: '24px' }}>{icon}<span>{label}</span></div>;
}

/**
 * Public test page /form_test (PC and phone browsers): contact form with email format + domain check and a phone
 * verified by the web widget (popup). [메일 보내기] turns on when everything is filled in and verified; the server
 * confirms the verification (one use) and sends the mail.
 */
export function FormTestPage() {
  const screens = Grid.useBreakpoint();
  const narrow = !screens.sm;
  const box = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const widget = useRef<{ reset: () => void } | null>(null);
  const [cfg, setCfg] = useState<{ siteKey: string; mailEnabled: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [em, setEm] = useState<EmailState>({ s: 'empty' });
  const [msg, setMsg] = useState('');
  const [phone, setPhone] = useState<{ ok: boolean; masked?: string | null }>({ ok: false });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);

  useEffect(() => {
    document.title = '문의하기 · ARS2FA 휴대폰 인증 시험';
    let alive = true;
    (async () => {
      try {
        const { data } = await apiClient.get('/public/form-test/config');
        setCfg(data);
        const w = await loadWidget();
        if (!alive || !box.current) return;
        widget.current = w.render(box.current, {
          siteKey: data.siteKey, purpose: '문의하기',
          onVerified: (r: { phoneMasked?: string | null }) => setPhone({ ok: true, masked: r?.phoneMasked ?? null }),
          onReset: () => setPhone({ ok: false }), onFailed: () => setPhone({ ok: false }),
        });
      } catch (e) { setErr(`화면을 준비하지 못했습니다. (${(e as Error).message})`); }
    })();
    return () => { alive = false; };
  }, [result]);

  // email: format right away, then the domain on the server (after typing stops)
  useEffect(() => {
    const v = email.trim();
    if (!v) { setEm({ s: 'empty' }); return; }
    if (!emailFormatOk(v)) { setEm({ s: 'format', msg: EMAIL_REASON.format }); return; }
    setEm({ s: 'checking' });
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const { data } = await apiClient.post('/public/form-test/check-email', { email: v });
        if (alive) setEm(data.ok ? { s: 'ok', msg: `${data.domain} 메일 서버 확인됨` } : { s: 'bad', msg: EMAIL_REASON[data.reason] ?? '이메일 주소를 확인해 주세요.' });
      } catch { if (alive) setEm({ s: 'bad', msg: '도메인을 확인하지 못했습니다. 잠시 후 다시 입력해 주세요.' }); }
    }, 600);
    return () => { alive = false; clearTimeout(t); };
  }, [email]);

  const nameOk = name.trim().length > 0 && name.trim().length <= 40;
  const msgOk = msg.trim().length >= 5 && msg.length <= 2000;
  const allOk = nameOk && em.s === 'ok' && phone.ok && msgOk;

  async function send() {
    const sid = (formRef.current?.querySelector('input[name="ars2fa_session"]') as HTMLInputElement | null)?.value;
    if (!allOk || !sid) return;
    setSending(true); setSendErr(null);
    try {
      const { data } = await apiClient.post('/public/form-test/send', { name: name.trim(), email: email.trim(), message: msg.trim(), session_id: sid });
      setPhone({ ok: false }); // one verification = one mail
      setResult(data);
    } catch (e: any) {
      const m = e?.response?.data?.message;
      setSendErr(Array.isArray(m) ? m.join(', ') : m || (e as Error).message);
      if (e?.response?.data?.code === 'PHONE_NOT_VERIFIED') { widget.current?.reset(); setPhone({ ok: false }); }
    } finally { setSending(false); }
  }

  function again() {
    setResult(null); setMsg(''); setSendErr(null);
  }

  const label = (t: string, sub?: string) => (
    <div style={{ fontWeight: 600, margin: '18px 0 6px', fontSize: 15 }}>{t}{sub && <span style={{ fontWeight: 400, color: '#888', fontSize: 13 }}> {sub}</span>}</div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#f5f7fb' }}>
      <div style={{ background: '#0b1730', color: '#fff', padding: narrow ? '12px 16px' : '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link to="/" style={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>ARS2FA</Link>
        <span style={{ fontSize: 13, opacity: 0.8 }}>문의 폼 시험</span>
      </div>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: narrow ? 12 : 24 }}>
        <Card styles={{ body: { padding: narrow ? 16 : 28 } }}>
          <Typography.Title level={narrow ? 4 : 3} style={{ marginTop: 0 }}>문의하기</Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
            모든 항목을 입력하고 휴대폰 인증을 마치면 [메일 보내기]가 켜집니다. PC에서는 QR을, 휴대폰 브라우저에서는 [전화 걸기]를 씁니다.
          </Typography.Paragraph>
          {err && <Alert type="error" showIcon message={err} style={{ marginTop: 12 }} />}
          {cfg && !cfg.mailEnabled && <Alert type="warning" showIcon style={{ marginTop: 12 }} message="메일 발송 설정 전입니다. 휴대폰 인증과 서버 확인까지 시험하고, 메일은 보내지 않습니다." />}

          {result ? (
            <Result status={result.sent ? 'success' : 'info'} style={{ padding: '32px 0 8px' }}
              title={result.sent ? '메일을 보냈습니다' : '서버 확인 완료 (메일 발송 설정 전)'}
              subTitle={<>
                <div>휴대폰 인증: {result.phone_masked}</div>
                {result.sent && <div>받는 사람: {(result.to as string[]).join(', ')}</div>}
                <div style={{ fontSize: 12, marginTop: 4 }}>인증 번호 {result.session_id}</div>
              </>}
              extra={<Button type="primary" onClick={again}>새 문의 작성</Button>} />
          ) : (
            <form ref={formRef} onSubmit={(e) => { e.preventDefault(); void send(); }}>
              {label('이름')}
              <Input size="large" value={name} maxLength={40} placeholder="홍길동" onChange={(e) => setName(e.target.value)} autoComplete="name" />

              {label('이메일', '(답변 받을 주소)')}
              <Input size="large" type="email" inputMode="email" autoComplete="email" value={email} placeholder="name@example.com"
                status={em.s === 'format' || em.s === 'bad' ? 'error' : undefined}
                suffix={em.s === 'checking' ? <LoadingOutlined /> : em.s === 'ok' ? <CheckCircleFilled style={{ color: '#52c41a' }} /> : <span />}
                onChange={(e) => setEmail(e.target.value.replace(/\s/g, ''))} />
              {em.msg && <div style={{ fontSize: 13, marginTop: 4, color: em.s === 'ok' ? '#389e0d' : em.s === 'checking' ? '#888' : '#cf1322' }}>{em.msg}</div>}

              {label('연락처', '(휴대폰 인증 필수)')}
              <div ref={box} className="form-test-widget" />
              {phone.ok && <div style={{ fontSize: 13, marginTop: 4, color: '#389e0d' }}>인증 완료 {phone.masked ?? ''}</div>}

              {label('문의 내용', `(${msg.length}/2000)`)}
              <Input.TextArea value={msg} rows={narrow ? 5 : 4} maxLength={2000} placeholder="문의 내용을 5자 이상 입력하세요." onChange={(e) => setMsg(e.target.value)} />

              <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, padding: '10px 14px', margin: '18px 0 14px' }}>
                <Check ok={name ? nameOk : null} label="이름" />
                <Check ok={em.s === 'empty' ? null : em.s === 'ok'} busy={em.s === 'checking'} label="이메일 형식 · 도메인" />
                <Check ok={phone.ok ? true : null} label="휴대폰 인증" />
                <Check ok={msg ? msgOk : null} label="문의 내용 (5자 이상)" />
              </div>
              {sendErr && <Alert type="error" showIcon message={sendErr} style={{ marginBottom: 12 }} />}
              <Button type="primary" size="large" htmlType="submit" disabled={!allOk} loading={sending} block={narrow} style={narrow ? undefined : { minWidth: 160 }}>
                메일 보내기
              </Button>
              {!allOk && !narrow && <Typography.Text type="secondary" style={{ marginLeft: 12 }}>모든 항목을 채우고 휴대폰 인증을 마치면 켜집니다.</Typography.Text>}
            </form>
          )}
        </Card>
        <div style={{ textAlign: 'center', color: '#999', fontSize: 12, margin: '16px 0' }}>ARS2FA 웹 위젯 시험 화면 · (주)이지트론</div>
      </div>
      <style>{`.form-test-widget .ars2fa-widget select,.form-test-widget .ars2fa-widget input,.form-test-widget .ars2fa-widget button{font-size:16px;height:40px;border:1px solid #d9d9d9;border-radius:6px;background:#fff}
.form-test-widget .ars2fa-widget button{background:#1677ff;color:#fff;border-color:#1677ff;padding:0 14px}
.form-test-widget .ars2fa-widget input{flex:1 1 8em;min-width:7em}`}</style>
    </div>
  );
}
