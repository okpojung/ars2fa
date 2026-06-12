# 발신 ARS 인증 API 신청 사이트 설계문서

이 폴더는 `ars2fa` 서비스에서 발신 ARS 휴대폰 인증 API를 외부 모바일 앱/웹앱에 제공하기 위한 신청 사이트와 운영 시스템 설계를 정리한다.

## 참조 저장소

- `https://github.com/okpojung/ars_auth`
  - Flutter ARS 인증 위젯 패키지.
  - 현행 흐름은 `install_app(_ios).php` -> 전화 발신 -> `confirm_auth(_ios).php` -> 필요 시 `confirm_auth_recheck.php` 순서이다.
  - 현재 요청 파라미터에는 `appsid`, OS 정보, `appuuid`, 위치값, 수동 입력 전화번호 등이 포함된다.
- `https://github.com/okpojung/BS_Point`
  - `ars_auth`의 `LoginARS` 위젯을 사용하는 Flutter 웹앱.
  - 인증 성공 콜백에서 `app_cid`, `appuuid`, `appsid`, `now`, `prnts_phone_no` 등을 저장하고 웹뷰 URL에 인증 전화번호를 전달한다.

## 문서 목록

1. [개념 및 범위](./01_개념_및_범위.md)
2. [기능구조도](./02_기능구조도.md)
3. [사용자/관리자 업무 흐름](./03_업무_흐름.md)
4. [API 구분 및 명세 개정안](./04_API_구분_및_명세.md)
5. [DB 설계](./05_DB_설계.md)
6. [운영, 보안, 권한 설계](./06_운영_보안_권한.md)
7. [인프라 아키텍처](./07_인프라_아키텍처.md)

## 핵심 설계 방향

- 서비스 대표 도메인은 `https://ars2fa.baro.me`를 사용한다.
- 관리자 콘솔은 같은 도메인의 `https://ars2fa.baro.me/admin` 경로를 사용한다.
- 인프라는 API 사용 앱 수 기준으로 초기 단계(100개 이내), 확장 단계(500개 이내), 본격 운영 단계(500개 이상)로 나누어 확장한다.
- 회원 가입한 사용자가 API 사용 신청을 등록한다.
- 관리자는 신청 내용을 심사하고 승인하면 서비스별 API Key를 발급한다.
- 발급된 API Key는 모바일 앱 명칭과 함께 ARS 인증 API 호출마다 전달되어 API 사용 주체를 구분한다.
- 사용자는 API Key 발급 후 관리자 승인 범위 안에서 인증 요청 현황, 성공/실패 현황, 월별 사용량을 조회할 수 있다.
- 기존 `ars_auth`의 ARS 인증 흐름은 유지하되, 서버 API 구분 기준을 `api_key + mobile_app_name + platform + endpoint`로 확장한다.
