-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'PURGE', 'STAGE_CHANGE');

-- CreateEnum
CREATE TYPE "ShiftGroupStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'CLOSED');

-- CreateEnum
CREATE TYPE "FinanceKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "FinanceSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "FinanceCategory" AS ENUM ('ORDER_PAYMENT', 'OTHER_INCOME', 'SALARY', 'BONUS', 'SUPPLIES', 'TRANSPORT', 'RENT', 'MARKETING', 'TAX', 'OTHER_EXPENSE');

-- CreateEnum
CREATE TYPE "ChecklistStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'SENT', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReminderSource" AS ENUM ('MANUAL', 'PREORDER');

-- CreateEnum
CREATE TYPE "TelegramStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ORDER_PREFERENCES';
ALTER TYPE "NotificationType" ADD VALUE 'REMINDER_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'PROPOSAL_SENT';
ALTER TYPE "NotificationType" ADD VALUE 'CHECKLIST_DONE';
ALTER TYPE "NotificationType" ADD VALUE 'SHIFT_CLOSED';
ALTER TYPE "NotificationType" ADD VALUE 'BONUS_ACCRUED';

-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_managerId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canManageTasks" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "telegramChatId" TEXT,
ADD COLUMN     "telegramEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Cleaner" ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "groupId" TEXT;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "isRepeat" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastOrderAt" TIMESTAMP(3),
ADD COLUMN     "paidOrdersCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "preferences" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "isManualPrice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serviceKey" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "Tariff" ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Tariff.key: enum CleaningType -> TEXT (ТЗ 1.1 — директор заводит новые услуги).
-- ВАЖНО: Prisma по умолчанию генерирует DROP COLUMN + ADD COLUMN, что стёрло бы
-- ключи всех существующих услуг. Заменено на преобразование типа с сохранением
-- значений; уникальный индекс пересоздаётся под новый тип.
DROP INDEX IF EXISTS "Tariff_key_key";
ALTER TABLE "Tariff" ALTER COLUMN "key" TYPE TEXT USING "key"::text;
CREATE UNIQUE INDEX "Tariff_key_key" ON "Tariff"("key");

-- Базовые услуги: ключ и единицу измерения менять нельзя, удалять нельзя —
-- на них завязаны калькулятор лендинга и старые заказы.
UPDATE "Tariff" SET "isSystem" = true
 WHERE "key" IN ('MAINTENANCE', 'GENERAL', 'POST_RENOVATION', 'FURNITURE');
UPDATE "Tariff" SET "sortOrder" = CASE "key"
    WHEN 'GENERAL' THEN 0
    WHEN 'POST_RENOVATION' THEN 1
    WHEN 'FURNITURE' THEN 2
    ELSE 3 END;

-- AlterTable
ALTER TABLE "ExtraService" ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ShiftGroup" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "address" TEXT NOT NULL,
    "orderId" TEXT,
    "startTime" TEXT,
    "endTime" TEXT,
    "status" "ShiftGroupStatus" NOT NULL DEFAULT 'PLANNED',
    "brigadeId" TEXT,
    "brigadeName" TEXT,
    "brigadierId" TEXT,
    "brigadierName" TEXT,
    "managerId" TEXT,
    "managerName" TEXT,
    "note" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedByName" TEXT,
    "closedSnapshot" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deleteReason" TEXT,

    CONSTRAINT "ShiftGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "cleanerId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'Клинер',
    "rate" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityTitle" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "summary" TEXT,
    "changes" JSONB,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceEntry" (
    "id" TEXT NOT NULL,
    "kind" "FinanceKind" NOT NULL,
    "category" "FinanceCategory" NOT NULL DEFAULT 'OTHER_INCOME',
    "amount" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "comment" TEXT,
    "source" "FinanceSource" NOT NULL DEFAULT 'MANUAL',
    "autoKey" TEXT,
    "orderId" TEXT,
    "clientId" TEXT,
    "shiftGroupId" TEXT,
    "reportId" TEXT,
    "bonusId" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deleteReason" TEXT,

    CONSTRAINT "FinanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bonus" (
    "id" TEXT NOT NULL,
    "cleanerId" TEXT,
    "userId" TEXT,
    "recipientName" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deleteReason" TEXT,

    CONSTRAINT "Bonus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cleaningType" "CleaningType",
    "serviceKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deleteReason" TEXT,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "section" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChecklistTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderChecklist" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateName" TEXT NOT NULL,
    "status" "ChecklistStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderChecklistItem" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "section" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "doneById" TEXT,
    "doneByName" TEXT,
    "doneAt" TIMESTAMP(3),
    "comment" TEXT,

    CONSTRAINT "OrderChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "body" TEXT NOT NULL,
    "conditions" TEXT,
    "validDays" INTEGER NOT NULL DEFAULT 7,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deleteReason" TEXT,

    CONSTRAINT "ProposalTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "clientId" TEXT NOT NULL,
    "orderId" TEXT,
    "templateId" TEXT,
    "templateName" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientPhone" TEXT,
    "address" TEXT,
    "area" INTEGER,
    "pricePerSqm" INTEGER,
    "total" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "items" JSONB,
    "bodySnapshot" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3),
    "sentById" TEXT,
    "sentByName" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deleteReason" TEXT,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "orderId" TEXT,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "source" "ReminderSource" NOT NULL DEFAULT 'MANUAL',
    "assigneeId" TEXT NOT NULL,
    "assigneeName" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deleteReason" TEXT,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "parseMode" TEXT DEFAULT 'HTML',
    "status" "TelegramStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextTryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "kind" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftGroup_date_idx" ON "ShiftGroup"("date");

