-- Скидка в сомони: постоянная у клиента (подставляется в новые заказы)
-- и своя у каждого заказа — она и попадает в платёжную ведомость.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "discount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "discount" INTEGER NOT NULL DEFAULT 0;
