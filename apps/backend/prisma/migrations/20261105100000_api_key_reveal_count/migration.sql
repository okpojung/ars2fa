-- Viewing an API key again is limited: after 3 views the next view issues a new key.
ALTER TABLE "ApiKey" ADD COLUMN "revealCount" INTEGER NOT NULL DEFAULT 0;
