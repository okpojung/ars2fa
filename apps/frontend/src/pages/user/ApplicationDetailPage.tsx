import { Card, Descriptions, List, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { apiClient } from '../../shared/api/client';

export function ApplicationDetailPage() {
  const { id } = useParams();
  const { data } = useQuery({
    queryKey: ['application', id],
    queryFn: async () => (await apiClient.get(`/applications/${id}`)).data,
    enabled: Boolean(id),
  });

  return (
    <Card>
      <Typography.Title level={2}>신청 상세</Typography.Title>
      <Descriptions bordered column={1}>
        <Descriptions.Item label="서비스명">{data?.serviceName}</Descriptions.Item>
        <Descriptions.Item label="상태"><Tag>{data?.status}</Tag></Descriptions.Item>
        <Descriptions.Item label="사용 목적">{data?.usagePurpose}</Descriptions.Item>
        <Descriptions.Item label="관리자 의견">{data?.adminComment ?? '-'}</Descriptions.Item>
      </Descriptions>
      <Typography.Title level={4} style={{ marginTop: 24 }}>앱 정보</Typography.Title>
      <List
        dataSource={data?.apps ?? []}
        renderItem={(app: { mobileAppName: string; platform: string; status: string }) => (
          <List.Item>
            {app.mobileAppName} / {app.platform} <Tag>{app.status}</Tag>
          </List.Item>
        )}
      />
    </Card>
  );
}
