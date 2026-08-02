-- Подключение Telegram по одноразовому коду.
--
-- Раньше chat_id вносил руководитель руками: приходилось спрашивать его у
-- каждого сотрудника. Теперь сотрудник жмёт кнопку в своём профиле, получает
-- ссылку t.me/бот?start=код, нажимает «Старт» — и бот привязывается сам.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "telegramName" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "telegramLinkCode" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "telegramLinkExpires" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "User_telegramLinkCode_key"
  ON "User"("telegramLinkCode");
