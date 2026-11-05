# 13. ARS 인증 엔진 v1 (사용자 발신형, 0507 랜덤 순환)

2026-10-30 구현. 기존 `barocall.baro.so` 중계(ars-gateway)를 대체한다.

## 1. 원리

사용자가 **본인 휴대폰으로 직접 전화를 건다**(발신 ARS). 서버는 통신사 쪽 기록(다우 AuthLog)으로 발신 휴대폰을 확인한다.

| 약점 | 대응 |
|---|---|
| 번호 노출(먼저 걸기, LG U+ 페이나우형) | 인증마다 0507 1,000개 중 하나를 **랜덤 순서로** 짧게 임대. 번호는 화면에 표시하지 않고 앱이 직접 걸거나 PC에서는 QR(`tel:`)로만 전달. 임대 중 그 번호로 전화가 **2건 이상**이면 실패 |
| 발신번호 조작 | **다우 AuthLog가 있어야** 성공. PBX에 들어온 SIP 발신번호와 AuthLog 발신번호(`an`)가 같아야 함. 2026-10-26 시험에서 010-1234-7777로 조작한 전화의 AuthLog에는 실제 번호가 찍힘 |
| 발신번호 숨김 / 유선 | 실패(`hidden_caller`, `not_mobile`) |
| 피싱(남에게 대신 걸게 함) | 통화 첫머리 "본인이 요청한 인증이 아니면 끊으세요. 계속하려면 1번" — 1번을 누르지 않으면 실패(`not_confirmed`). 앱 화면에는 `display_name`과 같은 안내 문구 제공 |
| 앱 위조(키 도용) | 앱별 정책 OFF/MONITOR/ENFORCE. Android Play Integrity, iOS App Attest 검증 |
| PC↔전화 사람 불일치 | PC 모드: 통화가 확인되면 ARS가 두 자리 숫자를 읽어 주고 PC에 입력해야 완료 |

## 2. 번호 풀

- 0507 1,000개(old-new `number-pool-0507.json`) → SKB 070 50개(070-5190-1950~1999)에 **목록 순서대로** 20개씩 고정 착신(CallMix 1회 설정).
- 배정: 전체 번호의 CSPRNG 순열 1개(`VnCycle`)를 만들고 그 순서대로 하나씩 임대. **1,000개를 모두 한 번씩 쓴 뒤에만** 새 순열을 만든다. 임대 중·휴식 중인 번호는 잠시 건너뛰고 같은 회차 안에서 나중에 쓴다.
- 종료된 번호는 `cooldownSeconds` 동안 휴식.
- SKB는 Request-URI에 대표번호(070-7875-4442)를, **To 헤더에 실제 착신 070**을 넣는다. 다이얼플랜은 To로 `rn`을 구한다.

## 2-1. SKB 수신 실측 (2026-10-31)

- Request-URI: 대표번호 070-7875-4442, `To`: 실제 착신 070(예: 070-5190-1900)
- 발신번호: `CALLERID(num)`과 `P-Asserted-Identity`는 비어 있고 **`From` 헤더에만** 휴대폰 번호가 온다. 다이얼플랜은 num → PAI → From 순으로 읽는다(`deploy/asterisk/from-skb.conf`).
- 첫 실통화 성공: 발신 후 다우 AuthLog 2초 만에 도착, 1번 입력 후 판정 OK, PC 확인 숫자 입력으로 VERIFIED.

## 2-2. CallMix 착신 자동 켜기/끄기 (2026-10-31 사용자 지시)

- 번호 1,000개는 평소 **착신 꺼짐**(linkYn=n, 컬러링·콜멘트 0). 인증을 시작할 때 고른 번호만 `vnMapping`(linkYn=y, rn=배정 070, 컬러링·콜멘트 0)으로 켜고, CallMix가 SUCCESS를 준 뒤에만 앱/QR에 번호를 넘긴다. 거절되면 다음 번호(최대 3개).
- **30초**(설정 `leaseSecondsApp/Pc`)가 지나거나 인증이 끝나면 끈다. 통화 중이면 통화 종료 알림(다이얼플랜 `h`) 때, 늦어도 판정 20초 뒤.
- 끄기 실패는 2·4·8…최대 60초 간격으로 재시도하고, 꺼졌다고 확인될 때까지 그 번호는 다시 빌려주지 않는다(상태 `UNKNOWN`). 재시작 시 켜져 있을 수 있는 번호는 모두 끈다.
- 30초 직전에 건 전화도 처리되도록 세션은 20초 더 기다린다(PENDING 유예). PC 모드는 통화 확인 후 `pcCodeSeconds`(기본 90초) 동안 숫자 입력.
- 시험 번호 0507-0090-1103은 `STATIC`(CallMix에서 상시 착신, API 호출 안 함).
- 모든 CallMix 호출은 `CarrierCall` 표에 남는다(결과·지연).
- CallMix 계정은 서버 `/opt/ars2fa/callmix.env`(600)에만 둔다. 저장 전 계정에 없는 번호(050700000000)로 로그인만 확인해 설정 변경이 없다.

