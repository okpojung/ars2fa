-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_EMAIL', 'ACTIVE', 'SUSPENDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'REVIEWER', 'OPERATOR', 'KEY_MANAGER');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'NEEDS_REVISION', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AppPlatform" AS ENUM ('ANDROID', 'IOS');

-- CreateEnum
CREATE TYPE "AppStatus" AS ENUM ('PENDING', 'APPROVED', 'DISABLED');

-- CreateEnum
CREATE TYPE "ApiKeyEnvironment" AS ENUM ('TEST', 'LIVE');

-- CreateEnum
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ROTATED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AuthRequestStatus" AS ENUM ('INSTALL_REQUESTED', 'INSTALL_SUCCEEDED', 'INSTALL_FAILED', 'CONFIRM_REQUESTED', 'AUTH_SUCCEEDED', 'MANUAL_REQUIRED', 'RETRY_REQUIRED', 'AUTH_FAILED', 'MANUAL_SUCCEEDED', 'MANUAL_FAILED');

-- CreateEnum
CREATE TYPE "AuthEventType" AS ENUM ('INSTALL', 'CONFIRM', 'RECHECK', 'STATUS_QUERY', 'ERROR');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "VnStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ArsSessionMode" AS ENUM ('APP', 'PC');

-- CreateEnum
CREATE TYPE "ArsSessionStatus" AS ENUM ('PENDING', 'CALL_CONFIRMED', 'VERIFIED', 'FAILED', 'EXPIRED', 'CANCELED');

-- CreateEnum
CREATE TYPE "IntegrityPolicy" AS ENUM ('OFF', 'MONITOR', 'ENFORCE');

