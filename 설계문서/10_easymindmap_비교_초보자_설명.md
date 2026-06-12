# 10. easymindmap과 ars2fa 아키텍처 비교 - IT 초보자용 설명

## 1. 이 문서의 목적

이 문서는 `easymindmap`의 프론트엔드/백엔드 아키텍처와 `ars2fa`의 프론트엔드/백엔드 아키텍처를 IT 초보자도 이해할 수 있도록 비교 설명한다.

두 시스템은 모두 웹 기술을 사용하지만, 서비스 성격이 다르기 때문에 화면 구조, 서버 구조, 데이터 저장 방식, 확장 방식이 다르다.

## 2. 한 줄 요약

| 시스템 | 한 줄 설명 | 쉬운 비유 |
|---|---|---|
| `easymindmap` | 사용자가 화면에서 마인드맵을 그리고, 수정하고, 협업하고, AI/번역 기능을 사용하는 편집 서비스 | 여러 사람이 함께 그림을 그리고 고치는 온라인 화이트보드 |
| `ars2fa` | 외부 앱 개발자가 ARS 인증 API를 신청하고, 관리자가 승인하며, 모바일 앱이 ARS 인증 API를 호출하는 인증 운영 서비스 | 출입증을 신청하고 승인받은 뒤 출입 기록을 확인하는 보안 출입 관리소 |

## 3. 가장 큰 차이

### 3.1 easymindmap은 "화면 안에서 계속 움직이는 서비스"

easymindmap은 사용자가 마인드맵 노드를 만들고, 끌어다 놓고, 글자를 수정하고, 자동 저장하고, 다른 사람과 동시에 편집한다.

따라서 프론트엔드가 매우 중요하다.

예를 들어 사용자가 노드 하나를 드래그하면:

1. 화면에서 노드 위치가 바뀐다.
2. 연결선 위치도 바뀐다.
3. 자동 저장 대상이 생긴다.
4. 협업 중인 다른 사람에게 변경 사항을 알려야 한다.
5. 필요하면 번역 캐시나 AI 기능도 영향을 받는다.

즉, easymindmap의 프론트엔드는 단순한 화면이 아니라 작은 편집 프로그램에 가깝다.

### 3.2 ars2fa는 "신청, 승인, 인증 API 운영 서비스"

ars2fa는 사용자가 화면에서 복잡한 편집 작업을 하는 서비스가 아니다.

주요 흐름은 다음과 같다.

1. API 사용자가 회원 가입한다.
2. API 사용 신청을 등록한다.
3. 관리자가 신청을 검토하고 승인한다.
4. API Key가 발급된다.
5. 모바일 앱이 `api_key`와 `mobile_app_name`으로 ARS 인증 API를 호출한다.
6. 사용자는 인증 요청 현황과 통계를 조회한다.

즉, ars2fa의 핵심은 화면의 복잡한 움직임보다 **승인 절차, API Key 보안, 인증 로그 저장, 상태 조회**에 있다.

## 4. 전체 구조 비교

```text
easymindmap
  사용자
    └── 마인드맵 편집 화면
          ├── 노드/선 그리기
          ├── 드래그/줌/선택
          ├── 자동 저장
          ├── 협업
          ├── AI 생성
          └── 번역/내보내기

ars2fa
  API 사용자
    └── API 신청/Key 관리 화면
  관리자
    └── 신청 승인/Key 운영 화면
  모바일 앱
    └── ARS 인증 API 호출
```

## 5. 프론트엔드 비교

## 5.1 프론트엔드란?

프론트엔드는 사용자가 직접 보는 화면이다.

쉬운 비유로 말하면:

- 프론트엔드는 가게의 매장, 안내판, 계산대 화면이다.
- 백엔드는 매장 뒤 창고, 직원용 시스템, 재고 관리 시스템이다.

## 5.2 easymindmap 프론트엔드의 특징

easymindmap 프론트엔드는 마인드맵 편집기이다.

참조 문서 기준 주요 구성은 다음과 같다.

