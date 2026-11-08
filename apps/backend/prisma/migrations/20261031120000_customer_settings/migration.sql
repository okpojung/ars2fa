-- Customer setting per app: press 1 after the notice (APP mode). null = system default.
ALTER TABLE "ApplicationApp" ADD COLUMN "confirmKeyRequired" BOOLEAN;
ALTER TABLE "ArsSession" ADD COLUMN "confirmKey" BOOLEAN NOT NULL DEFAULT true;
