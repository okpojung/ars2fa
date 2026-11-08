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
    confirm?: 'default' | 'on' | 'off';
    digits?: string;
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
            confirmKeyRequired: values.platform !== 'WEB' && values.confirm && values.confirm !== 'default' ? values.confirm === 'on' : undefined,
            pcCodeDigits: values.platform === 'WEB' && values.digits && values.digits !== 'default' ? Number(values.digits) : undefined,
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
      <Form layout="vertical" onFinish={onFinish} initialValues={{ platform: 'ANDROID', confirm: 'default', digits: 'default' }}>
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
          ) : null}
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(a, b) => a.platform !== b.platform}>
          {({ getFieldValue }) => getFieldValue('platform') === 'WEB' ? (
            <Form.Item name="digits" label="인증번호 자릿수" extra="PC 화면(팝업)에 보여 주고 휴대폰 키패드로 누르는 숫자의 자릿수입니다. 신청 후에도 신청 상세에서 바꿀 수 있습니다.">
              <Select style={{ width: 200 }} options={[{ value: 'default', label: '기본값 (3자리)' }, ...[3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n}자리` }))]} />
            </Form.Item>
          ) : (
            <Form.Item name="confirm" label="1번 누르기" extra="켜면 '휴대폰 인증을 하시려면 1번을 누르세요' 안내 후 1번을 눌러야 인증됩니다. 끄면 연결 즉시 인증합니다. 신청 후에도 바꿀 수 있습니다.">
              <Select style={{ width: 200 }} options={[{ value: 'default', label: '기본값 (켬)' }, { value: 'on', label: '켬 (안내 후 1번)' }, { value: 'off', label: '끔 (바로 인증)' }]} />
            </Form.Item>
          )}
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(a, b) => a.platform !== b.platform}>
          {({ getFieldValue }) => getFieldValue('platform') === 'WEB' ? (
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
