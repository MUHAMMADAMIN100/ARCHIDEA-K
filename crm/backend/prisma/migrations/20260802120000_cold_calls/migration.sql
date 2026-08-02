-- Холодные звонки: источник лида, тип разговора, перезвон и степень
-- заинтересованности клиента.
--
-- ALTER TYPE ... ADD VALUE внутри транзакции допустим с PostgreSQL 12, пока
-- новое значение не используется в этой же транзакции — здесь только
-- объявление, поэтому миграция проходит одним файлом как обычно.
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'COLD_CALL';

DO $$
BEGIN
  CREATE TYPE "CallType" AS ENUM ('COLD', 'NEUTRAL', 'HOT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "callType" "CallType";
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "callbackAt" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "interestLevel" TEXT;

-- календарь спрашивает перезвоны за месяц — по дате, а не перебором клиентов
CREATE INDEX IF NOT EXISTS "Client_callbackAt_idx" ON "Client"("callbackAt");
