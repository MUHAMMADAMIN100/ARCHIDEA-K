import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save, Send, Users } from 'lucide-react';
import { api } from '../api/client';
import { useFetch } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { Spinner, PageHeader, EmptyState } from '../components/ui';
import { ScrollArea } from '../components/ScrollArea';
import { useToast } from '../components/Toast';
import { useDialog } from '../components/Dialog';
import { PhoneInput } from '../components/ContactFields';
import { DatePicker } from '../components/DatePicker';
import { cleaningDaysOf, dayWord } from '../lib/date';
import { formatDate, formatPrice, formatVolume } from '../lib/labels';
import type { Brigade, Cleaner, Order, Report } from '../types';

/** Только цифры, без ведущих нулей */
const digits = (v: string) => v.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
const num = (v: string) => Number(v) || 0;

/**
 * Ставка клинера для поля ввода.
 *
 * Сервер отдаёт её только тем, кому открыты финансы, — остальным поля `rate`
 * в ответе просто нет. Раньше здесь стояло String(c.rate): для менеджера это
 * давало в денежном поле буквальное слово «undefined», а при сохранении
 * Number('undefined') || 0 превращало его в НОЛЬ. Ведомость уходила
 * основателю с нулевыми выплатами, и после её принятия у клинеров
 * начислялись смены по нулевой ставке.
 *
 * Пустая строка вместо этого честно показывает: значение неизвестно, впишите
 * его руками. Сохранение с незаполненной ставкой перехватывается проверкой
 * перед отправкой.
 */
const rateOf = (c?: { rate?: number } | null): string =>
  c && typeof c.rate === 'number' ? String(c.rate) : '';

let rowCounter = 0;
const rowKey = () => `row_${++rowCounter}`;

/**
 * Сколько дней выходит каждый штатный клинер заказа — с учётом «состава
 * по дням» многодневной уборки.
 *
 * День 1 выходят все назначенные; для дней 2+ смотрим раскладку: день
 * описан — только отмеченные в нём (пустой день = никто), не описан — все.
 * Ровно так же считают карточка заказа и начисление смен на сервере.
 * Пока ведомость раскладку не читала, она ставила каждому все дни заказа:
 * у «Вали» в карточке 14 710 сомони, а в отчёте 18 820 — лишние 4 110 за
 * дни, в которые люди не выходили.
 */
function дниПоРаскладке(o: {
  scheduledDate?: string | null;
  scheduledEndDate?: string | null;
  cleaners?: { id: string }[] | null;
  dayTeams?: { day: number; cleanerIds: string[] }[] | null;
}): Map<string, number> {
  const всего = Math.max(1, cleaningDaysOf(o.scheduledDate, o.scheduledEndDate));
  const штат = (o.cleaners ?? []).map((c) => c.id);
  const дни = new Map(штат.map((id) => [id, 0]));
  for (let день = 1; день <= всего; день++) {
    const запись =
      день >= 2 ? (o.dayTeams ?? []).find((t) => t.day === день) : undefined;
    const вышли =
      день === 1 || !запись || !Array.isArray(запись.cleanerIds)
        ? штат
        : запись.cleanerIds.filter((id) => дни.has(id));
    for (const id of вышли) дни.set(id, (дни.get(id) ?? 0) + 1);
  }
  return дни;
}

interface WorkerRow {
  key: string;
  cleanerId: string;
  fullName: string;
  role: string;
  days: string;
  rate: string;
  fine: string;
  extra: string;
}

interface ExpenseRow {
  key: string;
  title: string;
  initiator: string;
  amount: string;
  comment: string;
}

const emptyWorker = (): WorkerRow => ({
  key: rowKey(),
  cleanerId: '',
  fullName: '',
  role: 'Клинер',
  days: '1',
  rate: '230',
  fine: '',
  extra: '',
});

const emptyExpense = (): ExpenseRow => ({
  key: rowKey(),
  title: '',
  initiator: '',
  amount: '',
  comment: '',
});

