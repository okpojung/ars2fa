import { Button } from 'antd';
import { Link } from 'react-router-dom';
import './site.css';
import { useAuthStore } from '../../shared/auth/authStore';

const BASE = 'https://ars2fa.baro.me';

const CREATE_APP = `POST ${BASE}/v1/ars/sessions
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "mobile_app_name": "바로포인트",        // 신청 때 등록한 앱 이름
  "client_platform": "ANDROID",           // ANDROID | IOS
  "package_name": "com.example.app",      // Android (iOS는 bundle_id)
  "purpose": "로그인"                      // 선택, 40자 이내
}

200 OK
{
  "session_id": "ars_...",
  "status": "PENDING",
  "mode": "APP",
  "dial_number": "0507-xxxx-xxxx",        // 앱이 바로 발신. 화면에 표시하지 마세요
  "dial_uri": "tel:0507-xxxx-xxxx",
  "expires_at": "2026-10-31T08:00:30.000Z",
  "expires_in": 30,
  "display_name": "바로포인트",
  "notice": "바로포인트 인증 전화입니다. 본인이 요청하지 않았다면 전화를 끊으세요.",
  "server_time": "2026-10-31T08:00:00.000Z",
  "confirm_key": true                      // 통화 중 1번 누르기 안내 여부(콘솔 앱 설정)
}`;

const STATUS = `POST ${BASE}/v1/ars/sessions/status
{ ...앱 식별 필드, "session_id": "ars_..." }

200 OK
{
  "session_id": "ars_...",
  "status": "VERIFIED",                    // PENDING | CALL_CONFIRMED | VERIFIED | FAILED | EXPIRED | CANCELED
  "fail_reason": null,
  "phone": "01012345678",                  // VERIFIED 일 때만
  "phone_masked": "010****5678",
  "server_time": "..."
}`;

const CREATE_PC = `POST ${BASE}/v1/ars/sessions
{
  ...앱 식별 필드,
  "mode": "PC",
  "country_code": "82",
  "expected_phone": "01012345678"          // PC 인증은 필수
}

200 OK
{
  "session_id": "ars_...",
  "mode": "PC",
  "dial_page_url": "${BASE}/m/ars/<1회용 토큰>",   // 이 주소를 QR로 보여 주세요 (0507 번호는 PC에 전달되지 않습니다)
  "expires_in": 30,
  ...
}

// 전화가 연결되면 status 응답에 인증번호가 생깁니다
{ "status": "CALL_CONFIRMED", "pc_code": "4821", "code_expires_at": "...", "code_seconds": 15, "server_time": "..." }`;

const WIDGET_A = `<script src="${BASE}/widget.js"></script>

<form method="post" action="/contact">
  <input name="name" placeholder="이름">
  <div id="phone-auth"></div>                 <!-- 휴대폰 입력란 + [휴대폰 인증] 버튼이 그려집니다 -->
  <textarea name="message"></textarea>
  <button id="send" type="submit" disabled>메일 보내기</button>
</form>

<script>
  ARS2FA.render('#phone-auth', {
    siteKey: 'pk_...',                         // 콘솔 앱 설정의 사이트 키
    purpose: '문의하기',                        // 선택: 인증 내역에 남는 목적
    onVerified: function (r) { document.getElementById('send').disabled = false; },
    onReset:    function ()  { document.getElementById('send').disabled = true; },
    onFailed:   function (r) { console.log(r.status, r.reason); }
  });
</script>`;

const WIDGET_B = `<script src="${BASE}/widget.js"></script>

<input id="phone" placeholder="010-1234-5678">
<button id="verify" type="button">휴대폰 인증</button>
<input type="hidden" name="ars2fa_session" id="ars2fa_session">

<script>
  document.getElementById('verify').onclick = function () {
    ARS2FA.verify({ siteKey: 'pk_...', phone: document.getElementById('phone').value, purpose: '회원가입' })
      .then(function (r) {
        if (r.status === 'VERIFIED') {
          document.getElementById('ars2fa_session').value = r.sessionId;   // 서버로 보내 확인
          document.getElementById('phone').readOnly = true;                // 인증한 번호 고정
        } else {
          alert(r.message || '휴대폰 인증을 하지 못했습니다.');
        }
      });
  };
</script>`;

