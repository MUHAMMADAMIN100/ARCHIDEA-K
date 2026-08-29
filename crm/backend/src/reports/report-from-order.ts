import { CleaningType, Prisma } from '@prisma/client';
import { dayKey, dayUTC } from '../common/time/dushanbe';
import { guestsOf } from '../common/order-guests';

/**
 * Черновик платёжной ведомости из заказа.
 *
 * Раньше отчёт заполнялся вручную и данные разъезжались с заказом: в поле
 * «Ответственный менеджер» подставлялся тот, кто открыл форму, а назначенная
 * на заказ команда не переносилась вовсе. Здесь собран единый источник правды —
 * им пользуется и автоматическое создание при переходе в «Оплачено»,
 * и кнопка «Заполнить из заказа».
 */

/** Что нужно знать о заказе, чтобы собрать по нему ведомость */
export type OrderForReport = {
  id: string;
  address: string | null;
  area: number | null;
  seats: number | null;
  cleaningType: CleaningType;
  pricePerSqm: number | null;
  finalPrice: number | null;
  estimatedPrice: number;
  scheduledDate: Date | null;
  /** последний день уборки — из него берётся число смен штатного клинера */
  scheduledEndDate?: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  managerId: string | null;
  client: { fullName: string; phone: string | null } | null;
  manager: { id: string; fullName: string } | null;
  discount: number;
  cleaners: {
    id: string;
    fullName: string;
    rate: number;
    leaderOf?: { id: string } | null;
    /** бригада клинера — из неё берётся ответственный бригадир */
    brigade?: { id: string; name: string; leader: { fullName: string } | null } | null;
  }[];
  /** Разовые сотрудники заказа — сырой JSON из базы, разбирает guestsOf */
  guestCleaners?: unknown;
};

/**
 * Ответственный бригадир по составу команды.
 *
 * Сначала смотрим, нет ли среди выбранных клинеров самого бригадира. Если нет
 * — берём руководителя бригады, из которой набрана команда: менеджер выбирает
 * людей из бригады, а отвечает за них её бригадир. Раньше поле оставалось
 * пустым, если бригадира не отметили в составе, и в ведомости было «—».
 */
export function brigadierFromOrder(order: OrderForReport): string | null {
  const own = order.cleaners.find((c) => c.leaderOf);
  if (own) return own.fullName;
  const withBrigade = order.cleaners.find((c) => c.brigade?.leader?.fullName);
  return withBrigade?.brigade?.leader?.fullName ?? null;
}

/** «45 м² по 25 с» или «6 мест по 70 с» — как на бумажном бланке */
export function volumeLabel(order: OrderForReport): string | null {
  const perUnit = order.pricePerSqm ? ` по ${order.pricePerSqm} с` : '';
  if (order.cleaningType === CleaningType.FURNITURE) {
    return order.seats ? `${order.seats} мест${perUnit}` : null;
  }
  return order.area ? `${order.area} м²${perUnit}` : null;
}

/**
 * Строки работников ведомости: назначенная команда и разовые сотрудники.
 *
 * Разовый идёт СТРОКОЙ БЕЗ cleanerId — так и задумано в этой модели:
 * «работник без привязки к клинеру — только в ведомости». Смену ему не
 * начислить, его нет в базе клинеров и постоянных выплат у него не бывает,
 * но отданные ему деньги обязаны быть в документе, который уходит владельцу.
 * Раньше их не было нигде: 800 сомони наличными жили только пометкой в
 * карточке заказа и ни в один отчёт не попадали.
 */
/**
 * Сколько смен начисляется штатному клинеру по заказу.
 *
 * Считаем дни уборки, оба конца включительно: заказ на 11–12 августа — это
 * две смены. Пока здесь стояла единица, ведомость по многодневной уборке
 * расходилась с деньгами, которые владелец отдаёт людям на руки, ровно во
 * столько раз, сколько дней длился объект.
 *
 * У разового сотрудника смен не бывает: ему вписывают сумму на руки целиком,
 * поэтому его строка остаётся с одним днём и на дни не умножается.
 *
 * Предел в 31 день — тот же, что у выездов: без него опечатка в году
 * («2027» вместо «2026») начислила бы человеку сотни смен.
 */
