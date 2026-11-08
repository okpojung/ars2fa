-- PC mode: QR opens a mobile dial page (one-time token); the code shown on the PC is keyed in on the phone (DTMF).
ALTER TABLE "ArsSession" ADD COLUMN "dialToken" TEXT, ADD COLUMN "codeExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "ArsSession_dialToken_key" ON "ArsSession"("dialToken");