const WIDGET_SERVER = `// Node.js (Express)
const r = await fetch('${BASE}/v1/widget/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.ARS2FA_API_KEY },
  body: JSON.stringify({ session_id: req.body.ars2fa_session, consume: true }),
}).then((x) => x.json());
if (!r.verified || r.phone !== req.body.phone.replace(/\\D/g, '')) return res.status(400).send('휴대폰 인증이 필요합니다');

// PHP
$ch = curl_init('${BASE}/v1/widget/verify');
curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . getenv('ARS2FA_API_KEY')],
  CURLOPT_POSTFIELDS => json_encode(['session_id' => $_POST['ars2fa_session'], 'consume' => true])]);
$r = json_decode(curl_exec($ch), true);
if (empty($r['verified']) || $r['phone'] !== preg_replace('/\\D/', '', $_POST['phone'])) { http_response_code(400); exit; }

# Python (requests)
r = requests.post('${BASE}/v1/widget/verify', timeout=10,
    headers={'Authorization': 'Bearer ' + os.environ['ARS2FA_API_KEY']},
    json={'session_id': form['ars2fa_session'], 'consume': True}).json()
if not r.get('verified') or r['phone'] != re.sub(r'\\D', '', form['phone']):
    abort(400)`;

const WIDGET_VERIFY = `POST ${BASE}/v1/widget/verify
Authorization: Bearer <비밀 API Key>
{ "session_id": "<ars2fa_session>", "consume": true }

200 OK
{
  "verified": true, "phone": "01012345678", "phone_masked": "010****5678", "reason": null,
  "verified_at": "...", "origin": "https://www.example.com", "purpose": "문의하기",
  "clients": {
    "requester": { "ip": "203.0.113.10", "browser": "Chrome 141", "os": "Windows 10/11", "device": "Windows PC" },
    "phone":     { "ip": "223.38.x.x", "device": "Samsung SM-S918N", "browser": "삼성 인터넷 25", "os": "Android 14", "screen": "412x915" }
  }
}`;
const FLUTTER = `# pubspec.yaml
dependencies:
  ars_login:
    git: https://github.com/okpojung/ars_auth.git

// Dart
import 'package:ars_login/ars_login.dart';

const config = Ars2faConfig(
  apiKey: String.fromEnvironment('ARS2FA_API_KEY'),  // 소스에 직접 쓰지 마세요
  mobileAppName: '바로포인트',                         // 신청 때 등록한 앱 이름
  packageName: 'com.example.app',                     // Android
  bundleId: 'com.example.app',                        // iOS
  purpose: '로그인',
);

final result = await Ars2fa.authenticate(context, config);  // 화면 표시 → 바로 발신 → 결과
if (result != null && result.success) {
  // result.phone 은 서버로 보내고, 서버에서 /v1/ars/sessions/status 로 다시 확인하세요
}`;

