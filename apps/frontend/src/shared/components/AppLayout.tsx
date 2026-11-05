import {
  ApiOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  DashboardOutlined,
  KeyOutlined,
  LogoutOutlined,
  SafetyOutlined,
  PhoneOutlined,
  NumberOutlined,
  LockOutlined,
  SettingOutlined,
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
        { key: '/admin/ars/sessions', icon: <PhoneOutlined />, label: <Link to="/admin/ars/sessions">ARS 진행 현황</Link> },
        { key: '/admin/ars/pool', icon: <NumberOutlined />, label: <Link to="/admin/ars/pool">0507 번호 풀</Link> },
        { key: '/admin/ars/apps', icon: <LockOutlined />, label: <Link to="/admin/ars/apps">앱 보안</Link> },
        { key: '/admin/ars/settings', icon: <SettingOutlined />, label: <Link to="/admin/ars/settings">ARS 설정</Link> },
        { key: '/admin/ars/test', icon: <PhoneOutlined />, label: <Link to="/admin/ars/test">ARS 실통화 시험</Link> },
      ]
    : [
        { key: '/console', icon: <DashboardOutlined />, label: <Link to="/console">대시보드</Link> },
        { key: '/console/applications', icon: <AppstoreOutlined />, label: <Link to="/console/applications">API 신청·앱 설정</Link> },
        { key: '/console/api-keys', icon: <KeyOutlined />, label: <Link to="/console/api-keys">API Key</Link> },
        { key: '/console/sessions', icon: <ApiOutlined />, label: <Link to="/console/sessions">인증 내역</Link> },
        { key: '/console/test', icon: <PhoneOutlined />, label: <Link to="/console/test">ARS 실통화 시험</Link> },
        { key: '/console/settings', icon: <SettingOutlined />, label: <Link to="/console/settings">ARS 설정</Link> },
        { key: '/console/docs', icon: <BarChartOutlined />, label: <Link to="/console/docs">개발자 가이드</Link> },
      ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="0">
        <Typography.Title level={4} style={{ color: '#fff', padding: 16, margin: 0 }}>
          <Link to={isAdmin ? '/admin' : '/'} style={{ color: '#fff' }}>ARS2FA</Link>
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
