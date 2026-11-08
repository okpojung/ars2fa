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
      message.success('승인했습니다. 고객이 콘솔에서 휴대폰 ARS 인증 후 키를 받습니다.');
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
      <Typography.Paragraph type="secondary">
        제출 10분 뒤 자동으로 승인됩니다. 그 전에 직접 승인하거나 반려할 수 있습니다. 다른 고객이 이미 등록한 패키지명, Bundle ID, 사이트 주소면 자동 승인하지 않고 여기서 기다립니다.
      </Typography.Paragraph>
      <Table<Record<string, any>>
        rowKey="id"
        loading={isLoading}
        dataSource={data ?? []}
        columns={[
          { title: '서비스명', dataIndex: 'serviceName' },
          { title: '회사', render: (_, record) => record.user?.companyName },
          { title: '상태', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> },
          { title: '자동 승인', render: (_, r) => r.status !== 'SUBMITTED' ? (r.adminComment ?? '')
            : r.adminComment?.startsWith('자동 승인 보류') ? <Typography.Text type="warning">{r.adminComment}</Typography.Text>
            : r.submittedAt ? `${new Date(new Date(r.submittedAt).getTime() + 10 * 60_000).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })} 예정` : '-' },
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
