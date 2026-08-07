-- Доп. услуги заказа строками.
--
-- Раньше в карточке стоял готовый список из справочника с галочками, и
-- вписать «вынос мусора — 150» было некуда. Теперь менеджер заводит свои
-- строки прямо в заказе: название, цена и отметка «в счёт».
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customExtras" JSONB;

-- Переносим уже выбранные услуги старых заказов в строки, чтобы суммы не
-- изменились ни на копейку, а в карточке было видно, из чего сложилась цена.
-- Цену берём из справочника: у услуги с количеством умножаем, у остальных нет.
UPDATE "Order" o
SET "customExtras" = sub.rows,
    -- прежний список очищаем: иначе одна и та же услуга посчиталась бы дважды
    "extras" = NULL
FROM (
  SELECT
    o2."id" AS order_id,
    jsonb_agg(
      jsonb_build_object(
        'title',
        CASE
          WHEN e."hasQty" AND (kv.value#>>'{}')::numeric > 1
            THEN e."title" || ' × ' || (kv.value#>>'{}')
          ELSE e."title"
        END,
        'price',
        CASE
          WHEN e."hasQty" THEN e."price" * (kv.value#>>'{}')::int
          ELSE e."price"
        END,
        'checked', true
      )
      ORDER BY e."sortOrder"
    ) AS rows
  FROM "Order" o2
  CROSS JOIN LATERAL jsonb_each(o2."extras") AS kv(key, value)
  JOIN "ExtraService" e ON e."key" = kv.key
  WHERE o2."extras" IS NOT NULL
    AND jsonb_typeof(o2."extras") = 'object'
    AND (kv.value#>>'{}') ~ '^[0-9]+$'
    AND (kv.value#>>'{}')::int > 0
  GROUP BY o2."id"
) AS sub
WHERE o."id" = sub.order_id
  -- «ещё не переносили»: колонка пуста либо в ней json-null (его пишут
  -- клиентские библиотеки вместо настоящего NULL — на глаз не отличить)
  AND (o."customExtras" IS NULL OR jsonb_typeof(o."customExtras") = 'null');
