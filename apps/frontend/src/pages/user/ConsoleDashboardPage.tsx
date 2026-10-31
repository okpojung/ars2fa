import { Card, Col, Row, Statistic, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../../shared/api/client';
import { FAIL_REASON_LABEL } from '../admin/AdminDashboardPage';

export const SESSION_STATUS: Record<string, [string, string]> = {
  PENDING: ['전화 대기', 'blue'], CALL_CONFIRMED: ['번호 입력 대기', 'gold'], VERIFIED: ['성공', 'green'],
  FAILED: ['실패', 'red'], EXPIRED: ['시간 초과', 'default'], CANCELED: ['취소', 'default'],
};

export function SessionResult({ r }: { r: Record<string, any> }) {
  return (
    <>
      <Tag color={SESSION_STATUS[r.status]?.[1]}>{SESSION_STATUS[r.status]?.[0] ?? r.status}</Tag>
      {r.failReason && <Typography.Text type="secondary">{FAIL_REASON_LABEL[r.failReason] ?? r.failReason}</Typography.Text>}
    </>
  );
}

export function ConsoleDashboardPage() {
  const { data: d } = useQuery({ queryKey: ['statistics'], queryFn: async () => (await apiClient.get('/statistics')).data, refetchInterval: 15_000 });
  const { data: recent } = useQuery({ queryKey: ['console-sessions', 'recent'], queryFn: async () => (await apiClient.get('/console/sessions', { params: { take: 10 } })).data });
  const daily = (d?.daily ?? []) as { day: string; total: number; success: number }[];
  const maxDaily = Math.max(1, ...daily.map((x) => x.total));
  return (
    <>
      <Typography.Title level={2}>대시보드</Typography.Title>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="오늘 인증" value={d?.today?.total ?? 0} /></Card></Col>
        <Col span={6}><Card><Statistic title="오늘 성공" value={d?.today?.success ?? 0} valueStyle={{ color: '#389e0d' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="전체 인증" value={d?.total ?? 0} /></Card></Col>
        <Col span={6}><Card><Statistic title="성공률 (취소 제외)" value={d?.successRate ?? 0} suffix="%" /></Card></Col>
      </Row>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={14}>
          <Card title="최근 14일" size="small">
            {daily.map((x) => (
              <div key={x.day} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 48, color: '#888' }}>{x.day.slice(5)}</span>
                <div style={{ flex: 1, background: '#f0f0f0', height: 14, position: 'relative' }}>
                  <div style={{ width: `${(x.total / maxDaily) * 100}%`, background: '#ffccc7', height: 14, position: 'absolute' }} />
                  <div style={{ width: `${(x.success / maxDaily) * 100}%`, background: '#95de64', height: 14, position: 'absolute' }} />
                </div>
                <span style={{ width: 70, textAlign: 'right' }}>{x.success} / {x.total}</span>
              </div>
            ))}
            <Typography.Text type="secondary">초록: 성공, 분홍: 전체</Typography.Text>
          </Card>
        </Col>
        <Col span={10}>
          <Card title="실패 사유" size="small">
            {(d?.failReasons ?? []).length === 0 ? <Typography.Text type="secondary">없음</Typography.Text> :
              (d.failReasons as { reason: string; count: number }[]).map((r) => (
                <div key={r.reason} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{FAIL_REASON_LABEL[r.reason] ?? r.reason}</span><b>{r.count}</b></div>
              ))}
          </Card>
        </Col>
      </Row>
      <Card title="최근 인증" size="small" extra={<Link to="/console/sessions">전체 보기</Link>}>
        <Table<Record<string, any>> size="small" rowKey="sessionId" pagination={false} dataSource={recent ?? []}
          columns={[
            { title: '시각', dataIndex: 'createdAt', render: (v) => new Date(v).toLocaleString('ko-KR') },
            { title: '앱', dataIndex: 'mobileAppName' },
            { title: '방식', dataIndex: 'mode', render: (v) => (v === 'PC' ? 'PC' : '앱') },
            { title: '휴대폰', dataIndex: 'callerPhoneMasked', render: (v) => v ?? '-' },
            { title: '결과', render: (_, r) => <SessionResult r={r} /> },
          ]} />
      </Card>
    </>
  );
}
