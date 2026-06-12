import { Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client';

export function AuthRequestListPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['auth-requests'],
    queryFn: async () => (await apiClient.get('/auth-requests')).data,
  });

  return (
    <>
      <Typography.Title level={2}>인증 현황</Typography.Title>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data ?? []}
        columns={[
          { title: '요청 ID', dataIndex: 'requestId' },
          { title: '앱명', dataIndex: 'mobileAppName' },
          { title: '플랫폼', dataIndex: 'clientPlatform' },
          { title: '상태', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> },
          { title: '전화번호', dataIndex: 'phoneMasked' },
          { title: '요청 시각', dataIndex: 'requestedAt' },
        ]}
      />
    </>
  );
}
