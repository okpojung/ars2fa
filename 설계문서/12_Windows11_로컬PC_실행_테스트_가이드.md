# 12. Windows 11 로컬 PC 실행/테스트 가이드 - IT 왕초보자용

## 1. 이 문서의 목적

이 문서는 Windows 11 PC에서 GitHub의 `ars2fa` 소스코드를 내려받아 직접 실행하고 테스트하는 방법을 아주 자세히 설명한다.

IT 왕초보자를 기준으로 작성했기 때문에, 이미 알고 있는 내용이 있어도 순서대로 따라 하는 것을 권장한다.

## 2. 최종 목표

이 문서를 끝까지 따라 하면 내 Windows PC에서 아래 주소들이 열린다.

| 구분 | 주소 |
|---|---|
| 사용자 포털 | `http://localhost:5173` |
| 관리자 콘솔 | `http://localhost:5173/admin` |
| Backend API | `http://localhost:3000` |
| Backend 상태 확인 | `http://localhost:3000/health` |
| Swagger API 문서 | `http://localhost:3000/api-docs` |

그리고 아래 테스트를 할 수 있다.

1. 사용자 회원 가입.
2. API 신청 등록.
3. 관리자 로그인.
4. 관리자 승인.
5. API Key 발급 확인.
6. ARS install/confirm mock API 호출.
7. 인증 현황 조회.

## 3. 전체 흐름을 먼저 이해하기

ars2fa는 크게 4개로 구성된다.

```text
내 Windows 11 PC
  ├── Frontend  : 화면 담당, http://localhost:5173
  ├── Backend   : API 담당, http://localhost:3000
  ├── PostgreSQL: 데이터베이스, Docker로 실행
  └── Redis     : 캐시/Rate Limit, Docker로 실행
```

쉽게 비유하면:

| 구성 | 비유 |
|---|---|
| Frontend | 사용자가 보는 가게 매장 |
| Backend | 매장 뒤에서 일하는 직원 |
| PostgreSQL | 중요한 서류를 보관하는 창고 |
| Redis | 직원 책상 위 빠른 메모지 |

## 4. 준비물

Windows 11에 아래 프로그램을 설치해야 한다.

| 프로그램 | 용도 |
|---|---|
| Git | GitHub 소스코드를 내 PC로 가져오기 |
| Node.js | 프론트엔드/백엔드 실행 |
| Docker Desktop | PostgreSQL, Redis 실행 |
| VS Code | 소스코드 보기/수정 |
| PowerShell 또는 Windows Terminal | 명령어 실행 |

## 5. 필수 프로그램 설치

## 5.1 Git 설치

1. 브라우저에서 아래 주소로 이동한다.

```text
https://git-scm.com/download/win
```

2. Windows용 Git 설치 파일을 다운로드한다.
3. 설치 파일을 실행한다.
4. 설치 옵션은 대부분 기본값으로 두고 `Next`를 누른다.
5. 설치 완료 후 PowerShell을 새로 열고 아래 명령어를 입력한다.

```powershell
git --version
```

정상 예:

```text
git version 2.x.x
```

## 5.2 Node.js 설치

1. 브라우저에서 아래 주소로 이동한다.

```text
https://nodejs.org
```

2. LTS 버전을 다운로드한다.
3. 설치 파일을 실행한다.
4. 설치 완료 후 PowerShell을 새로 열고 확인한다.

```powershell
node --version
npm --version
```

권장:

```text
node v20 이상
npm 10 이상
```

이 프로젝트는 Node 20 이상이면 된다. Node 22도 가능하다.

## 5.3 Docker Desktop 설치

1. 브라우저에서 아래 주소로 이동한다.

```text
https://www.docker.com/products/docker-desktop/
```

2. Docker Desktop for Windows를 다운로드한다.
3. 설치 파일을 실행한다.
4. 설치 중 WSL2 관련 안내가 나오면 허용한다.
5. 설치 완료 후 PC 재부팅이 필요할 수 있다.
6. Docker Desktop을 실행한다.
7. 화면 왼쪽 아래 또는 상단에 Docker가 Running 상태인지 확인한다.

