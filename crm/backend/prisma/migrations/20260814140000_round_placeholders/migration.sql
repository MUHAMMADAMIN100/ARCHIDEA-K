-- Метки в шаблонах КП переезжают с фигурных скобок на круглые.
--
-- Решение владельца: «{Имя клиента}» пугало людей, «(Имя клиента)» читает
-- любой. Сервер понимает оба вида (template-render.ts), поэтому перевод —
-- ради читаемости, а не ради работоспособности. Уже отправленные КП не
-- затрагиваются: они хранят готовый текст снимком.
UPDATE "ProposalTemplate"
SET "intro" = regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      COALESCE("intro", ''),
      '\{\{\s*Имя клиента\s*\}\}', '(Имя клиента)', 'g'),
      '\{\{\s*Телефон\s*\}\}', '(Телефон)', 'g'),
      '\{\{\s*Адрес объекта\s*\}\}', '(Адрес объекта)', 'g'),
      '\{\{\s*Площадь\s*\}\}', '(Площадь)', 'g'),
      '\{\{\s*Цена за единицу\s*\}\}', '(Цена за единицу)', 'g'),
      '\{\{\s*Итоговая сумма\s*\}\}', '(Итоговая сумма)', 'g'),
      '\{\{\s*Скидка\s*\}\}', '(Скидка)', 'g'),
      '\{\{\s*Менеджер\s*\}\}', '(Менеджер)', 'g'),
      '\{\{\s*Дата составления\s*\}\}', '(Дата составления)', 'g'),
      '\{\{\s*Срок действия\s*\}\}', '(Срок действия)', 'g'),
      '\{\{\s*Список работ и цен\s*\}\}', '(Список работ и цен)', 'g'),
      '\{\{\s*Что входит\s*\}\}', '(Что входит)', 'g'),
      '\{\{\s*Что не входит\s*\}\}', '(Что не входит)', 'g'),
      '\{\{\s*client\s*\}\}', '(Имя клиента)', 'g'),
      '\{\{\s*phone\s*\}\}', '(Телефон)', 'g'),
      '\{\{\s*address\s*\}\}', '(Адрес объекта)', 'g'),
      '\{\{\s*area\s*\}\}', '(Площадь)', 'g'),
      '\{\{\s*pricePerSqm\s*\}\}', '(Цена за единицу)', 'g'),
      '\{\{\s*total\s*\}\}', '(Итоговая сумма)', 'g'),
      '\{\{\s*discount\s*\}\}', '(Скидка)', 'g'),
      '\{\{\s*manager\s*\}\}', '(Менеджер)', 'g'),
      '\{\{\s*date\s*\}\}', '(Дата составления)', 'g'),
      '\{\{\s*validUntil\s*\}\}', '(Срок действия)', 'g'),
      '\{\{\s*items\s*\}\}', '(Список работ и цен)', 'g'),
      '\{\{\s*included\s*\}\}', '(Что входит)', 'g'),
      '\{\{\s*excluded\s*\}\}', '(Что не входит)', 'g'),
    "body" = regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      "body",
      '\{\{\s*Имя клиента\s*\}\}', '(Имя клиента)', 'g'),
      '\{\{\s*Телефон\s*\}\}', '(Телефон)', 'g'),
      '\{\{\s*Адрес объекта\s*\}\}', '(Адрес объекта)', 'g'),
      '\{\{\s*Площадь\s*\}\}', '(Площадь)', 'g'),
      '\{\{\s*Цена за единицу\s*\}\}', '(Цена за единицу)', 'g'),
      '\{\{\s*Итоговая сумма\s*\}\}', '(Итоговая сумма)', 'g'),
      '\{\{\s*Скидка\s*\}\}', '(Скидка)', 'g'),
      '\{\{\s*Менеджер\s*\}\}', '(Менеджер)', 'g'),
      '\{\{\s*Дата составления\s*\}\}', '(Дата составления)', 'g'),
      '\{\{\s*Срок действия\s*\}\}', '(Срок действия)', 'g'),
      '\{\{\s*Список работ и цен\s*\}\}', '(Список работ и цен)', 'g'),
      '\{\{\s*Что входит\s*\}\}', '(Что входит)', 'g'),
      '\{\{\s*Что не входит\s*\}\}', '(Что не входит)', 'g'),
      '\{\{\s*client\s*\}\}', '(Имя клиента)', 'g'),
      '\{\{\s*phone\s*\}\}', '(Телефон)', 'g'),
      '\{\{\s*address\s*\}\}', '(Адрес объекта)', 'g'),
      '\{\{\s*area\s*\}\}', '(Площадь)', 'g'),
      '\{\{\s*pricePerSqm\s*\}\}', '(Цена за единицу)', 'g'),
      '\{\{\s*total\s*\}\}', '(Итоговая сумма)', 'g'),
      '\{\{\s*discount\s*\}\}', '(Скидка)', 'g'),
      '\{\{\s*manager\s*\}\}', '(Менеджер)', 'g'),
      '\{\{\s*date\s*\}\}', '(Дата составления)', 'g'),
      '\{\{\s*validUntil\s*\}\}', '(Срок действия)', 'g'),
      '\{\{\s*items\s*\}\}', '(Список работ и цен)', 'g'),
      '\{\{\s*included\s*\}\}', '(Что входит)', 'g'),
      '\{\{\s*excluded\s*\}\}', '(Что не входит)', 'g'),
    "conditions" = regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      COALESCE("conditions", ''),
      '\{\{\s*Имя клиента\s*\}\}', '(Имя клиента)', 'g'),
      '\{\{\s*Телефон\s*\}\}', '(Телефон)', 'g'),
      '\{\{\s*Адрес объекта\s*\}\}', '(Адрес объекта)', 'g'),
      '\{\{\s*Площадь\s*\}\}', '(Площадь)', 'g'),
      '\{\{\s*Цена за единицу\s*\}\}', '(Цена за единицу)', 'g'),
      '\{\{\s*Итоговая сумма\s*\}\}', '(Итоговая сумма)', 'g'),
      '\{\{\s*Скидка\s*\}\}', '(Скидка)', 'g'),
      '\{\{\s*Менеджер\s*\}\}', '(Менеджер)', 'g'),
      '\{\{\s*Дата составления\s*\}\}', '(Дата составления)', 'g'),
      '\{\{\s*Срок действия\s*\}\}', '(Срок действия)', 'g'),
      '\{\{\s*Список работ и цен\s*\}\}', '(Список работ и цен)', 'g'),
      '\{\{\s*Что входит\s*\}\}', '(Что входит)', 'g'),
      '\{\{\s*Что не входит\s*\}\}', '(Что не входит)', 'g'),
      '\{\{\s*client\s*\}\}', '(Имя клиента)', 'g'),
      '\{\{\s*phone\s*\}\}', '(Телефон)', 'g'),
      '\{\{\s*address\s*\}\}', '(Адрес объекта)', 'g'),
      '\{\{\s*area\s*\}\}', '(Площадь)', 'g'),
      '\{\{\s*pricePerSqm\s*\}\}', '(Цена за единицу)', 'g'),
      '\{\{\s*total\s*\}\}', '(Итоговая сумма)', 'g'),
      '\{\{\s*discount\s*\}\}', '(Скидка)', 'g'),
      '\{\{\s*manager\s*\}\}', '(Менеджер)', 'g'),
      '\{\{\s*date\s*\}\}', '(Дата составления)', 'g'),
      '\{\{\s*validUntil\s*\}\}', '(Срок действия)', 'g'),
      '\{\{\s*items\s*\}\}', '(Список работ и цен)', 'g'),
      '\{\{\s*included\s*\}\}', '(Что входит)', 'g'),
      '\{\{\s*excluded\s*\}\}', '(Что не входит)', 'g')
WHERE "deletedAt" IS NULL;
