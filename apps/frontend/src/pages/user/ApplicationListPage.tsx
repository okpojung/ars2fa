import { Button, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../../shared/api/client';
import { APPLICATION_STATUS } from './ApplicationDetailPage';

export const PLATFORM_LABEL: Record<string, [string, string]> = { ANDROID: ['Android', 'green'], IOS: ['iOS', 'blue'], WEB: ['웹', 'purple'] };

export function PlatformTag({ p }: { p: string }) {
  return <Tag color={PLATFORM_LABEL[p]?.[1]}>{PLATFORM_LABEL[p]?.[0] ?? p}</Tag>;
}

/** Settings of one app / website in plain words (defaults resolved). */
export function AppSettingText({ a, defaults }: { a: Record<string, any>; defaults?: Record<string, any> }) {
  if (a.platform === 'WEB') {
    const digits = a.pcCodeDigits ?? defaults?.pcCodeDigits ?? 3;
    const sites = String(a.allowedOrigins ?? '').split(',').filter(Boolean);
    return (
      <Space direction="vertical" size={0}>
        <span>인증번호 {digits}자리{a.pcCodeDigits ? '' : ' (기본값)'}</span>
        <Typography.Text style={{ fontSize: 12 }}>전화 {a.leaseSeconds ?? defaults?.pcCallWindowSeconds ?? 30}초 · 입력 {a.pcCodeSeconds ?? defaults?.pcCodeSeconds ?? 15}초</Typography.Text>
        <Typography.Text type={sites.length ? undefined : 'danger'} style={{ fontSize: 12 }}>
          허용 사이트: {sites.length ? sites.join(', ') : '없음 (등록 필요)'}
        </Typography.Text>
        <Typography.Text type={a.siteKey ? 'secondary' : 'warning'} style={{ fontSize: 12 }}>사이트 키: {a.siteKey ? '발급됨' : '미발급'}</Typography.Text>
      </Space>
    );
  }
  const on = a.confirmKeyRequired ?? defaults?.confirmKeyRequired ?? true;
  return (
    <Space direction="vertical" size={0}>
      <span>1번 누르기 {on ? '켬' : '끔 (바로 인증)'}{a.confirmKeyRequired === null || a.confirmKeyRequired === undefined ? ' (기본값)' : ''}</span>
      <Typography.Text style={{ fontSize: 12 }}>전화 {a.leaseSeconds ?? defaults?.callWindowSeconds ?? 30}초</Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{a.platform === 'IOS' ? 'Bundle ID' : '패키지'}: {a.packageName ?? a.bundleId ?? '-'}</Typography.Text>
    </Space>
  );
}

export function ApplicationListPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['applications'],
    queryFn: async () => (await apiClient.get('/applications')).data,
  });
  const { data: defaults } = useQuery({ queryKey: ['console-defaults'], queryFn: async () => (await apiClient.get('/console/defaults')).data });

  return (
    <>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Typography.Title level={2}>API 신청·앱 설정</Typography.Title>
        <Link to="/console/applications/new"><Button type="primary">신규 신청</Button></Link>
      </Space>
      <Typography.Paragraph type="secondary">
        [보기]에서 앱 설정을 바꾸고, API Key를 확인([키 보기])할 수 있습니다.
      </Typography.Paragraph>
      <Table<Record<string, any>>
        rowKey="id"
        loading={isLoading}
        dataSource={data ?? []}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }}
        columns={[
          { title: '서비스명', dataIndex: 'serviceName', render: (v, r) => <Link to={`/console/applications/${r.id}`}>{v}</Link> },
          { title: '종류', render: (_, r) => <>{(r.apps ?? []).map((a: any) => <PlatformTag key={a.id} p={a.platform} />)}</> },
          { title: '앱 / 사이트 이름', render: (_, r) => (r.apps ?? []).map((a: any) => <div key={a.id}>{a.displayName || a.mobileAppName}</div>) },
          { title: '설정', render: (_, r) => (r.apps ?? []).map((a: any) => <AppSettingText key={a.id} a={a} defaults={defaults} />) },
          { title: 'API Key', render: (_, r) => (r.apiKeys ?? []).length
            ? (r.apiKeys as any[]).map((k) => <div key={k.id}><Typography.Text code style={{ fontSize: 12 }}>{k.keyPrefix}</Typography.Text> <Tag color={k.status === 'ACTIVE' ? 'green' : 'red'}>{k.status}</Tag></div>)
            : <Typography.Text type="secondary">승인 후 발급</Typography.Text> },
          { title: '상태', dataIndex: 'status', render: (v) => <Tag color={v === 'APPROVED' ? 'green' : undefined}>{APPLICATION_STATUS[v] ?? v}</Tag> },
          { title: '신청일', dataIndex: 'createdAt', render: (v) => (v ? new Date(v).toLocaleDateString('ko-KR') : '-') },
          { title: '상세', render: (_, r) => <Link to={`/console/applications/${r.id}`}>보기</Link> },
        ]}
      />
    </>
  );
}