PowerShell에서 확인:

```powershell
docker --version
docker compose version
```

정상 예:

```text
Docker version ...
Docker Compose version ...
```

> 중요: Docker Desktop이 실행 중이어야 PostgreSQL과 Redis가 동작한다.

## 5.4 VS Code 설치

1. 브라우저에서 아래 주소로 이동한다.

```text
https://code.visualstudio.com/
```

2. Windows용 VS Code를 설치한다.
3. 설치 후 실행한다.

권장 Extension:

- ESLint
- Prettier
- Prisma
- Docker

필수는 아니지만 있으면 편하다.

## 6. 소스코드 받을 폴더 만들기

PowerShell을 연다.

예를 들어 `C:\dev` 폴더를 만들고 그 안에 소스코드를 받는다.

```powershell
mkdir C:\dev
cd C:\dev
```

이미 폴더가 있으면 `mkdir`에서 오류가 날 수 있다. 그 경우 무시하고 `cd C:\dev`만 실행한다.

## 7. GitHub에서 소스코드 clone 하기

아래 명령어를 실행한다.

```powershell
git clone https://github.com/okpojung/ars2fa.git
```

완료되면 폴더로 이동한다.

```powershell
cd ars2fa
```

현재 위치 확인:

```powershell
pwd
```

정상 예:

```text
Path
----
C:\dev\ars2fa
```

파일 목록 확인:

```powershell
dir
```

아래와 비슷하게 보여야 한다.

```text
apps
docker-compose.yml
package.json
README.md
설계문서
```

## 8. VS Code로 프로젝트 열기

PowerShell에서 아래 명령어를 입력한다.

```powershell
code .
```

VS Code가 열리면 왼쪽 파일 목록에서 아래 폴더가 보인다.

```text
apps/backend
apps/frontend
설계문서
```

## 9. 환경변수 파일 만들기

프로젝트에는 `.env.example` 파일이 있다. 이 파일은 예시 파일이다.

실제로 실행할 때는 `.env` 파일이 필요하다.

PowerShell에서:

```powershell
copy .env.example .env
```

생성 확인:

```powershell
dir .env
```

## 10. `.env` 파일 확인하기

VS Code에서 `.env` 파일을 연다.

처음 테스트할 때는 기본값 그대로 사용해도 된다.

중요한 값:

```env
DATABASE_URL=postgresql://ars2fa:ars2fa@localhost:5432/ars2fa?schema=public
REDIS_URL=redis://localhost:6379
SEED_ADMIN_EMAIL=admin@ars2fa.baro.me
SEED_ADMIN_PASSWORD=ChangeMe123!
LEGACY_ARS_ENABLED=false
```

의미:

| 값 | 의미 |
|---|---|
| `DATABASE_URL` | PostgreSQL 연결 주소 |
| `REDIS_URL` | Redis 연결 주소 |
| `SEED_ADMIN_EMAIL` | 처음 생성할 관리자 이메일 |
| `SEED_ADMIN_PASSWORD` | 처음 생성할 관리자 비밀번호 |
| `LEGACY_ARS_ENABLED=false` | 실제 ARS 서버 대신 mock 응답 사용 |

처음 테스트할 때는 `LEGACY_ARS_ENABLED=false`가 안전하다.

## 11. npm 패키지 설치

PowerShell에서 프로젝트 루트(`C:\dev\ars2fa`)에 있는지 확인한다.

```powershell
pwd
```

그 다음 패키지를 설치한다.

```powershell
npm install
```

시간이 조금 걸릴 수 있다.

정상 완료되면 `node_modules` 폴더가 생긴다.

## 12. PostgreSQL과 Redis 실행

Docker Desktop이 실행 중인지 먼저 확인한다.

```powershell
docker ps
```

오류가 나오면 Docker Desktop을 실행한 뒤 다시 시도한다.

PostgreSQL과 Redis를 실행한다.

```powershell
docker compose up -d postgres redis
```

정상 확인:

```powershell
docker compose ps
```

아래처럼 `running` 또는 `healthy` 상태여야 한다.

