import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, Typography, message } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../../shared/api/client';
import { useAuthStore } from '../../shared/auth/authStore';

type LoginResponse = {
  accessToken: string;
  user?: { id: string; email: string };
  admin?: { id: string; email: string; role: string };
};

export function LoginPage({ admin = false }: { admin?: boolean }) {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);

  async function onFinish(values: { email: string; password: string }) {
    try {
      const endpoint = admin ? '/admin/auth/login' : '/auth/login';
      const { data } = await apiClient.post<LoginResponse>(endpoint, values);
      const principal = data.admin
        ? { ...data.admin, kind: 'admin' as const }
        : { ...data.user!, kind: 'user' as const };
      setSession(data.accessToken, principal);
      navigate(admin ? '/admin' : '/');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '로그인 실패');
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '80px auto' }}>
      <Card>
        <Typography.Title level={3}>
          {admin ? 'ars2fa 관리자 로그인' : 'ars2fa 로그인'}
        </Typography.Title>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="email" label="이메일" rules={[{ required: true, type: 'email' }]}>
            <Input prefix={<MailOutlined />} />
          </Form.Item>
          <Form.Item name="password" label="비밀번호" rules={[{ required: true }]}>
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            로그인
          </Button>
        </Form>
        {!admin && (
          <Typography.Paragraph style={{ marginTop: 16 }}>
            계정이 없나요? <Link to="/signup">회원 가입</Link>
          </Typography.Paragraph>
        )}
      </Card>
    </div>
  );
}
