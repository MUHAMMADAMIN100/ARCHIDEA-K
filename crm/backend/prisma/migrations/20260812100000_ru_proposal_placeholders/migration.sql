-- Подстановки в шаблонах КП переводятся на русский.
--
-- Было «{{client}}», стало «{{Имя клиента}}». Причина простая: сотрудник,
-- который не работал с шаблонами, не понимал, что означают двойные скобки
-- с английским словом внутри и можно ли их трогать.
--
-- Английские названия сервер по-прежнему понимает (template-render.ts), так
-- что перевод не обязателен для работы — он нужен, чтобы человек ВИДЕЛ в
-- тексте понятные слова. Уже отправленные КП не затрагиваются: они хранят
-- готовый текст снимком.
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
      regexp_replace(COALESCE("intro", ''),
        '\{\{\s*client\s*\}\}',      '{{Имя клиента}}',      'g'),
        '\{\{\s*phone\s*\}\}',       '{{Телефон}}',          'g'),
        '\{\{\s*address\s*\}\}',     '{{Адрес объекта}}',    'g'),
        '\{\{\s*area\s*\}\}',        '{{Площадь}}',          'g'),
        '\{\{\s*pricePerSqm\s*\}\}', '{{Цена за единицу}}',  'g'),
        '\{\{\s*total\s*\}\}',       '{{Итоговая сумма}}',   'g'),
        '\{\{\s*discount\s*\}\}',    '{{Скидка}}',           'g'),
        '\{\{\s*manager\s*\}\}',     '{{Менеджер}}',         'g'),
        '\{\{\s*date\s*\}\}',        '{{Дата составления}}', 'g'),
        '\{\{\s*validUntil\s*\}\}',  '{{Срок действия}}',    'g'),
        '\{\{\s*items\s*\}\}',       '{{Список работ и цен}}', 'g'),
        '\{\{\s*included\s*\}\}',    '{{Что входит}}',       'g'),
        '\{\{\s*excluded\s*\}\}',    '{{Что не входит}}',    'g'),
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
      regexp_replace("body",
        '\{\{\s*client\s*\}\}',      '{{Имя клиента}}',      'g'),
        '\{\{\s*phone\s*\}\}',       '{{Телефон}}',          'g'),
        '\{\{\s*address\s*\}\}',     '{{Адрес объекта}}',    'g'),
        '\{\{\s*area\s*\}\}',        '{{Площадь}}',          'g'),
        '\{\{\s*pricePerSqm\s*\}\}', '{{Цена за единицу}}',  'g'),
        '\{\{\s*total\s*\}\}',       '{{Итоговая сумма}}',   'g'),
        '\{\{\s*discount\s*\}\}',    '{{Скидка}}',           'g'),
        '\{\{\s*manager\s*\}\}',     '{{Менеджер}}',         'g'),
        '\{\{\s*date\s*\}\}',        '{{Дата составления}}', 'g'),
        '\{\{\s*validUntil\s*\}\}',  '{{Срок действия}}',    'g'),
        '\{\{\s*items\s*\}\}',       '{{Список работ и цен}}', 'g'),
        '\{\{\s*included\s*\}\}',    '{{Что входит}}',       'g'),
        '\{\{\s*excluded\s*\}\}',    '{{Что не входит}}',    'g'),
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
      regexp_replace(COALESCE("conditions", ''),
        '\{\{\s*client\s*\}\}',      '{{Имя клиента}}',      'g'),
        '\{\{\s*phone\s*\}\}',       '{{Телефон}}',          'g'),
        '\{\{\s*address\s*\}\}',     '{{Адрес объекта}}',    'g'),
        '\{\{\s*area\s*\}\}',        '{{Площадь}}',          'g'),
        '\{\{\s*pricePerSqm\s*\}\}', '{{Цена за единицу}}',  'g'),
        '\{\{\s*total\s*\}\}',       '{{Итоговая сумма}}',   'g'),
        '\{\{\s*discount\s*\}\}',    '{{Скидка}}',           'g'),
        '\{\{\s*manager\s*\}\}',     '{{Менеджер}}',         'g'),
        '\{\{\s*date\s*\}\}',        '{{Дата составления}}', 'g'),
        '\{\{\s*validUntil\s*\}\}',  '{{Срок действия}}',    'g'),
        '\{\{\s*items\s*\}\}',       '{{Список работ и цен}}', 'g'),
        '\{\{\s*included\s*\}\}',    '{{Что входит}}',       'g'),
        '\{\{\s*excluded\s*\}\}',    '{{Что не входит}}',    'g')
WHERE "deletedAt" IS NULL;
