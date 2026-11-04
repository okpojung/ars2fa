-- API key kept sealed (AES-GCM) so the owner can view it again after an ARS phone check.
ALTER TABLE "ApiKey" ADD COLUMN "keyEnc" TEXT;
