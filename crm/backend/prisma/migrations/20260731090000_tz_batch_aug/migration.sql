-- ТЗ «Архидея», августовская партия.

-- 1.1 Запасные номера клиента; 1.2 свободные теги; 1.4 «От кого»
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "extraPhones" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "labels" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "sourceDetail" TEXT;

-- 1.3 несколько услуг в заявке; 1.4 «От кого» у заявки
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "additionalServices" JSONB;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "sourceDetail" TEXT;

-- 2. Разовые клинеры: участник выезда без записи в базе клинеров
ALTER TABLE "ShiftGroupMember" ALTER COLUMN "cleanerId" DROP NOT NULL;
ALTER TABLE "ShiftGroupMember" ADD COLUMN IF NOT EXISTS "isGuest" BOOLEAN NOT NULL DEFAULT false;

-- 3. Этапы воронки: «Обработка» и «КП» уходят из процесса.
-- Существующие сделки переносим НАЗАД (прогресс не завышаем):
-- Обработка → Новая заявка, КП → Осмотр объекта.
UPDATE "Order" SET "stage" = 'NEW' WHERE "stage" = 'PROCESSING';
UPDATE "Order" SET "stage" = 'INSPECTION' WHERE "stage" = 'OFFER';
