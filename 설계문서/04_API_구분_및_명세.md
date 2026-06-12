# 04. API 구분 및 명세 개정안

## 1. 개정 목표

기존 `ars_auth`의 ARS 인증 API 요청은 앱 세션과 OS 정보 중심으로 구성되어 있다. API 신청 사이트 운영을 위해서는 호출 주체와 승인 앱을 식별할 수 있어야 하므로 모든 ARS 인증 API에 아래 공통 파라미터를 추가한다.

| 파라미터 | 필수 | 설명 |
|---|---|---|
| `api_key` | Y | ars2fa 신청 사이트에서 승인 후 발급된 API Key |
| `mobile_app_name` | Y | API를 사용하는 모바일 앱 명칭. 신청 승인 시 등록된 명칭과 일치해야 함 |
| `client_platform` | Y | `ANDROID` 또는 `IOS` |
| `package_name` | Android 권장 | Android 앱 패키지명 |
| `bundle_id` | iOS 권장 | iOS Bundle ID |
| `sdk_version` | 권장 | `ars_auth` Flutter 위젯 버전 |

## 2. API 구분 기준

개정 후 ARS 인증 API 요청은 다음 조합으로 사용 주체를 구분한다.

```text
api_key + mobile_app_name + client_platform + endpoint + appsid/appuuid
```

| 구분 요소 | 목적 |
|---|---|
| `api_key` | 회원/신청/API Key 권한 검증, 과금/사용량 집계 |
| `mobile_app_name` | 하나의 회원 또는 Key가 여러 앱을 사용할 때 앱별 통계 분리 |
| `client_platform` | Android/iOS별 승인 여부 및 URL 분기 |
| `endpoint` | install, confirm, recheck, status 등 API 종류 구분 |
| `appsid` | 모바일 앱에서 생성한 인증 세션 추적 |
| `appuuid` | 기존 ARS 서버가 발급하는 인증 세션 식별자 |

## 3. Flutter 위젯 공개 API 개정안

현재 `LoginARS` 위젯 생성자는 `useOnlyCallPermission`과 콜백만 받는다.

```dart
LoginARS({
  bool useOnlyCallPermission = false,
  ArsAuthStartCallback? onAuthStart,
  ArsAuthCompleteCallback? onAuthComplete,
  ArsAuthFailureCallback? onAuthFailure,
  ArsManualInputCallback? onManualInputRequired,
})
```

개정안은 `apiKey`와 `mobileAppName`을 필수 값으로 추가한다.

```dart
LoginARS({
  required String apiKey,
  required String mobileAppName,
  String? packageName,
  String? bundleId,
  String? sdkVersion,
  bool useOnlyCallPermission = false,
  ArsAuthStartCallback? onAuthStart,
  ArsAuthCompleteCallback? onAuthComplete,
  ArsAuthFailureCallback? onAuthFailure,
  ArsManualInputCallback? onManualInputRequired,
})
```

### 사용 예시

```dart
LoginARS(
  apiKey: 'ars2fa_live_xxxxxxxxxxxxxxxxx',
  mobileAppName: 'BS Point',
  packageName: 'com.example.bs_point',
  bundleId: 'com.example.bsPoint',
  useOnlyCallPermission: true,
  onAuthComplete: (userInfo) {
    print("전화번호: ${userInfo['app_cid']}");
  },
)
```

## 4. 공통 요청 헤더

기존 서버가 `application/x-www-form-urlencoded`를 사용하므로 호환성을 위해 본문 형식은 유지한다.

```http
Content-Type: application/x-www-form-urlencoded
Accept: application/json
```

운영 서버에서는 API Key를 본문 파라미터로 받되, 신규 API Gateway를 설계할 경우 헤더 방식도 함께 지원할 수 있다.

```http
Authorization: Bearer {api_key}
X-ARS-Mobile-App-Name: BS Point
```

본문 파라미터와 헤더가 동시에 전달되면 헤더를 우선하고, 불일치 시 `400 PARAMETER_CONFLICT`로 처리한다.

## 5. Install API 개정

### 5.1 현행 요청

```http
POST /install_app.php
Content-Type: application/x-www-form-urlencoded

appsid={appsid}
&app_os_type=AND
&app_os_version=14
&app_cp_carr=
&gcmid=deprecated
&playerid=deprecated
```

### 5.2 개정 요청

