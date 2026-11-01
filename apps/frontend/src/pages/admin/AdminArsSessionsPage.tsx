import { Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../../shared/api/client';
import { SessionDetailButton, phoneIp, requesterIp } from '../../shared/ars/SessionDetailDrawer';

const STATUS: Record<string, [string, string]> = {
  PENDING: ['전화 대기', 'gold'], CALL_CONFIRMED: ['PC 숫자 대기', 'blue'], VERIFIED: ['성공', 'green'],
  FAILED: ['실패', 'red'], EXPIRED: ['만료', 'default'], CANCELED: ['취소', 'default'],
};
const REASON: Record<string, string> = {
  hidden_caller: '발신번호 숨김', not_mobile: '휴대폰 아님', not_confirmed: '1번 미확인(피싱 방지)', no_authlog: '통신사 기록 없음(조작 의심)',
  no_session: '진행 중 인증 없음', multiple_calls: '2건 이상 전화', second_call: '이미 처리된 인증에 추가 전화', phone_mismatch: '요청 번호와 다름',
  pc_code_wrong: 'PC 숫자 틀림', timeout: '시간 초과', canceled_by_client: '고객 취소', pool_mismatch: '회선 불일치',
};
const fmt = (vn: string) => (vn?.length === 12 ? `${vn.slice(0, 4)}-${vn.slice(4, 8)}-${vn.slice(8)}` : vn);
const dt = (v?: string) => (v ? new Date(v).toLocaleString('ko-KR') : '');

export function AdminArsSessionsPage() {
  const [status, setStatus] = useState<string | undefined>();
  const sessions = useQuery({ queryKey: ['ars-sessions', status], queryFn: async () => (await apiClient.get('/admin/ars/sessions', { params: { status, take: 300 } })).data, refetchInterval: 5000 });
  const calls = useQuery({ queryKey: ['ars-calls'], queryFn: async () => (await apiClient.get('/admin/ars/calls', { params: { take: 300 } })).data, refetchInterval: 5000 });
  return (
    <>
      <Typography.Title level={2}>ARS 인증 진행 현황</Typography.Title>
      <Tabs items={[
        { key: 's', label: '인증 세션', children: (
          <>
            <Space style={{ marginBottom: 12 }}>
              <Select allowClear placeholder="상태" style={{ width: 160 }} value={status} onChange={setStatus}
                options={Object.entries(STATUS).map(([v, [l]]) => ({ value: v, label: l }))} />
            </Space>
            <Table<Record<string, any>> rowKey="sessionId" size="small" loading={sessions.isLoading} dataSource={sessions.data?.items ?? []}
              columns={[
                { title: '요청', dataIndex: 'createdAt', render: dt },
                { title: '앱', render: (_, r) => `${r.mobileAppName} (${r.clientPlatform}/${r.mode})` },
                { title: '용도', dataIndex: 'purpose' },
                { title: '0507', dataIndex: 'vn', render: fmt },
                { title: '발신', dataIndex: 'callerPhoneMasked' },
                { title: '결과', render: (_, r) => <><Tag color={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0] ?? r.status}</Tag>{r.failReason ? REASON[r.failReason] ?? r.failReason : ''}</> },
                { title: '웹·앱 IP', render: (_, r) => requesterIp(r) },
                { title: '휴대폰 IP', render: (_, r) => phoneIp(r) },
                { title: '앱 검증', dataIndex: 'integrityVerdict', render: (v) => <Tag color={v === 'PASSED' ? 'green' : v === 'FAILED' ? 'red' : 'default'}>{v}</Tag> },
                { title: '완료', dataIndex: 'finishedAt', render: dt },
                { title: '상세', width: 56, align: 'center', render: (_, r) => <SessionDetailButton r={r} admin /> },
              ]} />
          </>
        ) },
        { key: 'c', label: '착신 통화(PBX)', children: (
          <Table<Record<string, any>> rowKey="uniqueId" size="small" loading={calls.isLoading} dataSource={calls.data ?? []}
            columns={[
              { title: '시각', dataIndex: 'startedAt', render: dt },
              { title: '070', dataIndex: 'rn' },
              { title: '발신', dataIndex: 'callerMasked' },
              { title: '결과', render: (_, r) => <><Tag color={r.result === 'OK' ? 'green' : 'red'}>{r.result ?? '-'}</Tag>{r.reason ? REASON[r.reason] ?? r.reason : ''}</> },
              { title: '세션', dataIndex: 'sessionId' },
            ]} />
        ) },
      ]} />
    </>
  );
}