export function shiftsOfOrder(order: {
  scheduledDate: Date | null;
  scheduledEndDate?: Date | null;
}): number {
  const { scheduledDate: начало, scheduledEndDate: конец } = order;
  if (!начало || !конец) return 1;
  // считаем по календарным дням Душанбе: в базе даты лежат в UTC, и
  // вычитать их напрямую нельзя — 8 утра и полночь дали бы «полдня»
  const a = dayUTC(dayKey(начало)).getTime();
  const b = dayUTC(dayKey(конец)).getTime();
  if (b <= a) return 1;
  const дней = Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1;
  return Math.min(Math.max(дней, 1), 31);
}

export function workersFromOrder(order: OrderForReport) {
  const смен = shiftsOfOrder(order);
  const штат = order.cleaners.map((c) => ({
    cleanerId: c.id as string | null,
    fullName: c.fullName,
    // бригадир определяется по тому, руководит ли клинер бригадой
    role: c.leaderOf ? 'Бригадир' : 'Клинер',
    days: смен,
    // ставка — снапшот: пересчёт ставки задним числом не должен менять
    // уже выставленную ведомость
    rate: c.rate,
    fine: 0,
    extra: 0,
  }));
  const разовые = guestsOf(order.guestCleaners).map((g) => ({
    cleanerId: null,
    fullName: g.fullName,
    role: 'Разовый',
    days: 1,
    rate: g.rate,
    fine: 0,
    extra: 0,
  }));
  return [...штат, ...разовые];
}

/**
 * Данные ведомости по заказу.
 *
 * managerName — снапшот ответственного ЗА ЗАКАЗ, а не того, кто нажал кнопку.
 * Если у заказа менеджера нет, поле остаётся пустым: заполнит человек.
 */
export function reportDataFromOrder(
  order: OrderForReport,
  ownerId: string,
): Prisma.ReportUncheckedCreateInput {
  return {
    status: 'DRAFT',
    orderId: order.id,
    clientName: order.client?.fullName ?? 'Клиент',
    clientPhone: order.client?.phone ?? null,
    address: order.address ?? null,
    /*
     * Дата работ — КАЛЕНДАРНЫЙ ДЕНЬ, а не момент времени.
     *
     * У заказа scheduledDate и closedAt — точные отметки времени. Пока они
     * попадали в ведомость как есть, приёмка создавала смену не полночью,
     * а, скажем, в 05:00. Смена уникальна по паре «клинер + дата», поэтому
     * такая запись НЕ считалась дублем к обычной смене того же дня — человеку
     * начислялся день дважды. Вдобавок выборки за период идут по полуночи
     * UTC, и смена из ведомости в них не попадала вовсе.
     *
     * День берём по Душанбе: заказ, закрытый в час ночи, относится к своим
     * суткам, а не к предыдущим.
     */
    workDate: dayUTC(
      dayKey(order.scheduledDate ?? order.closedAt ?? order.createdAt),
    ),
    unitsLabel: volumeLabel(order),
    // скидка переносится из заказа — в ведомости её не вводят заново
    discount: order.discount ?? 0,
    totalPrice: order.finalPrice ?? order.estimatedPrice ?? 0,
    managerId: ownerId,
    managerName: order.manager?.fullName ?? null,
    brigadierName: brigadierFromOrder(order),
  };
}

/** Что подтягивать из базы, чтобы собрать ведомость по заказу */
export const orderForReportInclude = {
  client: { select: { fullName: true, phone: true } },
  manager: { select: { id: true, fullName: true } },
  cleaners: {
    select: {
      id: true,
      fullName: true,
      rate: true,
      leaderOf: { select: { id: true } },
      brigade: {
        select: {
          id: true,
          name: true,
          leader: { select: { fullName: true } },
        },
      },
    },
  },
} as const;
