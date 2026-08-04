-- Оплаты по заказам: способ, банк, смешанная оплата (ТЗ 3.1 и 3.2).
--
-- Раньше оплата была одним числом в заказе: система знала СКОЛЬКО получено,
-- но не знала чем, когда и сколькими частями. Поэтому нельзя было ни спросить
-- банк, ни разбить платёж на наличные + перевод, ни свести поступления по
-- каналам в книге доходов.

-- ── Способ оплаты ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentMethod') THEN
    CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK');
  END IF;
END
$$;

-- ── Справочник банков ──────────────────────────────────────────────────────
-- Справочник, а не список в коде: новый банк заводит руководитель сам.
CREATE TABLE IF NOT EXISTS "PaymentBank" (
  "id"           TEXT NOT NULL,
  "key"          TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "isSystem"     BOOLEAN NOT NULL DEFAULT false,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"    INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "deletedAt"    TIMESTAMP(3),
  "deletedById"  TEXT,
  "deleteReason" TEXT,
  CONSTRAINT "PaymentBank_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentBank_key_key" ON "PaymentBank"("key");
CREATE INDEX IF NOT EXISTS "PaymentBank_isActive_sortOrder_idx" ON "PaymentBank"("isActive", "sortOrder");
CREATE INDEX IF NOT EXISTS "PaymentBank_deletedAt_idx" ON "PaymentBank"("deletedAt");

-- Три варианта из ТЗ. Помечены системными: скрыть можно, удалить нельзя —
-- иначе в старых платежах остались бы ссылки в никуда.
INSERT INTO "PaymentBank" ("id", "key", "title", "isSystem", "sortOrder", "updatedAt")
VALUES
  ('bank_alif',     'ALIF',           'Алиф',                        true, 0, NOW()),
  ('bank_dushanbe', 'DUSHANBE_CITY',  'Душанбе Сити',                true, 1, NOW()),
  ('bank_other',    'OTHER',          'Другой банк / прямой перевод', true, 2, NOW())
ON CONFLICT ("key") DO NOTHING;

-- ── Взносы по заказу ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OrderPayment" (
  "id"            TEXT NOT NULL,
  "orderId"       TEXT NOT NULL,
  "amount"        INTEGER NOT NULL,
  "method"        "PaymentMethod",
  "bankId"        TEXT,
  "note"          TEXT,
  "paidAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById"   TEXT,
  "createdByName" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  "deletedAt"     TIMESTAMP(3),
  "deletedById"   TEXT,
  "deleteReason"  TEXT,
  CONSTRAINT "OrderPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OrderPayment_orderId_idx" ON "OrderPayment"("orderId");
CREATE INDEX IF NOT EXISTS "OrderPayment_paidAt_idx" ON "OrderPayment"("paidAt");
CREATE INDEX IF NOT EXISTS "OrderPayment_deletedAt_idx" ON "OrderPayment"("deletedAt");

ALTER TABLE "OrderPayment"
  DROP CONSTRAINT IF EXISTS "OrderPayment_orderId_fkey";
ALTER TABLE "OrderPayment"
  ADD CONSTRAINT "OrderPayment_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderPayment"
  DROP CONSTRAINT IF EXISTS "OrderPayment_bankId_fkey";
ALTER TABLE "OrderPayment"
  ADD CONSTRAINT "OrderPayment_bankId_fkey"
  FOREIGN KEY ("bankId") REFERENCES "PaymentBank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Канал поступления в книге доходов ──────────────────────────────────────
ALTER TABLE "FinanceEntry" ADD COLUMN IF NOT EXISTS "paymentMethod" "PaymentMethod";
ALTER TABLE "FinanceEntry" ADD COLUMN IF NOT EXISTS "bankId" TEXT;
CREATE INDEX IF NOT EXISTS "FinanceEntry_bankId_idx" ON "FinanceEntry"("bankId");

ALTER TABLE "FinanceEntry"
  DROP CONSTRAINT IF EXISTS "FinanceEntry_bankId_fkey";
ALTER TABLE "FinanceEntry"
  ADD CONSTRAINT "FinanceEntry_bankId_fkey"
  FOREIGN KEY ("bankId") REFERENCES "PaymentBank"("id") ON DELETE SET NULL ON UPDATE CASCADE;
