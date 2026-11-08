-- The first view of a newly approved key needs no ARS check; keys already shown are marked as shown.
ALTER TABLE "ApiKey" ADD COLUMN "firstShownAt" TIMESTAMP(3);
UPDATE "ApiKey" SET "firstShownAt" = now() WHERE "keyEnc" IS NOT NULL;
