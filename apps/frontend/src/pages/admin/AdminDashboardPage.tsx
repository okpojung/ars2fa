import { Alert, Card, Col, Progress, Row, Statistic, Table, Tag, Tooltip, Typography } from 'antd';
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

const kst = (v?: string | null, withDate = false) => (v ? new Date(v).toLocaleString('ko-KR', withDate
  ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
  : { hour: '2-digit', minute: '2-digit', hour12: false }) : '-');
const small = { fontSize: 20 } as const;
const cardBody = { padding: '10px 14px' } as const;

/** Concurrent calls on the SIP trunk: live gauge, peaks and the last 24 h (30-minute maxima). */
function TrunkCard({ t }: { t: Record<string, any> | undefined }) {
  const limit: number = t?.limit ?? 30;
  const cur: number | null = t?.live ? t.live.trunk : null;
  const pct = cur == null ? 0 : Math.round((cur / Math.max(1, limit)) * 100);
  const color = pct >= 100 ? '#cf1322' : pct >= 80 ? '#fa8c16' : '#52c41a';
  const peakColor = (n: number) => (n >= limit ? '#cf1322' : n >= (t?.warnAt ?? limit) ? '#fa8c16' : undefined);
  return (
    <Card size="small" styles={{ body: cardBody }} title="동시 통화 (SIP 트렁크)"
      extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>계약 {t?.capacity ?? 30}회선{t?.maxcalls ? ` · PBX 한도 ${t.maxcalls}` : ''}</Typography.Text>}>
      <Row align="middle" gutter={12}>
        <Col flex="96px">
          <Progress type="dashboard" size={88} percent={pct} strokeColor={color}
            format={() => <span style={{ fontSize: 18 }}>{cur ?? '-'}<span style={{ fontSize: 12, color: '#888' }}> / {limit}</span></span>} />
        </Col>
        <Col flex="auto">
          <Row>
            <Col span={8}><Statistic title="오늘 최대" value={t?.peakToday?.calls ?? 0} valueStyle={{ ...small, color: peakColor(t?.peakToday?.calls ?? 0) }} /><Typography.Text type="secondary" style={{ fontSize: 11 }}>{kst(t?.peakToday?.at)}</Typography.Text></Col>
            <Col span={8}><Statistic title="7일 최대" value={t?.peak7d?.calls ?? 0} valueStyle={{ ...small, color: peakColor(t?.peak7d?.calls ?? 0) }} /><Typography.Text type="secondary" style={{ fontSize: 11 }}>{kst(t?.peak7d?.at, true)}</Typography.Text></Col>
            <Col span={8}><Statistic title="30일 최대" value={t?.peak30d?.calls ?? 0} valueStyle={{ ...small, color: peakColor(t?.peak30d?.calls ?? 0) }} /><Typography.Text type="secondary" style={{ fontSize: 11 }}>{kst(t?.peak30d?.at, true)}</Typography.Text></Col>
          </Row>
        </Col>
      </Row>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 44, marginTop: 6, borderBottom: '1px solid #eee', position: 'relative' }}>
        {((t?.last24h ?? []) as { at: string; max: number }[]).map((b) => (
          <Tooltip key={b.at} title={`${kst(b.at)}~ 최대 ${b.max}회선`}>
            <div style={{ flex: 1, height: `${Math.min(100, (b.max / Math.max(1, limit)) * 100)}%`, minHeight: b.max ? 2 : 0, background: peakColor(b.max) ?? '#69b1ff' }} />
          </Tooltip>
        ))}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: '80%', borderTop: '1px dashed #fa8c16' }} />
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        최근 24시간(30분별 최대) · 점선 80%{t?.busyMinutesToday ? ` · 오늘 80% 이상 ${t.busyMinutesToday}분` : ''}{!t?.live ? ' · 수집 대기' : ''}
      </Typography.Text>
    </Card>
  );
}

