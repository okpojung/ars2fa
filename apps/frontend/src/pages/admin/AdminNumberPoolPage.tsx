import { Button, Card, Col, Descriptions, Input, Modal, Row, Select, Space, Statistic, Switch, Table, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../../shared/api/client';

const fmt = (vn: string) => (vn?.length === 12 ? `${vn.slice(0, 4)}-${vn.slice(4, 8)}-${vn.slice(8)}` : vn);
const fmtRn = (rn: string) => (rn?.length === 11 ? `${rn.slice(0, 3)}-${rn.slice(3, 7)}-${rn.slice(7)}` : rn);

export function AdminNumberPoolPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [remap, setRemap] = useState(false);

  const summary = useQuery({ queryKey: ['ars-pool-summary'], queryFn: async () => (await apiClient.get('/admin/ars/pool/summary')).data, refetchInterval: 10_000 });
  const list = useQuery({
    queryKey: ['ars-pool', q, status, page],
    queryFn: async () => (await apiClient.get('/admin/ars/pool', { params: { q, status, skip: (page - 1) * 100, take: 100 } })).data,
  });
  const toggle = useMutation({
    mutationFn: (v: { id: number; status: string }) => apiClient.patch(`/admin/ars/pool/${v.id}`, { status: v.status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ars-pool'] }); qc.invalidateQueries({ queryKey: ['ars-pool-summary'] }); },
    onError: (e) => message.error((e as Error).message),
  });
  const unlink = useMutation({
    mutationFn: (id: number) => apiClient.post(`/admin/ars/pool/${id}/unlink`),
    onSuccess: () => { message.success('착신 해제를 요청했습니다. 몇 초 안에 반영됩니다.'); setTimeout(() => qc.invalidateQueries({ queryKey: ['ars-pool'] }), 3000); },
    onError: (e) => message.error((e as Error).message),
  });
  const doImport = useMutation({
    mutationFn: async () => {
      // accepts the old-new number-pool JSON ({numbers:[...]}) plus {lines:[...]} or "numbers" / "lines" text blocks
      const j = JSON.parse(importText);
      return (await apiClient.post('/admin/ars/pool/import', { numbers: j.numbers, lines: j.lines, remap_rn: remap })).data;
    },
    onSuccess: (r) => { message.success(`추가 ${r.created}개, 070 재배정 ${r.remapped}개 (전체 ${r.total}개)`); setImportOpen(false); qc.invalidateQueries(); },
    onError: (e) => message.error(e instanceof SyntaxError ? 'JSON 형식이 아닙니다.' : (e as Error).message),
  });

  const s = summary.data;
  return (
    <>
      <Typography.Title level={2}>0507 번호 풀</Typography.Title>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={4}><Card><Statistic title="전체" value={s?.total ?? 0} /></Card></Col>
        <Col span={4}><Card><Statistic title="사용 가능" value={s?.active ?? 0} /></Card></Col>
        <Col span={4}><Card><Statistic title="인증 진행 중" value={s?.leased ?? 0} /></Card></Col>
        <Col span={4}><Card><Statistic title="휴식 중" value={s?.cooling ?? 0} /></Card></Col>
        <Col span={4}><Card><Statistic title="CallMix 착신 켜짐" value={s?.linkOn ?? 0} suffix={s?.linkUnknown ? <Tag color="red">확인 필요 {s.linkUnknown}</Tag> : null} /></Card></Col>
        <Col span={4}><Card><Statistic title={`랜덤 순환 ${s?.cycle ? `${s.cycle.cycleNo}회차` : '(시작 전)'}`} value={s?.cycle ? `${s.cycle.used} / ${s.cycle.size}` : '-'} /></Card></Col>
      </Row>
      <Card style={{ marginBottom: 16 }} title="070 착신 회선 (0507 → 070 순서대로 배정)">
        <Descriptions size="small" column={5}>
          {(s?.lines ?? []).map((l: any) => <Descriptions.Item key={l.rn} label={fmtRn(l.rn)}>{l.numbers}개</Descriptions.Item>)}
        </Descriptions>
      </Card>
      <Space style={{ marginBottom: 12 }}>
        <Input.Search placeholder="0507 또는 070 번호" allowClear onSearch={(v) => { setQ(v); setPage(1); }} style={{ width: 260 }} />
        <Select allowClear placeholder="상태" style={{ width: 140 }} value={status} onChange={(v) => { setStatus(v); setPage(1); }}
          options={[{ value: 'ACTIVE', label: '사용' }, { value: 'DISABLED', label: '중지' }]} />
        <Button onClick={() => setImportOpen(true)}>번호 가져오기</Button>
      </Space>
      <Table<Record<string, any>>
        rowKey="id" size="small" loading={list.isLoading} dataSource={list.data?.items ?? []}
        pagination={{ current: page, pageSize: 100, total: list.data?.total ?? 0, onChange: setPage, showSizeChanger: false }}
        columns={[
          { title: '#', dataIndex: 'ordinal', width: 70 },
          { title: '0507', dataIndex: 'vn', render: fmt },
          { title: '착신 070', dataIndex: 'rn', render: fmtRn },
          { title: '상태', dataIndex: 'status', render: (v) => <Tag color={v === 'ACTIVE' ? 'green' : 'red'}>{v === 'ACTIVE' ? '사용' : '중지'}</Tag> },
          { title: '인증 중', render: (_, r) => (r.leasedUntil && new Date(r.leasedUntil) > new Date() ? <Tag color="orange">임대</Tag> : r.cooldownUntil && new Date(r.cooldownUntil) > new Date() ? <Tag>휴식</Tag> : '') },
          { title: 'CallMix 착신', render: (_, r) => r.routing === 'STATIC' ? <Tag color="blue">고정(시험)</Tag>
            : r.linkState === 'ON' ? <Tag color="orange">켜짐</Tag>
            : r.linkState === 'UNKNOWN' ? <Tag color="red" title={r.linkError ?? ''}>확인 필요{r.linkFailCount ? ` (실패 ${r.linkFailCount})` : ''}</Tag>
            : <Tag>꺼짐</Tag> },
          { title: '사용 횟수', dataIndex: 'useCount' },
          { title: '최근 사용', dataIndex: 'lastUsedAt', render: (v) => (v ? new Date(v).toLocaleString('ko-KR') : '-') },
          { title: '', render: (_, r) => <Space>
            {r.routing === 'DYNAMIC' && r.linkState !== 'OFF' && <Button size="small" danger onClick={() => unlink.mutate(r.id)}>착신 해제</Button>}
            <Switch checked={r.status === 'ACTIVE'} onChange={(on) => toggle.mutate({ id: r.id, status: on ? 'ACTIVE' : 'DISABLED' })} />
          </Space> },
        ]}
      />
      <Modal open={importOpen} title="번호 가져오기" onCancel={() => setImportOpen(false)} onOk={() => doImport.mutate()} confirmLoading={doImport.isPending} width={720}>
        <Typography.Paragraph type="secondary">
          {'{"numbers": ["050700952000", ...], "lines": ["07051901950", ..., "07051901999"]}'} 형식. 이미 있는 번호는 건너뜁니다.
          새 번호는 목록 순서대로 070 회선에 하나씩 차례로 배정됩니다.
        </Typography.Paragraph>
        <Input.TextArea rows={12} value={importText} onChange={(e) => setImportText(e.target.value)} style={{ fontFamily: 'monospace' }} />
        <Space style={{ marginTop: 8 }}><Switch checked={remap} onChange={setRemap} /> 기존 번호도 070 배정을 다시 계산</Space>
      </Modal>
    </>
  );
}
