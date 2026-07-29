-- Новый тип уведомления: менеджеру сообщаем, что по его оплаченному заказу
-- уже подготовлен черновик ведомости и осталось только отправить.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REPORT_DRAFT_READY';

-- ═══════════════════════════════════════════════════════════
--  1. Телефоны к единому виду: девять цифр без кода страны
-- ═══════════════════════════════════════════════════════════
-- С сайта номер приходил как «992900000001», а в CRM его вбивали руками
-- как «900000001» — это две разные строки, и один и тот же человек заводился
-- дважды. Приводим всё к национальному номеру; код +992 добавляется при показе.

-- Клиенты. Телефон уникален, поэтому отрезаем код только там, где короткая
-- форма ещё не занята другой карточкой — иначе миграция упадёт на конфликте.
UPDATE "Client" c
   SET "phone" = substring(c."phone" from 4)
 WHERE c."phone" ~ '^992[0-9]{9}$'
   AND NOT EXISTS (
     SELECT 1 FROM "Client" o
      WHERE o."phone" = substring(c."phone" from 4)
        AND o."id" <> c."id"
   );

-- Клинеры и сотрудники: уникальности нет, приводим все подходящие номера
UPDATE "Cleaner"
   SET "phone" = substring("phone" from 4)
 WHERE "phone" ~ '^992[0-9]{9}$';

UPDATE "User"
   SET "phone" = substring("phone" from 4)
 WHERE "phone" ~ '^992[0-9]{9}$';

-- Телефон, записанный в снапшот платёжной ведомости
UPDATE "Report"
   SET "clientPhone" = substring("clientPhone" from 4)
 WHERE "clientPhone" ~ '^992[0-9]{9}$';

-- ═══════════════════════════════════════════════════════════
--  2. Черновики отчётов по уже оплаченным заказам
-- ═══════════════════════════════════════════════════════════
-- С этого момента отчёт создаётся автоматически при переходе заказа
-- в «Оплачено / Закрыто». Разово доводим до того же состояния заказы,
-- которые были закрыты раньше и остались без ведомости.
--
-- Владелец ведомости — менеджер заказа; если его нет, берём любого
-- руководителя, иначе запись не сохранить (поле обязательное).
-- Видимое поле «Ответственный менеджер» при этом остаётся пустым,
-- как и договаривались: менеджер заполнит его сам.

INSERT INTO "Report" (
  id, status, "orderId", "clientName", "clientPhone", address,
  "workDate", "unitsLabel", discount, "totalPrice", "managerName",
  "managerId", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  'DRAFT',
  o.id,
  cl."fullName",
  cl."phone",
  o.address,
  COALESCE(o."scheduledDate", o."closedAt", o."createdAt"),
  CASE
    WHEN o."cleaningType" = 'FURNITURE' AND COALESCE(o.seats, 0) > 0
      THEN o.seats || ' мест' || COALESCE(' по ' || o."pricePerSqm" || ' с', '')
    WHEN COALESCE(o.area, 0) > 0
      THEN o.area || ' м²' || COALESCE(' по ' || o."pricePerSqm" || ' с', '')
    ELSE NULL
  END,
  0,
  COALESCE(o."finalPrice", o."estimatedPrice", 0),
  u."fullName",
  COALESCE(o."managerId", (
    SELECT d.id FROM "User" d
     WHERE d.role = 'DIRECTOR' AND d."deletedAt" IS NULL
     ORDER BY d."createdAt" LIMIT 1
  )),
  now(),
  now()
FROM "Order" o
JOIN "Client" cl ON cl.id = o."clientId"
LEFT JOIN "User" u ON u.id = o."managerId"
WHERE o.stage = 'PAID'
  AND o."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Report" r WHERE r."orderId" = o.id AND r."deletedAt" IS NULL
  )
  AND COALESCE(o."managerId", (
    SELECT d.id FROM "User" d
     WHERE d.role = 'DIRECTOR' AND d."deletedAt" IS NULL
     ORDER BY d."createdAt" LIMIT 1
  )) IS NOT NULL;

-- Работники ведомости — команда, назначенная на заказ, со ставкой на сегодня.
-- Бригадир определяется по тому, руководит ли клинер бригадой.
INSERT INTO "ReportWorker" (id, "reportId", "cleanerId", "fullName", role, days, rate, fine, extra)
SELECT
  gen_random_uuid()::text,
  r.id,
  c.id,
  c."fullName",
  CASE WHEN b.id IS NOT NULL THEN 'Бригадир' ELSE 'Клинер' END,
  1,
  c.rate,
  0,
  0
FROM "Report" r
JOIN "Order" o ON o.id = r."orderId"
-- в связующей таблице Prisma колонки идут по алфавиту имён моделей:
-- A — клинер, B — заказ. Перепутать их местами значит не найти ни одного работника.
JOIN "_OrderCleaners" oc ON oc."B" = o.id
JOIN "Cleaner" c ON c.id = oc."A"
LEFT JOIN "Brigade" b ON b."leaderId" = c.id
WHERE r.status = 'DRAFT'
  AND r."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ReportWorker" w WHERE w."reportId" = r.id
  );
