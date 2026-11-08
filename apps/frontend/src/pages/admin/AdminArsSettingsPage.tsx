import { Button, Card, Form, InputNumber, Switch, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '../../shared/api/client';

const NUM: [string, string, string, number, number][] = [
  ['cooldownSeconds', '번호 휴식 시간', '인증이 끝난 번호를 다시 쓰기 전 쉬는 시간(초)', 0, 3600],
  ['authlogWaitSeconds', '통신사 기록(AuthLog) 대기', '전화가 들어온 뒤 다우 AuthLog를 기다리는 최대 시간(초)', 1, 20],
];
const BOOL: [string, string, string][] = [
  ['mobileOnly', '휴대폰 번호만 허용', '010·011·016~019 발신만 인증'],
];

export function AdminArsSettingsPage() {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const { data } = useQuery({ queryKey: ['ars-settings'], queryFn: async () => (await apiClient.get('/admin/ars/settings')).data });
  useEffect(() => { if (data) form.setFieldsValue(data); }, [data, form]);
  const save = useMutation({
    mutationFn: async (v: Record<string, unknown>) => (await apiClient.patch('/admin/ars/settings', v)).data,
    onSuccess: () => { message.success('저장했습니다.'); qc.invalidateQueries({ queryKey: ['ars-settings'] }); },
    onError: (e) => message.error((e as Error).message),
  });
  return (
    <>
      <Typography.Title level={2}>ARS 인증 설정</Typography.Title>
      <Typography.Paragraph type="secondary">
        서비스 전체에 적용되는 설정입니다. 전화 걸 수 있는 시간, 인증번호 입력 시간·자릿수, 1번 누르기는 고객이 API Key(신청)마다 정하고,
        정하지 않으면 기본값(앱·웹 전화 30초, 인증번호 입력 15초, 인증번호 3자리, 1번 누르기 켬)을 씁니다.
      </Typography.Paragraph>
      <Card>
        <Form form={form} layout="horizontal" labelCol={{ span: 8 }} wrapperCol={{ span: 14 }} onFinish={(v) => save.mutate(v)}>
          {NUM.map(([k, label, help, min, max]) => (
            <Form.Item key={k} name={k} label={label} extra={help}><InputNumber min={min} max={max} /></Form.Item>
          ))}
          {BOOL.map(([k, label, help]) => (
            <Form.Item key={k} name={k} label={label} extra={help} valuePropName="checked"><Switch /></Form.Item>
          ))}
          <Form.Item wrapperCol={{ offset: 8 }}><Button type="primary" htmlType="submit" loading={save.isPending}>저장</Button></Form.Item>
        </Form>
      </Card>
    </>
  );
}