-- CreateIndex
CREATE INDEX "ShiftGroup_orderId_idx" ON "ShiftGroup"("orderId");

-- CreateIndex
CREATE INDEX "ShiftGroup_status_date_idx" ON "ShiftGroup"("status", "date");

-- CreateIndex
CREATE INDEX "ShiftGroup_deletedAt_idx" ON "ShiftGroup"("deletedAt");

-- CreateIndex
CREATE INDEX "ShiftGroupMember_cleanerId_idx" ON "ShiftGroupMember"("cleanerId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftGroupMember_groupId_cleanerId_key" ON "ShiftGroupMember"("groupId", "cleanerId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_createdAt_idx" ON "AuditLog"("entity", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceEntry_autoKey_key" ON "FinanceEntry"("autoKey");

-- CreateIndex
CREATE INDEX "FinanceEntry_kind_date_idx" ON "FinanceEntry"("kind", "date");

-- CreateIndex
CREATE INDEX "FinanceEntry_category_date_idx" ON "FinanceEntry"("category", "date");

-- CreateIndex
CREATE INDEX "FinanceEntry_orderId_idx" ON "FinanceEntry"("orderId");

-- CreateIndex
CREATE INDEX "FinanceEntry_deletedAt_idx" ON "FinanceEntry"("deletedAt");

-- CreateIndex
CREATE INDEX "Bonus_cleanerId_idx" ON "Bonus"("cleanerId");

-- CreateIndex
CREATE INDEX "Bonus_userId_idx" ON "Bonus"("userId");

-- CreateIndex
CREATE INDEX "Bonus_createdAt_idx" ON "Bonus"("createdAt");

-- CreateIndex
CREATE INDEX "Bonus_deletedAt_idx" ON "Bonus"("deletedAt");

-- CreateIndex
CREATE INDEX "ChecklistTemplate_cleaningType_idx" ON "ChecklistTemplate"("cleaningType");

-- CreateIndex
CREATE INDEX "ChecklistTemplate_deletedAt_idx" ON "ChecklistTemplate"("deletedAt");

-- CreateIndex
CREATE INDEX "ChecklistTemplateItem_templateId_idx" ON "ChecklistTemplateItem"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderChecklist_orderId_key" ON "OrderChecklist"("orderId");

-- CreateIndex
CREATE INDEX "OrderChecklistItem_checklistId_idx" ON "OrderChecklistItem"("checklistId");

-- CreateIndex
CREATE INDEX "ProposalTemplate_deletedAt_idx" ON "ProposalTemplate"("deletedAt");

-- CreateIndex
CREATE INDEX "Proposal_clientId_sentAt_idx" ON "Proposal"("clientId", "sentAt");

-- CreateIndex
CREATE INDEX "Proposal_orderId_idx" ON "Proposal"("orderId");

-- CreateIndex
CREATE INDEX "Proposal_status_idx" ON "Proposal"("status");

-- CreateIndex
CREATE INDEX "Proposal_deletedAt_idx" ON "Proposal"("deletedAt");

-- CreateIndex
CREATE INDEX "Reminder_status_remindAt_idx" ON "Reminder"("status", "remindAt");

-- CreateIndex
CREATE INDEX "Reminder_assigneeId_status_idx" ON "Reminder"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Reminder_clientId_idx" ON "Reminder"("clientId");

-- CreateIndex
CREATE INDEX "Reminder_deletedAt_idx" ON "Reminder"("deletedAt");

-- CreateIndex
CREATE INDEX "TelegramMessage_status_nextTryAt_idx" ON "TelegramMessage"("status", "nextTryAt");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE INDEX "Cleaner_deletedAt_idx" ON "Cleaner"("deletedAt");

-- CreateIndex
CREATE INDEX "Shift_groupId_idx" ON "Shift"("groupId");

-- CreateIndex
CREATE INDEX "Client_isRepeat_idx" ON "Client"("isRepeat");

-- CreateIndex
CREATE INDEX "Client_deletedAt_idx" ON "Client"("deletedAt");

-- CreateIndex
CREATE INDEX "Order_serviceKey_idx" ON "Order"("serviceKey");

-- CreateIndex
CREATE INDEX "Order_deletedAt_idx" ON "Order"("deletedAt");

-- CreateIndex
CREATE INDEX "Task_deletedAt_idx" ON "Task"("deletedAt");

-- CreateIndex
CREATE INDEX "Report_deletedAt_idx" ON "Report"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tariff_key_key" ON "Tariff"("key");

-- CreateIndex
CREATE INDEX "Tariff_isActive_sortOrder_idx" ON "Tariff"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "Tariff_deletedAt_idx" ON "Tariff"("deletedAt");

-- CreateIndex
CREATE INDEX "ExtraService_isActive_sortOrder_idx" ON "ExtraService"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "ExtraService_deletedAt_idx" ON "ExtraService"("deletedAt");

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ShiftGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftGroup" ADD CONSTRAINT "ShiftGroup_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftGroupMember" ADD CONSTRAINT "ShiftGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ShiftGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftGroupMember" ADD CONSTRAINT "ShiftGroupMember_cleanerId_fkey" FOREIGN KEY ("cleanerId") REFERENCES "Cleaner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bonus" ADD CONSTRAINT "Bonus_cleanerId_fkey" FOREIGN KEY ("cleanerId") REFERENCES "Cleaner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistTemplateItem" ADD CONSTRAINT "ChecklistTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderChecklist" ADD CONSTRAINT "OrderChecklist_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderChecklistItem" ADD CONSTRAINT "OrderChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "OrderChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProposalTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════
--  Перенос существующих данных под новую схему
-- ═══════════════════════════════════════════════════════════

-- ТЗ 1.1: доп. услуги из поставки — базовые, удалять их нельзя
UPDATE "ExtraService" SET "isSystem" = true;

-- ТЗ 1.1: у старых заказов ключ услуги = прежний тип уборки
UPDATE "Order" SET "serviceKey" = "cleaningType"::text WHERE "serviceKey" IS NULL;

-- ТЗ 3.3: закрытые заказы без даты закрытия ломали расчёт выручки по периодам
UPDATE "Order" SET "closedAt" = "updatedAt"
 WHERE "stage" IN ('PAID', 'REJECTED') AND "closedAt" IS NULL;

-- ТЗ 1.2: полный доступ к модулю задач для Ироды (Ибодат)
UPDATE "User" SET "canManageTasks" = true
 WHERE "login" = 'iroda' OR "fullName" = 'Ирода';

-- ТЗ 9.4: пересчёт метки «повторный клиент» по уже оплаченным заказам
UPDATE "Client" c SET
  "paidOrdersCount" = s.cnt,
  "isRepeat"        = (s.cnt >= 2),
  "lastOrderAt"     = s.last_at
FROM (
  SELECT "clientId", COUNT(*) AS cnt, MAX(COALESCE("closedAt", "createdAt")) AS last_at
    FROM "Order" WHERE "stage" = 'PAID' GROUP BY "clientId"
) s WHERE c.id = s."clientId";