| 구성 | 초보자 설명 |
|---|---|
| React + TypeScript | 화면을 부품처럼 나누어 만들고, 실수를 줄이기 위해 타입을 사용한다. |
| Zustand Store | 화면 안에서 변하는 상태를 보관하는 작은 메모장들이다. |
| React Query | 서버에서 가져온 데이터를 관리하는 도구이다. |
| editor/canvas | 마인드맵이 그려지는 도화지이다. |
| node-renderer | 마인드맵 노드를 화면에 그리는 부품이다. |
| edge-renderer | 노드와 노드 사이 선을 그리는 부품이다. |
| command-dispatcher | 사용자의 행동을 "명령"으로 바꾸는 곳이다. |
| history | 실행 취소/다시 실행을 관리한다. |
| collaboration | 여러 사용자가 동시에 편집할 때 필요한 상태를 관리한다. |

### 쉬운 예시

사용자가 노드 글자를 "회의"에서 "주간 회의"로 바꾸면 easymindmap 프론트엔드는 다음 일을 한다.

```text
사용자 입력
  -> Command 생성
  -> 화면 상태 변경
  -> 자동 저장 예약
  -> 연결된 화면 다시 그리기
  -> 협업 중이면 다른 사용자에게 변경 알림
```

이처럼 easymindmap은 프론트엔드가 매우 바쁘다.

## 5.3 ars2fa 프론트엔드의 특징

ars2fa 프론트엔드는 업무 포털과 관리자 콘솔이다.

주요 화면은 다음과 같다.

| 화면 | 역할 |
|---|---|
| 회원 가입/로그인 | API 사용자가 서비스에 들어온다. |
| API 신청 등록 | 사용할 모바일 앱명, 플랫폼, 사용 목적을 입력한다. |
| 신청 상세 | 심사 상태와 관리자 의견을 확인한다. |
| API Key 목록/상세 | 발급된 API Key 상태와 한도를 확인한다. |
| 인증 현황 | ARS 인증 요청 성공/실패 내역을 조회한다. |
| 관리자 `/admin` | 신청 승인, 반려, Key 정지, 로그 확인을 한다. |

ars2fa 프론트엔드는 easymindmap처럼 노드를 드래그하거나 실시간 편집하지 않는다.

대신 다음이 중요하다.

- 폼 입력이 정확해야 한다.
- 관리자 권한에 따라 메뉴가 달라져야 한다.
- API Key와 전화번호가 화면에 안전하게 표시되어야 한다.
- 인증 로그 목록과 통계가 빠르게 조회되어야 한다.

## 5.4 프론트엔드 난이도 비교

| 항목 | easymindmap | ars2fa |
|---|---|---|
| 화면 복잡도 | 매우 높음 | 중간 |
| 실시간 상호작용 | 많음 | 거의 없음 |
| 드래그/줌/캔버스 | 필요 | 불필요 |
| 관리자 테이블/폼 | 일부 | 매우 중요 |
| 상태 관리 | 복잡한 편집 상태 중심 | 로그인, 신청 상태, 조회 필터 중심 |
| 성능 이슈 | 노드가 많을 때 렌더링 성능 중요 | 인증 로그 목록/통계 조회 성능 중요 |

## 5.5 초보자용 결론 - 프론트엔드

easymindmap 프론트엔드는 "그림판 + 협업 도구"에 가깝다.

ars2fa 프론트엔드는 "관리 사이트 + 신청 사이트"에 가깝다.

따라서 ars2fa는 easymindmap보다 프론트엔드 화면 움직임은 단순하지만, 업무 흐름과 보안 표시가 더 중요하다.

## 6. 백엔드 비교

## 6.1 백엔드란?

백엔드는 사용자가 직접 보지 않는 서버 쪽 프로그램이다.

쉬운 비유로 말하면:

- 프론트엔드가 은행 창구라면,
- 백엔드는 고객 정보 확인, 계좌 처리, 승인 기록 저장을 하는 은행 내부 시스템이다.

## 6.2 easymindmap 백엔드의 특징

easymindmap 백엔드는 마인드맵 편집을 지원하는 서버이다.

