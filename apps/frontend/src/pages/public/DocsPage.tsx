import { Button } from 'antd';
import { Link } from 'react-router-dom';
import './site.css';

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
  return (
    <div className="site">
      <header className="site-nav">
        <Link to="/" className="site-logo">ARS2FA</Link>
        <nav>
          <Link to="/">서비스 소개</Link>
          <Link to="/login">로그인</Link>
          <Link to="/signup"><Button type="primary" size="small">API 신청하기</Button></Link>
        </nav>
      </header>
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
    </div>
  );
}
