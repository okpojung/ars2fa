import { CheckCircleFilled } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Select, Space, Typography, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../../shared/api/client';
import { useAuthStore } from '../../shared/auth/authStore';
import { runArsPopup } from '../../shared/ars/popup';
import { FAIL_REASON_LABEL } from '../admin/AdminDashboardPage';

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};
declare global { interface Window { turnstile?: TurnstileApi } }

const SCRIPT_ID = 'cf-turnstile-script';
const PREFIXES = ['010', '011', '016', '017', '018', '019'];

/** Loads the Turnstile script once (explicit rendering). */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    let s = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!s) {
      s = document.createElement('script');
      s.id = SCRIPT_ID;
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      document.head.appendChild(s);
    }
    s.addEventListener('load', () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile'))));
    s.addEventListener('error', () => reject(new Error('turnstile')));
  });
}

export function SignupPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [cfg, setCfg] = useState<{ turnstileSiteKey: string | null; phoneVerify: boolean } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // phone check
  const [prefix, setPrefix] = useState('010');
  const [rest, setRest] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneSession, setPhoneSession] = useState<string | null>(null);
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null);
  const [phoneMsg, setPhoneMsg] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get('/auth/config').then((r) => setCfg({ turnstileSiteKey: r.data?.turnstileSiteKey ?? null, phoneVerify: !!r.data?.phoneVerify }))
      .catch(() => setCfg({ turnstileSiteKey: null, phoneVerify: false }));
  }, []);

  const siteKey = cfg?.turnstileSiteKey;
  useEffect(() => {
    if (!siteKey || !box.current) return;
    let cancelled = false;
    loadTurnstile().then((ts) => {
      if (cancelled || !box.current || widgetId.current) return;
      widgetId.current = ts.render(box.current, {
        sitekey: siteKey, language: 'ko', action: 'signup', theme: 'light', size: 'flexible',
        callback: (t: string) => setToken(t),
        'expired-callback': () => setToken(null),
        'error-callback': () => { setToken(null); setLoadError(true); },
      });
    }).catch(() => setLoadError(true));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  const resetTurnstile = () => { if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current); setToken(null); };
  const phoneOk = /^[0-9]{7,8}$/.test(rest);
  const needPhone = !!cfg?.phoneVerify;
  const needBot = !!siteKey;

  function verifyPhone() {
    if (needBot && !token) { message.warning('먼저 자동가입 방지 확인을 완료해 주세요.'); return; }
    setPhoneBusy(true); setPhoneMsg(null);
    const usedToken = token;
    runArsPopup(async () => (await apiClient.post('/auth/phone/start', { countryCode: '82', phone: `${prefix}${rest}`, turnstileToken: usedToken ?? undefined })).data)
      .then((r) => {
        if (r.status === 'VERIFIED' && r.sessionId) {
          setPhoneSession(r.sessionId); setPhoneMasked(r.phoneMasked ?? null);
        } else {
          setPhoneMsg(r.message ?? FAIL_REASON_LABEL[r.reason ?? ''] ?? '휴대폰 인증을 하지 못했습니다. 다시 시도해 주세요.');
        }
      })
      .finally(() => { setPhoneBusy(false); resetTurnstile(); }); // a Turnstile token is single use
  }

  async function onFinish(values: Record<string, string>) {
    if (needPhone && !phoneSession) { message.warning('담당자 휴대폰 인증을 완료해 주세요.'); return; }
    if (!needPhone && needBot && !token) { message.warning('자동가입 방지 확인을 완료해 주세요.'); return; }
    setBusy(true);
    try {
      const { data } = await apiClient.post('/auth/signup', {
        ...values, contactPhone: `${prefix}${rest}`,
        ...(needPhone ? { phoneSessionId: phoneSession } : token ? { turnstileToken: token } : {}),
      });
      setSession(data.accessToken, { ...data.user, kind: 'user' });
      navigate('/console');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '회원 가입 실패');
      if (!needPhone) resetTurnstile();
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = cfg !== null && phoneOk && (needPhone ? !!phoneSession : !needBot || !!token);

  return (
    <div style={{ maxWidth: 560, margin: '40px auto' }}>
      <Card>
        <Typography.Title level={3}><Link to="/" style={{ color: '#1d4ed8' }}>ARS2FA</Link> 회원 가입</Typography.Title>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="email" label="이메일" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="비밀번호" rules={[{ required: true, message: '비밀번호를 입력하세요.' }, { pattern: /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9\s])\S{8,64}$/, message: '8자 이상, 영문·숫자·특수문자를 모두 포함하세요.' }]}
            extra="8자 이상, 영문 + 숫자 + 특수문자 조합">
            <Input.Password />
          </Form.Item>
          <Form.Item name="companyName" label="회사명" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="businessNumber" label="사업자등록번호">
            <Input />
          </Form.Item>
          <Form.Item name="contactName" label="담당자명" rules={[{ required: true }]}>
            <Input />
          </Form.Item>

          {needBot && (
            <Form.Item label="자동가입 방지" required extra={token ? undefined : '확인이 끝나면 다음 단계로 진행할 수 있습니다.'}>
              <div ref={box} style={{ minHeight: 65 }} />
              {loadError && <Alert type="error" showIcon message="자동가입 방지 확인을 불러오지 못했습니다. 새로고침해 주세요." />}
            </Form.Item>
          )}

          <Form.Item label={needPhone ? '담당자 휴대폰 (ARS 인증)' : '담당자 휴대폰'} required
            extra={needPhone && !phoneSession ? '[휴대폰 인증]을 누르면 팝업 창에서 QR을 찍어 전화를 걸고, 팝업에 나오는 숫자를 휴대폰 키패드로 누릅니다.' : undefined}>
            <Space wrap>
              <Select value="82" disabled style={{ width: 96 }} options={[{ value: '82', label: '+82' }]} />
              <Select value={prefix} onChange={setPrefix} disabled={!!phoneSession} style={{ width: 86 }} options={PREFIXES.map((p) => ({ value: p, label: p }))} />
              <Input value={rest} onChange={(e) => setRest(e.target.value.replace(/\D/g, '').slice(0, 8))} disabled={!!phoneSession}
                placeholder="나머지 7~8자리" inputMode="numeric" style={{ width: 150 }} status={rest && !phoneOk ? 'error' : undefined} />
              {needPhone && !phoneSession && (
                <Button onClick={verifyPhone} loading={phoneBusy} disabled={!phoneOk || (needBot && !token)}>휴대폰 인증</Button>
              )}
              {phoneSession && (
                <>
                  <Typography.Text type="success"><CheckCircleFilled /> 인증 완료 {phoneMasked}</Typography.Text>
                  <Button size="small" onClick={() => { setPhoneSession(null); setPhoneMasked(null); }}>번호 변경</Button>
                </>
              )}
            </Space>
            {phoneMsg && <Alert type="error" showIcon style={{ marginTop: 8 }} message={phoneMsg} />}
          </Form.Item>

          <Button type="primary" htmlType="submit" block loading={busy} disabled={!canSubmit}>
            가입하기
          </Button>
        </Form>
        <Typography.Paragraph style={{ marginTop: 16 }}>
          이미 계정이 있나요? <Link to="/login">로그인</Link>
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
