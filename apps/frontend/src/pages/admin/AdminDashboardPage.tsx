import { Card, Col, Row, Statistic, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client';

export function AdminDashboardPage() {
  const { data } = useQuery({
    queryKey: ['admin-statistics'],
    queryFn: async () => (await apiClient.get('/statistics')).data,
  });

  return (
    <>
      <Typography.Title level={2}>관리자 대시보드</Typography.Title>
      <Row gutter={16}>
        <Col span={6}><Card><Statistic title="전체 인증" value={data?.total ?? 0} /></Card></Col>
        <Col span={6}><Card><Statistic title="성공" value={data?.success ?? 0} /></Card></Col>
        <Col span={6}><Card><Statistic title="실패" value={data?.failed ?? 0} /></Card></Col>
        <Col span={6}><Card><Statistic title="성공률" value={data?.successRate ?? 0} suffix="%" /></Card></Col>
      </Row>
    </>
  );
}
