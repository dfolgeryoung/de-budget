-- A category whose Classic "actual" is what was set aside this month, not what was spent (estimated taxes: saved monthly, paid quarterly).
ALTER TABLE "categories" ADD COLUMN "classic_funded" boolean NOT NULL DEFAULT false;
UPDATE "categories" SET "classic_funded" = true WHERE lower("name") LIKE 'estimated tax%';
