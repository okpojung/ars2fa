export type PopupResult = { status: string; sessionId?: string | null; phoneMasked?: string | null; reason?: string | null; message?: string };

const loadingHtml = (msg: string) => `<!doctype html><meta charset="utf-8"><title>발신 ARS 인증</title>
<body style="font-family:system-ui,'Malgun Gothic',sans-serif;display:flex;align-items:center;justify-content:center;height:90vh;color:#334155">
<div style="text-align:center"><div style="font-size:20px;font-weight:700;margin-bottom:8px">발신 ARS 인증</div><div>${msg}</div></div></body>`;

/**
 * Opens the ARS popup and waits for its result. Call it directly from a click handler (popup blockers):
 * the window is opened first, then `start()` asks our server for the popup URL.
 */
export function runArsPopup(start: () => Promise<{ popup_url: string; session_id: string }>): Promise<PopupResult> {
  const w = 440, h = 680;
  const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2);
  const pop = window.open('', `ars2fa_${Date.now()}`, `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
  if (pop) { try { pop.document.write(loadingHtml('인증을 준비하고 있습니다…')); } catch { /* ignore */ } }
  return new Promise((resolve) => {
    if (!pop) { resolve({ status: 'ERROR', reason: 'popup_blocked', message: '팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.' }); return; }
    let done = false;
    let sessionId: string | null = null;
    const finish = (r: PopupResult) => { if (done) return; done = true; window.removeEventListener('message', onMsg); clearInterval(timer); resolve(r); };
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin || !ev.data || ev.data.type !== 'ars2fa:result') return;
      if (sessionId && ev.data.sessionId !== sessionId) return;
      finish({ status: ev.data.status, sessionId: ev.data.sessionId, phoneMasked: ev.data.phoneMasked, reason: ev.data.reason });
    };
    window.addEventListener('message', onMsg);
    const timer = setInterval(() => { if (pop.closed) finish({ status: 'CLOSED', sessionId, reason: 'popup_closed', message: '인증 창을 닫았습니다.' }); }, 500);
    start().then((r) => { sessionId = r.session_id; pop.location.href = r.popup_url; }).catch((e: Error) => {
      try { pop.close(); } catch { /* ignore */ }
      finish({ status: 'ERROR', reason: 'start_failed', message: e.message || '인증을 시작하지 못했습니다.' });
    });
  });
}
