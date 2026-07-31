-- Сколько клиент уже заплатил по заказу: контроль остатка (долга).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "paidAmount" INTEGER NOT NULL DEFAULT 0;