export function ReportEdit() {
  const { id } = useParams(); // undefined = новый отчёт
  const navigate = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { user } = useAuth();

  const { data: existing, loading, error } = useFetch<Report>(
    id ? `/reports/${id}` : null,
    { deps: [id] },
  );
  const { data: orders } = useFetch<Order[]>('/orders');
  const { data: cleaners } = useFetch<Cleaner[]>('/cleaners');
  const { data: brigades } = useFetch<Brigade[]>('/brigades');

  // ── поля шапки ──
  const [orderId, setOrderId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [address, setAddress] = useState('');
  const [workDate, setWorkDate] = useState('');
  const [workEndDate, setWorkEndDate] = useState('');
  const [unitsLabel, setUnitsLabel] = useState('');
  const [extraServices, setExtraServices] = useState('');
  const [discount, setDiscount] = useState('');
  const [totalPrice, setTotalPrice] = useState('');
  const [arrivedBy, setArrivedBy] = useState('');
  const [brigadierName, setBrigadierName] = useState('');
  const [managerName, setManagerName] = useState(user?.fullName ?? '');

  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [saving, setSaving] = useState(false);

  // редактирование: заполняем форму один раз из загруженного отчёта
  const seeded = useRef(false);
  useEffect(() => {
    if (!id || !existing || seeded.current) return;
    seeded.current = true;
    if (existing.status === 'ACCEPTED') {
      navigate(`/reports/${existing.id}`, { replace: true });
      return;
    }
    setOrderId(existing.orderId ?? '');
    setClientName(existing.clientName);
    setClientPhone(existing.clientPhone ?? '');
    setAddress(existing.address ?? '');
    setWorkDate(existing.workDate?.slice(0, 10) ?? '');
    setWorkEndDate(existing.workEndDate?.slice(0, 10) ?? '');
    setUnitsLabel(existing.unitsLabel ?? '');
    setExtraServices(existing.extraServices ?? '');
    setDiscount(existing.discount ? String(existing.discount) : '');
    setTotalPrice(existing.totalPrice ? String(existing.totalPrice) : '');
    setArrivedBy(existing.arrivedBy ?? '');
    setBrigadierName(existing.brigadierName ?? '');
    setManagerName(existing.managerName ?? user?.fullName ?? '');
    setWorkers(
      existing.workers.map((w) => ({
        key: rowKey(),
        cleanerId: w.cleanerId ?? '',
        fullName: w.fullName,
        role: w.role,
        days: String(w.days),
        rate: String(w.rate),
        fine: w.fine ? String(w.fine) : '',
        extra: w.extra ? String(w.extra) : '',
      })),
    );
    setExpenses(
      existing.expenses.map((e) => ({
        key: rowKey(),
        title: e.title,
        initiator: e.initiator ?? '',
        amount: String(e.amount),
        comment: e.comment ?? '',
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, id]);

  // бригадиры (для авто-должности)
  const leaderIds = useMemo(
    () => new Set((brigades ?? []).map((b) => b.leaderId).filter(Boolean)),
    [brigades],
  );

  /*
   * Если заказ выбрали раньше, чем догрузился справочник клинеров, ставки
   * в строках работников остаются пустыми. Доставляем их, как только справочник
   * появится — уже введённые вручную значения не трогаем.
   *
   * rateOf: ставка приходит только тем, кому открыты финансы; остальным сервер
   * её вырезает. Без проверки String(undefined) давал буквальный текст
   * «undefined» в денежном поле, а при сохранении он превращался в 0 — и
   * ведомость уходила с нулевыми выплатами.
   */
  useEffect(() => {
    if (!cleaners?.length) return;
    setWorkers((prev) => {
      if (!prev.some((w) => w.cleanerId && !w.rate)) return prev;
      return prev.map((w) => {
        if (!w.cleanerId || w.rate) return w;
        const full = cleaners.find((c) => c.id === w.cleanerId);
        return full
          ? {
              ...w,
              rate: rateOf(full),
              fullName: w.fullName || full.fullName,
            }
          : w;
      });
    });
  }, [cleaners]);

  const fillFromOrder = (oid: string) => {
    setOrderId(oid);
    const o = (orders ?? []).find((x) => x.id === oid);
    if (!o) return;
    setClientName(o.client?.fullName ?? '');
    setClientPhone(o.client?.phone ?? '');
    setAddress(o.address ?? '');
    if (o.scheduledDate) setWorkDate(o.scheduledDate.slice(0, 10));
    // последний день заказа — в шапку ведомости: по нему видно, за что смены
    setWorkEndDate(o.scheduledEndDate ? o.scheduledEndDate.slice(0, 10) : '');
    setUnitsLabel(formatVolume(o));
    setTotalPrice(String(o.finalPrice ?? o.estimatedPrice ?? ''));

    /*
     * Ответственный — менеджер ЗАКАЗА, а не тот, кто открыл форму.
     * Раньше поле оставалось со значением текущего пользователя, и в ведомости
     * оказывался не тот человек, который вёл объект.
     */
    setManagerName(o.manager?.fullName ?? '');

    /*
     * Команда заказа переносится в таблицу работников со ставкой и днями.
     * Раньше блок оставался пустым, хотя на заказе были назначены люди —
     * их приходилось выбирать заново вручную.
     */
    const assigned = o.cleaners ?? [];
    /*
     * Дни — по длительности заказа, а не по одному на каждого.
     * Уборка 11–12 августа оплачивается людям как две смены; пока здесь
     * стояла единица, ведомость расходилась с тем, что владелец отдаёт
     * на руки, ровно вдвое на двухдневных объектах.
     */
    const дней = cleaningDaysOf(o.scheduledDate, o.scheduledEndDate);
    // дни каждому — по раскладке «кто выходил в какой день», не всем подряд
    const поДням = дниПоРаскладке(o);
    if (assigned.length) {
      const known = cleaners ?? [];
      const rows: WorkerRow[] = assigned.map((a) => {
        const full = known.find((c) => c.id === a.id);
        const isLeader = leaderIds.has(a.id);
        return {
          key: rowKey(),
          cleanerId: a.id,
          fullName: a.fullName ?? full?.fullName ?? '',
          role: isLeader ? 'Бригадир' : 'Клинер',
          days: String(поДням.get(a.id) ?? дней),
          rate: rateOf(full),
          fine: '',
          extra: '',
        };
      });
      // бригадир — первой строкой, как на бумажном бланке
      rows.sort((a, b) => (a.role === 'Бригадир' ? -1 : b.role === 'Бригадир' ? 1 : 0));
      setWorkers([...rows, ...разовыеСтроки(o)]);

      const leader = assigned.find((a) => leaderIds.has(a.id));
      if (leader) setBrigadierName(leader.fullName);
    } else {
      // штата нет — но разовые в заказе быть могут
      const гости = разовыеСтроки(o);
      if (гости.length) setWorkers(гости);
    }
  };

  /**
   * Разовые сотрудники заказа отдельными строками ведомости.
   *
   * Их вписывают в карточку заказа наличными «на руки за всю работу», и
   * раньше кнопка «Заполнить из заказа» их не переносила вовсе: в карточке
   * «Итого клинерам 9 390», а в ведомости 7 890 — двух человек не хватало.
   * Дни у разового всегда один: его сумма на дни не умножается.
   */
  const разовыеСтроки = (o: Order): WorkerRow[] =>
    (o.guestCleaners ?? [])
      .filter((g) => g.fullName?.trim())
      .map((g) => ({
        key: rowKey(),
        cleanerId: '',
        fullName: g.fullName.trim(),
        role: 'Разовый',
        days: '1',
        rate: String(g.rate ?? 0),
        fine: '',
        extra: '',
      }));

  const addCleanerRow = (c: Cleaner) => {
    setWorkers((prev) => {
      if (c.id && prev.some((w) => w.cleanerId === c.id)) return prev;
      const isLeader = leaderIds.has(c.id);
      const row: WorkerRow = {
        key: rowKey(),
        cleanerId: c.id,
        fullName: c.fullName,
        role: isLeader ? 'Бригадир' : 'Клинер',
        days: '1',
        rate: rateOf(c),
        fine: '',
        extra: '',
      };
      // бригадир — первым в списке
      return isLeader ? [row, ...prev] : [...prev, row];
    });
    if (leaderIds.has(c.id) && !brigadierName) setBrigadierName(c.fullName);
  };

  const addBrigade = (b: Brigade) => {
    const members = b.cleaners.filter((c) => c.isActive);
    // бригадир первым
    [...members]
      .sort((x, y) => (x.id === b.leaderId ? -1 : y.id === b.leaderId ? 1 : 0))
      .forEach((c) => addCleanerRow(c as Cleaner));
    if (b.leader?.fullName) setBrigadierName(b.leader.fullName);
  };

  const patchWorker = (key: string, patch: Partial<WorkerRow>) =>
    setWorkers((prev) =>
      prev.map((w) => (w.key === key ? { ...w, ...patch } : w)),
    );
  const patchExpense = (key: string, patch: Partial<ExpenseRow>) =>
    setExpenses((prev) =>
      prev.map((e) => (e.key === key ? { ...e, ...patch } : e)),
    );

  const selectCleanerFor = (key: string, cleanerId: string) => {
    const c = (cleaners ?? []).find((x) => x.id === cleanerId);
    if (!c) {
      patchWorker(key, { cleanerId: '' });
      return;
    }
    /*
     * Ставку подставляем, только если она известна. Иначе сохраняем уже
     * введённую руками: смена работника в строке не должна стирать сумму,
     * которую человек только что вписал.
     */
    const known = rateOf(c);
    patchWorker(key, {
      cleanerId: c.id,
      fullName: c.fullName,
      ...(known ? { rate: known } : {}),
      role: leaderIds.has(c.id) ? 'Бригадир' : 'Клинер',
    });
  };

  const workerSum = (w: WorkerRow) =>
    num(w.days) * num(w.rate) - num(w.fine) + num(w.extra);
  const workersSum = workers.reduce((s, w) => s + workerSum(w), 0);
  const expensesSum = expenses.reduce((s, e) => s + num(e.amount), 0);

  const buildPayload = () => ({
    orderId: orderId || null,
    clientName: clientName.trim(),
    clientPhone: clientPhone.trim() || undefined,
    address: address.trim() || undefined,
    workDate: workDate || null,
    workEndDate: workEndDate || null,
    unitsLabel: unitsLabel.trim() || undefined,
    extraServices: extraServices.trim() || undefined,
    discount: num(discount),
    totalPrice: num(totalPrice),
    arrivedBy: arrivedBy.trim() || undefined,
    brigadierName: brigadierName.trim() || undefined,
    managerName: managerName.trim() || undefined,
    workers: workers
      .filter((w) => w.fullName.trim())
      .map((w) => ({
        cleanerId: w.cleanerId || null,
        fullName: w.fullName.trim(),
        role: w.role.trim() || 'Клинер',
        // 0 дней допустимо (работник только со штрафом); максимум 60
        days: Math.min(60, num(w.days)),
        rate: num(w.rate),
        fine: num(w.fine),
        extra: num(w.extra),
      })),
    expenses: expenses
      .filter((e) => e.title.trim() && num(e.amount) > 0)
      .map((e) => ({
        title: e.title.trim(),
        initiator: e.initiator.trim() || undefined,
        amount: num(e.amount),
        comment: e.comment.trim() || undefined,
      })),
  });

  /*
   * Сколько дней длится заказ этой ведомости.
   *
   * Уборка на 19–21 августа — это три смены каждому штатному клинеру. Пока
   * ведомость про даты заказа не знала, в строках оставались единицы, и
   * основателю уходила сумма втрое меньше той, что людям причитается.
   * Берём заказ из списка (когда его только что выбрали) или из самой
   * ведомости (когда открыли уже созданную).
   */
  const заказВедомости = (orders ?? []).find((o) => o.id === orderId) ?? existing?.order ?? null;
  const датыЗаказа = заказВедомости
    ? { начало: заказВедомости.scheduledDate ?? null, конец: заказВедомости.scheduledEndDate ?? null }
    : null;
  const днейПоЗаказу = датыЗаказа
    ? cleaningDaysOf(датыЗаказа.начало, датыЗаказа.конец)
    : 0;

  /*
   * Кого назначили на заказ — штат и разовые.
   *
   * Ведомость снимает состав один раз, при создании. Людей, вписанных в
   * заказ позже, она не замечала: в карточке «Итого клинерам 9 390», а в
   * ведомости 7 890 — двух разовых там просто не было.
   *
   * Сводим по имени: у разового нет карточки в базе, и другого ключа не
   * существует, а штатного в ведомости могли добавить и вручную, без id.
   */
  /*
   * Сверяем имена «на слух»: «ё» и «е» в одних и тех же людях пишут
   * вперемешку — Кибриё в ведомости и Кибрие в заказе это один человек.
   * Без этого кнопка добавляла его вторым и начисляла зарплату дважды.
   */
  const имя = (s: string) =>
    s.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  const ужеВВедомости = new Set(
    workers.map((w) => имя(w.fullName)).filter(Boolean),
  );
  /*
   * Заказ приходит двух видов: полный (из самой ведомости) и краткий из
   * списка «Заполнить из заказа». Во втором у клинера нет ни ставки, ни
   * признака бригадира — ставку тогда берём из справочника команды.
   */
  const командаЗаказа = ((заказВедомости?.cleaners ?? []) as {
    id: string;
    fullName: string;
    rate?: number;
    leaderOf?: { id: string } | null;
  }[]).filter((c) => c.fullName);
  const разовыеЗаказа = ((заказВедомости?.guestCleaners ?? []) as
    | { fullName: string; rate: number }[]
    | null ?? []).filter((g) => g.fullName);
  const нетШтата = командаЗаказа.filter((c) => !ужеВВедомости.has(имя(c.fullName)));
  const нетРазовых = разовыеЗаказа.filter((g) => !ужеВВедомости.has(имя(g.fullName)));
  /*
   * Дни каждому — по раскладке «кто выходил в какой день». Человека без
   * карточки в заказе сверяем по имени; совсем чужого (вписан руками, в
   * заказе его нет) — по полной длительности, как раньше.
   */
  const дниРаскладки = заказВедомости
    ? дниПоРаскладке(заказВедомости)
    : new Map<string, number>();
  const идПоИмени = new Map(командаЗаказа.map((c) => [имя(c.fullName), c.id]));
  const ожидаемыеДни = (w: WorkerRow): number => {
    const ид = w.cleanerId || идПоИмени.get(имя(w.fullName)) || '';
    return дниРаскладки.get(ид) ?? днейПоЗаказу;
  };
  /*
   * Разовому вписывают сумму на руки за всю работу, а не за день — дни
   * его строки это правило не касается.
   */
  const дниНеПоЗаказу =
    днейПоЗаказу > 1
      ? workers.filter(
          (w) => w.role !== 'Разовый' && w.fullName.trim() && num(w.days) !== ожидаемыеДни(w),
        )
      : [];
  const естьРасхождение =
    дниНеПоЗаказу.length > 0 || нетШтата.length > 0 || нетРазовых.length > 0;

  /*
   * Что именно не сходится — словами, чтобы человек видел причину, а не
   * просто жёлтую полосу.
   */
  const расхождениеСловами = (() => {
    const части: string[] = [];
    if (днейПоЗаказу > 1 && дниНеПоЗаказу.length) {
      const промежуток =
        датыЗаказа?.начало && датыЗаказа?.конец
          ? ` (${formatDate(датыЗаказа.начало)} — ${formatDate(датыЗаказа.конец)})`
          : '';
      части.push(
        `в заказе ${днейПоЗаказу} ${dayWord(днейПоЗаказу)}${промежуток}, ` +
          `а здесь у ${
            дниНеПоЗаказу.length === 1
              ? дниНеПоЗаказу[0].fullName.trim()
              : `${дниНеПоЗаказу.length} работников`
          } ${
            (заказВедомости?.dayTeams ?? []).length
              ? 'число смен не совпадает с составом по дням заказа'
              : 'проставлено другое число смен'
          }`,
      );
    }
    const пропущены = [...нетШтата, ...нетРазовых].map((x) => x.fullName.trim());
    if (пропущены.length) {
      части.push(
        `в заказе ${пропущены.length === 1 ? 'есть' : 'есть'} ${пропущены.join(', ')} — ` +
          `${пропущены.length === 1 ? 'его нет' : 'их нет'} в ведомости`,
      );
    }
    if (!части.length) return '';
    const [первая, ...остальные] = части;
    return [первая.charAt(0).toUpperCase() + первая.slice(1), ...остальные].join('; ') + '.';
  })();

  /**
   * Привести ведомость к заказу: добавить недостающих, проставить дни.
   * Никого не удаляет — вписанный вручную человек остаётся на месте.
   */
  const заполнитьПоЗаказу = () => {
    const дней = днейПоЗаказу > 0 ? днейПоЗаказу : 1;
    const добавленные: WorkerRow[] = [
      ...нетШтата.map((c) => ({
        key: rowKey(),
        cleanerId: c.id,
        fullName: c.fullName,
        role: leaderIds.has(c.id) || c.leaderOf ? 'Бригадир' : 'Клинер',
        days: String(дниРаскладки.get(c.id) ?? дней),
        rate: rateOf(c) || rateOf((cleaners ?? []).find((x) => x.id === c.id)),
        fine: '',
        extra: '',
      })),
      ...нетРазовых.map((g) => ({
        key: rowKey(),
        cleanerId: '',
        fullName: g.fullName,
        role: 'Разовый',
        // сумма на руки за всю работу — на дни не умножается
        days: '1',
        rate: String(g.rate ?? 0),
        fine: '',
        extra: '',
      })),
    ];
    setWorkers((prev) => [
      ...prev.map((w) =>
        w.role === 'Разовый' || днейПоЗаказу <= 1
          ? w
          : { ...w, days: String(ожидаемыеДни(w)) },
      ),
      ...добавленные,
    ]);
    const части = [
      добавленные.length
        ? `добавлено ${добавленные.length} ${добавленные.length === 1 ? 'работник' : 'работников'}`
        : '',
      днейПоЗаказу > 1 && дниНеПоЗаказу.length
        ? `дни — ${днейПоЗаказу} ${dayWord(днейПоЗаказу)}`
        : '',
    ].filter(Boolean);
    toast.success(`Заполнено по заказу: ${части.join(', ')}`);
  };

  const save = async (andSend: boolean) => {
    if (!clientName.trim()) {
      toast.error('Укажите клиента / объект');
      return;
    }
    /*
     * Ведомость — документ, по которому людям платят. Строка с работником и
     * пустой ставкой уходила бы на сервер нулём: он молча принимает 0, а при
     * приёмке начисляет смену без денег. Поэтому останавливаемся здесь и
     * называем конкретного человека, у которого сумма не заполнена.
     */
    const unpaid = workers.filter((w) => w.fullName.trim() && !num(w.rate));
    if (unpaid.length > 0) {
      toast.error(
        `Укажите ставку: ${unpaid.map((w) => w.fullName.trim()).join(', ')}`,
      );
      return;
    }
    /*
     * Перед отправкой основателю сверяем дни с заказом.
     *
     * Именно на этом шаге владелец и заметил ошибку: уборка на три дня, а в
     * ведомости единицы. Молча отправлять заниженную сумму нельзя.
     */
    if (andSend && естьРасхождение) {
      const ок = await dialog.confirm({
        title: 'Ведомость не сходится с заказом',
        message: `${расхождениеСловами} Отправить как есть?`,
        confirmText: 'Отправить как есть',
      });
      if (!ок) return;
    }

    setSaving(true);
    let saved: Report | null = null;
    try {
      const payload = buildPayload();
      saved = id
        ? (await api.patch<Report>(`/reports/${id}`, payload)).data
        : (await api.post<Report>('/reports', payload)).data;
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось сохранить отчёт');
      setSaving(false);
      return; // ничего не сохранилось — остаёмся в форме
    }
    // отчёт сохранён; сбой отправки не должен приводить к дублям —
    // уходим на страницу отчёта, откуда его можно отправить повторно
    try {
      if (andSend && saved.status === 'DRAFT') {
        await api.post(`/reports/${saved.id}/send`);
        toast.success('Отчёт отправлен основателю');
      } else {
        toast.success('Отчёт сохранён');
      }
    } catch {
      toast.error(
        'Черновик сохранён, но не отправлен — отправьте его со страницы отчёта',
      );
    }
    navigate(`/reports/${saved.id}`, { replace: true });
  };

  if (id && !existing) {
    if (error && !loading) {
      return (
        <div className="mx-auto max-w-4xl animate-page-in">
          <button
            onClick={() => navigate('/reports')}
            className="press mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-navy-600 hover:text-navy-800"
          >
            <ArrowLeft className="h-4 w-4" /> К списку
          </button>
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 shadow-card">
            {error}
          </div>
        </div>
      );
    }
    return <Spinner />;
  }

  const activeOrders = (orders ?? []).filter(
    (o) => o.stage !== 'REJECTED',
  );

  return (
    <div className="mx-auto max-w-4xl animate-page-in">
      <button
        onClick={() => navigate(-1)}
        className="press mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-navy-600 hover:text-navy-800"
      >
        <ArrowLeft className="h-4 w-4" /> Назад
      </button>

      <PageHeader
        back={false}
        title={id ? 'Редактирование отчёта' : 'Новый отчёт'}
      />

      {/* ── Объект ── */}
      <div className="card mb-5 p-5">
        <h3 className="mb-4 font-bold text-navy-900">Объект</h3>

        <div className="mb-4">
          <label className="label">Заполнить из заказа (необязательно)</label>
          <OrderPicker
            orders={activeOrders}
            value={orderId}
            onPick={fillFromOrder}
            onClear={() => setOrderId('')}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Клиент / объект *</label>
            <input
              className="input"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Например: Галина"
            />
          </div>
          <PhoneInput value={clientPhone} onChange={setClientPhone} />
          <div className="sm:col-span-2">
            <label className="label">Адрес</label>
            <input
              className="input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Адрес объекта"
            />
          </div>
          <div>
            <label className="label">Дата начала работ</label>
            <DatePicker value={workDate} onChange={setWorkDate} />
          </div>
          <div>
            <label className="label">Дата завершения (если не в один день)</label>
            <DatePicker value={workEndDate} onChange={setWorkEndDate} />
          </div>
          <div>
            <label className="label">Площадь и стоимость за единицу</label>
            <input
              className="input"
              value={unitsLabel}
              onChange={(e) => setUnitsLabel(e.target.value)}
              placeholder="Например: 180 м² по 25 с"
            />
          </div>
          <div>
            <label className="label">Доп. услуга и стоимость на единицу</label>
            <input
              className="input"
              value={extraServices}
              onChange={(e) => setExtraServices(e.target.value)}
              placeholder="Например: мытьё окон, 6 шт по 50 с"
            />
          </div>
          <div>
            <label className="label">Предоставленная скидка, сомони</label>
            <input
              type="text"
              inputMode="numeric"
              className="input"
              value={discount}
              onChange={(e) => setDiscount(digits(e.target.value))}
              placeholder="0"
            />
          </div>
          <div>
            <label className="label">Итоговая стоимость, сомони *</label>
            <input
              type="text"
              inputMode="numeric"
              className="input font-bold"
              value={totalPrice}
              onChange={(e) => setTotalPrice(digits(e.target.value))}
              placeholder="0"
            />
          </div>
          <div>
            <label className="label">Привёл</label>
            <input
              className="input"
              value={arrivedBy}
              onChange={(e) => setArrivedBy(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Ответственный бригадир</label>
            <input
              className="input"
              value={brigadierName}
              onChange={(e) => setBrigadierName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Ответственный менеджер</label>
            <input
              className="input"
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ── Работники ── */}
      <div className="card mb-5 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-navy-900">Работники</h3>
          <div className="flex flex-wrap gap-2">
            {(brigades ?? []).map((b) => (
              <button
                key={b.id}
                onClick={() => addBrigade(b)}
                className="press inline-flex items-center gap-1.5 rounded-xl border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-600 transition hover:bg-navy-50"
              >
                <Users className="h-3.5 w-3.5" />
                {b.name}
              </button>
            ))}
            <button
              onClick={() => setWorkers((p) => [...p, emptyWorker()])}
              className="press inline-flex items-center gap-1.5 rounded-xl border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-600 transition hover:bg-navy-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Работник
            </button>
          </div>
        </div>

        {естьРасхождение && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <span>{расхождениеСловами}</span>
            <button
              onClick={заполнитьПоЗаказу}
              className="press shrink-0 rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
            >
              Заполнить по заказу
            </button>
          </div>
        )}

        {workers.length === 0 ? (
          <EmptyState text="Добавьте бригаду целиком или работников по одному" />
        ) : (
          // таблица шире телефона: край растворяется с той стороны, куда ещё
          // можно тянуть, и гаснет на упоре — так видно, что колонки есть дальше
          <ScrollArea axis="x" label="Таблица работников">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-navy-100 text-left text-xs uppercase tracking-wide text-navy-600">
                  <th className="py-2 pr-2 font-semibold">Сотрудник</th>
                  <th className="w-28 py-2 pr-2 font-semibold">Должность</th>
                  <th className="w-16 py-2 pr-2 font-semibold">Дней</th>
                  <th className="w-20 py-2 pr-2 font-semibold">Ставка</th>
                  <th className="w-20 py-2 pr-2 font-semibold">Штраф</th>
                  <th className="w-20 py-2 pr-2 font-semibold">Доп.</th>
                  <th className="w-24 py-2 pr-2 text-right font-semibold">Сумма</th>
                  <th className="w-10 py-2" />
                </tr>
              </thead>
              <tbody>
                {workers.map((w) => (
                  <tr key={w.key} className="border-b border-navy-50 align-middle">
                    <td className="py-2 pr-2">
                      <select
                        className="input !py-1.5"
                        value={w.cleanerId}
                        onChange={(e) => selectCleanerFor(w.key, e.target.value)}
                      >
                        <option value="">— вручную —</option>
                        {(cleaners ?? [])
                          .filter(
                            (c) =>
                              // отключённый клинер остаётся видимым в своей строке
                              (c.isActive || c.id === w.cleanerId) &&
                              !workers.some(
                                (x) => x.cleanerId === c.id && x.key !== w.key,
                              ),
                          )
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.fullName}
                              {c.brigade ? ` · ${c.brigade.name}` : ''}
                              {!c.isActive ? ' · отключён' : ''}
                            </option>
                          ))}
                      </select>
                      {!w.cleanerId && (
                        <input
                          className="input mt-1 !py-1.5"
                          value={w.fullName}
                          onChange={(e) =>
                            patchWorker(w.key, { fullName: e.target.value })
                          }
                          placeholder="ФИО"
                        />
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      <select
                        className="input !py-1.5"
                        value={w.role}
                        onChange={(e) => patchWorker(w.key, { role: e.target.value })}
                      >
                        <option value="Бригадир">Бригадир</option>
                        <option value="Клинер">Клинер</option>
                        {/*
                          Разовый сотрудник — тоже должность в ведомости.
                          Без этого пункта его строка показывала «Бригадир»:
                          значения «Разовый» в списке не было, и браузер рисовал
                          первый вариант. Стоило тронуть поле — человек терял
                          свою роль, и его сумма начинала умножаться на дни.
                        */}
                        <option value="Разовый">Разовый</option>
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="input !py-1.5"
                        value={w.days}
                        onChange={(e) =>
                          patchWorker(w.key, { days: digits(e.target.value) })
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="input !py-1.5"
                        value={w.rate}
                        onChange={(e) =>
                          patchWorker(w.key, { rate: digits(e.target.value) })
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="input !py-1.5"
                        value={w.fine}
                        onChange={(e) =>
                          patchWorker(w.key, { fine: digits(e.target.value) })
                        }
                        placeholder="0"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="input !py-1.5"
                        value={w.extra}
                        onChange={(e) =>
                          patchWorker(w.key, { extra: digits(e.target.value) })
                        }
                        placeholder="0"
                      />
                    </td>
                    <td className="py-2 pr-2 text-right font-bold text-navy-900">
                      {workerSum(w).toLocaleString('ru-RU')}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() =>
                          setWorkers((p) => p.filter((x) => x.key !== w.key))
                        }
                        className="press rounded-lg p-1.5 text-navy-600 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold text-navy-900">
                  <td className="py-2.5" colSpan={6}>
                    Итого выплаты работникам
                  </td>
                  <td className="py-2.5 pr-2 text-right">
                    {formatPrice(workersSum)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </ScrollArea>
        )}
      </div>

      {/* ── Доп. расходы ── */}
      <div className="card mb-5 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-bold text-navy-900">Доп. расходы</h3>
          <button
            onClick={() => setExpenses((p) => [...p, emptyExpense()])}
            className="press inline-flex items-center gap-1.5 rounded-xl border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-600 transition hover:bg-navy-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Расход
          </button>
        </div>

        {expenses.length === 0 ? (
          <p className="text-sm text-navy-600">
            Расходов нет. Например: такси, расходные материалы, обед бригады.
          </p>
        ) : (
          <ScrollArea axis="x" label="Таблица дополнительных расходов">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-navy-100 text-left text-xs uppercase tracking-wide text-navy-600">
                  <th className="py-2 pr-2 font-semibold">Наименование</th>
                  <th className="w-36 py-2 pr-2 font-semibold">Инициатор</th>
                  <th className="w-24 py-2 pr-2 font-semibold">Сумма</th>
                  <th className="py-2 pr-2 font-semibold">Комментарий</th>
                  <th className="w-10 py-2" />
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.key} className="border-b border-navy-50">
                    <td className="py-2 pr-2">
                      <input
                        className="input !py-1.5"
                        value={e.title}
                        onChange={(ev) =>
                          patchExpense(e.key, { title: ev.target.value })
                        }
                        placeholder="Например: такси"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        className="input !py-1.5"
                        value={e.initiator}
                        onChange={(ev) =>
                          patchExpense(e.key, { initiator: ev.target.value })
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="input !py-1.5"
                        value={e.amount}
                        onChange={(ev) =>
                          patchExpense(e.key, { amount: digits(ev.target.value) })
                        }
                        placeholder="0"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        className="input !py-1.5"
                        value={e.comment}
                        onChange={(ev) =>
                          patchExpense(e.key, { comment: ev.target.value })
                        }
                      />
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() =>
                          setExpenses((p) => p.filter((x) => x.key !== e.key))
                        }
                        className="press rounded-lg p-1.5 text-navy-600 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold text-navy-900">
                  <td className="py-2.5" colSpan={2}>
                    Итого расходов
                  </td>
                  <td className="py-2.5 pr-2">{formatPrice(expensesSum)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </ScrollArea>
        )}
      </div>

      {/* ── Итоги и действия ── */}
      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="text-sm text-navy-600">
          Выручка: <b className="text-navy-900">{formatPrice(num(totalPrice))}</b>
          {' · '}Выплаты: <b className="text-navy-900">{formatPrice(workersSum)}</b>
          {' · '}Расходы: <b className="text-navy-900">{formatPrice(expensesSum)}</b>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="btn-ghost"
          >
            <Save className="h-4 w-4" />
            Сохранить черновик
          </button>
          <button
            onClick={() => save(true)}
            disabled={saving}
            className="btn-primary"
          >
            <Send className="h-4 w-4" />
            {saving ? 'Сохранение…' : 'Отправить основателю'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Выбор заказа с живым поиском — вместо длинного выпадающего списка.
 *
 * На планшете найти нужный заказ прокруткой десятков строк было неудобно
 * (просьба владельца). Печатаете любой обрывок — имя, кусок телефона,
 * адреса или сумму — и список сужается. Вид тот же, что у выбора клиента
 * в задачах (ClientPicker): выбранный заказ — карточкой с «Изменить» и
 * «Убрать». «Убрать» снимает только привязку — заполненные поля формы
 * остаются как есть.
 */
function OrderPicker({
  orders,
  value,
  onPick,
  onClear,
}: {
  orders: Order[];
  value: string;
  onPick: (id: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const chosen = orders.find((o) => o.id === value) ?? null;

  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orders.slice(0, 30);
    const digits = q.replace(/\D/g, '');
    return orders
      .filter((o) => {
        const сумма = String(o.finalPrice ?? o.estimatedPrice ?? '');
        return (
          (o.client?.fullName ?? '').toLowerCase().includes(q) ||
          (o.address ?? '').toLowerCase().includes(q) ||
          (digits.length >= 2 &&
            ((o.client?.phone ?? '').replace(/\D/g, '').includes(digits) ||
              сумма.includes(digits)))
        );
      })
      .slice(0, 30);
  }, [orders, query]);

  const строка = (o: Order) =>
    `${formatVolume(o)} · ${formatPrice(o.finalPrice ?? o.estimatedPrice ?? 0)}`;

  if (chosen && !open) {
    return (
      <div
        className="flex items-center gap-2 rounded-xl border border-navy-200 bg-white px-3 py-2"
        data-testid="выбранный-заказ"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-navy-900">
            {chosen.client?.fullName ?? 'Клиент'} · {строка(chosen)}
          </span>
          {chosen.address && (
            <span className="block truncate text-xs text-navy-600">
              {chosen.address}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => {
            setQuery('');
            setOpen(true);
          }}
          className="shrink-0 text-xs font-medium text-brand-600 hover:underline"
        >
          Изменить
        </button>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 text-xs font-medium text-navy-600 hover:underline"
        >
          Убрать
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        className="input"
        value={query}
        autoFocus={open}
        placeholder="Поиск заказа: имя, телефон, адрес или сумма"
        data-testid="поиск-заказа"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div
          className="mt-1 animate-drop-in rounded-xl border border-navy-100 bg-white py-1 shadow-pop"
          data-testid="список-заказов"
        >
          <ScrollArea
            axis="y"
            innerClassName="max-h-52 overscroll-contain"
            label="Заказы"
          >
            {found.length === 0 ? (
              <div className="px-3 py-3 text-sm text-navy-600">
                Заказы не найдены
              </div>
            ) : (
              found.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    onPick(o.id);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="press block w-full px-3 py-2 text-left hover:bg-navy-50"
                >
                  <span className="block truncate text-sm font-medium text-navy-900">
                    {o.client?.fullName ?? 'Клиент'} · {строка(o)}
                  </span>
                  {o.address && (
                    <span className="block truncate text-xs text-navy-600">
                      {o.address}
                    </span>
                  )}
                </button>
              ))
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