참조 문서 기준 주요 모듈은 다음과 같다.

| 모듈 | 초보자 설명 |
|---|---|
| auth | 로그인/회원 인증 |
| maps | 마인드맵 문서 관리 |
| nodes | 마인드맵 노드 관리 |
| autosave | 편집 내용을 자동 저장 |
| snapshot | 대시보드용 가벼운 데이터 조회 |
| media | 첨부파일/이미지 저장 |
| ai | AI로 마인드맵 생성/확장 |
| translation | 다국어 번역 |
| export/publish | 마인드맵을 파일이나 공개 페이지로 내보내기 |
| collaboration | 여러 사용자의 협업 권한/상태 관리 |
| redmine | 외부 Redmine 시스템 연동 |

easymindmap 백엔드는 사용자가 계속 편집하는 데이터를 받아 저장하고, 다른 사용자에게도 알려주는 역할이 크다.

## 6.3 ars2fa 백엔드의 특징

ars2fa 백엔드는 API 신청과 ARS 인증 중계를 담당한다.

주요 모듈은 다음과 같다.

| 모듈 | 초보자 설명 |
|---|---|
| auth | API 사용자 로그인/회원 가입 |
| admin-auth | 관리자 로그인/권한 확인 |
| api-applications | API 사용 신청 등록/보완/제출 |
| application-apps | 모바일 앱명, Android/iOS 정보 관리 |
| api-keys | API Key 발급/정지/폐기 |
| ars-gateway | 모바일 앱의 ARS 인증 요청을 받아 기존 ARS 서버로 중계 |
| auth-requests | 인증 요청 현황 조회 |
| statistics | 성공률, 실패율, 사용량 통계 |
| audit-logs | 관리자 작업 이력 저장 |
| notifications | 승인/반려/한도/장애 알림 |

ars2fa 백엔드에서 가장 중요한 것은 다음 3가지이다.

1. **API Key 검증**
   - 이 요청이 승인된 사용자의 요청인지 확인한다.
2. **ARS 인증 중계**
   - 모바일 앱 요청을 받아 기존 ARS 서버의 install/confirm/recheck API로 전달한다.
3. **로그 저장**
   - 누가, 어떤 앱으로, 언제, 성공/실패했는지 기록한다.

## 6.4 백엔드 흐름 비교

### easymindmap 편집 흐름

```text
사용자가 노드 수정
  -> 프론트엔드가 patch 생성
  -> 백엔드 autosave API 호출
  -> DB에 노드 변경 저장
  -> Redis cache 무효화
  -> 협업 사용자에게 WebSocket 알림
```

### ars2fa 인증 흐름

```text
모바일 앱이 ARS 인증 시작
  -> /v1/ars/install 호출
  -> 백엔드가 API Key 확인
  -> 기존 ARS 서버 install 호출
  -> 인증 요청 로그 저장
  -> 모바일 앱이 전화 발신
  -> /v1/ars/confirm 호출
  -> 성공/실패 결과 저장
  -> 사용자 포털에서 현황 조회
```

## 6.5 백엔드 난이도 비교

| 항목 | easymindmap | ars2fa |
|---|---|---|
| 주요 데이터 | 마인드맵, 노드, 협업 상태 | API 신청, API Key, 인증 로그 |
| 실시간 처리 | WebSocket/협업 중요 | 중요도 낮음 |
| 외부 연동 | AI, 번역, Redmine, Supabase Storage | 기존 ARS 서버, 메일/SMS |
| 보안 핵심 | 사용자 권한, 협업 범위 | API Key, 관리자 권한, 개인정보 마스킹 |
| 비동기 작업 | AI, 번역, export | 통계, CSV, 알림, 로그 정리 |
| 서버 부하 | 편집/AI/번역 작업 | 인증 API 호출과 로그 저장 |

## 6.6 초보자용 결론 - 백엔드

easymindmap 백엔드는 "문서 편집과 협업을 실시간으로 도와주는 서버"이다.

ars2fa 백엔드는 "인증 API 사용 허가를 관리하고, 실제 인증 요청을 안전하게 통과시키는 서버"이다.

