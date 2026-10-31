import { Alert, Button, Card, Input, Progress, QRCode, Radio, Result, Select, Space, Statistic, Typography, message } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiClient } from '../../shared/api/client';
import { FAIL_REASON_LABEL } from './AdminDashboardPage';

const PREFIXES = ['010', '011', '016', '017', '018', '019'];

/** Seconds left until an ISO time on the server clock (offsetMs = server - this device), updated 4x a second. */
export function useSecondsLeft(iso?: string | null, offsetMs = 0) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!iso) { setLeft(null); return; }
    const tick = () => setLeft(Math.max(0, Math.floor((new Date(iso).getTime() - (Date.now() + offsetMs)) / 1000)));
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [iso, offsetMs]);
  return left;
}

/** server - device clock difference from a response's server_time (taken when the response arrived). */
export function clockOffset(serverTime?: string | null) {
  return serverTime ? new Date(serverTime).getTime() - Date.now() : 0;
}

export function AdminArsTestPage() {
  const [mode, setMode] = useState<'APP' | 'PC'>('PC');
  const [cc, setCc] = useState('82');
  const [prefix, setPrefix] = useState('010');
  const [rest, setRest] = useState('');
  const [session, setSession] = useState<Record<string, any> | null>(null);
  const [offset, setOffset] = useState(0);

  const phoneOk = /^[0-9]{7,8}$/.test(rest);
  const create = useMutation({
    mutationFn: async () => (await apiClient.post('/admin/ars/test/sessions', {
      mode, country_code: cc, expected_phone: mode === 'PC' || rest ? `${prefix}${rest}` : undefined,
    })).data,
    onSuccess: (d) => { setOffset(clockOffset(d.server_time)); setSession(d); },
    onError: (e) => message.error((e as Error).message),
  });
  const status = useQuery({
    queryKey: ['ars-test', session?.session_id],
    enabled: !!session,
    queryFn: async () => {
      const d = (await apiClient.get(`/admin/ars/test/sessions/${session!.session_id}`)).data;
      setOffset(clockOffset(d.server_time));
      return d;
    },
    refetchInterval: (q) => (['PENDING', 'CALL_CONFIRMED'].includes(q.state.data?.status ?? 'PENDING') ? 1000 : false),
  });
  const st = status.data?.status ?? session?.status;
  const callLeft = useSecondsLeft(st === 'PENDING' ? session?.expires_at : null, offset);
  const codeLeft = useSecondsLeft(st === 'CALL_CONFIRMED' ? status.data?.code_expires_at : null, offset);
  const codeTotal = status.data?.code_seconds ?? 15;

  return (
    <>
      <Typography.Title level={2}>ARS 실통화 시험</Typography.Title>
      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" size="middle">
          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}
            options={[{ value: 'PC', label: 'PC 인증 (QR → 휴대폰으로 전화 → 화면의 인증번호를 휴대폰 키패드로 입력)' }, { value: 'APP', label: '앱 인증 (전화 + 1번)' }]} />
          <Space wrap>
            <span>휴대폰 번호{mode === 'PC' ? '' : ' (선택)'}</span>
            <Select value={cc} onChange={setCc} style={{ width: 110 }} options={[{ value: '82', label: '+82 한국' }]} />
            <Select value={prefix} onChange={setPrefix} style={{ width: 90 }} options={PREFIXES.map((p) => ({ value: p, label: p }))} />
            <Input value={rest} onChange={(e) => setRest(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="나머지 7~8자리" style={{ width: 160 }}
              inputMode="numeric" status={rest && !phoneOk ? 'error' : undefined} />
            <Button type="primary" loading={create.isPending} disabled={mode === 'PC' ? !phoneOk : !!rest && !phoneOk}
              onClick={() => { setSession(null); create.mutate(); }}>인증 시작</Button>
          </Space>
        </Space>
      </Card>
      {session && (
        <Card>
          {st === 'PENDING' && mode === 'PC' && session.dial_page_url && (
            <Space size={40} align="start">
              <QRCode value={session.dial_page_url} size={220} />
              <div>
                <Typography.Title level={4}>휴대폰 카메라로 QR을 찍으세요</Typography.Title>
                <Typography.Paragraph>
                  휴대폰에 "발신 ARS 인증" 화면이 열리면 <b>전화걸기</b>를 누르고, 번호가 입력되면 바로 통화 버튼을 누르세요.<br />
                  전화가 연결되면 이 화면에 인증번호가 나타납니다.
                </Typography.Paragraph>
                <Statistic title="전화를 걸 수 있는 남은 시간" value={callLeft ?? 0} suffix="초" valueStyle={callLeft !== null && callLeft <= 10 ? { color: '#cf1322' } : undefined} />
                <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>인증할 휴대폰: +{cc} {prefix}-****-{rest.slice(-4)}</Typography.Paragraph>
              </div>
            </Space>
          )}
          {st === 'PENDING' && mode === 'APP' && (
            <Space size={40} align="start">
              <QRCode value={session.dial_uri} size={220} />
              <div>
                <Typography.Title level={4}>QR을 찍어 전화를 걸고, 안내가 나오면 1번을 누르세요</Typography.Title>
                <Statistic title="남은 시간" value={callLeft ?? 0} suffix="초" />
              </div>
            </Space>
          )}
          {st === 'CALL_CONFIRMED' && (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <Typography.Title level={4} style={{ marginTop: 0 }}>휴대폰 키패드로 아래 인증번호를 누르세요</Typography.Title>
              <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: 24, fontFamily: 'monospace', margin: '8px 0 16px' }}>{status.data?.pc_code}</div>
              <Progress type="circle" size={110} percent={Math.round(((codeLeft ?? 0) / codeTotal) * 100)} format={() => `${codeLeft ?? 0}초`}
                status={codeLeft !== null && codeLeft <= 5 ? 'exception' : 'active'} />
              <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
                {codeTotal}초 안에 입력하지 않으면 인증에 실패하며, 처음부터 다시 해야 합니다.
              </Typography.Paragraph>
            </div>
          )}
          {st === 'VERIFIED' && <Result status="success" title="인증 성공" subTitle={`인증된 휴대폰: ${status.data?.phone_masked ?? ''}`} />}
          {(st === 'FAILED' || st === 'EXPIRED' || st === 'CANCELED') && (
            <Result status="error" title="인증 실패" subTitle={FAIL_REASON_LABEL[status.data?.fail_reason] ?? status.data?.fail_reason}
              extra={<Button type="primary" onClick={() => { setSession(null); create.mutate(); }}>다시 시작</Button>} />
          )}
          {st === 'PENDING' && callLeft === 0 && <Alert type="info" showIcon message="전화 걸 시간이 지났습니다. 잠시 후 결과가 표시됩니다." />}
        </Card>
      )}
    </>
  );
}
