import { Button, Form, Input, Modal, Select, Table, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../../shared/api/client';

const POLICY: Record<string, [string, string]> = { OFF: ['끔', 'default'], MONITOR: ['감시(기록만)', 'blue'], ENFORCE: ['강제(차단)', 'red'] };

export function AdminAppSecurityPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Record<string, any> | null>(null);
  const [form] = Form.useForm();
  const { data, isLoading } = useQuery({ queryKey: ['ars-apps'], queryFn: async () => (await apiClient.get('/admin/ars/apps')).data });
  const save = useMutation({
    mutationFn: async (v: Record<string, unknown>) => (await apiClient.patch(`/admin/ars/apps/${editing!.id}/security`, v)).data,
    onSuccess: () => { message.success('저장했습니다.'); setEditing(null); qc.invalidateQueries({ queryKey: ['ars-apps'] }); },
    onError: (e) => message.error((e as Error).message),
  });
  return (
    <>
      <Typography.Title level={2}>앱 보안 (위조 방지·피싱 안내)</Typography.Title>
      <Typography.Paragraph type="secondary">
        감시: 앱 무결성 검증 결과만 기록합니다. 강제: Android Play Integrity 또는 iOS App Attest를 통과한 정품 앱만 인증을 시작할 수 있습니다.
        강제로 하려면 Android는 패키지명, iOS는 Bundle ID와 Team ID를 먼저 넣어야 합니다(신청서에서 받은 값이며 여기서 고칠 수 있습니다). 표시 이름은 앱 화면과 팝업에 쓰입니다.
      </Typography.Paragraph>
      <Table<Record<string, any>> rowKey="id" loading={isLoading} dataSource={data ?? []}
        columns={[
          { title: '회사/서비스', render: (_, r) => `${r.application?.user?.companyName ?? ''} / ${r.application?.serviceName ?? ''}` },
          { title: '앱', render: (_, r) => `${r.mobileAppName} (${r.platform})` },
          { title: '패키지/번들', render: (_, r) => r.packageName || r.bundleId },
          { title: '표시 이름', render: (_, r) => r.displayName || r.mobileAppName },
          { title: '앱 검증', dataIndex: 'integrityPolicy', render: (v) => <Tag color={POLICY[v]?.[1]}>{POLICY[v]?.[0] ?? v}</Tag> },
          { title: '', render: (_, r) => <Button onClick={() => { setEditing(r); form.setFieldsValue({ integrityPolicy: r.integrityPolicy, displayName: r.displayName ?? '', androidCertSha256: r.androidCertSha256 ?? '', iosTeamId: r.iosTeamId ?? '', packageName: r.packageName ?? '', bundleId: r.bundleId ?? '' }); }}>설정</Button> },
        ]} />
      <Modal open={!!editing} title={`${editing?.mobileAppName ?? ''} 보안 설정`} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={save.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="integrityPolicy" label="앱 무결성 검증"><Select options={Object.entries(POLICY).map(([value, [label]]) => ({ value, label }))} /></Form.Item>
          <Form.Item name="displayName" label="표시 이름 (피싱 방지 안내)" extra="예: 바로포인트"><Input maxLength={40} /></Form.Item>
          {editing?.platform === 'ANDROID' && (
            <Form.Item name="packageName" label="Android 패키지명 (applicationId)" extra="예: com.hnglife.bspoint · 인증 요청 값과 비교하고 위조 방지에도 씁니다"><Input /></Form.Item>
          )}
          {editing?.platform === 'IOS' && (
            <Form.Item name="bundleId" label="iOS Bundle ID" extra="예: com.hnglife.bspoint · 인증 요청 값과 비교하고 위조 방지에도 씁니다"><Input /></Form.Item>
          )}
          {editing?.platform === 'ANDROID' && (
            <Form.Item name="androidCertSha256" label="서명 인증서 SHA-256 (Play Integrity 값, 쉼표로 여러 개)"><Input /></Form.Item>
          )}
          {editing?.platform === 'IOS' && (
            <Form.Item name="iosTeamId" label="Apple Team ID (App Attest)" extra="10자리 영문 대문자·숫자" rules={[{ pattern: /^[A-Z0-9]{10}$/, message: '10자리 영문 대문자·숫자' }]}><Input maxLength={10} /></Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
