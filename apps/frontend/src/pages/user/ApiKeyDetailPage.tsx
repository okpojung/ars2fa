import { Card, Descriptions, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { apiClient } from '../../shared/api/client';

export function ApiKeyDetailPage() {
  const { id } = useParams();
  const { data } = useQuery({
    queryKey: ['api-key', id],
    queryFn: async () => (await apiClient.get(`/api-keys/${id}`)).data,
    enabled: Boolean(id),
  });

  return (
    <Card>
      <Typography.Title level={2}>API Key 상세</Typography.Title>
      <Descriptions bordered column={1}>
        <Descriptions.Item label="Key">{data?.keyPrefix}</Descriptions.Item>
        <Descriptions.Item label="상태"><Tag>{data?.status}</Tag></Descriptions.Item>
        <Descriptions.Item label="환경">{data?.environment}</Descriptions.Item>
        <Descriptions.Item label="월 한도">{data?.monthlyLimit}</Descriptions.Item>
        <Descriptions.Item label="분당 한도">{data?.rateLimitPerMinute ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="최근 사용">{data?.lastUsedAt ?? '-'}</Descriptions.Item>
      </Descriptions>
    </Card>
  );
}