## 2-2-1. 쉬는 번호 = 안내 회선 착신 (2026-10-31)

- linkYn=n이면 벨만 울리고 끝나므로, 쉬는 번호는 **안내 회선 070-5190-1900**(`CALLMIX_GUARD_RN`)으로 착신해 둔다. 이 회선에는 인증이 걸리지 않아 서버가 받아 안내 후 끊는다.
- 안내 문구: "지금은 사용할 수 없는 인증 번호입니다. 앱이나 화면에서 인증을 다시 요청해 주세요."
- 전화가 연결되어 세션이 확인되면 그 즉시 안내 회선으로 되돌린다(통화 중 전환). 판정(성공·실패)이 나는 모든 경우에도 즉시 되돌린다.
- 2026-10-31 16:45 실통화 확인: 연결 2초 뒤 안내 회선으로 전환했고, 8초 뒤 키패드 입력까지 통화가 유지됐다(통화 중 전환해도 끊기지 않음). 인증 뒤 같은 0507로 다시 건 전화는 안내 회선으로 들어와 안내 후 종료, 다른 번호로 건 전화는 phone_mismatch로 실패.

## 2-4. PC 인증 (2026-10-31 개정)

1. PC에서 휴대폰 번호를 국가번호(+82)/국번/번호로 입력하고 시작(필수, 다른 번호로 걸면 `phone_mismatch`).
2. QR에는 0507이 아니라 1회용 모바일 화면 주소(`/m/ars/<token>`)를 담는다. 화면: "발신 ARS 인증" 안내와 [전화걸기] 버튼(tel:), 남은 시간. PC 응답에는 0507 번호가 없다.
3. 전화가 연결되면(`/internal/pbx/connect`) 통신사 AuthLog로 세션을 확인하고 착신을 즉시 해제, 세션은 `CALL_CONFIRMED`. PC 화면에 인증번호(기본 4자리, `pcCodeDigits`)와 20초(`pcCodeSeconds`) 카운트다운 표시.
4. ARS "발신 ARS 인증입니다. 화면의 인증번호를 눌러 주세요." 후 휴대폰 키패드(DTMF)로 입력(`/internal/pbx/code`). 안내 중에도 입력 가능. 한 번만, 20초 안에. 틀리면 `pc_code_wrong`, 없으면 `code_timeout`("입력 시간이 지났습니다") → 처음부터 다시.
5. 청각장애인도 화면을 보고 입력할 수 있고, 숫자를 잘못 듣는 오류가 없다.

## 2-3. 인증 요청이 아닌 전화

- 응답 직후 `/internal/pbx/precheck`: 그 070에 전화를 기다리는 인증이 없으면 "정상적인 접근이 아닙니다. 전화를 끊겠습니다." 후 종료.
- 판정 결과가 `no_session`·`no_authlog`·`pool_mismatch`(인증과 무관한 전화)여도 같은 안내. 그 밖의 실패는 "인증 실패" 안내.

## 3. 판정 (PBX → `POST /internal/pbx/verify`)

1. 발신번호 표시·휴대폰 여부
2. 이 070(rn)으로 착신되는 0507 중, 이 발신번호의 AuthLog(±20초)를 최대 `authlogWaitSeconds` 동안 기다림 → 없으면 `no_authlog`
3. 그 0507을 임대 중인 세션 → 없으면 `no_session`
4. 1번 확인 → 아니면 `not_confirmed`
5. 세션 시작 이후 그 0507의 AuthLog가 정확히 1건 → 아니면 `multiple_calls`
6. `expected_phone` 일치 → 아니면 `phone_mismatch`
7. APP: `VERIFIED`. PC: `CALL_CONFIRMED` + 확인 숫자 → PC 입력 후 `VERIFIED`
8. 확정된 세션은 바뀌지 않음(이후 전화는 `second_call`)

