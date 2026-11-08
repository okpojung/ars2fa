-- Concurrent call monitoring (per-minute maximum of SIP trunk channels / Asterisk calls).
CREATE TABLE "TrunkMinute" (
  "minute" TIMESTAMP(3) NOT NULL,
  "trunkMax" INTEGER NOT NULL,
  "totalMax" INTEGER NOT NULL,
  "samples" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrunkMinute_pkey" PRIMARY KEY ("minute")
);
