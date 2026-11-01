-- Web widget: WEB apps with a public site key + allowed origins; popup token / origin on sessions.
ALTER TYPE "AppPlatform" ADD VALUE IF NOT EXISTS 'WEB';
ALTER TABLE "ApplicationApp" ADD COLUMN "siteKey" TEXT, ADD COLUMN "allowedOrigins" TEXT;
CREATE UNIQUE INDEX "ApplicationApp_siteKey_key" ON "ApplicationApp"("siteKey");
ALTER TABLE "ArsSession" ADD COLUMN "widgetToken" TEXT, ADD COLUMN "widgetOrigin" TEXT, ADD COLUMN "widgetConsumedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "ArsSession_widgetToken_key" ON "ArsSession"("widgetToken");