## 4. 고객 API (`/v1/ars/*`)

공통: `api_key`(또는 `Authorization: Bearer`), `mobile_app_name`, `client_platform`(ANDROID/IOS), `package_name`/`bundle_id`.

| 경로 | 설명 |
|---|---|
| `POST /v1/ars/integrity/challenge` | 무결성 증명용 1회용 nonce |
| `POST /v1/ars/integrity/ios/attest` | iOS App Attest 키 등록(`key_id`, `attestation`, `integrity_nonce`) |
| `POST /v1/ars/sessions` | 인증 시작. `mode`(APP/PC), `purpose`, `expected_phone`, 무결성 필드(`integrity_nonce`+`integrity_token` 또는 `attest_key_id`+`attest_assertion`). 응답 `session_id`, `dial_number`/`dial_uri`(앱이 바로 발신, **화면 표시 금지**), `expires_at`, `display_name`, `notice` |
| `POST /v1/ars/sessions/status` | `PENDING`·`CALL_CONFIRMED`·`VERIFIED`(이때만 `phone` 원문)·`FAILED`·`EXPIRED`·`CANCELED` |
| `POST /v1/ars/sessions/pc-code` | PC 모드 확인 숫자 |
| `POST /v1/ars/sessions/cancel` | 취소 |

## 5. 내부·관리자

- `POST /internal/authlog`: AuthLog 수신기(.180)가 인증 성공한 콜백만 넘김(루프백 + `INTERNAL_API_KEY`).
- 관리자 콘솔: ARS 진행 현황, 0507 번호 풀(가져오기·중지), 앱 보안(무결성 정책·표시 이름·서명 인증서·Team ID), ARS 설정, **ARS 실통화 시험**(QR).
- 설정 기본값: 앱 임대 60초, PC 임대 120초, 휴식 120초, AuthLog 대기 6초, 1번 확인 켬, PC 확인 숫자 켬(3회), 휴대폰만.

## 6. 남은 일

- CallMix에서 1,000개 착신을 070-5190-1950~1999로 설정(매장 사용 여부 확인 후, 컬러링·콜멘트 '선택 안함'). 그 전까지 스테이징은 0507-0090-1103 → 070-5190-1900만 사용.
- 070-5190-1950~1999가 .180 SKB 트렁크로 들어오는지 확인.
- `ars_auth` Flutter SDK를 새 API로 개정(번호 비표시 자동 발신, 무결성 토큰).
- Play Integrity 서비스 계정(`GOOGLE_PLAY_INTEGRITY_SA_FILE`), 앱별 서명 인증서·Apple Team ID 등록.
- 공개 도메인 `ars2fa.baro.me`(DNS·NPM·인증서).
- 안내 음성은 Google 번역 TTS 시험본. 운영 전 성우 녹음 권장. 앱 이름을 읽어 주려면 앱별 녹음 필요.


## 7. 공개 사이트·고객 콘솔 (2026-10-31)

- `https://ars2fa.baro.me` (Cloudflare DNS 전용 → NPM → .180:9447). 홈페이지(/), 개발자 가이드(/docs), 고객 콘솔(/console), 모바일 인증 화면(/m/ars), 고객 API(/v1/ars)는 공개. 관리자(/admin, /api/admin), API 문서, health는 사무실 IP만.
- 고객 콘솔: 대시보드, API 신청·앱 설정(안내 서비스 이름, **1번 누르기** 기본값/켬/끔), API Key 발급·재발급(원문 1회 표시, 이전 키 즉시 폐기), 인증 내역(번호 가림).
- 1번 누르기는 앱별 설정(없으면 서비스 기본값)이 인증 시작 시점에 세션에 고정된다(`ArsSession.confirmKey`). 끈 앱은 다이얼플랜이 안내 없이 바로 판정(`APPN`). 생성 응답에 `confirm_key`.
- 응답에서 비밀값 제외: Prisma 전역 omit(User/AdminUser.passwordHash, ApiKey.keyHash).
- 안내 음성: Microsoft 신경망 여성 음성(SunHi)으로 교체, 생성 스크립트 `deploy/voice/gen-female.py`.
- Flutter SDK: okpojung/ars_auth PR #2 (`ars_login` 2.0.0).
- 정리: 예전 PHP 포털(.180:9444) 보관 후 제거(/root/archive/ars-portal-retired-20261031-170704), 시험 관리자 계정 삭제.