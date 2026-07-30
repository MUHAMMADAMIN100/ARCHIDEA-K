-- Чек-листы приёма объекта оцениваются по шкале, как в бумажной форме:
-- «норма / среднее / сильное». Обычная проверка качества остаётся галочкой.
DO $$ BEGIN
  CREATE TYPE "DirtAssessment" AS ENUM ('NORMAL', 'MEDIUM', 'HEAVY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ChecklistTemplate" ADD COLUMN IF NOT EXISTS "usesLevels" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChecklistTemplate" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- подсказка мелким шрифтом: на что смотреть и почему это важно
ALTER TABLE "ChecklistTemplateItem" ADD COLUMN IF NOT EXISTS "hint" TEXT;

ALTER TABLE "OrderChecklist" ADD COLUMN IF NOT EXISTS "usesLevels" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OrderChecklist" ADD COLUMN IF NOT EXISTS "note" TEXT;

ALTER TABLE "OrderChecklistItem" ADD COLUMN IF NOT EXISTS "hint" TEXT;
ALTER TABLE "OrderChecklistItem" ADD COLUMN IF NOT EXISTS "level" "DirtAssessment";