```http
POST /v1/ars/install
Content-Type: application/x-www-form-urlencoded

api_key={api_key}
&mobile_app_name=BS%20Point
&client_platform=ANDROID
&package_name=com.example.bs_point
&sdk_version=1.3.0
&appsid={appsid}
&app_os_type=AND
&app_os_version=14
&app_cp_carr=
&gcmid=deprecated
&playerid=deprecated
```

### 5.3 요청 파라미터

| 이름 | 필수 | 설명 |
|---|---|---|
| `api_key` | Y | 발급된 API Key |
| `mobile_app_name` | Y | 승인된 모바일 앱 명칭 |
| `client_platform` | Y | `ANDROID`, `IOS` |
| `package_name` | Android 권장 | Android 패키지명 |
| `bundle_id` | iOS 권장 | iOS Bundle ID |
| `sdk_version` | 권장 | `ars_auth` SDK 버전 |
| `appsid` | Y | 앱에서 생성한 세션 ID |
| `app_os_type` | Y | 기존 값 유지: `AND`, `iOS` |
| `app_os_version` | Y | 단말 OS 버전 |
| `app_cp_carr` | N | 기존 호환 필드, 통신사 정보는 deprecated |
| `gcmid` | N | 기존 호환 필드, deprecated |
| `playerid` | N | 기존 호환 필드, deprecated |

### 5.4 응답 예시

```json
{
  "return": true,
  "request_id": "arsreq_01HX...",
  "api_key_id": "key_01HX...",
  "mobile_app_name": "BS Point",
  "appsid": "3da3bf62...",
  "appuuid": "C5CECB54-6930-670E-93F1-4F7F3BE102C7",
  "phonenum": "+8270-7540-1426",
  "lease_time": "2026-06-12 10:03:16",
  "now": "2026-06-12 10:02:46",
  "msg": "succeeded"
}
```

## 6. Confirm API 개정

### 6.1 현행 요청

```http
POST /confirm_auth.php
Content-Type: application/x-www-form-urlencoded

appuuid={appuuid}
&appsid={appsid}
&applng=0
&applat=0
```

### 6.2 개정 요청

```http
POST /v1/ars/confirm
Content-Type: application/x-www-form-urlencoded

api_key={api_key}
&mobile_app_name=BS%20Point
&client_platform=ANDROID
&package_name=com.example.bs_point
&appuuid={appuuid}
&appsid={appsid}
&applng=0
&applat=0
```

### 6.3 응답 예시

```json
{
  "return": true,
  "request_id": "arsreq_01HX...",
  "api_key_id": "key_01HX...",
  "mobile_app_name": "BS Point",
  "appsid": "41c136b2...",
  "appuuid": "E39E023F-5835-CE9B-E8EB-91010CBB9926",
  "appip": "210.57.238.143",
  "now": "2026-06-12 10:05:00",
  "call_count": 1,
  "app_cid": "01021581108",
  "msg": "succeeded",
  "inst_phone_no": "",
  "inst_time": "",
  "prnts_phone_no": "",
  "myapp": "BS Point"
}
```

### 6.4 `call_count` 처리

| 값 | 의미 | 클라이언트 처리 |
|---|---|---|
| `1` | 자동 인증 성공 | `onAuthComplete` 호출 |
| `2` | 자동 인증 실패, 수동 입력 필요 | 수동 전화번호 입력 화면으로 이동 |
| `0` | 재시도 필요 | 실패 메시지 표시 후 재시도 유도 |
| 기타 | 실패 | `onAuthFailure` 호출 |

## 7. Manual Recheck API 개정

### 7.1 현행 요청

```http
POST /confirm_auth_recheck.php
Content-Type: application/x-www-form-urlencoded

appphone=01012345678
&appuuid={appuuid}
```

### 7.2 개정 요청

```http
POST /v1/ars/recheck
Content-Type: application/x-www-form-urlencoded

api_key={api_key}
&mobile_app_name=BS%20Point
&client_platform=ANDROID
&package_name=com.example.bs_point
&appphone=01012345678
&appuuid={appuuid}
```

### 7.3 응답

Confirm API와 동일한 `ArsAuthResponse` 형식을 사용한다.

## 8. 인증 현황 조회 API

API Key 발급 이후 사용자는 포털 화면뿐 아니라 서버 간 API로 인증 현황을 조회할 수 있다.

### 8.1 요청

```http
GET /v1/ars/auth-requests?from=2026-06-01&to=2026-06-12&status=AUTH_SUCCEEDED&limit=50
Authorization: Bearer {api_key}
```

### 8.2 쿼리 파라미터

