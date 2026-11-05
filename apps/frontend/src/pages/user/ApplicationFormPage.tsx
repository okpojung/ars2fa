import { Button, Card, Form, Input, Select, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../shared/api/client';

export function ApplicationFormPage() {
  const navigate = useNavigate();

  async function onFinish(values: {
    serviceName: string;
    mobileAppName: string;
    platform: 'ANDROID' | 'IOS' | 'WEB';
    allowedOrigins?: string;
    packageName?: string;
    bundleId?: string;
  }) {
    try {
      const { data } = await apiClient.post('/applications', {
        serviceName: values.serviceName,
        apps: [
          {
            mobileAppName: values.mobileAppName,
            platform: values.platform,
            packageName: values.platform === 'ANDROID' ? values.packageName?.trim() : undefined,
            bundleId: values.platform === 'IOS' ? values.bundleId?.trim() : undefined,
            allowedOrigins: values.platform === 'WEB' ? values.allowedOrigins : undefined,
          },
        ],
      });
      await apiClient.post(`/applications/${data.id}/submit`);
      message.success('API 신청이 제출되었습니다. 약 10분 뒤 자동으로 승인됩니다.');
      navigate('/console/applications');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '신청 실패');
    }
  }

  return (
    <Card>
      <Typography.Title level={2}>신규 API 신청</Typography.Title>
      <Form layout="vertical" onFinish={onFinish} initialValues={{ platform: 'ANDROID' }}>
        <Form.Item name="serviceName" label="서비스명" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="mobileAppName" label="앱(또는 웹사이트) 이름" rules={[{ required: true }]} extra="인증 안내와 팝업에 표시되는 이름입니다.">
          <Input />
        </Form.Item>
        <Form.Item name="platform" label="플랫폼" rules={[{ required: true }]}>
          <Select options={[{ value: 'ANDROID', label: 'Android 앱' }, { value: 'IOS', label: 'iOS 앱' }, { value: 'WEB', label: '웹사이트 (팝업 위젯)' }]} />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(a, b) => a.platform !== b.platform}>
          {({ getFieldValue }) => getFieldValue('platform') === 'ANDROID' ? (
            <Form.Item name="packageName" label="Android 패키지명 (applicationId)" extra="앱의 build.gradle에 있는 applicationId입니다. 인증 요청의 package_name과 같아야 합니다."
              rules={[{ required: true, message: 'Android 패키지명을 입력하세요.' }, { pattern: /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/, message: '예: com.example.app' }]}>
              <Input placeholder="com.example.app" />
            </Form.Item>
          ) : getFieldValue('platform') === 'IOS' ? (
            <Form.Item name="bundleId" label="iOS Bundle ID" extra="Xcode의 Bundle Identifier입니다. 인증 요청의 bundle_id와 같아야 합니다."
              rules={[{ required: true, message: 'iOS Bundle ID를 입력하세요.' }, { pattern: /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/, message: '예: com.example.app' }]}>
              <Input placeholder="com.example.app" />
            </Form.Item>
          ) : getFieldValue('platform') === 'WEB' ? (
            <Form.Item name="allowedOrigins" label="위젯을 쓸 사이트 주소" rules={[{ required: true, message: '사이트 주소를 입력하세요.' }]}
              extra="https:// 로 시작하는 주소, 여러 개는 쉼표로 (예: https://www.example.com, https://example.com)">
              <Input placeholder="https://www.example.com" />
            </Form.Item>
          ) : null}
        </Form.Item>
        <Button type="primary" htmlType="submit">
          신청 제출
        </Button>
      </Form>
    </Card>
  );
}
