# ars2fa

## 문서

- [발신 ARS 인증 API 신청 사이트 설계문서](./설계문서/README.md)

## MVP 코드 구조

```text
apps/
  backend/   NestJS + TypeScript + PostgreSQL + Prisma + Redis + BullMQ
  frontend/  React + TypeScript + Vite + React Router + TanStack Query + Zustand
```

## 로컬 실행

```bash
cp .env.example .env
npm install
docker compose up -d postgres redis
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed -w @ars2fa/backend
npm run backend:dev
npm run frontend:dev
```

- 사용자 포털: http://localhost:5173
- 관리자 콘솔: http://localhost:5173/admin
- Backend API: http://localhost:3000
- Swagger: http://localhost:3000/api-docs

기본 관리자 계정은 `.env`의 `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` 값을 사용한다.
