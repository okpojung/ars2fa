import {
  ApiOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  DashboardOutlined,
  KeyOutlined,
  LogoutOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { Button, Layout, Menu, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../auth/authStore';

const { Header, Content, Sider } = Layout;

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { principal, logout } = useAuthStore();
  const isAdmin = location.pathname.startsWith('/admin');

  const items: MenuProps['items'] = isAdmin
    ? [
        { key: '/admin', icon: <DashboardOutlined />, label: <Link to="/admin">관리자 대시보드</Link> },
        { key: '/admin/applications', icon: <AppstoreOutlined />, label: <Link to="/admin/applications">신청 심사</Link> },
        { key: '/admin/api-keys', icon: <KeyOutlined />, label: <Link to="/admin/api-keys">API Key 운영</Link> },
        { key: '/admin/auth-logs', icon: <SafetyOutlined />, label: <Link to="/admin/auth-logs">인증 로그</Link> },
      ]
    : [
        { key: '/', icon: <DashboardOutlined />, label: <Link to="/">대시보드</Link> },
        { key: '/applications', icon: <AppstoreOutlined />, label: <Link to="/applications">API 신청</Link> },
        { key: '/api-keys', icon: <KeyOutlined />, label: <Link to="/api-keys">API Key</Link> },
        { key: '/auth-requests', icon: <ApiOutlined />, label: <Link to="/auth-requests">인증 현황</Link> },
        { key: '/statistics', icon: <BarChartOutlined />, label: <Link to="/statistics">통계</Link> },
      ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="0">
        <Typography.Title level={4} style={{ color: '#fff', padding: 16, margin: 0 }}>
          ars2fa
        </Typography.Title>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={items}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingInline: 24,
          }}
        >
          <span>{principal?.email}</span>
          <Button
            icon={<LogoutOutlined />}
            onClick={() => {
              logout();
              navigate(isAdmin ? '/admin/login' : '/login');
            }}
          >
            로그아웃
          </Button>
        </Header>
        <Content style={{ margin: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
