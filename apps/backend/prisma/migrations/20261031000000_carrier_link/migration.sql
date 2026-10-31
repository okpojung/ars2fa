-- CallMix forwarding is switched on per lease and off after the session (dynamic routing).
CREATE TYPE "VnRouting" AS ENUM ('DYNAMIC', 'STATIC');
CREATE TYPE "VnLinkState" AS ENUM ('OFF', 'ON', 'UNKNOWN');

ALTER TABLE "VirtualNumber"
  ADD COLUMN "routing" "VnRouting" NOT NULL DEFAULT 'DYNAMIC',
  ADD COLUMN "linkState" "VnLinkState" NOT NULL DEFAULT 'OFF',
  ADD COLUMN "unlinkAfter" TIMESTAMP(3),
  ADD COLUMN "linkChangedAt" TIMESTAMP(3),
  ADD COLUMN "linkFailCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "linkError" TEXT;
CREATE INDEX "VirtualNumber_linkState_unlinkAfter_idx" ON "VirtualNumber"("linkState", "unlinkAfter");

ALTER TABLE "PbxCall" ADD COLUMN "endedAt" TIMESTAMP(3);

CREATE TABLE "CarrierCall" (
  "id" TEXT NOT NULL,
  "vnId" INTEGER NOT NULL,
  "vn" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "ok" BOOLEAN NOT NULL,
  "resCd" TEXT NOT NULL,
  "resMsg" TEXT,
  "ms" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarrierCall_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CarrierCall_createdAt_idx" ON "CarrierCall"("createdAt");
CREATE INDEX "CarrierCall_vnId_createdAt_idx" ON "CarrierCall"("vnId", "createdAt");
