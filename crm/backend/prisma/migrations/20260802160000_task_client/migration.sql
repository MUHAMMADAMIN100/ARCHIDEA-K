-- Задача может ссылаться на клиента: встречу и звонок назначают по конкретному
-- человеку, и перед выездом нужны его телефон и адрес.
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "clientId" TEXT;

DO $$
BEGIN
  ALTER TABLE "Task"
    ADD CONSTRAINT "Task_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE INDEX IF NOT EXISTS "Task_clientId_idx" ON "Task"("clientId");

-- Тип «Личное» убран из системы: такие задачи становятся «Встречей».
-- Значение enum'а остаётся в базе, но больше не используется — удалять его
-- отдельной операцией опаснее, чем оставить неиспользуемым.
UPDATE "Task" SET "type" = 'MEETING' WHERE "type" = 'PERSONAL';
