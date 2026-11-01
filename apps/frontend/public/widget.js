/*!
 * ARS2FA web widget - 발신 ARS 휴대폰 인증 (팝업)
 * https://ars2fa.baro.me/docs#web-widget
 *
 *   <script src="https://ars2fa.baro.me/widget.js"></script>
 *
 *   // 1) 화면까지 위젯이 그리기 (휴대폰 입력란 + [휴대폰 인증] 버튼)
 *   ARS2FA.render('#phone-auth', { siteKey: 'pk_...', onVerified: function (r) { ... } });
 *
 *   // 2) 이미 있는 입력란의 번호로 팝업 인증만 (버튼 click 핸들러 안에서 호출)
 *   ARS2FA.verify({ siteKey: 'pk_...', phone: '010-1234-5678' }).then(function (r) { ... });
 *
 * 결과(r): { status: 'VERIFIED' | 'FAILED' | 'EXPIRED' | 'CANCELED' | 'CLOSED', sessionId, phoneMasked, reason }
 * 서버에서 반드시 POST /v1/widget/verify (비밀 API Key) 로 sessionId 를 확인한 뒤 사용하세요.
 */
(function (global) {
  'use strict';
  if (global.ARS2FA && global.ARS2FA.version) return;

  var script = document.currentScript;
  var BASE = (script && script.src) ? new URL(script.src).origin : 'https://ars2fa.baro.me';
  var PREFIXES = ['010', '011', '016', '017', '018', '019'];

  function digits(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

  /** "+82 10-1234-5678", "010-1234-5678", "01012345678" -> { cc: '82', phone: '01012345678' } */
  function normalize(phone, countryCode) {
    var cc = digits(countryCode || '82');
    var d = digits(phone);
    if (!countryCode && d.indexOf('82') === 0 && d.length >= 11) { d = '0' + d.slice(2); }
    if (cc === '82' && d.length >= 9 && d.charAt(0) !== '0') d = '0' + d;
    return { cc: cc, phone: d };
  }

  function popupHtml(msg) {
    return '<!doctype html><meta charset="utf-8"><title>발신 ARS 인증</title>' +
      '<body style="font-family:system-ui,\'Malgun Gothic\',sans-serif;display:flex;align-items:center;justify-content:center;height:90vh;color:#334155">' +
      '<div style="text-align:center"><div style="font-size:20px;font-weight:700;margin-bottom:8px">발신 ARS 인증</div><div>' + msg + '</div></div></body>';
  }

  /**
   * Opens the popup and runs one authentication. Must be called from a click handler (popup blockers).
   * Resolves with the result; never rejects (errors come back as status 'ERROR' with reason/message).
   */
  function verify(opts) {
    opts = opts || {};
    var n = normalize(opts.phone, opts.countryCode);
    var w = 440, h = 680;
    var left = Math.max(0, (global.screenX || 0) + ((global.outerWidth || w) - w) / 2);
    var top = Math.max(0, (global.screenY || 0) + ((global.outerHeight || h) - h) / 2);
    var pop = global.open('', 'ars2fa_' + Date.now(), 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes');
    if (pop) { try { pop.document.write(popupHtml('인증을 준비하고 있습니다…')); } catch (e) { /* ignore */ } }

    return new Promise(function (resolve) {
      if (!pop) { resolve({ status: 'ERROR', reason: 'popup_blocked', message: '팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.' }); return; }
      var done = false, sessionId = null, timer = null;
      function finish(r) {
        if (done) return; done = true;
        global.removeEventListener('message', onMsg); if (timer) clearInterval(timer);
        resolve(r);
      }
      function onMsg(ev) {
        if (ev.origin !== BASE || !ev.data || ev.data.type !== 'ars2fa:result') return;
        if (sessionId && ev.data.sessionId !== sessionId) return;
        finish({ status: ev.data.status, sessionId: ev.data.sessionId, phoneMasked: ev.data.phoneMasked || null, reason: ev.data.reason || null });
      }
      global.addEventListener('message', onMsg);
      timer = setInterval(function () { if (pop.closed) finish({ status: 'CLOSED', sessionId: sessionId, reason: 'popup_closed' }); }, 500);

      fetch(BASE + '/v1/widget/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
        body: JSON.stringify({ site_key: opts.siteKey, country_code: n.cc, phone: n.phone, purpose: opts.purpose || undefined }),
      }).then(function (res) {
        return res.json().then(function (j) { return { ok: res.ok, j: j }; });
      }).then(function (x) {
        if (!x.ok) {
          var m = (x.j && (x.j.message || x.j.code)) || '인증을 시작하지 못했습니다.';
          if (Array.isArray(m)) m = m.join(', ');
          try { pop.document.body.innerHTML = popupHtml(String(m)).replace(/^[\s\S]*<body[^>]*>/, ''); } catch (e) { /* ignore */ }
          finish({ status: 'ERROR', reason: (x.j && x.j.code) || 'start_failed', message: String(m) });
          return;
        }
        sessionId = x.j.session_id;
        pop.location.href = x.j.popup_url;
      }).catch(function () {
        finish({ status: 'ERROR', reason: 'network', message: '인증 서버에 연결하지 못했습니다.' });
      });
    });
  }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  /**
   * Renders phone input + button into `target`. Puts the session id into a hidden input
   * (name: opts.inputName || 'ars2fa_session') of the surrounding form after success.
   */
  function render(target, opts) {
    opts = opts || {};
    var root = typeof target === 'string' ? document.querySelector(target) : target;
    if (!root) throw new Error('ARS2FA: target not found');
    root.innerHTML = '';
    var wrap = el('div', { 'class': 'ars2fa-widget', style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-family:inherit' });
    var cc = el('select', { 'aria-label': '국가번호', style: 'padding:6px' }); cc.appendChild(el('option', { value: '82' }, '+82'));
    var pre = el('select', { 'aria-label': '국번', style: 'padding:6px' });
    PREFIXES.forEach(function (p) { pre.appendChild(el('option', { value: p }, p)); });
    var rest = el('input', { type: 'tel', inputmode: 'numeric', placeholder: '나머지 7~8자리', maxlength: '9', 'aria-label': '휴대폰 번호', style: 'padding:6px;width:9em' });
    var btn = el('button', { type: 'button', style: 'padding:6px 12px;cursor:pointer' }, opts.buttonText || '휴대폰 인증');
    var msg = el('div', { 'class': 'ars2fa-message', role: 'status', style: 'width:100%;font-size:13px;color:#555;margin-top:2px' });
    [cc, pre, rest, btn, msg].forEach(function (x) { wrap.appendChild(x); });
    root.appendChild(wrap);
    var form = root.closest ? root.closest('form') : null;
    var hidden = null;
    if (form) {
      var name = opts.inputName || 'ars2fa_session';
      hidden = form.querySelector('input[name="' + name + '"]') || el('input', { type: 'hidden', name: name });
      if (!hidden.parentNode) form.appendChild(hidden);
      hidden.value = '';
    }
    function setMsg(t, color) { msg.textContent = t; msg.style.color = color || '#555'; }
    rest.addEventListener('input', function () {
      rest.value = digits(rest.value).slice(0, 8);
      if (hidden && hidden.value) { hidden.value = ''; setMsg('번호가 바뀌어 다시 인증해야 합니다.', '#b45309'); if (opts.onReset) opts.onReset(); }
    });
    btn.addEventListener('click', function () {
      var r = digits(rest.value);
      if (r.length < 7) { setMsg('휴대폰 번호를 입력해 주세요.', '#b91c1c'); rest.focus(); return; }
      btn.disabled = true; setMsg('팝업 창에서 인증을 진행해 주세요.');
      verify({ siteKey: opts.siteKey, countryCode: cc.value, phone: pre.value + r, purpose: opts.purpose }).then(function (res) {
        btn.disabled = false;
        if (res.status === 'VERIFIED') {
          if (hidden) hidden.value = res.sessionId;
          setMsg('휴대폰 인증 완료 (' + (res.phoneMasked || '') + ')', '#15803d');
          btn.textContent = '다시 인증';
          if (opts.onVerified) opts.onVerified(res);
        } else {
          if (hidden) hidden.value = '';
          setMsg(res.message || '인증하지 못했습니다. 다시 시도해 주세요.', '#b91c1c');
          if (opts.onFailed) opts.onFailed(res);
        }
      });
    });
    return { reset: function () { if (hidden) hidden.value = ''; setMsg(''); btn.textContent = opts.buttonText || '휴대폰 인증'; } };
  }

  global.ARS2FA = { version: '1.0.0', verify: verify, render: render, base: BASE };
})(window);
