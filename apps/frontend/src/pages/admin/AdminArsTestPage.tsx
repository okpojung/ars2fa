import { Alert, Button, Card, Input, QRCode, Radio, Result, Space, Statistic, Typography, message } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../../shared/api/client';

const REASON: Record<string, string> = {
  hidden_caller: '발신번호가 숨겨져 있습니다', not_mobile: '휴대폰 번호가 아닙니다', not_confirmed: '1번을 누르지 않았습니다(피싱 방지)',
  no_authlog: '통신사 기록(AuthLog)이 확인되지 않았습니다', multiple_calls: '같은 번호로 2건 이상 전화가 들어왔습니다', second_call: '이미 처리된 인증입니다',
  phone_mismatch: '요청한 휴대폰 번호와 다릅니다', pc_code_wrong: 'PC 확인 숫자가 틀렸습니다', timeout: '시간이 지났습니다', canceled_by_client: '취소되었습니다',
};

export function AdminArsTestPage() {
  const [mode, setMode] = useState<'APP' | 'PC'>('PC');
  const [expected, setExpected] = useState('');
  const [session, setSession] = useState<Record<string, any> | null>(null);
  const [code, setCode] = useState('');
  const create = useMutation({
    mutationFn: async () => (await apiClient.post('/admin/ars/test/sessions', { mode, expected_phone: expected || undefined })).data,
    onSuccess: setSession,
    onError: (e) => message.error((e as Error).message),
  });
  const status = useQuery({
    queryKey: ['ars-test', session?.session_id],
    enabled: !!session,
    queryFn: async () => (await apiClient.get(`/admin/ars/test/sessions/${session!.session_id}`)).data,
    refetchInterval: (q) => (['PENDING', 'CALL_CONFIRMED'].includes(q.state.data?.status ?? 'PENDING') ? 1500 : false),
  });
  const submit = useMutation({
    mutationFn: async () => (await apiClient.post(`/admin/ars/test/sessions/${session!.session_id}/pc-code`, { code })).data,
    onSuccess: () => { setCode(''); status.refetch(); },
    onError: (e) => message.error((e as Error).message),
  });
  const st = status.data?.status ?? session?.status;

  return (
    <>
      <Typography.Title level={2}>ARS 실통화 시험</Typography.Title>
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)} options={[{ value: 'PC', label: 'PC 인증(QR + 확인 숫자)' }, { value: 'APP', label: '앱 인증(전화만)' }]} />
          <Input placeholder="기대 휴대폰 번호(선택)" value={expected} onChange={(e) => setExpected(e.target.value)} style={{ width: 200 }} />
          <Button type="primary" loading={create.isPending} onClick={() => { setSession(null); create.mutate(); }}>인증 시작</Button>
        </Space>
      </Card>
      {session && (
        <Card>
          {st === 'PENDING' && (
            <Space size={40} align="start">
              <QRCode value={session.dial_uri} size={220} />
              <div>
                <Typography.Title level={4}>휴대폰 카메라로 QR을 찍어 전화를 거세요</Typography.Title>
                <Typography.Paragraph>안내가 나오면 <b>1번</b>을 누르세요. 번호는 화면에 표시하지 않습니다.</Typography.Paragraph>
                <Statistic.Countdown title="남은 시간" value={new Date(session.expires_at).getTime()} format="mm:ss" />
                <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>표시 이름: {session.display_name}</Typography.Paragraph>
              </div>
            </Space>
          )}
          {st === 'CALL_CONFIRMED' && (
            <Space direction="vertical">
              <Alert type="info" showIcon message="전화 확인 완료. ARS가 읽어 준 두 자리 숫자를 입력하세요." />
              <Space><Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 2))} style={{ width: 120, fontSize: 24 }} maxLength={2} />
                <Button type="primary" onClick={() => submit.mutate()} disabled={code.length !== 2}>확인</Button></Space>
            </Space>
          )}
          {st === 'VERIFIED' && <Result status="success" title="인증 성공" subTitle={`인증된 휴대폰: ${status.data?.phone_masked ?? ''}`} />}
          {(st === 'FAILED' || st === 'EXPIRED' || st === 'CANCELED') && (
            <Result status="error" title="인증 실패" subTitle={REASON[status.data?.fail_reason] ?? status.data?.fail_reason} />
          )}
        </Card>
      )}
    </>
  );
}
