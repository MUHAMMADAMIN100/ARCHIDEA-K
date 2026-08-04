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
    extraPhones: ['905123456'],
    preferences: 'Обувь снимать',
  });
  report.check(ok2xx(cupd), 'Правка клиента сохранена', brief(cupd));
  const client = (await call(m, 'GET', `/clients/${clientId}`)).data;
  report.check(client.tags?.includes('VIP'), 'ТЗ 1.2: статус выставлен');
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

    const reread = (await call(m, 'GET', `/shift-groups/${visit.id}`)).data;
    const guest = (reread.members ?? []).find((x) => !x.cleanerId);
    report.check(guest?.rate === 300, 'ТЗ 2: выплата замене сохранена', `rate=${guest?.rate}`);
    const staff = (reread.members ?? []).filter((x) => x.cleanerId);
    report.check(
      staff.every((x) => typeof x.rate === 'number'),
      'Ставки штатных участников видны — по ним составляется ведомость',
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

  // ── 7. Оплата взносами, ведомость, доход (ТЗ 3.1, 3.2) ──
  report.section('7. ОПЛАТА И ЗАКРЫТИЕ СДЕЛКИ');

  const total = after.finalPrice ?? after.estimatedPrice;
  const banks = (await call(m, 'GET', '/banks')).data ?? [];
  const alif = banks.find((b) => b.key === 'ALIF') ?? banks[0];
  report.check(banks.length > 0, 'ТЗ 3.1: справочник банков доступен', `${banks.length} шт.`);

  // недоплаченный заказ закрывать нельзя
  const early = await call(m, 'PATCH', `/orders/${orderId}/stage`, { stage: 'PAID' });
  report.check(early.status === 400, 'Без оплаты заказ не закрывается', brief(early));

  // безналичный расчёт без банка не принимается
  const noBank = await call(m, 'POST', `/orders/${orderId}/payments`, {
    parts: [{ amount: 100, method: 'BANK' }],
  });
  report.check(noBank.status === 400, 'ТЗ 3.1: перевод без банка отклонён', brief(noBank));

  // смешанная оплата: сумма частей обязана совпасть с суммой платежа
  const mismatch = await call(m, 'POST', `/orders/${orderId}/payments`, {
    expectedTotal: 1000,
    parts: [
      { amount: 400, method: 'CASH' },
      { amount: 400, method: 'BANK', bankId: alif.id },
    ],
  });
  report.check(
    mismatch.status === 400,
    'ТЗ 3.2: расхождение частей и суммы отклонено',
    brief(mismatch),
  );

  // предоплата наличными
  const prepay = await call(m, 'POST', `/orders/${orderId}/payments`, {
    parts: [{ amount: 1000, method: 'CASH' }],
    expectedTotal: 1000,
  });
  report.check(ok2xx(prepay), 'Предоплата наличными внесена', brief(prepay));

  // переплата не принимается
  const over = await call(m, 'POST', `/orders/${orderId}/payments`, {
    parts: [{ amount: total, method: 'CASH' }],
  });
  report.check(over.status === 400, 'Переплата отклонена', brief(over));

  // остаток — смешанной оплатой: часть наличными, часть переводом
  const rest = total - 1000;
  const mixed = await call(m, 'POST', `/orders/${orderId}/payments`, {
    expectedTotal: rest,
    parts: [
      { amount: rest - 500, method: 'CASH' },
      { amount: 500, method: 'BANK', bankId: alif.id },
    ],
  });
  report.check(ok2xx(mixed), 'ТЗ 3.2: смешанная оплата проведена', brief(mixed));

  const withPayments = (await call(m, 'GET', `/orders/${orderId}`)).data;
  report.check(
    withPayments.paidAmount === total,
    'Сумма оплаты заказа сошлась с итогом',
    `${withPayments.paidAmount} из ${total}`,
  );
  report.check(
    (withPayments.payments ?? []).length === 3,
    'История взносов видна в карточке',
    `${(withPayments.payments ?? []).length} шт.`,
  );

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

  /*
   * Доход теперь признаётся в момент получения денег, а не при закрытии
   * заказа: у каждого взноса своя строка со своим каналом. Проверяем и сумму
   * (она обязана сойтись с заказом), и различимость каналов — ради этого
   * учёт и затевался.
   */
  const bookRows = ((await call(dir, 'GET', '/finance?take=200')).data?.rows ?? []).filter(
    (r) => r.orderId === orderId,
  );
  report.check(
    bookRows.length === 3,
    'Каждый взнос дал строку в книге доходов',
    `${bookRows.length} шт.`,
  );
  const bookSum = bookRows.reduce((sum, r) => sum + r.amount, 0);
  report.check(bookSum === total, 'Сумма доходов по заказу равна его итогу', `${bookSum} из ${total}`);

  const byBank = ((await call(dir, 'GET', `/finance?take=200&bankId=${alif.id}`)).data?.rows ?? [])
    .filter((r) => r.orderId === orderId);
  report.check(
    byBank.length === 1 && byBank[0].amount === 500,
    'ТЗ 3.1: фильтр по банку работает',
    `${byBank.length} шт.`,
  );
  const byCash = ((await call(dir, 'GET', '/finance?take=200&method=CASH')).data?.rows ?? [])
    .filter((r) => r.orderId === orderId);
  report.check(byCash.length === 2, 'Фильтр «наличные» отделяет их от переводов', `${byCash.length} шт.`);

  /*
   * Закрытая сделка защищена с обеих сторон.
   *
   * Запрет «вернуть заказ из „Оплачено“ может только руководитель» ничего не
   * стоил бы, если бы менеджер мог просто удалить взнос: сумма оплаты упала
   * бы ниже итога, а заказ остался бы закрытым.
   */
  report.section('7Б. ЗАКРЫТАЯ СДЕЛКА НЕ МЕНЯЕТСЯ МЕНЕДЖЕРОМ');
  const paymentsNow = (await call(m, 'GET', `/orders/${orderId}/payments`)).data ?? [];
  const delByManager = await call(
    m,
    'DELETE',
    `/orders/${orderId}/payments/${paymentsNow[0]?.id}`,
  );
  report.check(
    delByManager.status === 403,
    'Менеджер не может удалить взнос закрытого заказа',
    brief(delByManager),
  );
  const addByManager = await call(m, 'POST', `/orders/${orderId}/payments`, {
    parts: [{ amount: 100, method: 'CASH' }],
  });
  report.check(
    addByManager.status === 403,
    'Менеджер не может дописать взнос в закрытый заказ',
    brief(addByManager),
  );

  // цена закрытого заказа не расходится с оплатой
  const repriceClosed = await call(m, 'PATCH', `/orders/${orderId}`, {
    finalPrice: total + 500,
    isManualPrice: true,
  });
  report.check(
    repriceClosed.status === 400,
    'Сумму закрытого заказа нельзя развести с оплатой',
    brief(repriceClosed),
  );

  /*
   * Переплата не проходит и «в лоб», и гонкой: два одинаковых запроса,
   * отправленных одновременно, раньше оба записывались.
   */
  report.section('7В. ГОНКА ПРИ ВНЕСЕНИИ ОПЛАТЫ');
  const raceOrder = (
    await call(m, 'POST', '/orders', {
      clientId,
      serviceKey: 'GENERAL',
      area: 100,
      dirtLevel: 'MEDIUM',
      source: 'CALL',
    })
  ).data;
  const raceTotal = raceOrder.finalPrice ?? raceOrder.estimatedPrice;
  const both = await Promise.all([
    call(m, 'POST', `/orders/${raceOrder.id}/payments`, {
      parts: [{ amount: raceTotal, method: 'CASH' }],
    }),
    call(m, 'POST', `/orders/${raceOrder.id}/payments`, {
      parts: [{ amount: raceTotal, method: 'CASH' }],
    }),
  ]);
  const accepted = both.filter((r) => ok2xx(r)).length;
  report.check(accepted === 1, 'Из двух одновременных оплат прошла ровно одна', `${accepted}`);
  const raceAfter = (await call(m, 'GET', `/orders/${raceOrder.id}`)).data;
  report.check(
    raceAfter.paidAmount === raceTotal,
    'Сумма оплаты не превысила итог заказа',
    `${raceAfter.paidAmount} из ${raceTotal}`,
  );
  await call(m, 'DELETE', `/orders/${raceOrder.id}?reason=Проверка гонки`);

  // ── 8. Откат и защита от задвоения ──
  report.section('8. ОТКАТ ОПЛАТЫ И ЗАЩИТА ОТ ЗАДВОЕНИЯ');
  /*
   * Заказ вернули с «Оплачено» — деньги от этого не исчезли: клиент их
   * действительно отдал, и в книге доходов они обязаны остаться. Доход
   * снимается только вместе с удалением самого взноса.
   *
   * Возвращает заказ руководитель: менеджеру оплаченный заказ не отдаётся.
   */
  await call(dir, 'PATCH', `/orders/${orderId}/stage`, { stage: 'DONE' });
  const stillThere = ((await call(dir, 'GET', '/finance?take=200')).data?.rows ?? []).filter(
    (r) => r.orderId === orderId,
  );
  report.check(
    stillThere.length === 3,
    'Полученные деньги остались доходом после отката этапа',
    `${stillThere.length} шт.`,
  );

  await call(dir, 'PATCH', `/orders/${orderId}/stage`, { stage: 'PAID' });
  await call(dir, 'PATCH', `/orders/${orderId}/stage`, { stage: 'DONE' });
  await call(dir, 'PATCH', `/orders/${orderId}/stage`, { stage: 'PAID' });
  const dupes = ((await call(dir, 'GET', '/finance?take=200')).data?.rows ?? []).filter(
    (r) => r.orderId === orderId,
  );
  report.check(dupes.length === 3, 'Доход не задвоился от переходов туда-обратно', `${dupes.length} шт.`);

  // удаление взноса снимает и его доход
  const payments = (await call(dir, 'GET', `/orders/${orderId}/payments`)).data ?? [];
  const del = await call(dir, 'DELETE', `/orders/${orderId}/payments/${payments[0]?.id}`);
  report.check(ok2xx(del), 'Взнос удалён', brief(del));
  const afterDelete = ((await call(dir, 'GET', '/finance?take=200')).data?.rows ?? []).filter(
    (r) => r.orderId === orderId,
  );
  report.check(afterDelete.length === 2, 'Доход по удалённому взносу снят', `${afterDelete.length} шт.`);
  const orderAfterDelete = (await call(dir, 'GET', `/orders/${orderId}`)).data;
  report.check(
    orderAfterDelete.paidAmount === total - 1000,
    'Сумма оплаты заказа пересчитана',
    `${orderAfterDelete.paidAmount}`,
  );
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