```text
postgres   running
redis      running
```

## 13. Prisma Client 생성

Prisma는 백엔드가 PostgreSQL과 대화할 수 있게 도와주는 도구이다.

아래 명령어를 실행한다.

```powershell
npm run prisma:generate
```

정상 예:

```text
Generated Prisma Client
```

## 14. DB 테이블 생성

처음 실행할 때는 데이터베이스에 테이블이 없다.

아래 명령어로 테이블을 생성한다.

```powershell
npm run prisma:migrate -w @ars2fa/backend -- --name init
```

정상 완료되면 `users`, `api_applications`, `api_keys`, `auth_requests` 같은 테이블이 생성된다.

## 15. 초기 관리자 계정 생성

관리자 로그인을 위해 seed를 실행한다.

```powershell
npm run prisma:seed -w @ars2fa/backend
```

정상 예:

```text
Seeded admin user: admin@ars2fa.baro.me
```

기본 관리자 계정:

| 항목 | 값 |
|---|---|
| 이메일 | `admin@ars2fa.baro.me` |
| 비밀번호 | `ChangeMe123!` |

이 값은 `.env`에서 바꿀 수 있다.

## 16. 백엔드 실행

PowerShell 창을 하나 연다.

프로젝트 폴더로 이동한다.

```powershell
cd C:\dev\ars2fa
```

백엔드를 실행한다.

```powershell
npm run backend:dev
```

정상 예:

```text
ars2fa backend listening on 3000
```

이 창은 닫지 말고 그대로 둔다.

## 17. 프론트엔드 실행

PowerShell 창을 하나 더 연다.

프로젝트 폴더로 이동한다.

```powershell
cd C:\dev\ars2fa
```

프론트엔드를 실행한다.

```powershell
npm run frontend:dev
```

정상 예:

```text
Local: http://localhost:5173/
```

이 창도 닫지 않는다.

## 18. 브라우저에서 접속 확인

브라우저에서 아래 주소를 연다.

```text
http://localhost:5173
```

로그인 화면이 보이면 프론트엔드가 정상이다.

백엔드 상태 확인:

```text
http://localhost:3000/health
```

정상 예:

```json
{
  "ok": true,
  "service": "ars2fa-backend"
}
```

Swagger API 문서:

```text
http://localhost:3000/api-docs
```

## 19. 사용자 회원 가입 테스트

브라우저에서:

```text
http://localhost:5173/signup
```

예시 입력:

| 항목 | 값 |
|---|---|
| 이메일 | `user@test.com` |
| 비밀번호 | `UserTest123!` |
| 회사명 | `테스트 회사` |
| 사업자등록번호 | 비워도 됨 |
| 담당자명 | `홍길동` |
| 담당자 연락처 | `01012345678` |

가입하면 사용자 대시보드로 이동한다.

## 20. API 신청 테스트

사용자 로그인 상태에서:

```text
http://localhost:5173/applications/new
```

예시 입력:

| 항목 | 값 |
|---|---|
| 서비스명 | `테스트 서비스` |
| 사용 목적 | `발신 ARS 휴대폰 인증 테스트` |
| 예상 월 요청 수 | `10000` |
| 모바일 앱 명칭 | `테스트 앱` |
| 플랫폼 | `ANDROID` |
| Android 패키지명 | `com.example.testapp` |
| iOS Bundle ID | 비워도 됨 |
| 스토어 URL | 비워도 됨 |

`신청 제출` 버튼을 누른다.

신청 목록에서 상태가 `SUBMITTED`이면 정상이다.

## 21. 관리자 로그인 테스트

사용자 화면에서 로그아웃한다.

브라우저에서:

```text
http://localhost:5173/admin/login
```

기본 관리자 계정:

| 항목 | 값 |
|---|---|
| 이메일 | `admin@ars2fa.baro.me` |
| 비밀번호 | `ChangeMe123!` |

로그인 후 관리자 대시보드가 보이면 정상이다.

## 22. 관리자 승인 테스트

관리자 화면에서:

```text
http://localhost:5173/admin/applications
```