따라서 ars2fa 백엔드는 easymindmap보다 실시간 편집 기능은 적지만, 보안과 로그 기록의 중요성이 더 크다.

## 7. 데이터베이스 비교

## 7.1 easymindmap 데이터

easymindmap은 마인드맵 내용을 저장한다.

예를 들면:

- 사용자.
- 워크스페이스.
- 마인드맵.
- 노드.
- 노드 번역.
- 협업자.
- 버전 기록.
- 내보내기 결과.

즉, "사용자가 만든 콘텐츠"가 중심이다.

## 7.2 ars2fa 데이터

ars2fa는 API 운영 데이터를 저장한다.

예를 들면:

- 사용자/회사.
- API 신청.
- 모바일 앱 정보.
- API Key 해시.
- 인증 요청.
- 인증 이벤트.
- 관리자 감사 로그.
- 통계.

즉, "API 사용 권한과 인증 기록"이 중심이다.

## 7.3 데이터 성격 비교

| 항목 | easymindmap | ars2fa |
|---|---|---|
| 데이터 중심 | 사용자가 만든 마인드맵 콘텐츠 | 인증 API 운영 기록 |
| 자주 바뀌는 데이터 | 노드 위치/텍스트/편집 상태 | 인증 요청 상태, 사용량 |
| 개인정보 민감도 | 사용자 정보, 협업 정보 | 휴대폰 번호, API Key, 인증 이력 |
| 로그 중요도 | 편집 이력/감사 로그 | 인증 이벤트/관리자 감사 로그 매우 중요 |

## 8. Redis와 Worker 비교

## 8.1 Redis를 쉽게 설명하면

Redis는 매우 빠른 임시 보관함이다.

비유하면:

- DB는 오래 보관하는 서류 창고.
- Redis는 직원 책상 위 메모지.

자주 보고 빨리 확인해야 하는 정보는 Redis에 잠깐 올려두면 빠르다.

## 8.2 easymindmap에서 Redis

easymindmap은 Redis를 다음 용도로 사용한다.

- 자동 저장 중복 방지.
- 스냅샷 캐시.
- 번역 캐시.
- 협업 soft lock.
- BullMQ 작업 큐.

즉, 실시간 편집과 AI/번역 작업을 빠르게 처리하는 데 Redis가 많이 쓰인다.

## 8.3 ars2fa에서 Redis

ars2fa는 Redis를 다음 용도로 사용한다.

- API Key 검증 결과 캐시.
- API Key별 rate limit 카운터.
- 월별 호출량 카운터.
- CSV 생성 작업 큐.
- 승인/반려 알림 큐.

즉, 인증 API를 빠르고 안전하게 처리하는 데 Redis를 사용한다.

## 8.4 Worker를 쉽게 설명하면

Worker는 뒷일을 처리하는 직원이다.

사용자에게 바로 답해야 하는 일은 API 서버가 처리하고, 시간이 걸리는 일은 Worker에게 맡긴다.

| 작업 | 바로 처리 | Worker 처리 |
|---|---|---|
| 로그인 | O | X |
| API Key 검증 | O | X |
| 인증 요청 저장 | O | X |
| CSV 파일 생성 | X | O |
| 일별 통계 집계 | X | O |
| 알림 발송 | X | O |

## 9. 외부 연동 비교

| 구분 | easymindmap | ars2fa |
|---|---|---|
| 주요 외부 연동 | OpenAI, DeepL, Redmine, Supabase Storage | 기존 ARS 서버, 메일/SMS Provider |
| 외부 연동 목적 | AI 생성, 번역, 외부 프로젝트 동기화, 파일 저장 | 휴대폰 ARS 인증, 승인/장애 알림 |
| 장애 영향 | AI/번역/export 기능 장애 | 인증 API 장애로 직접 연결될 수 있음 |

ars2fa는 기존 ARS 서버와의 연동이 핵심이다. 이 서버가 느리거나 장애가 나면 모바일 앱 인증이 실패할 수 있다.