-- CreateEnum
CREATE TYPE "IntegrityVerdict" AS ENUM ('NOT_PROVIDED', 'PASSED', 'FAILED', 'ERROR', 'SKIPPED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "businessNumber" TEXT,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'REVIEWER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "usagePurpose" TEXT NOT NULL,
    "expectedMonthlyRequests" INTEGER NOT NULL,
    "allowedIps" TEXT,
    "callbackUrl" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "adminComment" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationApp" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "mobileAppName" TEXT NOT NULL,
    "platform" "AppPlatform" NOT NULL,
    "packageName" TEXT,
    "bundleId" TEXT,
    "storeUrl" TEXT,
    "displayName" TEXT,
    "integrityPolicy" "IntegrityPolicy" NOT NULL DEFAULT 'MONITOR',
    "androidCertSha256" TEXT,
    "iosTeamId" TEXT,
    "status" "AppStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "environment" "ApiKeyEnvironment" NOT NULL DEFAULT 'TEST',
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "monthlyLimit" INTEGER NOT NULL DEFAULT 10000,
    "rateLimitPerMinute" INTEGER,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "applicationAppId" TEXT,
    "mobileAppName" TEXT NOT NULL,
    "clientPlatform" "AppPlatform" NOT NULL,
    "packageName" TEXT,
    "bundleId" TEXT,
    "appsid" TEXT NOT NULL,
    "appuuid" TEXT,
    "appip" TEXT,
    "status" "AuthRequestStatus" NOT NULL,
    "callCount" INTEGER,
    "phoneHash" TEXT,
    "phoneMasked" TEXT,
    "providerMessage" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthEvent" (
    "id" TEXT NOT NULL,
    "authRequestId" TEXT,
    "apiKeyId" TEXT,
    "eventType" "AuthEventType" NOT NULL,
    "endpoint" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "errorCode" TEXT,
    "message" TEXT,
    "requestPayloadMasked" JSONB,
    "responsePayloadMasked" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewHistory" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "fromStatus" "ApplicationStatus",
    "toStatus" "ApplicationStatus" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualNumber" (
    "id" SERIAL NOT NULL,
    "vn" TEXT NOT NULL,
    "rn" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "status" "VnStatus" NOT NULL DEFAULT 'ACTIVE',
    "leasedUntil" TIMESTAMP(3),
    "cooldownUntil" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VirtualNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VnCycle" (
    "id" SERIAL NOT NULL,
    "cycleNo" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "VnCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VnCycleSlot" (
    "id" SERIAL NOT NULL,
    "cycleId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "vnId" INTEGER NOT NULL,
    "usedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),

    CONSTRAINT "VnCycleSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArsSession" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "applicationAppId" TEXT NOT NULL,
    "mobileAppName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "clientPlatform" "AppPlatform" NOT NULL,
    "mode" "ArsSessionMode" NOT NULL DEFAULT 'APP',
    "appsid" TEXT,
    "purpose" TEXT,
    "vnId" INTEGER NOT NULL,
    "vn" TEXT NOT NULL,
    "rn" TEXT NOT NULL,
    "status" "ArsSessionStatus" NOT NULL DEFAULT 'PENDING',
    "failReason" TEXT,
    "expectedPhoneHash" TEXT,
    "callerPhoneHash" TEXT,
    "callerPhoneMasked" TEXT,
    "callerPhoneEnc" TEXT,
    "pcCode" TEXT,
    "pcCodeAttempts" INTEGER NOT NULL DEFAULT 0,
    "integrityVerdict" "IntegrityVerdict" NOT NULL DEFAULT 'NOT_PROVIDED',
    "integrityDetail" JSONB,
    "pbxUniqueId" TEXT,
    "authlogEventId" TEXT,
    "callStartedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArsSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthLogEvent" (
    "id" TEXT NOT NULL,
    "vn" TEXT NOT NULL,
    "anHash" TEXT,
    "anMasked" TEXT,
    "callStartAt" TIMESTAMP(3) NOT NULL,
    "callIdHash" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthLogEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PbxCall" (
    "id" TEXT NOT NULL,
    "uniqueId" TEXT NOT NULL,
    "rn" TEXT NOT NULL,
    "callerHash" TEXT,
    "callerMasked" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "result" TEXT,
    "reason" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PbxCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrityChallenge" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "applicationAppId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrityChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppAttestKey" (
    "id" TEXT NOT NULL,
    "applicationAppId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "publicKeyPem" TEXT NOT NULL,
    "signCount" INTEGER NOT NULL DEFAULT 0,
    "environment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "AppAttestKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "ApiApplication_userId_idx" ON "ApiApplication"("userId");

-- CreateIndex
CREATE INDEX "ApiApplication_status_idx" ON "ApiApplication"("status");

-- CreateIndex
CREATE INDEX "ApiApplication_submittedAt_idx" ON "ApiApplication"("submittedAt");

-- CreateIndex
CREATE INDEX "ApplicationApp_mobileAppName_platform_idx" ON "ApplicationApp"("mobileAppName", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationApp_applicationId_mobileAppName_platform_key" ON "ApplicationApp"("applicationId", "mobileAppName", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_applicationId_idx" ON "ApiKey"("applicationId");

-- CreateIndex
CREATE INDEX "ApiKey_status_idx" ON "ApiKey"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AuthRequest_requestId_key" ON "AuthRequest"("requestId");

-- CreateIndex
CREATE INDEX "AuthRequest_apiKeyId_requestedAt_idx" ON "AuthRequest"("apiKeyId", "requestedAt");

-- CreateIndex
CREATE INDEX "AuthRequest_status_idx" ON "AuthRequest"("status");

-- CreateIndex
CREATE INDEX "AuthRequest_appsid_idx" ON "AuthRequest"("appsid");

-- CreateIndex
CREATE INDEX "AuthRequest_appuuid_idx" ON "AuthRequest"("appuuid");

-- CreateIndex
CREATE INDEX "AuthRequest_phoneHash_idx" ON "AuthRequest"("phoneHash");

-- CreateIndex
CREATE INDEX "AuthEvent_authRequestId_idx" ON "AuthEvent"("authRequestId");

-- CreateIndex
CREATE INDEX "AuthEvent_createdAt_idx" ON "AuthEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuthEvent_errorCode_idx" ON "AuthEvent"("errorCode");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualNumber_vn_key" ON "VirtualNumber"("vn");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualNumber_ordinal_key" ON "VirtualNumber"("ordinal");

-- CreateIndex
CREATE INDEX "VirtualNumber_rn_idx" ON "VirtualNumber"("rn");

-- CreateIndex
CREATE UNIQUE INDEX "VnCycle_cycleNo_key" ON "VnCycle"("cycleNo");

-- CreateIndex
CREATE UNIQUE INDEX "VnCycleSlot_cycleId_position_key" ON "VnCycleSlot"("cycleId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "VnCycleSlot_cycleId_vnId_key" ON "VnCycleSlot"("cycleId", "vnId");

-- CreateIndex
CREATE UNIQUE INDEX "ArsSession_sessionId_key" ON "ArsSession"("sessionId");

-- CreateIndex
CREATE INDEX "ArsSession_vnId_status_idx" ON "ArsSession"("vnId", "status");

-- CreateIndex
CREATE INDEX "ArsSession_apiKeyId_createdAt_idx" ON "ArsSession"("apiKeyId", "createdAt");

-- CreateIndex
CREATE INDEX "ArsSession_status_expiresAt_idx" ON "ArsSession"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthLogEvent_callIdHash_key" ON "AuthLogEvent"("callIdHash");

-- CreateIndex
CREATE INDEX "AuthLogEvent_vn_callStartAt_idx" ON "AuthLogEvent"("vn", "callStartAt");

-- CreateIndex
CREATE INDEX "AuthLogEvent_anHash_callStartAt_idx" ON "AuthLogEvent"("anHash", "callStartAt");

-- CreateIndex
CREATE UNIQUE INDEX "PbxCall_uniqueId_key" ON "PbxCall"("uniqueId");

-- CreateIndex
CREATE INDEX "PbxCall_rn_startedAt_idx" ON "PbxCall"("rn", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrityChallenge_nonce_key" ON "IntegrityChallenge"("nonce");

-- CreateIndex
CREATE UNIQUE INDEX "AppAttestKey_keyId_key" ON "AppAttestKey"("keyId");

-- CreateIndex
CREATE INDEX "AuditLog_actorType_actorId_idx" ON "AuditLog"("actorType", "actorId");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ApiApplication" ADD CONSTRAINT "ApiApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationApp" ADD CONSTRAINT "ApplicationApp_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ApiApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ApiApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthRequest" ADD CONSTRAINT "AuthRequest_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthRequest" ADD CONSTRAINT "AuthRequest_applicationAppId_fkey" FOREIGN KEY ("applicationAppId") REFERENCES "ApplicationApp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthEvent" ADD CONSTRAINT "AuthEvent_authRequestId_fkey" FOREIGN KEY ("authRequestId") REFERENCES "AuthRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewHistory" ADD CONSTRAINT "ReviewHistory_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ApiApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewHistory" ADD CONSTRAINT "ReviewHistory_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VnCycleSlot" ADD CONSTRAINT "VnCycleSlot_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "VnCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VnCycleSlot" ADD CONSTRAINT "VnCycleSlot_vnId_fkey" FOREIGN KEY ("vnId") REFERENCES "VirtualNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArsSession" ADD CONSTRAINT "ArsSession_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArsSession" ADD CONSTRAINT "ArsSession_applicationAppId_fkey" FOREIGN KEY ("applicationAppId") REFERENCES "ApplicationApp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArsSession" ADD CONSTRAINT "ArsSession_vnId_fkey" FOREIGN KEY ("vnId") REFERENCES "VirtualNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppAttestKey" ADD CONSTRAINT "AppAttestKey_applicationAppId_fkey" FOREIGN KEY ("applicationAppId") REFERENCES "ApplicationApp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

