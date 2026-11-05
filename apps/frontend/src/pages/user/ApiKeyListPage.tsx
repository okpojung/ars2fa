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
        API 신청이 승인되면 키가 만들어집니다. [키 보기]를 누르고 담당자 휴대폰(가입할 때 인증한 번호)으로 ARS 인증을 하면 키를 볼 수 있습니다. 볼 때마다 인증이 필요하고, 한 키는 3번까지 볼 수 있습니다(4번째에는 새 키가 발급됩니다). 키가 밖으로 새어 나갔을 때만 키 창의 [새 키로 바꾸기]를 쓰세요.
      </Typography.Paragraph>
      <Table<Record<string, any>> rowKey="id" loading={isLoading} dataSource={data ?? []}
        columns={[
          { title: '서비스', render: (_, r) => <Link to={`/console/applications/${r.applicationId}`}>{r.application?.serviceName}</Link> },
          { title: 'Key 앞자리', dataIndex: 'keyPrefix', render: (v) => <Typography.Text code>{v}…</Typography.Text> },
          { title: '환경', dataIndex: 'environment' },
          { title: '상태', dataIndex: 'status', render: (v) => <Tag color={v === 'ACTIVE' ? 'green' : 'red'}>{v}</Tag> },
          { title: '월 한도', dataIndex: 'monthlyLimit', render: (v) => v?.toLocaleString() },
          { title: '', render: (_, r) => r.status !== 'REVOKED' && <RotateKeyButton id={r.id} viewable={r.viewable} viewsLeft={r.viewsLeft} /> },
        ]} />
    </>
  );
}
