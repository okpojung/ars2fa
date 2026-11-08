-- Keys no longer carry a test/live marker: every issued key is a normal (LIVE) key.
ALTER TABLE "ApiKey" ALTER COLUMN "environment" SET DEFAULT 'LIVE';
UPDATE "ApiKey" SET "environment" = 'LIVE';
