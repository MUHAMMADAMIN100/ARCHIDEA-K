-- Доп. услуга «Химчистка мягкой мебели» — 70 сомони за место (решение владельца).
--
-- Заводим в справочник, а не хардкодим в форме: цену меняют в «Услугах и
-- ценах» в одном месте, и форма подхватывает её сама. hasQty = true —
-- считается по количеству мест, поэтому в форме рядом стоит поле количества.
--
-- IF NOT EXISTS по ключу: миграция может пройти по базе, где услугу уже
-- завели руками, и падать из-за этого она не должна.
INSERT INTO "ExtraService" ("id", "key", "title", "price", "hasQty", "isSystem", "isActive", "sortOrder", "updatedAt")
SELECT 'upholstery_dry_seed', 'upholsteryDry', 'Химчистка мягкой мебели', 70, true, false, true, 0, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "ExtraService" WHERE "key" = 'upholsteryDry');
