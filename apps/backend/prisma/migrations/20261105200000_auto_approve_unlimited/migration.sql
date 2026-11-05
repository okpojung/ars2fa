-- Automatic approval (system review entries without an admin) and no monthly limit for now (0 = unlimited).
ALTER TABLE "ReviewHistory" ALTER COLUMN "adminUserId" DROP NOT NULL;
ALTER TABLE "ApiKey" ALTER COLUMN "monthlyLimit" SET DEFAULT 0;
UPDATE "ApiKey" SET "monthlyLimit" = 0;