import { Button, Card, Descriptions, Input, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '../../shared/api/client';
import { RotateKeyButton } from './RotateKeyButton';
import { WebWidgetSettings } from './WebWidgetSettings';

export const APPLICATION_STATUS: Record<string, string> = {
  DRAFT: '작성 중', SUBMITTED: '심사 중', NEEDS_REVISION: '보완 요청', APPROVED: '승인', REJECTED: '반려', PENDING: '심사 대기', SUSPENDED: '정지',
};

function AppSettings({ app, defaultConfirm }: { app: Record<string, any>; defaultConfirm?: boolean }) {
  const qc = useQueryClient();
  const initial = app.confirmKeyRequired === null || app.confirmKeyRequired === undefined ? 'default' : app.confirmKeyRequired ? 'on' : 'off';
  const [confirm, setConfirm] = useState<string>(initial);
  const [name, setName] = useState<string>(app.displayName ?? '');
  const save = useMutation({
    mutationFn: async () => (await apiClient.patch(`/console/apps/${app.id}/settings`, {
      confirmKeyRequired: confirm === 'default' ? null : confirm === 'on', displayName: name,
    })).data,
    onSuccess: () => { message.success('저장했습니다. 다음 인증부터 적용됩니다.'); qc.invalidateQueries({ queryKey: ['application'] }); },
    onError: (e) => message.error((e as Error).message),
  });
  return (
    <Space wrap>
      <span>안내 서비스 이름</span>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={app.mobileAppName} maxLength={40} style={{ width: 170 }} />
      <span>1번 누르기</span>
      <Select value={confirm} onChange={setConfirm} style={{ width: 190 }} options={[
        { value: 'default', label: `서비스 기본값 (${defaultConfirm === false ? '끔' : '켬'})` },
        { value: 'on', label: '켬 (안내 후 1번)' },
        { value: 'off', label: '끔 (바로 인증)' },
      ]} />
      <Button type="primary" size="small" loading={save.isPending} onClick={() => save.mutate()}>저장</Button>
    </Space>
  );
}

export function ApplicationDetailPage() {
  const { id } = useParams();
  const { data } = useQuery({ queryKey: ['application', id], queryFn: async () => (await apiClient.get(`/applications/${id}`)).data, enabled: Boolean(id) });
  const { data: defaults } = useQuery({ queryKey: ['console-defaults'], queryFn: async () => (await apiClient.get('/console/defaults')).data });
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <Typography.Title level={3} style={{ marginTop: 0 }}>{data?.serviceName}</Typography.Title>
        <Descriptions bordered column={2} size="small">
          <Descriptions.Item label="상태"><Tag color={data?.status === 'APPROVED' ? 'green' : undefined}>{APPLICATION_STATUS[data?.status] ?? data?.status}</Tag></Descriptions.Item>
          <Descriptions.Item label="관리자 의견" span={2}>{data?.adminComment ?? '-'}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="앱 설정">
        <Table<Record<string, any>> rowKey="id" pagination={false} dataSource={data?.apps ?? []}
          columns={[
            { title: '앱', render: (_, a) => <><b>{a.mobileAppName}</b> <Tag>{a.platform}</Tag><br /><Typography.Text type="secondary">{a.packageName ?? a.bundleId ?? ''}</Typography.Text></> },
            { title: '상태', dataIndex: 'status', render: (v) => <Tag color={v === 'APPROVED' ? 'green' : undefined}>{APPLICATION_STATUS[v] ?? v}</Tag> },
            { title: '앱 위조 방지', dataIndex: 'integrityPolicy', render: (v, a) => a.platform === 'WEB' ? '-' : ({ OFF: '사용 안 함', MONITOR: '기록만', ENFORCE: '차단' } as Record<string, string>)[v] ?? v },
            { title: '설정', render: (_, a) => <AppSettings app={a} defaultConfirm={defaults?.confirmKeyRequired} /> },
          ]} expandable={{ rowExpandable: (a) => a.platform === 'WEB', defaultExpandAllRows: true,
            expandedRowRender: (a) => <WebWidgetSettings app={a} /> }} />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          1번 누르기: 켜면 "휴대폰 인증을 하시려면 1번을 누르세요" 안내 후 1번을 눌러야 인증됩니다. 끄면 1번 없이 연결 즉시 인증합니다. 인증 요청에 type(0/1)을 보내면 그 값이 먼저 적용됩니다.
          앱 인증에만 적용되며, PC 인증은 화면의 숫자를 휴대폰으로 누르는 방식입니다.
        </Typography.Paragraph>
      </Card>
      <Card title="API Key">
        {(data?.apiKeys ?? []).length === 0 ? <Typography.Text type="secondary">신청이 승인되면 API Key가 만들어집니다.</Typography.Text> : (
          <Table<Record<string, any>> rowKey="id" pagination={false} size="small" dataSource={data.apiKeys}
            columns={[
              { title: 'Key 앞자리', dataIndex: 'keyPrefix', render: (v) => <Typography.Text code>{v}…</Typography.Text> },
              { title: '환경', dataIndex: 'environment' },
              { title: '상태', dataIndex: 'status', render: (v) => <Tag color={v === 'ACTIVE' ? 'green' : 'red'}>{v}</Tag> },
              { title: '월 한도', dataIndex: 'monthlyLimit', render: (v) => v?.toLocaleString() },
              { title: '', render: (_, k) => k.status !== 'REVOKED' && <RotateKeyButton id={k.id} issued={k.updatedAt !== k.createdAt} /> },
            ]} />
        )}
      </Card>
    </Space>
  );
}