사용자가 제출한 신청이 보인다.

`승인` 버튼을 누른다.

성공하면 메시지에 API Key 원문이 표시된다.

예:

```text
ars2fa_test_xxxxxxxxxxxxxxxxx
```

> 매우 중요: API Key 원문은 한 번만 표시되는 것이 원칙이다. 반드시 복사해 둔다.

## 23. API Key 목록 확인

관리자 화면:

```text
http://localhost:5173/admin/api-keys
```

또는 사용자로 다시 로그인해서:

```text
http://localhost:5173/api-keys
```

발급된 API Key prefix와 상태가 보이면 정상이다.

## 24. ARS install API 테스트 - PowerShell

관리자 승인 때 복사한 API Key를 사용한다.

PowerShell 새 창에서 아래처럼 입력한다.

```powershell
$apiKey = "여기에_복사한_API_KEY를_붙여넣기"

$installBody = @{
  api_key = $apiKey
  mobile_app_name = "테스트 앱"
  client_platform = "ANDROID"
  package_name = "com.example.testapp"
  appsid = "test-session-001"
  app_os_type = "AND"
  app_os_version = "14"
  gcmid = "deprecated"
  playerid = "deprecated"
} | ConvertTo-Json

$install = Invoke-RestMethod `
  -Uri "http://localhost:3000/v1/ars/install" `
  -Method Post `
  -ContentType "application/json" `
  -Body $installBody

$install
```

정상 예:

```text
return  : True
appuuid : mock-...
phonenum: +8270-0000-0000
```

현재 `.env`에서 `LEGACY_ARS_ENABLED=false`이므로 실제 ARS 전화가 아니라 mock 응답이 온다.

## 25. ARS confirm API 테스트 - PowerShell

install 응답의 `appuuid`를 사용한다.

```powershell
$confirmBody = @{
  api_key = $apiKey
  mobile_app_name = "테스트 앱"
  client_platform = "ANDROID"
  package_name = "com.example.testapp"
  appsid = "test-session-001"
  appuuid = $install.appuuid
  applng = "0"
  applat = "0"
} | ConvertTo-Json

$confirm = Invoke-RestMethod `
  -Uri "http://localhost:3000/v1/ars/confirm" `
  -Method Post `
  -ContentType "application/json" `
  -Body $confirmBody

$confirm
```

정상 예:

```text
return     : True
call_count : 1
app_cid    : 01012345678
msg        : mock confirm succeeded
```

## 26. 인증 현황 확인

사용자 또는 관리자 화면에서:

```text
http://localhost:5173/auth-requests
```

또는 관리자:

```text
http://localhost:5173/admin/auth-logs
```

방금 호출한 인증 요청이 보이면 정상이다.

## 27. 자주 쓰는 명령어 정리

## 27.1 서버 실행

터미널 1:

```powershell
npm run backend:dev
```

터미널 2:

```powershell
npm run frontend:dev
```

## 27.2 DB/Redis 실행

```powershell
docker compose up -d postgres redis
```

## 27.3 DB/Redis 중지

```powershell
docker compose stop postgres redis
```

## 27.4 DB/Redis 완전 삭제

주의: 데이터가 삭제된다.

```powershell
docker compose down -v
```

## 27.5 타입 검사

```powershell
npm run typecheck -w @ars2fa/backend
npm run typecheck -w @ars2fa/frontend
```

## 27.6 빌드 검사

```powershell
npm run build -w @ars2fa/backend
npm run build -w @ars2fa/frontend
```

## 28. 문제 해결

## 28.1 `docker` 명령어가 안 될 때

증상:

```text
docker: command not found
```

해결:

1. Docker Desktop 설치 여부 확인.
2. Docker Desktop 실행.
3. PowerShell을 새로 열기.
4. 다시 확인.

```powershell
docker --version
```

## 28.2 `docker compose up`이 실패할 때

확인:

```powershell
docker compose ps
docker compose logs postgres
docker compose logs redis
```

가장 흔한 원인:

- Docker Desktop이 실행 중이 아님.
- 5432 또는 6379 포트를 다른 프로그램이 사용 중.

