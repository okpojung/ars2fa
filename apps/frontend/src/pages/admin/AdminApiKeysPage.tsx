import { Button, Space, Table, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client';

export function AdminApiKeysPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-api-keys'],
    queryFn: async () => (await apiClient.get('/admin/api-keys')).data,
  });
  const suspend = useMutation({
    mutationFn: (id: string) => apiClient.post(`/admin/api-keys/${id}/suspend`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-api-keys'] }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiClient.post(`/admin/api-keys/${id}/revoke`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-api-keys'] }),
  });

  return (
    <>
      <Typography.Title level={2}>API Key 운영</Typography.Title>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data ?? []}
        columns={[
          { title: 'Key', dataIndex: 'keyPrefix' },
          { title: '서비스', render: (_, record) => record.application?.serviceName },
          { title: '회사', render: (_, record) => record.application?.user?.companyName },
          { title: '상태', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> },
          { title: '월 한도', dataIndex: 'monthlyLimit' },
          {
            title: '작업',
            render: (_, record) => (
              <Space>
                <Button onClick={() => suspend.mutate(record.id)}>정지</Button>
                <Button danger onClick={() => revoke.mutate(record.id)}>폐기</Button>
              </Space>
            ),
          },
        ]}
      />
    </>
  );
}
