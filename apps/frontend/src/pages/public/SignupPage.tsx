import { Alert, Button, Card, Form, Input, Typography, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../../shared/api/client';
import { useAuthStore } from '../../shared/auth/authStore';

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};
declare global { interface Window { turnstile?: TurnstileApi } }

const SCRIPT_ID = 'cf-turnstile-script';

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
  const [siteKey, setSiteKey] = useState<string | null | undefined>(undefined);
  const [token, setToken] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    apiClient.get('/auth/config').then((r) => setSiteKey(r.data?.turnstileSiteKey ?? null)).catch(() => setSiteKey(null));
  }, []);

  useEffect(() => {
    if (!siteKey || !box.current) return;
    let cancelled = false;
    loadTurnstile().then((ts) => {
      if (cancelled || !box.current || widgetId.current) return;
      widgetId.current = ts.render(box.current, {
        sitekey: siteKey, language: 'ko', action: 'signup', theme: 'light',
        callback: (t: string) => setToken(t),
        'expired-callback': () => setToken(null),
        'error-callback': () => setToken(null),
      });
    }).catch(() => setLoadError(true));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  const needCheck = !!siteKey;
  async function onFinish(values: Record<string, string>) {
    if (needCheck && !token) { message.warning('자동가입 방지 확인을 완료해 주세요.'); return; }
    setBusy(true);
    try {
      const { data } = await apiClient.post('/auth/signup', { ...values, ...(token ? { turnstileToken: token } : {}) });
      setSession(data.accessToken, { ...data.user, kind: 'user' });
      navigate('/console');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '회원 가입 실패');
      // a token can be used only once
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
      setToken(null);
    } finally {
      setBusy(false);
    }
  }

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
          <Form.Item name="contactPhone" label="담당자 연락처" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          {needCheck && (
            <Form.Item label="자동가입 방지">
              <div ref={box} style={{ minHeight: 65 }} />
              {loadError && <Alert type="error" showIcon message="확인 화면을 불러오지 못했습니다. 새로고침해 주세요." />}
            </Form.Item>
          )}
          <Button type="primary" htmlType="submit" block loading={busy} disabled={siteKey === undefined || (needCheck && !token)}>
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
