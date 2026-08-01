-- Разовые сотрудники под конкретный заказ: имя и выплаченная сумма.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "guestCleaners" JSONB;
