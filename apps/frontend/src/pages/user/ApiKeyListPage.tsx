import { Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../../shared/api/client';

export function ApiKeyListPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => (await apiClient.get('/api-keys')).data,
  });

  return (
    <>
      <Typography.Title level={2}>API Key</Typography.Title>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data ?? []}
        columns={[
          { title: 'Key', dataIndex: 'keyPrefix' },
          { title: '환경', dataIndex: 'environment' },
          { title: '상태', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> },
          { title: '월 한도', dataIndex: 'monthlyLimit' },
          { title: '상세', render: (_, record) => <Link to={`/api-keys/${record.id}`}>보기</Link> },
        ]}
      />
    </>
  );
}
