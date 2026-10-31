import { Alert, Card, Col, Progress, Row, Statistic, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client';

export const FAIL_REASON_LABEL: Record<string, string> = {
  hidden_caller: '발신번호 숨김', not_mobile: '휴대폰 아님', not_confirmed: '1번 미입력', no_authlog: '통신사 기록 없음',
  no_session: '진행 중 인증 없음', multiple_calls: '2건 이상 전화', second_call: '이미 처리됨', phone_mismatch: '휴대폰 번호 불일치',
  pc_code_wrong: '인증번호 틀림', code_timeout: '인증번호 입력 시간 초과', timeout: '시간 초과(전화 안 함)', canceled_by_client: '취소',
  pool_mismatch: '회선 불일치', invalid_access: '인증 외 전화', unknown: '기타',
};
const STATUS: Record<string, [string, string]> = {
  PENDING: ['전화 대기', 'blue'], CALL_CONFIRMED: ['번호 입력 대기', 'gold'], VERIFIED: ['성공', 'green'],
  FAILED: ['실패', 'red'], EXPIRED: ['시간 초과', 'default'], CANCELED: ['취소', 'default'],
};
const fmtVn = (vn: string) => (vn?.length === 12 ? `${vn.slice(0, 4)}-${vn.slice(4, 8)}-${vn.slice(8)}` : vn);

export function AdminDashboardPage() {
  const { data: d } = useQuery({
    queryKey: ['admin-statistics'],
    queryFn: async () => (await apiClient.get('/statistics')).data,
    refetchInterval: 10_000,
  });
  const maxDaily = Math.max(1, ...((d?.daily ?? []) as { total: number }[]).map((x) => x.total));

  return (
    <>
      <Typography.Title level={2}>관리자 대시보드</Typography.Title>
      {d?.pool?.linkUnknown > 0 && (
        <Alert style={{ marginBottom: 16 }} type="error" showIcon message={`CallMix 착신 상태 확인이 필요한 번호가 ${d.pool.linkUnknown}개 있습니다. (0507 번호 풀 화면에서 확인)`} />
      )}
      <Typography.Title level={5}>오늘</Typography.Title>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="오늘 인증" value={d?.today?.total ?? 0} /></Card></Col>
        <Col span={6}><Card><Statistic title="오늘 성공" value={d?.today?.success ?? 0} valueStyle={{ color: '#389e0d' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="오늘 실패·시간초과" value={d?.today?.failed ?? 0} valueStyle={{ color: '#cf1322' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="지금 진행 중" value={d?.inProgress ?? 0} /></Card></Col>
      </Row>
      <Typography.Title level={5}>전체</Typography.Title>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="전체 인증" value={d?.total ?? 0} /></Card></Col>
        <Col span={6}><Card><Statistic title="성공" value={d?.success ?? 0} /></Card></Col>
        <Col span={6}><Card><Statistic title="실패·시간초과" value={d?.failed ?? 0} suffix={d?.canceled ? <Typography.Text type="secondary" style={{ fontSize: 14 }}> (취소 {d.canceled})</Typography.Text> : null} /></Card></Col>
        <Col span={6}><Card><Statistic title="성공률 (취소 제외)" value={d?.successRate ?? 0} suffix="%" /></Card></Col>
      </Row>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card title="0507 번호 풀" size="small">
            <Statistic title="사용 가능 / 전체" value={`${d?.pool?.active ?? 0} / ${d?.pool?.total ?? 0}`} />
            <Row style={{ marginTop: 12 }}>
              <Col span={8}><Statistic title="인증 중" value={d?.pool?.leased ?? 0} /></Col>
              <Col span={8}><Statistic title="휴식 중" value={d?.pool?.cooling ?? 0} /></Col>
              <Col span={8}><Statistic title="인증 연결 중" value={d?.pool?.linkOn ?? 0} /></Col>
            </Row>
            {d?.pool?.cycle && (
              <div style={{ marginTop: 12 }}>
                <Typography.Text type="secondary">랜덤 순환 {d.pool.cycle.cycleNo}회차 ({d.pool.cycle.used} / {d.pool.cycle.size})</Typography.Text>
                <Progress percent={Math.round((d.pool.cycle.used / Math.max(1, d.pool.cycle.size)) * 100)} size="small" />
              </div>
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card title="CallMix 착신 전환 (24시간, 인증 연결·안내 회선 복귀)" size="small">
            <Row>
              <Col span={8}><Statistic title="성공" value={d?.carrier24h?.ok ?? 0} /></Col>
              <Col span={8}><Statistic title="실패" value={d?.carrier24h?.failed ?? 0} valueStyle={d?.carrier24h?.failed ? { color: '#cf1322' } : undefined} /></Col>
              <Col span={8}><Statistic title="평균 응답" value={d?.carrier24h?.avgMs ?? 0} suffix="ms" /></Col>
            </Row>
            {d?.carrier24h?.lastFailure && (
              <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
                최근 실패: {new Date(d.carrier24h.lastFailure.createdAt).toLocaleString('ko-KR')} {d.carrier24h.lastFailure.resCd} {d.carrier24h.lastFailure.resMsg}
              </Typography.Paragraph>
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card title="실패 사유 (전체)" size="small">
            {(d?.failReasons ?? []).length === 0 ? <Typography.Text type="secondary">없음</Typography.Text> :
              (d.failReasons as { reason: string; count: number }[]).slice(0, 6).map((r) => (
                <div key={r.reason} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{FAIL_REASON_LABEL[r.reason] ?? r.reason}</span><b>{r.count}</b>
                </div>
              ))}
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              24시간 수신 전화 {d?.calls24h?.total ?? 0}건 중 인증 외 전화 {d?.calls24h?.invalid ?? 0}건
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={10}>
          <Card title="최근 14일" size="small">
            {((d?.daily ?? []) as { day: string; total: number; success: number }[]).map((x) => (
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
        <Col span={14}>
          <Card title="최근 인증" size="small">
            <Table<Record<string, any>> size="small" rowKey="sessionId" pagination={false} dataSource={d?.recent ?? []}
              columns={[
                { title: '시각', dataIndex: 'createdAt', render: (v) => new Date(v).toLocaleString('ko-KR') },
                { title: '앱', dataIndex: 'mobileAppName' },
                { title: '방식', dataIndex: 'mode', render: (v) => (v === 'PC' ? 'PC' : '앱') },
                { title: '0507', dataIndex: 'vn', render: fmtVn },
                { title: '휴대폰', dataIndex: 'callerPhoneMasked', render: (v) => v ?? '-' },
                { title: '결과', render: (_, r) => <>
                  <Tag color={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0] ?? r.status}</Tag>
                  {r.failReason && <Typography.Text type="secondary">{FAIL_REASON_LABEL[r.failReason] ?? r.failReason}</Typography.Text>}
                </> },
              ]} />
          </Card>
        </Col>
      </Row>
    </>
  );
}
