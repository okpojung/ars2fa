import { Button, Card, Form, Input, InputNumber, Select, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../shared/api/client';

export function ApplicationFormPage() {
  const navigate = useNavigate();

  async function onFinish(values: {
    serviceName: string;
    usagePurpose: string;
    expectedMonthlyRequests: number;
    mobileAppName: string;
    platform: 'ANDROID' | 'IOS' | 'WEB';
    allowedOrigins?: string;
    packageName?: string;
    bundleId?: string;
    storeUrl?: string;
  }) {
    try {
      const { data } = await apiClient.post('/applications', {
        serviceName: values.serviceName,
        usagePurpose: values.usagePurpose,
        expectedMonthlyRequests: values.expectedMonthlyRequests,
        apps: [
          {
            mobileAppName: values.mobileAppName,
            platform: values.platform,
            packageName: values.packageName,
            bundleId: values.bundleId,
            storeUrl: values.storeUrl,
            allowedOrigins: values.platform === 'WEB' ? values.allowedOrigins : undefined,
          },
        ],
      });
      await apiClient.post(`/applications/${data.id}/submit`);
      message.success('API 신청이 제출되었습니다.');
      navigate('/console/applications');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '신청 실패');
    }
  }

  return (
    <Card>
      <Typography.Title level={2}>신규 API 신청</Typography.Title>
      <Form layout="vertical" onFinish={onFinish} initialValues={{ platform: 'ANDROID', expectedMonthlyRequests: 10000 }}>
        <Form.Item name="serviceName" label="서비스명" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="usagePurpose" label="사용 목적" rules={[{ required: true }]}>
          <Input.TextArea rows={4} />
        </Form.Item>
        <Form.Item name="expectedMonthlyRequests" label="예상 월 요청 수" rules={[{ required: true }]}>
          <InputNumber min={1} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="mobileAppName" label="앱(또는 웹사이트) 이름" rules={[{ required: true }]} extra="인증 안내와 팝업에 표시되는 이름입니다.">
          <Input />
        </Form.Item>
        <Form.Item name="platform" label="플랫폼" rules={[{ required: true }]}>
          <Select options={[{ value: 'ANDROID', label: 'Android 앱' }, { value: 'IOS', label: 'iOS 앱' }, { value: 'WEB', label: '웹사이트 (팝업 위젯)' }]} />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(a, b) => a.platform !== b.platform}>
          {({ getFieldValue }) => getFieldValue('platform') === 'WEB' ? (
            <Form.Item name="allowedOrigins" label="위젯을 쓸 사이트 주소" rules={[{ required: true, message: '사이트 주소를 입력하세요.' }]}
              extra="https:// 로 시작하는 주소, 여러 개는 쉼표로 (예: https://www.example.com, https://example.com)">
              <Input placeholder="https://www.example.com" />
            </Form.Item>
          ) : null}
        </Form.Item>
        <Form.Item name="packageName" label="Android 패키지명">
          <Input />
        </Form.Item>
        <Form.Item name="bundleId" label="iOS Bundle ID">
          <Input />
        </Form.Item>
        <Form.Item name="storeUrl" label="스토어 URL">
          <Input />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          신청 제출
        </Button>
      </Form>
    </Card>
  );
}