## 28.3 5432 포트 충돌

증상:

```text
port is already allocated
```

의미:

PostgreSQL 포트 5432를 다른 프로그램이 이미 사용 중이다.

해결 방법:

1. 기존 PostgreSQL을 중지한다.
2. 또는 `docker-compose.yml`의 포트를 바꾼다.

초보자에게는 기존 PostgreSQL 중지를 권장한다.

## 28.4 `npm install`이 실패할 때

해결 순서:

```powershell
node --version
npm --version
```

Node 20 이상인지 확인한다.

그래도 실패하면:

```powershell
rmdir /s /q node_modules
del package-lock.json
npm install
```

주의: 위 명령어는 Windows PowerShell 기준이다.

## 28.5 Prisma migrate가 실패할 때

PostgreSQL이 실행 중인지 확인한다.

```powershell
docker compose ps
```

`postgres`가 running이 아니면:

```powershell
docker compose up -d postgres
```

다시 실행:

```powershell
npm run prisma:migrate -w @ars2fa/backend -- --name init
```

## 28.6 관리자 로그인이 안 될 때

확인할 것:

1. seed 실행 여부.
2. `.env`의 `SEED_ADMIN_EMAIL`.
3. `.env`의 `SEED_ADMIN_PASSWORD`.

다시 seed:

```powershell
npm run prisma:seed -w @ars2fa/backend
```

## 28.7 화면은 열리는데 API 오류가 날 때

확인:

```text
http://localhost:3000/health
```

정상 응답이 없으면 backend가 꺼져 있는 것이다.

다시 실행:

```powershell
npm run backend:dev
```

## 28.8 `/admin` 새로고침 시 오류

개발 서버에서는 Vite가 SPA fallback을 처리하므로 보통 문제 없다.

운영 배포에서만 문제가 나면 proxy/nginx 설정에서 `/admin/*`을 frontend로 보내야 한다.

## 28.9 API Key 인증 실패

확인:

| 항목 | 확인값 |
|---|---|
| API Key | 승인 시 복사한 원문이 맞는가 |
| mobile_app_name | 신청한 앱명과 정확히 같은가 |
| client_platform | `ANDROID` 또는 `IOS`가 맞는가 |
| package_name | 신청한 패키지명과 같은가 |
| Key 상태 | ACTIVE인가 |

`테스트 앱`과 `com.example.testapp`을 다르게 입력하면 `APP_NOT_ALLOWED`가 발생할 수 있다.

## 29. 개발 종료 방법

프론트엔드/백엔드 실행 중인 PowerShell 창에서:

```text
Ctrl + C
```

Docker DB/Redis 중지:

```powershell
docker compose stop postgres redis
```

## 30. 다음에 다시 실행할 때

이미 한 번 설치가 끝났다면 다음부터는 간단하다.

PowerShell 1:

```powershell
cd C:\dev\ars2fa
docker compose up -d postgres redis
npm run backend:dev
```

PowerShell 2:

```powershell
cd C:\dev\ars2fa
npm run frontend:dev
```

브라우저:

```text
http://localhost:5173
```

## 31. 초보자용 최종 체크리스트

| 체크 | 완료 |
|---|---|
| Git 설치 |  |
| Node.js 설치 |  |
| Docker Desktop 설치 및 실행 |  |
| VS Code 설치 |  |
| `git clone` 완료 |  |
| `.env` 생성 |  |
| `npm install` 완료 |  |
| PostgreSQL/Redis 실행 |  |
| Prisma generate 완료 |  |
| Prisma migrate 완료 |  |
| seed 완료 |  |
| backend 실행 |  |
| frontend 실행 |  |
| 사용자 회원 가입 |  |
| API 신청 제출 |  |
| 관리자 로그인 |  |
| 신청 승인 |  |
| API Key 복사 |  |
| install API 테스트 |  |
| confirm API 테스트 |  |
| 인증 현황 확인 |  |

위 항목이 모두 완료되면 Windows 11 로컬 PC에서 ars2fa MVP 실행/테스트가 완료된 것이다.