export function AdminDashboardPage() {
  const { data: d } = useQuery({
    queryKey: ['admin-statistics'],
    queryFn: async () => (await apiClient.get('/statistics')).data,
    refetchInterval: 5_000,
  });
  const daily = ((d?.daily ?? []) as { day: string; total: number; success: number }[]);
  const maxDaily = Math.max(1, ...daily.map((x) => x.total));
  const t = d?.trunk as Record<string, any> | undefined;
  const near = t?.live && t.live.trunk >= t.warnAt;
  const pbxBelow = t?.maxcalls && t.maxcalls < t.capacity;

  const stat = (title: string, value: number | string, color?: string, suffix?: string) => (
    <Col flex="1"><Statistic title={title} value={value} suffix={suffix} valueStyle={{ ...small, color }} /></Col>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Typography.Title level={4} style={{ margin: 0 }}>관리자 대시보드</Typography.Title>
      {d?.pool?.linkUnknown > 0 && (
        <Alert type="error" showIcon message={`CallMix 착신 상태 확인이 필요한 번호가 ${d.pool.linkUnknown}개 있습니다. (0507 번호 풀 화면에서 확인)`} />
      )}
      {near && <Alert type={t!.live.trunk >= t!.limit ? 'error' : 'warning'} showIcon
        message={`동시 통화 ${t!.live.trunk} / ${t!.limit}회선: 한도에 가깝습니다. 한도를 넘으면 0507 번호를 할당해도 전화가 들어오지 않습니다(통화 중). SIP 트렁크 회선 증설을 검토하세요.`} />}
      {pbxBelow && <Alert type="warning" showIcon
        message={`PBX(Asterisk) 동시 통화 한도가 ${t!.maxcalls}로, 계약 회선 ${t!.capacity}보다 낮습니다. 실제 한도는 ${t!.limit}회선입니다. (asterisk.conf maxcalls)`} />}

      <Card size="small" styles={{ body: cardBody }}>
        <Row gutter={8} wrap={false}>
          {stat('오늘 인증', d?.today?.total ?? 0)}
          {stat('오늘 성공', d?.today?.success ?? 0, '#389e0d')}
          {stat('오늘 실패·시간초과', d?.today?.failed ?? 0, '#cf1322')}
          {stat('지금 진행 중', d?.inProgress ?? 0, '#1677ff')}
          <Col style={{ borderLeft: '1px solid #f0f0f0', margin: '0 8px' }} />
          {stat('전체 인증', d?.total ?? 0)}
          {stat('성공', d?.success ?? 0)}
          {stat('실패·시간초과', d?.failed ?? 0, undefined, d?.canceled ? `(취소 ${d.canceled})` : undefined)}
          {stat('성공률(취소 제외)', d?.successRate ?? 0, undefined, '%')}
        </Row>
      </Card>

      <Row gutter={10}>
        <Col span={7}><TrunkCard t={t} /></Col>
        <Col span={6}>
          <Card title="0507 번호 풀" size="small" styles={{ body: cardBody }} style={{ height: '100%' }}>
            <Statistic title="사용 가능 / 전체" value={`${d?.pool?.active ?? 0} / ${d?.pool?.total ?? 0}`} valueStyle={small} />
            <Row style={{ marginTop: 6 }}>
              <Col span={8}><Statistic title="인증 중" value={d?.pool?.leased ?? 0} valueStyle={small} /></Col>
              <Col span={8}><Statistic title="휴식 중" value={d?.pool?.cooling ?? 0} valueStyle={small} /></Col>
              <Col span={8}><Statistic title="인증 연결 중" value={d?.pool?.linkOn ?? 0} valueStyle={small} /></Col>
            </Row>
            {d?.pool?.cycle && (
              <div style={{ marginTop: 6 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>랜덤 순환 {d.pool.cycle.cycleNo}회차 ({d.pool.cycle.used} / {d.pool.cycle.size})</Typography.Text>
                <Progress percent={Math.round((d.pool.cycle.used / Math.max(1, d.pool.cycle.size)) * 100)} size="small" />
              </div>
            )}
          </Card>
        </Col>
        <Col span={5}>
          <Card title="CallMix 착신 전환 (24시간)" size="small" styles={{ body: cardBody }} style={{ height: '100%' }}>
            <Row>
              <Col span={8}><Statistic title="성공" value={d?.carrier24h?.ok ?? 0} valueStyle={small} /></Col>
              <Col span={8}><Statistic title="실패" value={d?.carrier24h?.failed ?? 0} valueStyle={{ ...small, color: d?.carrier24h?.failed ? '#cf1322' : undefined }} /></Col>
              <Col span={8}><Statistic title="평균 응답" value={d?.carrier24h?.avgMs ?? 0} suffix="ms" valueStyle={small} /></Col>
            </Row>
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
              {d?.carrier24h?.lastFailure
                ? <>최근 실패: {kst(d.carrier24h.lastFailure.createdAt, true)} {d.carrier24h.lastFailure.resCd} {d.carrier24h.lastFailure.resMsg}</>
                : '인증 연결·안내 회선 복귀 호출 결과'}
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 0, fontSize: 12 }}>
              24시간 수신 전화 {d?.calls24h?.total ?? 0}건 중 인증 외 전화 {d?.calls24h?.invalid ?? 0}건
            </Typography.Paragraph>
          </Card>
        </Col>
        <Col span={6}>
          <Card title="실패 사유 (전체)" size="small" styles={{ body: cardBody }} style={{ height: '100%' }}>
            {(d?.failReasons ?? []).length === 0 ? <Typography.Text type="secondary">없음</Typography.Text> :
              (d.failReasons as { reason: string; count: number }[]).slice(0, 7).map((r) => (
                <div key={r.reason} style={{ display: 'flex', justifyContent: 'space-between', lineHeight: '22px' }}>
                  <span>{FAIL_REASON_LABEL[r.reason] ?? r.reason}</span><b>{r.count}</b>
                </div>
              ))}
          </Card>
        </Col>
      </Row>

      <Row gutter={10}>
        <Col span={7}>
          <Card title="최근 14일 (초록 성공 / 분홍 전체)" size="small" styles={{ body: cardBody }} style={{ height: '100%' }}>
            {daily.map((x) => (
              <div key={x.day} style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: '19px', fontSize: 12 }}>
                <span style={{ width: 40, color: '#888' }}>{x.day.slice(5)}</span>
                <div style={{ flex: 1, background: '#f5f5f5', height: 11, position: 'relative' }}>
                  <div style={{ width: `${(x.total / maxDaily) * 100}%`, background: '#ffccc7', height: 11, position: 'absolute' }} />
                  <div style={{ width: `${(x.success / maxDaily) * 100}%`, background: '#95de64', height: 11, position: 'absolute' }} />
                </div>
                <span style={{ width: 64, textAlign: 'right' }}>{x.success} / {x.total}</span>
              </div>
            ))}
          </Card>
        </Col>
        <Col span={17}>
          <Card title="최근 인증" size="small" styles={{ body: { padding: 0 } }} style={{ height: '100%' }}>
            <Table<Record<string, any>> size="small" rowKey="sessionId" pagination={false} dataSource={(d?.recent ?? []).slice(0, 8)}
              columns={[
                { title: '시각', dataIndex: 'createdAt', width: 120, render: (v) => kst(v, true) },
                { title: '앱', dataIndex: 'mobileAppName', ellipsis: true },
                { title: '방식', dataIndex: 'mode', width: 56, render: (v) => (v === 'PC' ? 'PC' : '앱') },
                { title: '0507', dataIndex: 'vn', width: 130, render: fmtVn },
                { title: '휴대폰', dataIndex: 'callerPhoneMasked', width: 120, render: (v) => v ?? '-' },
                { title: '결과', render: (_, r) => <>
                  <Tag color={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0] ?? r.status}</Tag>
                  {r.failReason && <Typography.Text type="secondary">{FAIL_REASON_LABEL[r.failReason] ?? r.failReason}</Typography.Text>}
                </> },
              ]} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}