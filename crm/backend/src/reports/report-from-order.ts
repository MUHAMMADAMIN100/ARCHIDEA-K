import { CleaningType, Prisma } from '@prisma/client';
import { dayKey, dayUTC } from '../common/time/dushanbe';

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

/** Строки работников: назначенная на заказ команда со ставкой на сегодня */
export function workersFromOrder(order: OrderForReport) {
  return order.cleaners.map((c) => ({
    cleanerId: c.id,
    fullName: c.fullName,
    // бригадир определяется по тому, руководит ли клинер бригадой
    role: c.leaderOf ? 'Бригадир' : 'Клинер',
    days: 1,
    // ставка — снапшот: пересчёт ставки задним числом не должен менять
    // уже выставленную ведомость
    rate: c.rate,
    fine: 0,
    extra: 0,
  }));
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
