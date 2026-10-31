import { Alert, Button, Modal, Typography, message } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../../shared/api/client';

/** Issues (or reissues) the secret of an API key and shows it once. */
export function RotateKeyButton({ id, issued }: { id: string; issued?: boolean }) {
  const qc = useQueryClient();
  const [raw, setRaw] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: async () => (await apiClient.post(`/console/api-keys/${id}/rotate`)).data,
    onSuccess: (d) => { setRaw(d.apiKey); qc.invalidateQueries(); },
    onError: (e) => message.error((e as Error).message),
  });
  return (
    <>
      <Button size="small" type={issued ? 'default' : 'primary'} loading={m.isPending}
        onClick={() => Modal.confirm({
          title: issued ? 'API Key를 재발급할까요?' : 'API Key를 발급할까요?',
          content: '새 키가 만들어지는 즉시 이전 키는 더 이상 쓸 수 없습니다. 운영 중인 서버의 키도 함께 바꿔야 합니다.',
          okText: '발급', cancelText: '취소', onOk: () => m.mutate(),
        })}>
        {issued ? '재발급' : '키 발급'}
      </Button>
      <Modal open={!!raw} title="API Key" onCancel={() => setRaw(null)} width={640}
        footer={<Button type="primary" onClick={() => setRaw(null)}>보관했습니다</Button>}>
        <Alert type="warning" showIcon style={{ marginBottom: 16 }}
          message="이 키는 지금 한 번만 표시됩니다. 서버의 안전한 곳에 보관하세요. 잃어버리면 재발급해야 합니다." />
        <Typography.Paragraph copyable={{ text: raw ?? '' }} code style={{ fontSize: 15, wordBreak: 'break-all' }}>{raw}</Typography.Paragraph>
      </Modal>
    </>
  );
}
