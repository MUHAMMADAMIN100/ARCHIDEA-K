-- Владелец компании — единственный, кто может удалять сотрудников.
--
-- Раньше удалить человека мог любой руководитель, а их несколько. Запрет по
-- должности не годится: он задел бы и владельца. Поэтому право именное.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isOwner" BOOLEAN NOT NULL DEFAULT false;

-- Владелец — Аниса (решение владельца).
UPDATE "User"
SET "isOwner" = true
WHERE lower("login") IN ('anisa', 'anisa_mukimi', 'аниса')
   OR "fullName" ILIKE 'аниса%';