따라서 ars2fa는 기존 ARS 서버 호출 시간, 실패율, timeout을 꼭 기록해야 한다.

## 10. 보안 관점 비교

## 10.1 easymindmap 보안 핵심

- 사용자가 본인 마인드맵만 볼 수 있어야 한다.
- 협업자는 허용된 범위만 편집해야 한다.
- AI/번역 API Key는 서버에 안전하게 보관해야 한다.
- 공개된 마인드맵과 비공개 마인드맵을 구분해야 한다.

## 10.2 ars2fa 보안 핵심

- 승인된 API Key만 ARS 인증 API를 사용할 수 있어야 한다.
- API Key 원문은 DB에 저장하지 않아야 한다.
- 휴대폰 번호 원문은 저장하지 않아야 한다.
- 관리자 작업은 감사 로그에 남아야 한다.
- `/admin` 화면은 백엔드에서 반드시 권한 검사를 해야 한다.

## 10.3 보안 난이도 비교

| 항목 | easymindmap | ars2fa |
|---|---|---|
| 사용자 권한 | 중요 | 중요 |
| 관리자 권한 | 일반적 | 매우 중요 |
| API Key 보안 | 외부 API Key 보호 | 고객 API Key 발급/검증 핵심 |
| 개인정보 | 사용자 정보 중심 | 휴대폰 번호/인증 이력 중심 |
| 감사 로그 | 필요 | 필수 |

## 11. 인프라 비교

## 11.1 easymindmap 인프라

easymindmap은 기능이 많고, AI/번역/협업/실시간 처리가 있어서 처음부터 App, Supabase, Redis, Worker를 분리하는 구조가 잘 맞는다.

```text
Frontend
Backend API
WebSocket
Supabase/PostgreSQL
Redis
Worker
AI/Translation Provider
```

## 11.2 ars2fa 인프라

ars2fa는 초기에는 동시 사용자가 많지 않을 가능성이 높다.

그래서 처음부터 큰 인프라를 만들 필요는 적고, 아래처럼 단계적으로 가는 것이 적합하다.

```text
초기 단계
  Coolify 단일 서버
  Frontend + Backend + PostgreSQL + Redis

확장 단계
  Coolify App Host
  PostgreSQL 분리
  Redis 분리
  Worker 분리

본격 운영 단계
  NPM/L4
  App VM 다중화
  DB VM/Replica
  Redis VM
  Worker Pool
```

## 11.3 초보자용 결론 - 인프라

easymindmap은 처음부터 작업실이 여러 개 필요한 서비스이다.

ars2fa는 처음에는 작은 사무실 하나로 시작해도 되고, 고객사가 늘어나면 부서와 서버를 나누면 된다.

## 12. 왜 ars2fa는 easymindmap보다 단순하게 시작해도 되는가?

이유는 다음과 같다.

1. 화면에서 복잡한 편집이 없다.
2. 실시간 협업이 없다.
3. AI/번역/export 같은 무거운 작업이 없다.
4. 포털 사용자 동시 접속자가 많지 않을 가능성이 높다.
5. 핵심 부하는 ARS 인증 API 호출과 로그 저장인데, 초기에는 Coolify 단일 서버로도 감당 가능하다.

하지만 단순하게 시작해도 아래는 처음부터 챙겨야 한다.

- DB 백업.
- API Key 마스킹.
- 휴대폰 번호 마스킹.
- 관리자 권한 검사.
- API Key별 rate limit.
- 인증 로그 인덱스.

## 13. 개발자가 보면 좋은 구조 비교

## 13.1 프론트엔드 폴더 비교

```text
easymindmap frontend
  editor/
  stores/
  commands/
  history/
  layout/
  collaboration/
  services/

ars2fa frontend
  pages/user/
  pages/admin/
  features/applications/
  features/apiKeys/
  features/authRequests/
  features/statistics/
  shared/api/
  shared/components/
```

easymindmap은 "편집기 내부 기능" 중심이다.

ars2fa는 "업무 화면과 도메인 기능" 중심이다.

## 13.2 백엔드 모듈 비교

