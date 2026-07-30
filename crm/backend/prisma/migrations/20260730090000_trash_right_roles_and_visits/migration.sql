-- 1. Доступ к корзине — персональное право, а не следствие роли.
-- Руководителей в компании несколько, но разбирать удалённое доверено
-- конкретным людям: Анисе и основателю.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canSeeTrash" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "canSeeTrash" = true WHERE "login" IN ('anisa', 'admin');

-- 2. Ирода — руководитель наравне с Анисой (доступ к корзине ей не выдаём).
UPDATE "User"
SET "role" = 'DIRECTOR', "position" = 'Руководитель'
WHERE "login" = 'iroda';

-- 3. Уведомление о поручении: сотрудник должен узнать, что напоминание
-- поставили на него, а не находить это случайно в своём списке.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REMINDER_ASSIGNED';

-- Выезд на осмотр создан из заказа — ответственный должен об этом узнать,
-- иначе автоматика незаметна и в «Смены» заводят второй выезд руками.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VISIT_PLANNED';

-- 4. Раздел «Расписание» убран: осмотры и выезды теперь живут в «Сменах»
-- и создаются из заказа автоматически, поэтому отдельная сущность не нужна.
DROP TABLE IF EXISTS "ScheduleEvent";
DROP TYPE IF EXISTS "ScheduleType";
