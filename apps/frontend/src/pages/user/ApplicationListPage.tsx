import { Button, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../../shared/api/client';

export function ApplicationListPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['applications'],
    queryFn: async () => (await apiClient.get('/applications')).data,
  });

  return (
    <>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Typography.Title level={2}>API 신청</Typography.Title>
        <Link to="/applications/new"><Button type="primary">신규 신청</Button></Link>
      </Space>
      <Table<Record<string, any>>
        rowKey="id"
        loading={isLoading}
        dataSource={data ?? []}
        columns={[
          { title: '서비스명', dataIndex: 'serviceName' },
          { title: '상태', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> },
          { title: '예상 월 요청', dataIndex: 'expectedMonthlyRequests' },
          {
            title: '상세',
            render: (_, record) => <Link to={`/applications/${record.id}`}>보기</Link>,
          },
        ]}
      />
    </>
  );
}
