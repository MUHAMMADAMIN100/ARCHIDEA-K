-- Уведомление о новой заявке должно открывать карточку клиента,
-- а не только заказ: клиент — то, с чего начинается работа с обращением.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
