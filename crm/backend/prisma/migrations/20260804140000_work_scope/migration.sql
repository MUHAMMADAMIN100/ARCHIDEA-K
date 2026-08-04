-- Объём работ: что входит в услугу и из чего состоит объект.
--
-- Раньше заказ знал только площадь одной цифрой. Спор «а окна вы должны были
-- мыть?» решать было нечем, а бригада на большом объекте не понимала, сколько
-- там этажей и помещений.
--
-- Только схема, без переноса данных: новые поля пустые, старые заказы
-- продолжают работать как прежде.

-- ── Состав работ у услуги ──────────────────────────────────────────────────
ALTER TABLE "Tariff" ADD COLUMN IF NOT EXISTS "includedWorks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Tariff" ADD COLUMN IF NOT EXISTS "excludedWorks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
-- Выработка на человека за смену — по ней считается срок работ
ALTER TABLE "Tariff" ADD COLUMN IF NOT EXISTS "outputPerDay" INTEGER;

-- ── Разбивка объекта ───────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SegmentKind') THEN
    CREATE TYPE "SegmentKind" AS ENUM ('BLOCK', 'FLOOR', 'ROOM');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "OrderSegment" (
  "id"        TEXT NOT NULL,
  "orderId"   TEXT NOT NULL,
  "parentId"  TEXT,
  "kind"      "SegmentKind" NOT NULL,
  "title"     TEXT NOT NULL,
  "area"      INTEGER,
  "note"      TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderSegment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OrderSegment_orderId_idx" ON "OrderSegment"("orderId");
CREATE INDEX IF NOT EXISTS "OrderSegment_parentId_idx" ON "OrderSegment"("parentId");

ALTER TABLE "OrderSegment" DROP CONSTRAINT IF EXISTS "OrderSegment_orderId_fkey";
ALTER TABLE "OrderSegment"
  ADD CONSTRAINT "OrderSegment_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Удаление блока уносит его этажи и помещения — висящих кусков объекта не бывает
ALTER TABLE "OrderSegment" DROP CONSTRAINT IF EXISTS "OrderSegment_parentId_fkey";
ALTER TABLE "OrderSegment"
  ADD CONSTRAINT "OrderSegment_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "OrderSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
