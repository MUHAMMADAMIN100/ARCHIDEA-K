-- Архив считается от того, когда запись появилась В СИСТЕМЕ.
--
-- Раньше переезд в папку «Архив» зависел только от даты закрытия сделки.
-- Из-за этого заказ за прошедший месяц, внесённый сегодня, исчезал из воронки
-- в ту же секунду: владелец вносил майские сделки и не находил их вовсе.
--
-- Дата оформления (createdAt) для этого не годится — её правят руками, как
-- раз чтобы указать, когда сделка была на самом деле. Поэтому заводим
-- отдельную дату появления записи, которую менять нельзя.

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "registeredAt" TIMESTAMP(3);

-- Для уже существующих заказов берём момент, когда о них впервые написал
-- журнал изменений: это настоящая дата появления записи, и подделать её
-- нельзя. Если записи в журнале нет (заказы старше журнала) — остаётся дата
-- оформления, другого источника у нас нет.
UPDATE "Order" o
SET "registeredAt" = COALESCE(
  (
    SELECT MIN(a."createdAt")
    FROM "AuditLog" a
    WHERE a."entity" = 'ORDER' AND a."entityId" = o."id"
  ),
  o."createdAt"
)
WHERE o."registeredAt" IS NULL;

-- страховка: если что-то осталось пустым, ставим дату оформления
UPDATE "Order" SET "registeredAt" = "createdAt" WHERE "registeredAt" IS NULL;

ALTER TABLE "Order" ALTER COLUMN "registeredAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Order" ALTER COLUMN "registeredAt" SET NOT NULL;

-- по этому полю отбирается архив вместе с датой закрытия
CREATE INDEX IF NOT EXISTS "Order_registeredAt_idx" ON "Order"("registeredAt");
