import { Button, Card, Form, Input, Typography, message } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../../shared/api/client';
import { useAuthStore } from '../../shared/auth/authStore';

export function SignupPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);

  async function onFinish(values: Record<string, string>) {
    try {
      const { data } = await apiClient.post('/auth/signup', values);
      setSession(data.accessToken, { ...data.user, kind: 'user' });
      navigate('/');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '회원 가입 실패');
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '40px auto' }}>
      <Card>
        <Typography.Title level={3}>회원 가입</Typography.Title>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="email" label="이메일" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="비밀번호" rules={[{ required: true, min: 10 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="companyName" label="회사명" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="businessNumber" label="사업자등록번호">
            <Input />
          </Form.Item>
          <Form.Item name="contactName" label="담당자명" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="contactPhone" label="담당자 연락처" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            가입하기
          </Button>
        </Form>
        <Typography.Paragraph style={{ marginTop: 16 }}>
          이미 계정이 있나요? <Link to="/login">로그인</Link>
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
