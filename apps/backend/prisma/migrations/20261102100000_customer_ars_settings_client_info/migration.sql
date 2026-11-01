-- Customer-level ARS settings; per-session resolved PC code time; client info (PC browser / phone) of each authentication.
ALTER TABLE "User" ADD COLUMN "arsSettings" JSONB;
ALTER TABLE "ArsSession" ADD COLUMN "pcCodeSeconds" INTEGER, ADD COLUMN "pcClient" JSONB, ADD COLUMN "mobileClient" JSONB;