```text
easymindmap backend
  maps
  nodes
  autosave
  collaboration
  ai
  translation
  export
  redmine

ars2fa backend
  api-applications
  application-apps
  api-keys
  ars-gateway
  auth-requests
  statistics
  audit-logs
  notifications
```

easymindmap은 "마인드맵 콘텐츠를 만들고 편집하는 기능" 중심이다.

ars2fa는 "API 사용 권한과 인증 요청을 운영하는 기능" 중심이다.

## 14. 실무적으로 주의할 점

## 14.1 easymindmap에서 특히 어려운 점

- 마인드맵 노드가 많아질 때 화면 성능.
- 드래그/줌/선택 UX.
- 자동 저장 충돌.
- 협업 권한.
- AI/번역 작업 실패 처리.
- WebSocket 연결 관리.

## 14.2 ars2fa에서 특히 어려운 점

- API Key 유출 방지.
- API Key 상태 변경 시 cache 무효화.
- 인증 로그가 많아질 때 DB 성능.
- 휴대폰 번호 개인정보 보호.
- 기존 ARS 서버 장애 대응.
- 관리자 승인/반려 감사 로그.
- 모바일 앱에서 `api_key`와 `mobile_app_name`을 정확히 전달하도록 SDK 개정.

## 15. 최종 비교표

| 구분 | easymindmap | ars2fa |
|---|---|---|
| 서비스 성격 | 마인드맵 편집/협업 서비스 | ARS 인증 API 신청/운영 서비스 |
| 프론트엔드 핵심 | 캔버스, 노드, 선, 실시간 편집 | 신청 폼, 관리자 테이블, 현황 조회 |
| 백엔드 핵심 | 문서 저장, 자동 저장, 협업, AI/번역 | API Key, ARS Gateway, 인증 로그 |
| 실시간성 | 높음 | 낮음 |
| 보안 핵심 | 문서 권한, 협업 권한 | API Key, 개인정보, 관리자 감사 |
| 외부 연동 | AI/번역/Redmine/Storage | 기존 ARS 서버, 메일/SMS |
| 초기 인프라 | 분리 구조가 유리 | Coolify 단일 서버로 시작 가능 |
| 확장 기준 | 편집/AI/협업 부하 | API 사용 앱 수, 인증 로그, Key 검증 부하 |

## 16. IT 초보자용 최종 결론

easymindmap과 ars2fa는 둘 다 React, TypeScript, NestJS, PostgreSQL, Redis 같은 비슷한 기술을 사용할 수 있다.

다만 ars2fa는 아래 스택으로 확정한다.

```text
Frontend: React + TypeScript + Vite + React Router + TanStack Query + Zustand
Backend : NestJS + TypeScript + PostgreSQL + Prisma + Redis + BullMQ
```

하지만 두 시스템이 해결하려는 문제가 다르다.

easymindmap은 사용자가 화면 안에서 계속 무언가를 만들고 고치는 서비스이다. 그래서 프론트엔드가 복잡하고, 실시간 협업과 자동 저장이 중요하다.

ars2fa는 API 사용을 신청하고 승인받은 뒤, 모바일 앱이 안전하게 ARS 인증 API를 쓰도록 관리하는 서비스이다. 그래서 백엔드의 API Key 검증, 인증 로그 저장, 개인정보 보호, 관리자 감사 로그가 중요하다.

따라서 ars2fa는 easymindmap의 구조를 그대로 복사하기보다, 아래처럼 필요한 부분만 가져오는 것이 좋다.

1. React + TypeScript + Vite로 가볍고 단순한 프론트엔드를 만든다.
2. NestJS + PostgreSQL + Prisma + Redis + BullMQ로 명확한 백엔드 구조를 만든다.
3. easymindmap의 복잡한 편집기/협업 구조는 ars2fa에 필요하지 않다.
4. ars2fa는 API Key, 인증 로그, 관리자 승인 흐름에 맞게 단순하고 안전하게 설계한다.
5. 초기에는 Coolify로 작게 시작하고, API 사용 앱이 늘어나면 단계적으로 분리한다.
