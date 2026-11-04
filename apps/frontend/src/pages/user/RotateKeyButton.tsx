import { Alert, Button, Modal, Typography, message } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../../shared/api/client';
import { runArsPopup } from '../../shared/ars/popup';

/**
 * Issues (or reissues) the secret of an API key. The key is shown once, only after an ARS phone check of the
 * account's contact phone (the one verified at sign-up) in the popup.
 */
export function RotateKeyButton({ id, issued }: { id: string; issued?: boolean }) {
  const qc = useQueryClient();
  const [raw, setRaw] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const m = useMutation({
    mutationFn: async (phoneSessionId: string) => (await apiClient.post(`/console/api-keys/${id}/rotate`, { phoneSessionId })).data,
    onSuccess: (d) => { setRaw(d.apiKey); qc.invalidateQueries(); },
    onError: (e: any) => message.error(e?.response?.data?.message ?? (e as Error).message),
  });

  // must run from the click (popup blockers): the popup opens first, then the server starts the check
  async function phoneCheckThenIssue() {
    setChecking(true);
    try {
      const r = await runArsPopup(async () => (await apiClient.post('/console/api-keys/phone/start')).data);
      if (r.status === 'VERIFIED' && r.sessionId) m.mutate(r.sessionId);
      else if (r.status !== 'CLOSED') message.warning(r.message ?? '휴대폰 인증을 마치지 못했습니다. 다시 시도해 주세요.');
    } finally { setChecking(false); }
  }

  return (
    <>
      <Button size="small" type={issued ? 'default' : 'primary'} loading={checking || m.isPending}
        onClick={() => Modal.confirm({
          title: issued ? 'API Key를 재발급할까요?' : 'API Key를 발급할까요?',
          content: (<>
            <p>본인 확인을 위해 <b>담당자 휴대폰(가입할 때 인증한 번호)</b>으로 ARS 인증을 한 뒤 키를 보여 드립니다.</p>
            <p>새 키가 만들어지는 즉시 이전 키는 더 이상 쓸 수 없습니다. 운영 중인 서버의 키도 함께 바꿔야 합니다.</p>
          </>),
          okText: '휴대폰 인증하고 발급', cancelText: '취소', onOk: () => { void phoneCheckThenIssue(); },
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
