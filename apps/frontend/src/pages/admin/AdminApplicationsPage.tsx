import { Button, Space, Table, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client';

export function AdminApplicationsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-applications'],
    queryFn: async () => (await apiClient.get('/admin/applications')).data,
  });
  const approve = useMutation({
    mutationFn: async (id: string) => (await apiClient.post(`/admin/applications/${id}/approve`, {})).data,
    onSuccess: (data) => {
      message.success(`승인 완료. API Key: ${data.rawApiKey}`);
      queryClient.invalidateQueries({ queryKey: ['admin-applications'] });
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '승인 실패'),
  });
  const reject = useMutation({
    mutationFn: async (id: string) => apiClient.post(`/admin/applications/${id}/reject`, { comment: 'MVP 관리자 반려' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-applications'] }),
  });

  return (
    <>
      <Typography.Title level={2}>신청 심사</Typography.Title>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data ?? []}
        columns={[
          { title: '서비스명', dataIndex: 'serviceName' },
          { title: '회사', render: (_, record) => record.user?.companyName },
          { title: '상태', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> },
          { title: '예상 월 요청', dataIndex: 'expectedMonthlyRequests' },
          {
            title: '작업',
            render: (_, record) => (
              <Space>
                <Button type="primary" disabled={record.status !== 'SUBMITTED'} onClick={() => approve.mutate(record.id)}>
                  승인
                </Button>
                <Button danger disabled={record.status !== 'SUBMITTED'} onClick={() => reject.mutate(record.id)}>
                  반려
                </Button>
              </Space>
            ),
          },
        ]}
      />
    </>
  );
}