export function DocsPage() {
  // ?embed=1: shown inside the customer console (iframe) without the site header/footer
  const embed = new URLSearchParams(window.location.search).get('embed') === '1';
  const principal = useAuthStore((s) => s.principal);
  const member = principal?.kind === 'user' || principal?.kind === 'admin';
  return (
    <div className="site">
      {!embed && <header className="site-nav">
        <Link to="/" className="site-logo">ARS2FA</Link>
        <nav>
          <Link to="/">서비스 소개</Link>
          <Link to="/login">로그인</Link>
          <Link to="/signup"><Button type="primary" size="small">API 신청하기</Button></Link>
        </nav>
      </header>}
      {!member ? (
        <article className="site-docs" style={{ textAlign: 'center', paddingTop: 80 }}>
          <h1>개발자 가이드</h1>
          <p>개발자 가이드는 <b>회원 전용</b>입니다. 로그인하거나 회원 가입 후 확인하세요.</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24 }}>
            <Link to="/login?next=/docs"><Button type="primary" size="large">로그인</Button></Link>
            <Link to="/signup"><Button size="large">회원 가입</Button></Link>
          </div>
        </article>
      ) : (
      <article className="site-docs">
        <h1>개발자 가이드</h1>
        <p>ARS2FA는 사용자가 직접 거는 전화를 통신사 발신 기록으로 확인해 휴대폰 번호를 인증합니다. 아래 API 세 개로 연동합니다.</p>
        <table>
          <thead><tr><th>API</th><th>설명</th></tr></thead>
          <tbody>
            <tr><td><code>POST /v1/ars/sessions</code></td><td>인증 시작. 1회용 인증 번호(앱) 또는 QR 주소(PC)를 받습니다.</td></tr>
            <tr><td><code>POST /v1/ars/sessions/status</code></td><td>진행 상태·결과 조회 (1~2초 간격 조회)</td></tr>
            <tr><td><code>POST /v1/ars/sessions/cancel</code></td><td>사용자가 그만둘 때 취소</td></tr>
          </tbody>
        </table>

        <h2>1. 시작하기</h2>
        <ol>
          <li><Link to="/signup">회원 가입</Link> 후 콘솔에서 <b>API 신청</b>을 제출합니다. 앱 이름, 플랫폼, Android 패키지명 / iOS Bundle ID가 필요합니다.</li>
          <li>승인되면 콘솔 <b>API Key</b> 메뉴에서 [키 발급]을 눌러 키를 받습니다. 원문은 한 번만 표시됩니다.</li>
          <li>모든 요청에 <code>Authorization: Bearer &lt;API_KEY&gt;</code>(또는 본문 <code>api_key</code>)와 앱 식별 필드 <code>mobile_app_name</code>, <code>client_platform</code>, <code>package_name</code>/<code>bundle_id</code>를 보냅니다. 등록한 값과 다르면 거절됩니다.</li>
        </ol>

        <h2>2. 앱 인증</h2>
        <p>사용자는 번호를 입력하지 않습니다. 앱이 받은 번호로 <b>즉시 발신</b>하고, 통신사가 확인한 발신번호가 결과로 돌아옵니다.</p>
        <pre><code>{CREATE_APP}</code></pre>
        <ul>
          <li>번호는 30초 동안만 유효하고, 전화가 연결되는 즉시 인증에서 빠집니다. 두 번째 전화는 인증되지 않습니다.</li>
          <li>이미 아는 회원을 다시 확인할 때는 <code>expected_phone</code>을 함께 보내면 그 번호로 건 전화만 성공합니다.</li>
          <li><b>1번 누르기</b>(피싱 방지 확인)는 콘솔의 앱 설정에서 켜고 끌 수 있습니다.</li>
        </ul>
        <h3>결과 조회</h3>
        <pre><code>{STATUS}</code></pre>

        <h2>3. PC 인증</h2>
        <p>PC에서 휴대폰 번호를 입력받고, 응답의 <code>dial_page_url</code>을 QR로 보여 줍니다. 사용자가 QR을 찍어 전화를 걸면 PC 화면에 인증번호를 표시하고, 사용자는 그 숫자를 휴대폰 키패드로 누릅니다.</p>
        <pre><code>{CREATE_PC}</code></pre>
        <ul>
          <li>남은 시간은 <code>server_time</code> 기준으로 계산하세요(기기 시계 차이 보정).</li>
          <li>입력한 휴대폰이 아닌 번호로 걸면 <code>phone_mismatch</code>로 실패합니다.</li>
        </ul>

        <h2 id="web-widget">3-1. 웹 위젯 적용 방법 (팝업, 개발 언어 무관)</h2>
        <p>
          가입·로그인·문의 폼처럼 <b>웹 페이지에서 휴대폰 본인 확인</b>이 필요할 때 씁니다. 페이지에는 스크립트 한 줄과 공개 <b>사이트 키</b>만 넣고,
          [휴대폰 인증]을 누르면 <b>팝업 창</b>에서 QR → 전화 → 인증번호 입력 → 결과까지 진행됩니다. 결과는 페이지로 돌아오고, 마지막 확인은 <b>고객 서버</b>가 합니다.
        </p>
        <table>
          <thead><tr><th>단계</th><th>할 일</th></tr></thead>
          <tbody>
            <tr><td>1. 웹사이트 등록</td><td>콘솔 → <b>API 신청·앱 설정</b> → 신규 신청에서 플랫폼을 <b>웹사이트 (팝업 위젯)</b>로 고르고 사이트 주소(<code>https://…</code>, 여러 개는 쉼표)를 적어 제출합니다. 관리자가 승인합니다.</td></tr>
            <tr><td>2. 키 받기</td><td>승인되면 앱 설정에서 <b>사이트 키 발급</b>(<code>pk_…</code>, 웹 페이지에 넣는 공개 키), <b>API Key</b> 메뉴에서 <b>키 발급</b>(비밀 키, 서버에만 보관)을 받습니다.</td></tr>
            <tr><td>3. 페이지에 붙이기</td><td>아래 A 또는 B 방식으로 스크립트를 넣습니다.</td></tr>
            <tr><td>4. 서버에서 확인</td><td>폼을 처리하기 전에 <code>POST /v1/widget/verify</code>로 결과를 확인합니다(1회용).</td></tr>
            <tr><td>5. 시험</td><td>콘솔 <b>ARS 실통화 시험</b>에서 휴대폰으로 직접 확인합니다.</td></tr>
          </tbody>
        </table>

        <h3>A. 위젯이 입력란과 버튼을 그리는 방식 (가장 간단)</h3>
        <pre><code>{WIDGET_A}</code></pre>
        <p>인증되면 폼 안에 숨은 입력 <code>ars2fa_session</code>이 자동으로 채워지고 <code>onVerified</code>가 호출됩니다. 번호를 고치면 값이 지워지고 <code>onReset</code>이 호출됩니다.</p>

        <h3>B. 이미 있는 휴대폰 입력란을 쓰는 방식</h3>
        <pre><code>{WIDGET_B}</code></pre>
        <p><code>ARS2FA.verify()</code>는 <b>버튼 click 처리 안에서 바로</b> 호출하세요(팝업 차단 방지). 결과 <code>r.status</code>: <code>VERIFIED</code> · <code>FAILED</code> · <code>EXPIRED</code> · <code>CLOSED</code>(창 닫음) · <code>ERROR</code>(<code>r.message</code>에 이유).</p>

        <h3>4. 서버에서 확인 (필수)</h3>
        <p>브라우저가 보낸 값만 믿으면 우회될 수 있습니다. 폼을 처리하기 전에 비밀 API Key로 확인하고, <code>verified</code>가 true이고 <b>폼의 번호와 같을 때만</b> 처리하세요. <code>consume: true</code>는 한 번만 성공합니다(가입 1건·문의 1건).</p>
        <pre><code>{WIDGET_VERIFY}</code></pre>
        <pre><code>{WIDGET_SERVER}</code></pre>
        <table>
          <thead><tr><th>응답 필드</th><th>의미</th></tr></thead>
          <tbody>
            <tr><td><code>verified</code></td><td>인증 성공이고 아직 쓰지 않은 결과면 true</td></tr>
            <tr><td><code>phone</code> / <code>phone_masked</code></td><td>통신사가 확인한 휴대폰 번호 (성공일 때만 원문)</td></tr>
            <tr><td><code>reason</code></td><td>실패 사유 (<code>already_used</code> = 이미 사용한 결과)</td></tr>
            <tr><td><code>verified_at</code>, <code>origin</code>, <code>purpose</code></td><td>인증 시각, 요청한 사이트, 목적</td></tr>
            <tr><td><code>clients.requester</code></td><td>인증을 요청한 브라우저: IP, 브라우저, 운영체제, 기기</td></tr>
            <tr><td><code>clients.phone</code></td><td>QR을 연 휴대폰: IP, 기종, 브라우저, 운영체제, 화면, 언어, 시간대</td></tr>
          </tbody>
        </table>

        <h3>자주 묻는 질문</h3>
        <ul>
          <li><b>팝업이 안 떠요</b>: 브라우저 주소창의 팝업 차단 아이콘에서 해당 사이트의 팝업을 허용하세요. <code>verify()</code>를 click 처리 밖(예: 응답을 기다린 뒤)에서 부르면 차단됩니다.</li>
          <li><b>ORIGIN_NOT_ALLOWED</b>: 등록한 사이트 주소와 페이지 주소가 다릅니다(<code>www</code> 유무, <code>http/https</code> 포함). 앱 설정의 허용 사이트에 추가하세요.</li>
          <li><b>429 / TOO_MANY_REQUESTS</b>: 같은 IP·번호로 짧은 시간에 너무 많이 요청했습니다. 잠시 후 다시 시도합니다.</li>
          <li><b>해외 번호</b>: 지금은 +82(한국 휴대폰)만 인증할 수 있습니다.</li>
          <li><b>시간·자릿수 조정</b>: 콘솔 <b>ARS 설정</b>에서 전화 걸 수 있는 시간, 인증번호 입력 시간과 자릿수를 정할 수 있습니다.</li>
        </ul>

        <h2>4. 실패 사유</h2>
        <table>
          <thead><tr><th>fail_reason</th><th>의미</th></tr></thead>
          <tbody>
            {[
              ['timeout', '시간 안에 전화하지 않음'], ['hidden_caller', '발신번호 숨김'], ['not_mobile', '휴대폰이 아닌 번호'],
              ['not_confirmed', '1번을 누르지 않음'], ['multiple_calls', '같은 인증 번호로 2건 이상 전화'], ['phone_mismatch', '기대한 휴대폰 번호와 다름'],
              ['pc_code_wrong', 'PC 인증번호 틀림'], ['code_timeout', 'PC 인증번호 입력 시간 초과'], ['canceled_by_client', '취소'],
            ].map(([k, v]) => <tr key={k}><td><code>{k}</code></td><td>{v}</td></tr>)}
          </tbody>
        </table>
        <p>HTTP 오류: <code>401/403</code> API Key·앱 정보 불일치, <code>429</code> 한도 초과, <code>503</code> 일시적으로 번호를 준비하지 못함(잠시 후 재시도).</p>

        <h2>5. Flutter SDK</h2>
        <p>Android는 전화 권한이 있으면 바로 발신하고, 없으면 다이얼러를 엽니다. iOS는 시스템 확인 후 발신합니다. 자세한 내용은 <a href="https://github.com/okpojung/ars_auth" target="_blank" rel="noreferrer">ars_auth 저장소 README</a>를 보세요.</p>
        <pre><code>{FLUTTER}</code></pre>

        <h2>6. 보안 권장 사항</h2>
        <ul>
          <li>인증 번호(0507)를 화면에 보여 주지 마세요. 앱은 바로 발신, PC는 QR만 사용합니다.</li>
          <li>결과(<code>phone</code>)는 서버에서 다시 조회해 확인하세요. 앱이 보낸 값만 믿지 마세요.</li>
          <li>앱 위조 방지: Play Integrity(Android) / App Attest(iOS) 토큰을 함께 보내면 정품 앱만 허용할 수 있습니다 (<code>/v1/ars/integrity/challenge</code>).</li>
        </ul>
      </article>
      )}
      {!embed && <footer className="site-footer">
        <div className="site-wrap">
          <div><b>ARS2FA</b> · (주)이지트론 · 문의 <a href="tel:0507-0090-1105">0507-0090-1105</a> · <a href="mailto:baro@baro.me">baro@baro.me</a></div>
          <div><Link to="/">서비스 소개</Link> · <Link to="/login">고객 로그인</Link></div>
        </div>
      </footer>}
    </div>
  );
}
