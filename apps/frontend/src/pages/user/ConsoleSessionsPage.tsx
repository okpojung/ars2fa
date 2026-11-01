import { Select, Space, Table, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../../shared/api/client';
import { clientSummary } from '../../shared/ars/ClientInfoView';
import { SessionDetailButton, phoneIp, requesterIp } from '../../shared/ars/SessionDetailDrawer';
import { SESSION_STATUS, SessionResult } from './ConsoleDashboardPage';

export function ConsoleSessionsPage() {
  const [status, setStatus] = useState<string | undefined>();
  const { data, isLoading } = useQuery({
    queryKey: ['console-sessions', status],
    queryFn: async () => (await apiClient.get('/console/sessions', { params: { status, take: 500 } })).data,
    refetchInterval: 10_000,
  });
  return (
    <>
      <Typography.Title level={2}>인증 내역</Typography.Title>
      <Space style={{ marginBottom: 12 }}>
        <Select allowClear placeholder="결과" style={{ width: 160 }} value={status} onChange={setStatus}
          options={Object.entries(SESSION_STATUS).map(([value, [label]]) => ({ value, label }))} />
        <Typography.Text type="secondary">휴대폰 번호는 가운데를 가려 표시합니다. 전체 번호는 API 결과로만 전달됩니다.</Typography.Text>
      </Space>
      <Table<Record<string, any>> rowKey="sessionId" size="small" loading={isLoading} dataSource={data ?? []}
        columns={[
          { title: '시각', dataIndex: 'createdAt', render: (v) => new Date(v).toLocaleString('ko-KR') },
          { title: '앱', dataIndex: 'mobileAppName' },
          { title: '플랫폼', dataIndex: 'clientPlatform' },
          { title: '방식', dataIndex: 'mode', render: (v) => (v === 'PC' ? 'PC' : '앱') },
          { title: '목적', dataIndex: 'purpose', render: (v) => v ?? '-' },
          { title: '휴대폰', dataIndex: 'callerPhoneMasked', render: (v) => v ?? '-' },
          { title: '웹·앱 IP', render: (_, r) => <Typography.Text code style={{ fontSize: 12 }}>{requesterIp(r)}</Typography.Text> },
          { title: '휴대폰 IP', render: (_, r) => <Typography.Text code style={{ fontSize: 12 }}>{phoneIp(r)}</Typography.Text> },
          { title: '기기 · 브라우저', render: (_, r) => clientSummary(r) },
          { title: '결과', render: (_, r) => <SessionResult r={r} /> },
          { title: '상세', width: 56, align: 'center', render: (_, r) => <SessionDetailButton r={r} /> },
        ]} />
    </>
  );
}
