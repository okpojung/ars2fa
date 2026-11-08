import { Alert, Button, Card, Form, InputNumber, Select, Space, Table, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '../../shared/api/client';

const NUM: [string, string, string][] = [
  ['leaseSecondsApp', '앱 인증: 전화 걸 수 있는 시간', '번호를 빌려주고 착신을 켜 두는 시간(초). 지나면 그 번호로는 인증할 수 없습니다.'],
  ['leaseSecondsPc', 'PC·웹 인증: 전화 걸 수 있는 시간', 'QR을 찍고 전화를 걸 수 있는 시간(초)'],
  ['pcCodeSeconds', 'PC·웹 인증: 인증번호 입력 시간', '전화가 연결된 뒤 화면의 숫자를 휴대폰 키패드로 누를 수 있는 시간(초)'],
];

type SettingsResp = {
  effective: Record<string, number | boolean>; own: Record<string, number | boolean>;
  defaults: Record<string, number | boolean>; bounds: Record<string, [number, number]>;
};

/** Customer's own ARS settings (apply to all of the customer's apps; per-app press-1 setting still wins). */
export function ConsoleArsSettingsPage() {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const { data } = useQuery({ queryKey: ['console-ars-settings'], queryFn: async () => (await apiClient.get('/console/ars-settings')).data as SettingsResp });
  useEffect(() => {
    if (!data) return;
    form.setFieldsValue(data.own);
  }, [data, form]);
  const save = useMutation({
    mutationFn: async (v: Record<string, unknown>) => {
      const body: Record<string, unknown> = {};
      for (const [k] of NUM) body[k] = v[k] === undefined || v[k] === null || v[k] === '' ? null : v[k];
      return (await apiClient.patch('/console/ars-settings', body)).data;
    },
    onSuccess: () => { message.success('저장했습니다. 다음 인증부터 적용됩니다.'); qc.invalidateQueries({ queryKey: ['console-ars-settings'] }); qc.invalidateQueries({ queryKey: ['console-defaults'] }); },
    onError: (e) => message.error((e as Error).message),
  });

  return (
    <>
      <Typography.Title level={2}>ARS 설정</Typography.Title>
      <Alert type="info" showIcon style={{ marginBottom: 16 }}
        message={<>내 계정의 모든 앱·웹사이트에 적용되는 시간 설정입니다. 비워 두면 서비스 기본값을 씁니다.<br />
          <b>앱 인증의 1번 누르기</b>와 <b>웹 인증의 인증번호 자릿수</b>는 API Key(신청)마다 다르게 정할 수 있도록 <b>API 신청·앱 설정 → 신청 상세 → 앱 설정</b>으로 옮겼습니다.</>} />
      <Card>
        <Form form={form} layout="horizontal" labelCol={{ span: 8 }} wrapperCol={{ span: 14 }} onFinish={(v) => save.mutate(v)}>
          {NUM.map(([k, label, help]) => (
            <Form.Item key={k} name={k} label={label}
              extra={<>{help} · 범위 {data?.bounds[k]?.[0]}~{data?.bounds[k]?.[1]} · 서비스 기본값 {String(data?.defaults[k] ?? '-')}</>}>
              <InputNumber min={data?.bounds[k]?.[0]} max={data?.bounds[k]?.[1]} placeholder={`기본값 ${data?.defaults[k] ?? ''}`} style={{ width: 160 }} />
            </Form.Item>
          ))}

          <Form.Item wrapperCol={{ offset: 8 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={save.isPending}>저장</Button>
              <Button onClick={() => { form.setFieldsValue(Object.fromEntries(NUM.map(([k]) => [k, null]))); }}>모두 기본값으로</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
      <Card title="현재 적용 값" size="small" style={{ marginTop: 16 }}>
        <Table size="small" pagination={false} rowKey="k"
          dataSource={NUM.map(([k, label]) => ({ k, label, v: data?.effective[k], own: data?.own[k] !== undefined }))}
          columns={[{ title: '항목', dataIndex: 'label' }, { title: '값', dataIndex: 'v', render: (v) => String(v ?? '-') },
            { title: '출처', dataIndex: 'own', render: (o) => (o ? '내 설정' : '서비스 기본값') }]} />
      </Card>
    </>
  );
}
