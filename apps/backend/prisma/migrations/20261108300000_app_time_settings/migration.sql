-- Per app (API key): call window and code entry time.
ALTER TABLE "ApplicationApp" ADD COLUMN "leaseSeconds" INTEGER, ADD COLUMN "pcCodeSeconds" INTEGER;
