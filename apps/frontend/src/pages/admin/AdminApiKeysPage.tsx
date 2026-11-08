import { Button, Descriptions, Drawer, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../../shared/api/client';
import { AppSettingText, PLATFORM_LABEL, PlatformTag } from '../user/ApplicationListPage';

const KEY_STATUS: Record<string, [string, string]> = { ACTIVE: ['사용 중', 'green'], SUSPENDED: ['정지', 'orange'], REVOKED: ['폐기', 'red'] };
const types = (r: Record<string, any>) => (r.application?.apps ?? []).map((a: any) => PLATFORM_LABEL[a.platform]?.[0] ?? a.platform).join(', ');
const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString('ko-KR', { hour12: false }) : '-');
const limit = (v: number) => (v > 0 ? Number(v).toLocaleString() : '무제한');

/** Admin: every API key with its owner (user ID), type, usage and a detail view. */
export function AdminApiKeysPage() {
  const queryClient = useQueryClient();
  const [detail, setDetail] = useState<Record<string, any> | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['admin-api-keys'],
    queryFn: async () => (await apiClient.get('/admin/api-keys')).data,
  });
  const done = () => queryClient.invalidateQueries({ queryKey: ['admin-api-keys'] });
  const suspend = useMutation({ mutationFn: (id: string) => apiClient.post(`/admin/api-keys/${id}/suspend`), onSuccess: done });
  const revoke = useMutation({ mutationFn: (id: string) => apiClient.post(`/admin/api-keys/${id}/revoke`), onSuccess: done });

  const d = detail;
  return (
    <>
      <Typography.Title level={2}>API Key 운영</Typography.Title>
      <Table<Record<string, any>>
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={data ?? []}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (t) => `전체 ${t}개` }}
        columns={[
          { title: '사용자 ID', render: (_, r) => r.application?.user?.email ?? '-',
            sorter: (a, b) => String(a.application?.user?.email ?? '').localeCompare(String(b.application?.user?.email ?? '')), defaultSortOrder: 'ascend' },
          { title: 'Key 종류', render: (_, r) => <>{(r.application?.apps ?? []).map((a: any) => <PlatformTag key={a.id} p={a.platform} />)}</>,
            sorter: (a, b) => types(a).localeCompare(types(b)) },
          { title: '서비스', render: (_, r) => r.application?.serviceName,
            sorter: (a, b) => String(a.application?.serviceName ?? '').localeCompare(String(b.application?.serviceName ?? '')) },
          { title: 'Key', dataIndex: 'keyPrefix', render: (v) => <Typography.Text code style={{ fontSize: 12 }}>{v}</Typography.Text> },
          { title: '상태', dataIndex: 'status', render: (v) => <Tag color={KEY_STATUS[v]?.[1]}>{KEY_STATUS[v]?.[0] ?? v}</Tag>,
            sorter: (a, b) => String(a.status).localeCompare(String(b.status)) },
          { title: '이번 달 / 전체', render: (_, r) => `${(r.usage?.month ?? 0).toLocaleString()} / ${(r.usage?.total ?? 0).toLocaleString()}`,
            sorter: (a, b) => (a.usage?.total ?? 0) - (b.usage?.total ?? 0) },
          { title: '월 한도', dataIndex: 'monthlyLimit', render: limit },
          {
            title: '작업',
            render: (_, r) => (
              <Space>
                <Button size="small" type="primary" onClick={() => setDetail(r)}>상세</Button>
                <Popconfirm title="이 키를 정지할까요?" okText="정지" cancelText="취소" onConfirm={() => suspend.mutate(r.id)} disabled={r.status !== 'ACTIVE'}>
                  <Button size="small" disabled={r.status !== 'ACTIVE'}>정지</Button>
                </Popconfirm>
                <Popconfirm title="폐기하면 되돌릴 수 없습니다. 폐기할까요?" okText="폐기" cancelText="취소" onConfirm={() => revoke.mutate(r.id)} disabled={r.status === 'REVOKED'}>
                  <Button size="small" danger disabled={r.status === 'REVOKED'}>폐기</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Drawer open={!!d} onClose={() => setDetail(null)} width={760} title={d ? `API Key 상세 · ${d.application?.serviceName ?? ''}` : ''}>
        {d && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Descriptions title="Key" bordered size="small" column={2}>
              <Descriptions.Item label="Key 앞자리" span={2}><Typography.Text code>{d.keyPrefix}</Typography.Text></Descriptions.Item>
              <Descriptions.Item label="상태"><Tag color={KEY_STATUS[d.status]?.[1]}>{KEY_STATUS[d.status]?.[0] ?? d.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="종류">{types(d) || '-'}</Descriptions.Item>
              <Descriptions.Item label="월 한도">{limit(d.monthlyLimit)}</Descriptions.Item>
              <Descriptions.Item label="분당 한도">{d.rateLimitPerMinute ?? '-'}건</Descriptions.Item>
              <Descriptions.Item label="발급일">{fmt(d.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="마지막 변경">{fmt(d.updatedAt)}</Descriptions.Item>
              <Descriptions.Item label="마지막 사용">{fmt(d.lastUsedAt)}</Descriptions.Item>
              <Descriptions.Item label="고객 키 조회">{d.firstShownAt ? `처음 조회 ${fmt(d.firstShownAt)} · 다시 보기 ${d.revealCount ?? 0}/3회` : '아직 조회 안 함'}</Descriptions.Item>
            </Descriptions>
            <Descriptions title="사용량" bordered size="small" column={2}>
              <Descriptions.Item label="이번 달 인증">{(d.usage?.month ?? 0).toLocaleString()}건</Descriptions.Item>
              <Descriptions.Item label="전체 인증">{(d.usage?.total ?? 0).toLocaleString()}건</Descriptions.Item>
              <Descriptions.Item label="성공">{(d.usage?.verified ?? 0).toLocaleString()}건</Descriptions.Item>
              <Descriptions.Item label="최근 인증">{fmt(d.usage?.lastAt)}</Descriptions.Item>
            </Descriptions>
            <Descriptions title="사용자" bordered size="small" column={2}>
              <Descriptions.Item label="사용자 ID" span={2}>{d.application?.user?.email ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="회사">{d.application?.user?.companyName ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="담당자">{d.application?.user?.contactName ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="계정 상태">{d.application?.user?.status ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="가입일">{fmt(d.application?.user?.createdAt)}</Descriptions.Item>
            </Descriptions>
            <div>
              <Typography.Title level={5}>앱 / 웹사이트</Typography.Title>
              <Table<Record<string, any>> size="small" rowKey="id" pagination={false} dataSource={d.application?.apps ?? []}
                columns={[
                  { title: '종류', dataIndex: 'platform', render: (p) => <PlatformTag p={p} /> },
                  { title: '이름', render: (_, a) => <>{a.mobileAppName}{a.displayName ? <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>표시: {a.displayName}</Typography.Text></div> : null}</> },
                  { title: '설정', render: (_, a) => <AppSettingText a={a} /> },
                  { title: '위조 방지', dataIndex: 'integrityPolicy', render: (v, a) => (a.platform === 'WEB' ? '-' : ({ OFF: '사용 안 함', MONITOR: '기록만', ENFORCE: '차단' } as Record<string, string>)[v] ?? v) },
                  { title: '상태', dataIndex: 'status' },
                ]} />
            </div>
            <Descriptions title="신청" bordered size="small" column={2}>
              <Descriptions.Item label="서비스명" span={2}>{d.application?.serviceName}</Descriptions.Item>
              <Descriptions.Item label="신청 상태">{d.application?.status}</Descriptions.Item>
              <Descriptions.Item label="승인일">{fmt(d.application?.approvedAt)}</Descriptions.Item>
              <Descriptions.Item label="관리자 의견" span={2}>{d.application?.adminComment ?? '-'}</Descriptions.Item>
            </Descriptions>
          </Space>
        )}
      </Drawer>
    </>
  );
}