| 이름 | 필수 | 설명 |
|---|---|---|
| `from` | Y | 조회 시작일 |
| `to` | Y | 조회 종료일 |
| `status` | N | 인증 상태 필터 |
| `mobile_app_name` | N | 앱명 필터 |
| `client_platform` | N | 플랫폼 필터 |
| `cursor` | N | 페이지네이션 커서 |
| `limit` | N | 기본 50, 최대 500 |

### 8.3 응답

```json
{
  "items": [
    {
      "request_id": "arsreq_01HX...",
      "requested_at": "2026-06-12T10:05:00+09:00",
      "mobile_app_name": "BS Point",
      "client_platform": "ANDROID",
      "status": "AUTH_SUCCEEDED",
      "appsid": "41c136b2...",
      "appuuid": "E39E023F-5835-CE9B-E8EB-91010CBB9926",
      "phone_masked": "010****1108",
      "call_count": 1,
      "message": "succeeded"
    }
  ],
  "next_cursor": null
}
```

## 9. 인증 통계 조회 API

### 9.1 요청

```http
GET /v1/ars/auth-statistics?from=2026-06-01&to=2026-06-12&group_by=day
Authorization: Bearer {api_key}
```

### 9.2 응답

```json
{
  "summary": {
    "total": 1200,
    "success": 1130,
    "failed": 45,
    "manual_required": 25,
    "success_rate": 94.17
  },
  "series": [
    {
      "date": "2026-06-12",
      "total": 100,
      "success": 95,
      "failed": 3,
      "manual_required": 2
    }
  ]
}
```

## 10. 오류 코드

| HTTP | 코드 | 설명 |
|---|---|---|
| 400 | `MISSING_REQUIRED_PARAMETER` | 필수 파라미터 누락 |
| 400 | `INVALID_PARAMETER` | 파라미터 형식 오류 |
| 400 | `PARAMETER_CONFLICT` | 헤더/본문 값 충돌 |
| 401 | `UNAUTHORIZED_API_KEY` | API Key 없음 또는 검증 실패 |
| 403 | `API_KEY_DISABLED` | 정지/폐기된 Key |
| 403 | `APP_NOT_ALLOWED` | 승인되지 않은 앱명 |
| 403 | `PLATFORM_NOT_ALLOWED` | 승인되지 않은 플랫폼 |
| 404 | `AUTH_SESSION_NOT_FOUND` | install 기록 없는 confirm/recheck |
| 409 | `AUTH_SESSION_EXPIRED` | 인증 세션 만료 |
| 429 | `RATE_LIMIT_EXCEEDED` | 호출 한도 초과 |
| 500 | `INTERNAL_ERROR` | 내부 오류 |
| 502 | `ARS_PROVIDER_ERROR` | 기존 ARS 서버 오류 |

## 11. 기존 `NetworkRepository` 적용 지점

`ars_auth/lib/repository/network_repository.dart` 기준 적용 대상은 다음과 같다.

| 메서드 | 추가 파라미터 |
|---|---|
| `requestArsInstall()` | `api_key`, `mobile_app_name`, `client_platform`, `package_name`/`bundle_id`, `sdk_version` |
| `requestArsConfirm(installData)` | `api_key`, `mobile_app_name`, `client_platform`, `package_name`/`bundle_id` |
| `requestManualConfirm(phoneNumber, appuuid)` | `api_key`, `mobile_app_name`, `client_platform`, `package_name`/`bundle_id` |

적용 시 `LoginARS` 생성자에서 받은 값을 `LoginNotifier`와 `NetworkRepository`에 전달하거나, 별도의 `ArsAuthConfig` 객체를 Provider로 주입하는 방식이 적합하다.

```dart
class ArsAuthConfig {
  final String apiKey;
  final String mobileAppName;
  final String? packageName;
  final String? bundleId;
  final String sdkVersion;
}
```

## 12. 호환성 전략

- 신규 ars2fa API Gateway는 `/v1/ars/*` 경로로 제공한다.
- 기존 `barocall.baro.so` API를 직접 호출하는 방식은 내부 중계로 전환한다.
- `api_key`가 없는 요청은 신규 Gateway에서 차단한다.
- 개발/테스트를 위해 `ars2fa_test_*` Key를 별도 발급할 수 있다.
- 앱 배포 전에는 API Key를 코드에 평문 하드코딩하지 않고 빌드 환경 변수 또는 원격 설정으로 주입하는 방식을 권장한다.
