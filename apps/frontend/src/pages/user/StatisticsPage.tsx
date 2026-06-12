import { Card, Col, Row, Statistic, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { apiClient } from '../../shared/api/client';

export function StatisticsPage() {
  const { data } = useQuery({
    queryKey: ['statistics'],
    queryFn: async () => (await apiClient.get('/statistics')).data,
  });
  const chartData = [
    { name: '성공', value: data?.success ?? 0 },
    { name: '실패', value: data?.failed ?? 0 },
    { name: '수동 필요', value: data?.manualRequired ?? 0 },
  ];

  return (
    <>
      <Typography.Title level={2}>인증 통계</Typography.Title>
      <Row gutter={16}>
        <Col span={8}><Card><Statistic title="전체" value={data?.total ?? 0} /></Card></Col>
        <Col span={8}><Card><Statistic title="성공" value={data?.success ?? 0} /></Card></Col>
        <Col span={8}><Card><Statistic title="성공률" value={data?.successRate ?? 0} suffix="%" /></Card></Col>
      </Row>
      <Card style={{ marginTop: 16, height: 320 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={chartData} dataKey="value" nameKey="name" outerRadius={100} label>
              {chartData.map((_, index) => (
                <Cell key={index} fill={['#52c41a', '#ff4d4f', '#faad14'][index]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </Card>
    </>
  );
}
