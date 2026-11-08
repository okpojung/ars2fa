import { Alert, Button, Input, Modal, Space, Typography, message } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../../shared/api/client';

const BASE = typeof window !== 'undefined' ? window.location.origin : 'https://ars2fa.baro.me';

export function widgetSnippet(siteKey: string) {
  return `<!-- 1) 스크립트 (한 번만) -->
<script src="${BASE}/widget.js"></script>

<!-- 2-a) 위젯이 휴대폰 입력란과 [휴대폰 인증] 버튼을 그려 줍니다 -->
<form id="contact" method="post" action="/contact">
  <div id="ars2fa-phone"></div>     <!-- 인증되면 hidden 입력 ars2fa_session 이 채워집니다 -->
  <button id="send" type="submit" disabled>메일 보내기</button>
</form>
<script>
  ARS2FA.render('#ars2fa-phone', {
    siteKey: '${siteKey}',
    onVerified: function () { document.getElementById('send').disabled = false; },
    onReset:    function () { document.getElementById('send').disabled = true; }
  });
</script>

<!-- 2-b) 이미 있는 입력란을 쓸 때: 버튼 click 안에서 호출 -->
<script>
  btn.onclick = function () {
    ARS2FA.verify({ siteKey: '${siteKey}', phone: phoneInput.value }).then(function (r) {
      if (r.status === 'VERIFIED') { /* r.sessionId 를 폼과 함께 서버로 보내세요 */ }
    });
  };
</script>`;
}

export const VERIFY_SNIPPET = `# 3) 서버에서 확인 (메일 발송·가입 처리 전에 반드시)
POST ${BASE}/v1/widget/verify
Authorization: Bearer <비밀 API Key>
Content-Type: application/json

{ "session_id": "<폼으로 받은 ars2fa_session>", "consume": true }

→ { "verified": true, "phone": "01012345678", "phone_masked": "010****5678", "verified_at": "...", "origin": "https://..." }
  verified 가 true 이고 phone 이 폼의 번호와 같을 때만 처리하세요. consume:true 는 한 번만 성공합니다.`;

export function WebWidgetSettings({ app }: { app: Record<string, any> }) {
  const qc = useQueryClient();
  const [origins, setOrigins] = useState<string>(app.allowedOrigins ?? '');
  const save = useMutation({
    mutationFn: async () => (await apiClient.patch(`/console/apps/${app.id}/settings`, { allowedOrigins: origins })).data,
    onSuccess: () => { message.success('저장했습니다.'); qc.invalidateQueries({ queryKey: ['application'] }); },
    onError: (e) => message.error((e as Error).message),
  });
  const issue = useMutation({
    mutationFn: async () => (await apiClient.post(`/console/apps/${app.id}/site-key`)).data,
    onSuccess: () => { message.success('사이트 키를 발급했습니다.'); qc.invalidateQueries({ queryKey: ['application'] }); },
    onError: (e) => message.error((e as Error).message),
  });
  const approved = app.status === 'APPROVED';
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Space wrap>
        <span>허용 사이트</span>
        <Input value={origins} onChange={(e) => setOrigins(e.target.value)} style={{ width: 380 }} placeholder="https://www.example.com, https://example.com" />
        <Button size="small" onClick={() => save.mutate()} loading={save.isPending}>저장</Button>
      </Space>
      <Space wrap>
        <span>사이트 키</span>
        {app.siteKey ? <Typography.Text code copyable>{app.siteKey}</Typography.Text> : <Typography.Text type="secondary">{approved ? '아직 발급하지 않았습니다.' : '승인 후 발급할 수 있습니다.'}</Typography.Text>}
        {approved && (
          <Button size="small" type={app.siteKey ? 'default' : 'primary'} loading={issue.isPending}
            onClick={() => app.siteKey
              ? Modal.confirm({ title: '사이트 키를 재발급할까요?', content: '이전 키는 바로 동작하지 않습니다. 사이트의 키도 함께 바꿔야 합니다.', okText: '재발급', cancelText: '취소', onOk: () => issue.mutate() })
              : issue.mutate()}>
            {app.siteKey ? '재발급' : '사이트 키 발급'}
          </Button>
        )}
      </Space>
      {app.siteKey && (
        <>
          <Alert type="info" showIcon message="사이트 키는 웹 페이지에 넣는 공개 키입니다. 인증 결과는 반드시 서버에서 비밀 API Key로 확인하세요(아래 3번)." />
          <Typography.Paragraph copyable={{ text: widgetSnippet(app.siteKey) }} style={{ marginBottom: 0 }}><b>붙여넣기 코드</b></Typography.Paragraph>
          <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 12, borderRadius: 8, fontSize: 12, overflowX: 'auto', margin: 0 }}>{widgetSnippet(app.siteKey)}</pre>
          <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 12, borderRadius: 8, fontSize: 12, overflowX: 'auto', margin: 0 }}>{VERIFY_SNIPPET}</pre>
        </>
      )}
    </Space>
  );
}
