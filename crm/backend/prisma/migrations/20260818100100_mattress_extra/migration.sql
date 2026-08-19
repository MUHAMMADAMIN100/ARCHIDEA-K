-- Доп. услуга «Мойка матраса» — 250 сомони за штуку (решение владельца).
--
-- Заводим в справочник, а не хардкодим в форме: цену меняют в «Услугах и
-- ценах» в одном месте, и форма подхватывает её сама. hasQty = true —
-- считается по количеству матрасов, в форме рядом стоит поле количества.
--
-- Урок дубля «Химчистки»: проверяем не только ключ, но и НАЗВАНИЕ — если
-- владелец уже завёл такую услугу руками, вторую строку не создаём.
INSERT INTO "ExtraService" ("id", "key", "title", "price", "hasQty", "isSystem", "isActive", "sortOrder", "updatedAt")
SELECT 'mattress_wash_seed', 'mattressWash', 'Мойка матраса', 250, true, false, true, 1, NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "ExtraService"
  WHERE "key" = 'mattressWash'
     OR ("deletedAt" IS NULL AND lower("title") LIKE '%матрас%')
);
