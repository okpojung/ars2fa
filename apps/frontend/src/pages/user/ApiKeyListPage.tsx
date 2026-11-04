import { Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../../shared/api/client';
import { RotateKeyButton } from './RotateKeyButton';

export function ApiKeyListPage() {
  const { data, isLoading } = useQuery({ queryKey: ['api-keys'], queryFn: async () => (await apiClient.get('/api-keys')).data });
  return (
    <>
      <Typography.Title level={2}>API Key</Typography.Title>
      <Typography.Paragraph type="secondary">
        API 신청이 승인되면 키가 만들어집니다. [키 발급]을 누르고 담당자 휴대폰으로 ARS 인증을 하면 키 원문이 한 번만 표시됩니다. 재발급하면 이전 키는 바로 쓸 수 없게 됩니다.
      </Typography.Paragraph>
      <Table<Record<string, any>> rowKey="id" loading={isLoading} dataSource={data ?? []}
        columns={[
          { title: '서비스', render: (_, r) => <Link to={`/console/applications/${r.applicationId}`}>{r.application?.serviceName}</Link> },
          { title: 'Key 앞자리', dataIndex: 'keyPrefix', render: (v) => <Typography.Text code>{v}…</Typography.Text> },
          { title: '환경', dataIndex: 'environment' },
          { title: '상태', dataIndex: 'status', render: (v) => <Tag color={v === 'ACTIVE' ? 'green' : 'red'}>{v}</Tag> },
          { title: '월 한도', dataIndex: 'monthlyLimit', render: (v) => v?.toLocaleString() },
          { title: '', render: (_, r) => r.status !== 'REVOKED' && <RotateKeyButton id={r.id} issued={r.updatedAt !== r.createdAt} /> },
        ]} />
    </>
  );
}
