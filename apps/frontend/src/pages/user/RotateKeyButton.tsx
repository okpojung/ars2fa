import { Alert, Button, Modal, Typography, message } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../../shared/api/client';
import { runArsPopup } from '../../shared/ars/popup';

type Shown = { apiKey: string; replaced: boolean };

/**
 * API key in the console: [키 보기] shows the issued key again after an ARS phone check of the account's contact
 * phone (the one verified at sign-up). Keys made before keys were kept sealed cannot be shown: [키 받기] issues a
 * new one. Replacing a key (e.g. when it leaked) is a small link in the key window, also behind the ARS check.
 */
export function RotateKeyButton({ id, viewable }: { id: string; viewable?: boolean }) {
  const qc = useQueryClient();
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);

  // must run from a click (popup blockers): the popup opens first, then the server starts the phone check
  async function phoneCheck(): Promise<string | null> {
    const r = await runArsPopup(async () => (await apiClient.post('/console/api-keys/phone/start')).data);
    if (r.status === 'VERIFIED' && r.sessionId) return r.sessionId;
    if (r.status !== 'CLOSED') message.warning(r.message ?? '휴대폰 인증을 마치지 못했습니다. 다시 시도해 주세요.');
    return null;
  }

  async function replace(phoneSessionId: string) {
    const { data } = await apiClient.post(`/console/api-keys/${id}/rotate`, { phoneSessionId });
    setShown({ apiKey: data.apiKey, replaced: true });
    void qc.invalidateQueries();
  }

  const errMsg = (e: any) => e?.response?.data?.message ?? (e as Error).message;

  async function view() {
    setBusy(true);
    try {
      const sid = await phoneCheck();
      if (!sid) return;
      try {
        const { data } = await apiClient.post(`/console/api-keys/${id}/reveal`, { phoneSessionId: sid });
        setShown({ apiKey: data.apiKey, replaced: false });
      } catch (e: any) {
        if (e?.response?.data?.code !== 'KEY_NOT_STORED') { message.error(errMsg(e)); return; }
        // older key (hash only): the same phone check can be used to issue a new key
        Modal.confirm({
          title: '이 키는 다시 볼 수 없습니다',
          content: '이전 방식으로 만든 키라 원문이 저장되어 있지 않습니다. 새 키를 받을까요? 새 키를 받으면 이전 키는 바로 쓸 수 없게 됩니다.',
          okText: '새 키 받기', cancelText: '취소',
          onOk: async () => { try { await replace(sid); } catch (err) { message.error(errMsg(err)); } },
        });
      }
    } finally { setBusy(false); }
  }

  function askReplace(firstTime: boolean) {
    Modal.confirm({
      title: firstTime ? 'API Key를 받을까요?' : '새 키로 바꿀까요?',
      content: (<>
        <p>본인 확인을 위해 <b>담당자 휴대폰(가입할 때 인증한 번호)</b>으로 ARS 인증을 합니다.</p>
        <p>새 키가 만들어지면 <b>이전 키는 바로 쓸 수 없게 됩니다.</b> 운영 중인 서버의 키도 함께 바꿔야 합니다.{firstTime ? '' : ' 키가 밖으로 새어 나갔을 때만 쓰세요.'}</p>
      </>),
      okText: '휴대폰 인증하고 받기', cancelText: '취소',
      onOk: () => {
        void (async () => {
          setBusy(true);
          try { const sid = await phoneCheck(); if (sid) await replace(sid); }
          catch (e) { message.error(errMsg(e)); }
          finally { setBusy(false); }
        })();
      },
    });
  }

  return (
    <>
      {viewable === false
        ? <Button size="small" type="primary" loading={busy} onClick={() => askReplace(true)}>키 받기</Button>
        : <Button size="small" type="primary" loading={busy} onClick={() => { void view(); }}>키 보기</Button>}
      <Modal open={!!shown} title={shown?.replaced ? '새 API Key' : 'API Key'} onCancel={() => setShown(null)} width={640}
        footer={<>
          {!shown?.replaced && <Button type="link" danger style={{ float: 'left' }} onClick={() => { setShown(null); askReplace(false); }}>유출이 의심되면 새 키로 바꾸기</Button>}
          <Button type="primary" onClick={() => setShown(null)}>닫기</Button>
        </>}>
        <Alert type={shown?.replaced ? 'warning' : 'info'} showIcon style={{ marginBottom: 16 }}
          message={shown?.replaced
            ? '새 키입니다. 이전 키는 이제 쓸 수 없으니 운영 서버의 키를 바꿔 주세요.'
            : '키는 서버의 안전한 곳에 보관하세요. 다시 볼 때도 휴대폰 ARS 인증이 필요합니다.'} />
        <Typography.Paragraph copyable={{ text: shown?.apiKey ?? '' }} code style={{ fontSize: 15, wordBreak: 'break-all' }}>{shown?.apiKey}</Typography.Paragraph>
      </Modal>
    </>
  );
}
