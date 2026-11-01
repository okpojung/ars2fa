import { Alert, Button, Card, Descriptions, Input, Result, Select, Space, Typography } from 'antd';
import { useState } from 'react';
import { FAIL_REASON_LABEL } from '../../pages/admin/AdminDashboardPage';
import { PopupResult, runArsPopup } from './popup';

const PREFIXES = ['010', '011', '016', '017', '018', '019'];

/**
 * Live call test with the popup: phone input (country / prefix / number) -> [인증 시작] -> popup -> result,
 * then the server-side check a customer's server would do.
 */
export function PopupPhoneTest(props: {
  start: (body: { country_code: string; expected_phone: string }) => Promise<{ popup_url: string; session_id: string }>;
  verify: (sessionId: string) => Promise<Record<string, any>>;
  disabled?: boolean;
  extra?: React.ReactNode;
}) {
  const [cc, setCc] = useState('82');
  const [prefix, setPrefix] = useState('010');
  const [rest, setRest] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PopupResult | null>(null);
  const [check, setCheck] = useState<Record<string, any> | null>(null);
  const ok = /^[0-9]{7,8}$/.test(rest);

  const go = () => {
    setBusy(true); setResult(null); setCheck(null);
    runArsPopup(() => props.start({ country_code: cc, expected_phone: `${prefix}${rest}` })).then(async (r) => {
      setResult(r);
      if (r.sessionId && r.status !== 'ERROR') { try { setCheck(await props.verify(r.sessionId)); } catch { /* ignore */ } }
    }).finally(() => setBusy(false));
  };

  return (
    <Card>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Paragraph style={{ margin: 0 }}>
          휴대폰 번호를 입력하고 <b>인증 시작</b>을 누르면 <b>팝업 창</b>이 열립니다. 팝업에서 QR을 찍어 전화를 걸고,
          연결되면 팝업에 나오는 인증번호를 휴대폰 키패드로 누르세요. 결과는 이 화면으로 돌아옵니다.
        </Typography.Paragraph>
        {props.extra}
        <Space wrap>
          <span>휴대폰 번호</span>
          <Select value={cc} onChange={setCc} style={{ width: 110 }} options={[{ value: '82', label: '+82 한국' }]} />
          <Select value={prefix} onChange={setPrefix} style={{ width: 90 }} options={PREFIXES.map((p) => ({ value: p, label: p }))} />
          <Input value={rest} onChange={(e) => setRest(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="나머지 7~8자리" inputMode="numeric"
            style={{ width: 160 }} status={rest && !ok ? 'error' : undefined} onPressEnter={() => ok && !busy && go()} />
          <Button type="primary" disabled={!ok || props.disabled} loading={busy} onClick={go}>인증 시작 (팝업)</Button>
        </Space>
        {busy && <Alert type="info" showIcon message="팝업 창에서 인증을 진행해 주세요. 팝업이 안 보이면 브라우저의 팝업 차단을 해제해 주세요." />}
        {result && (result.status === 'VERIFIED'
          ? <Result status="success" style={{ padding: '16px 0' }} title="인증 성공" subTitle={`인증된 휴대폰 ${result.phoneMasked ?? ''}`} />
          : <Result status="error" style={{ padding: '16px 0' }} title="인증하지 못했습니다"
              subTitle={result.message ?? FAIL_REASON_LABEL[result.reason ?? ''] ?? result.reason ?? result.status} />)}
        {check && (
          <Descriptions size="small" bordered column={2} title="서버 확인 결과 (고객 서버가 /v1/widget/verify 로 받는 내용)">
            <Descriptions.Item label="verified">{String(check.verified)}</Descriptions.Item>
            <Descriptions.Item label="phone_masked">{check.phone_masked ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="session_id"><Typography.Text code copyable>{check.session_id}</Typography.Text></Descriptions.Item>
            <Descriptions.Item label="verified_at">{check.verified_at ? new Date(check.verified_at).toLocaleString('ko-KR') : '-'}</Descriptions.Item>
          </Descriptions>
        )}
      </Space>
    </Card>
  );
}
