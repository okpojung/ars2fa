import { Alert, Select, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../../shared/api/client';
import { PopupPhoneTest } from '../../shared/ars/PopupPhoneTest';

/** Customer live call test: PC-mode authentication in the popup, with one of the customer's approved apps. */
export function ConsoleTestPage() {
  const { data: apps, isLoading } = useQuery({ queryKey: ['console-test-apps'], queryFn: async () => (await apiClient.get('/console/test/apps')).data as { id: string; name: string; platform: string; service: string }[] });
  const [appId, setAppId] = useState<string | undefined>();
  useEffect(() => { if (!appId && apps?.length) setAppId(apps[0].id); }, [apps, appId]);

  return (
    <>
      <Typography.Title level={2}>ARS 실통화 시험</Typography.Title>
      {!isLoading && !apps?.length ? (
        <Alert type="warning" showIcon message="승인된 API 신청이 있어야 시험할 수 있습니다."
          description={<>먼저 <Link to="/console/applications">API 신청</Link>을 제출하고 승인을 받으세요. 승인되면 이 화면에서 바로 시험할 수 있습니다.</>} />
      ) : (
        <PopupPhoneTest
          disabled={!appId}
          extra={(
            <Space wrap>
              <span>시험할 앱</span>
              <Select value={appId} onChange={setAppId} style={{ minWidth: 280 }} loading={isLoading}
                options={(apps ?? []).map((a) => ({ value: a.id, label: `${a.name} (${a.platform === 'WEB' ? '웹' : a.platform}) · ${a.service}` }))} />
              <Typography.Text type="secondary">시험도 실제 인증 1건으로 기록되고 월 한도에 포함됩니다.</Typography.Text>
            </Space>
          )}
          start={async (b) => (await apiClient.post('/console/test/popup', { appId, ...b })).data}
          verify={async (sid) => (await apiClient.post('/console/test/verify', { session_id: sid })).data}
        />
      )}
    </>
  );
}
