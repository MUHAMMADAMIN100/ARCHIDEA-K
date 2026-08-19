import { formatPhone } from '../common/validation/contact';
import { formatDate } from '../common/time/dushanbe';
import { escapeHtml } from './telegram.util';

/**
 * Текст уведомления о клиенте, добавленном сотрудником из CRM.
 *
 * Один сборщик на оба случая — «просто клиент» и «клиент с заявкой»:
 * сообщения обязаны выглядеть одинаково, иначе в переписке бота будет
 * два разных формата об одном и том же событии. Заявки с сайта живут
 * отдельно (leads.service) — у них свой устоявшийся вид.
 *
 * Показываем только заполненное: пустые строки в уведомлении — шум,
 * из-за которого важное перестают читать.
 */

const TYPE_LABEL: Record<string, string> = {
  MAINTENANCE: 'Поддерживающая',
  GENERAL: 'Генеральная уборка',
  POST_RENOVATION: 'Уборка после ремонта',
  FURNITURE: 'Мойка мягкой мебели',
};

const SOURCE_LABEL: Record<string, string> = {
  SITE: 'Сайт',
  INSTAGRAM: 'Instagram',
  CALL: 'Звонок',
  COLD_CALL: 'Холодный обзвон',
  RECOMMENDATION: 'Рекомендация',
  ANISA: 'От Анисы',
};

const TAG_LABEL: Record<string, string> = {
  VIP: 'VIP',
  REGULAR: 'Постоянный',
  REFUSED: 'Отказник',
  POTENTIAL: 'Потенциальный',
};

export interface CrmClientInfo {
  fullName: string;
  phone: string;
  extraPhones?: string[] | null;
  address?: string | null;
  source?: string | null;
  sourceDetail?: string | null;
  tags?: string[] | null;
}

export interface CrmOrderInfo {
  cleaningType?: string | null;
  area?: number | null;
  seats?: number | null;
  estimatedPrice?: number | null;
  finalPrice?: number | null;
  discount?: number | null;
  address?: string | null;
  customExtras?: unknown;
  preferredDate?: Date | null;
  preferredTime?: string | null;
  comment?: string | null;
}

export function buildCrmClientMessage(params: {
  addedBy: string;
  client: CrmClientInfo;
  order?: CrmOrderInfo | null;
  managerName?: string | null;
}): string {
  const { addedBy, client, order, managerName } = params;
  const e = escapeHtml;

  const lines: (string | null)[] = [
    order ? '<b>Новая заявка в CRM</b>' : '<b>Новый клиент в CRM</b>',
    `Добавил(а): ${e(addedBy)}`,
    `Клиент: ${e(client.fullName)}`,
    `Телефон: ${e(formatPhone(client.phone))}`,
  ];
  for (const extra of client.extraPhones ?? []) {
    lines.push(`Запасной: ${e(formatPhone(extra))}`);
  }
  const address = order?.address || client.address;
  if (address) lines.push(`Адрес: ${e(address)}`);
  if (client.source) {
    const from = client.sourceDetail ? ` (${e(client.sourceDetail)})` : '';
    lines.push(`Источник: ${SOURCE_LABEL[client.source] ?? e(client.source)}${from}`);
  }
  if (client.tags?.length) {
    lines.push(`Статусы: ${client.tags.map((t) => TAG_LABEL[t] ?? e(t)).join(', ')}`);
  }
  if (managerName) lines.push(`Ответственный: ${e(managerName)}`);

  if (order) {
    lines.push('');
    if (order.cleaningType) {
      lines.push(`Услуга: ${TYPE_LABEL[order.cleaningType] ?? e(order.cleaningType)}`);
    }
    if (order.seats) lines.push(`Объём: ${order.seats} мест`);
    else if (order.area) lines.push(`Объём: ${order.area} м²`);
    const total = order.finalPrice ?? order.estimatedPrice;
    if (total != null) {
      const discount = order.discount ? ` (скидка ${order.discount})` : '';
      lines.push(`Сумма: ${total} сомони${discount}`);
    }
    /*
     * Доп. услуги — из снапшота строк заказа; в счёт (и в сообщение)
     * идут только отмеченные галочкой, ровно как в карточке.
     */
    const extras = Array.isArray(order.customExtras)
      ? (order.customExtras as { title?: string; price?: number; checked?: boolean }[])
          .filter((x) => x?.checked && x.title)
      : [];
    if (extras.length) {
      lines.push(
        `Доп. услуги: ${extras
          .map((x) => `${e(String(x.title))} — ${x.price ?? 0} сомони`)
          .join('; ')}`,
      );
    }
    if (order.preferredDate) {
      const time = order.preferredTime ? ` ${e(order.preferredTime)}` : '';
      lines.push(`Клиент просил: ${formatDate(order.preferredDate)}${time}`);
    } else if (order.preferredTime) {
      lines.push(`Клиент просил: ${e(order.preferredTime)}`);
    }
    if (order.comment) lines.push(`Комментарий: ${e(order.comment)}`);
  }

  return lines.filter((l) => l !== null).join('\n');
}
