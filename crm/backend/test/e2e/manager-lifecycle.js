/**
 * Ключевая проверка после доработки прав: способен ли МЕНЕДЖЕР провести сделку
 * целиком — от заявки с сайта до принятой ведомости, — ни разу не упершись
 * в запрет.
 *
 * Всё делается от имени менеджера. Руководитель подключается ровно там, где
 * менеджера быть не должно: принять ведомость.
 *
 * Попутно проверяются доработки ТЗ: запасные номера и теги клиента (1.1, 1.2),
 * несколько услуг в заявке (1.3), «От кого» (1.4), разовые клинеры и выплата
 * за смену (2), переименованные и убранные этапы воронки (3).
 */
const {
  assertLocal,
  login,
  call,
  intake,
  uniquePhone,
  createReporter,
  ok2xx,
  brief,
} = require('./helpers');

async function main() {
  assertLocal();
  const report = createReporter();

  const dir = await login('director');
  const m = await login('manager');
  console.log(`МЕНЕДЖЕР @${m.login}: ${m.user.fullName} | общая база ${m.user.canManageOps}`);

  // ── 1. Заявка с сайта попадает менеджеру ──
  report.section('1. ЗАЯВКА С САЙТА');
  const phone = uniquePhone('901');
  const created = await intake({
    calculator: {
      area: 120,
      cleaningTypeId: 'post_renovation',
      dirtLevel: 'heavy',
      extras: { windows: 5, fridge: 1 },
    },
    quiz: { date: '2026-08-22', time: '09:00', hasUtilities: 'yes', access: 'onsite' },
    contact: { name: 'Клиент Проверки', phone, address: 'Душанбе, Айни 45' },
    total: 4530,
  });
  report.check(created.status === 201, 'Заявка принята', String(created.status));
  const orderId = created.data?.orderId;
  if (!orderId) return process.exit(report.finish(''));

  const mine = await call(m, 'GET', `/orders/${orderId}`);
  report.check(mine.status === 200, 'Заявка досталась менеджеру и открывается им', brief(mine));
  if (mine.status !== 200) {
    console.log(
      `\nЗаявка ушла не @${m.login}. Авто-распределение отдаёт её тому, у кого ` +
        `включён приём заявок (acceptsLeads). Задайте MANAGER_LOGIN этого сотрудника.`,
    );
    return process.exit(report.finish(''));
  }

  // ── 2. Этапы воронки (ТЗ 3) ──
  report.section('2. ВОРОНКА');
  const board = (await call(m, 'GET', '/orders/board')).data ?? [];
  const stages = board.map((c) => c.stage);
  report.check(
    !stages.includes('PROCESSING') && !stages.includes('OFFER'),
    'ТЗ 3: «Обработка» и «КП» убраны из воронки',
    stages.join(','),
  );
  report.check(
    board.find((c) => c.stage === 'DONE')?.label === 'К оплате',
    'ТЗ 3: «Выполнено» переименовано в «К оплате»',
  );

  // ── 3. Правка заявки (ТЗ 1.3, 1.4) ──
  report.section('3. ПРАВКА ЗАЯВКИ');
  const upd = await call(m, 'PATCH', `/orders/${orderId}`, {
    address: 'Душанбе, Айни 45, кв. 7',
    sourceDetail: 'От Ибодат',
    preferences: 'Без запаха хлорки, есть кот',
    discount: 300,
    paidAmount: 1000,
    additionalServices: [{ key: 'FURNITURE', qty: 4 }],
  });
  report.check(ok2xx(upd), 'Правка сохранена', brief(upd));

  const after = (await call(m, 'GET', `/orders/${orderId}`)).data;
  report.check(after.sourceDetail === 'От Ибодат', 'ТЗ 1.4: «От кого» сохранилось');
  report.check(
    Array.isArray(after.additionalServices) && after.additionalServices.length === 1,
    'ТЗ 1.3: дополнительная услуга записана снапшотом',
  );

  /*
   * Регрессия. Заявка с сайта приходит с суммой, в которую УЖЕ входят доп.
   * услуги. Пока цена за единицу выводилась делением этой суммы на площадь,
   * доп. услуги при первой же правке начислялись второй раз, и заказ дорожал
   * на их стоимость — при правке одного лишь адреса.
   */
  const tariffs = (await call(m, 'GET', '/tariffs')).data;
  const pr = tariffs.tariffs.find((t) => t.key === 'POST_RENOVATION');
  const expected = 120 * pr.priceHeavy + 4 * 70 + (5 * 50 + 80) - 300;
  report.check(
    after.finalPrice === expected,
    'Итог пересчитан по справочнику, доп. услуги не задвоились',
    `получено ${after.finalPrice}, ожидалось ${expected}`,
  );
  report.check(
    after.pricePerSqm === pr.priceHeavy,
    'Цена за м² взята из справочника, а не выведена из суммы с допами',
    `${after.pricePerSqm} против ${pr.priceHeavy}`,
  );

  // ── 4. Карточка клиента (ТЗ 1.1, 1.2) ──
  report.section('4. КАРТОЧКА КЛИЕНТА');
  const clientId = after.clientId;
  const cupd = await call(m, 'PATCH', `/clients/${clientId}`, {
    tags: ['VIP'],
    labels: ['офис', 'срочные'],
    extraPhones: ['905123456'],
    preferences: 'Обувь снимать',
  });
  report.check(ok2xx(cupd), 'Правка клиента сохранена', brief(cupd));
  const client = (await call(m, 'GET', `/clients/${clientId}`)).data;
  report.check(client.tags?.includes('VIP'), 'ТЗ 1.2: статус выставлен');
  report.check(client.labels?.length === 2, 'ТЗ 1.2: свободные теги сохранены');
  report.check(client.extraPhones?.length === 1, 'ТЗ 1.1: запасной номер сохранён');

  // ── 5. Выезд, разовый клинер (ТЗ 2, 4) ──
  report.section('5. ВЫЕЗД И РАЗОВЫЙ КЛИНЕР');
  const insp = await call(m, 'PATCH', `/orders/${orderId}/stage`, { stage: 'INSPECTION' });
  report.check(ok2xx(insp), 'Перевод в «Осмотр объекта»', brief(insp));
  const visit = ((await call(m, 'GET', `/shift-groups?orderId=${orderId}`)).data ?? [])[0];
  report.check(!!visit, 'Выезд создался автоматически из заказа');
  if (visit) {
    const cleaners = (await call(m, 'GET', '/cleaners?activeOnly=true')).data ?? [];
    const vupd = await call(m, 'PATCH', `/shift-groups/${visit.id}`, {
      cleanerIds: cleaners.slice(0, 3).map((c) => c.id),
      guests: [{ fullName: 'Замена Разовая', rate: 300 }],
      startTime: '09:00',
      endTime: '17:00',
    });
    report.check(ok2xx(vupd), 'Менеджер задал состав и разовую замену', brief(vupd));

    /*
     * Выплата разовому клинеру намеренно НЕ скрывается от менеджера: её вводит
     * он же. Если бы сервер её вырезал, форма правки выезда вернула бы пустое
     * поле и молча обнулила уже согласованную сумму.
     */
    const reread = (await call(m, 'GET', `/shift-groups/${visit.id}`)).data;
    const guest = (reread.members ?? []).find((x) => !x.cleanerId);
    report.check(guest?.rate === 300, 'ТЗ 2: выплата замене видна менеджеру', `rate=${guest?.rate}`);
    const staff = (reread.members ?? []).filter((x) => x.cleanerId);
    report.check(
      staff.every((x) => x.rate === undefined),
      'При этом ставки штатных клинеров скрыты',
    );

    await call(m, 'PATCH', `/shift-groups/${visit.id}`, { note: 'Повторная правка' });
    const again = (await call(m, 'GET', `/shift-groups/${visit.id}`)).data;
    const guest2 = (again.members ?? []).find((x) => !x.cleanerId);
    report.check(guest2?.rate === 300, 'Повторная правка не обнулила выплату замене');

    const closed = await call(m, 'POST', `/shift-groups/${visit.id}/close`, {});
    report.check(ok2xx(closed), 'Менеджер закрыл выезд', brief(closed));
  }

  // ── 6. Чек-лист, напоминание, КП ──
  report.section('6. ЧЕК-ЛИСТ, НАПОМИНАНИЕ, КП');
  const tpls = (await call(m, 'GET', '/checklist-templates')).data ?? [];
  const applied = await call(m, 'POST', `/orders/${orderId}/checklist`, {
    templateId: tpls[0]?.id,
  });
  report.check(ok2xx(applied), 'ТЗ 8: чек-лист применён', brief(applied));
  const item = applied.data?.items?.[0];
  if (item) {
    const tog = await call(m, 'PATCH', `/orders/${orderId}/checklist/items/${item.id}`, {
      isDone: true,
    });
    report.check(ok2xx(tog), 'Пункт чек-листа отмечается', brief(tog));
  }
  const rem = await call(m, 'POST', '/reminders', {
    clientId,
    orderId,
    title: 'Перезвонить по объекту',
    remindAt: '2026-08-21T10:00',
  });
  report.check(ok2xx(rem), 'ТЗ 10: напоминание создано', brief(rem));

  const templates = (await call(m, 'GET', '/proposal-templates')).data ?? [];
  if (templates.length === 0) {
    const tpl = await call(m, 'POST', '/proposal-templates', {
      name: 'Шаблон проверки',
      body: 'Здравствуйте, {{client}}! Стоимость: {{total}} сомони.',
      isDefault: true,
    });
    report.check(ok2xx(tpl), 'ТЗ 9: менеджер может завести шаблон КП', brief(tpl));
  }
  const prop = await call(m, 'POST', '/proposals', { clientId, orderId });
  report.check(ok2xx(prop), 'ТЗ 9: КП создано', brief(prop));
  if (prop.data?.id) {
    const sent = await call(m, 'POST', `/proposals/${prop.data.id}/send`, {});
    report.check(ok2xx(sent), 'ТЗ 9.2: КП отправлено, отправитель зафиксирован', brief(sent));
  }

  // ── 7. Оплата, ведомость, доход ──
  report.section('7. ЗАКРЫТИЕ СДЕЛКИ');
  const paid = await call(m, 'PATCH', `/orders/${orderId}/stage`, { stage: 'PAID' });
  report.check(ok2xx(paid), 'Заказ переведён в «Оплачено»', brief(paid));

  const draft = ((await call(m, 'GET', '/reports')).data ?? []).find(
    (r) => r.orderId === orderId,
  );
  report.check(!!draft, 'Черновик ведомости создан и доступен менеджеру');
  if (draft) {
    const send = await call(m, 'POST', `/reports/${draft.id}/send`, {});
    report.check(ok2xx(send), 'Менеджер отправил ведомость основателю', brief(send));
    const accept = await call(m, 'POST', `/reports/${draft.id}/accept`, {});
    report.check(accept.status === 403, 'Принять ведомость менеджер не может', brief(accept));
    const acceptDir = await call(dir, 'POST', `/reports/${draft.id}/accept`, {});
    report.check(ok2xx(acceptDir), 'Руководитель принял ведомость', brief(acceptDir));
  }

  const income = ((await call(dir, 'GET', '/finance?take=200')).data?.rows ?? []).find(
    (r) => r.orderId === orderId,
  );
  report.check(!!income, 'Доход по заказу записан в книгу');
  if (income) {
    report.check(
      income.amount === (after.finalPrice ?? after.estimatedPrice),
      'Сумма дохода совпадает с суммой заказа',
      `${income.amount}`,
    );
  }

  // ── 8. Откат и защита от задвоения ──
  report.section('8. ОТКАТ ОПЛАТЫ И ЗАЩИТА ОТ ЗАДВОЕНИЯ');
  await call(m, 'PATCH', `/orders/${orderId}/stage`, { stage: 'DONE' });
  const gone = ((await call(dir, 'GET', '/finance?take=200')).data?.rows ?? []).find(
    (r) => r.orderId === orderId,
  );
  report.check(!gone, 'Автодоход снят вместе с откатом этапа');

  await call(m, 'PATCH', `/orders/${orderId}/stage`, { stage: 'PAID' });
  await call(m, 'PATCH', `/orders/${orderId}/stage`, { stage: 'DONE' });
  await call(m, 'PATCH', `/orders/${orderId}/stage`, { stage: 'PAID' });
  const dupes = ((await call(dir, 'GET', '/finance?take=200')).data?.rows ?? []).filter(
    (r) => r.orderId === orderId,
  );
  report.check(dupes.length === 1, 'Запись о доходе ровно одна', `${dupes.length} шт.`);
  const reports = ((await call(m, 'GET', '/reports')).data ?? []).filter(
    (r) => r.orderId === orderId,
  );
  report.check(reports.length === 1, 'Ведомость по заказу ровно одна', `${reports.length} шт.`);

  process.exit(
    report.finish('МЕНЕДЖЕР ПРОВОДИТ СДЕЛКУ ЦЕЛИКОМ, ГРАНИЦЫ ДОСТУПА СОБЛЮДЕНЫ'),
  );
}

main().catch((e) => {
  console.error('\nСБОЙ ПРОВЕРКИ:', e.message);
  process.exit(1);
});
