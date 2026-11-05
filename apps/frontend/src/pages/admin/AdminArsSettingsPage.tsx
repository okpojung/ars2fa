import { Button, Card, Form, InputNumber, Switch, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '../../shared/api/client';

const NUM: [string, string, string, number, number][] = [
  ['leaseSecondsApp', '앱 인증: 전화 걸 수 있는 시간', '번호를 빌려주고 CallMix 착신을 켜 두는 시간(초). 지나면 착신을 끕니다.', 15, 600],
  ['leaseSecondsPc', 'PC 인증: 전화 걸 수 있는 시간', 'QR을 찍고 전화를 걸 수 있는 시간(초). 지나면 착신을 끕니다.', 15, 900],
  ['pcCodeSeconds', 'PC 인증: 인증번호 입력 시간', '전화가 연결된 뒤 PC 화면의 인증번호를 휴대폰 키패드로 누를 수 있는 시간(초)', 10, 120],
  ['pcCodeDigits', 'PC 인증: 인증번호 자릿수', '전화가 연결되면 PC 화면에 보여 주는 인증번호의 자릿수', 3, 6],
  ['cooldownSeconds', '번호 휴식 시간', '인증이 끝난 번호를 다시 쓰기 전 쉬는 시간(초)', 0, 3600],
  ['authlogWaitSeconds', '통신사 기록(AuthLog) 대기', '전화가 들어온 뒤 다우 AuthLog를 기다리는 최대 시간(초)', 1, 20],
];
const BOOL: [string, string, string][] = [
  ['confirmKeyRequired', '피싱 방지: 1번 눌러 확인', '통화 시작 시 "본인이 요청하지 않았다면 끊으세요" 안내 후 1번을 눌러야 진행'],
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
