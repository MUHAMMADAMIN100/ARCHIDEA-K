/**
 * Сведение состава выезда с составом, который должен быть по карточке заказа.
 *
 * Штатные сводятся по идентификатору клинера, разовые — ПО ИМЕНИ: у них нет
 * карточки в базе, и ключа кроме имени не существует. Сводить их тем же
 * способом, что штатных, нельзя: у всех разовых cleanerId равен null, они
 * никогда бы не нашлись среди уже записанных — и каждая синхронизация
 * добавляла бы их заново, пока в выезде не окажется десять «Убайдов».
 *
 * Функция чистая: одно и то же правило для открытого и для закрытого выезда,
 * и его можно проверить без базы.
 */

export interface MemberLike {
  cleanerId: string | null;
  fullName: string;
  rate: number;
  role: string;
}

export function memberKey(m: { cleanerId: string | null; fullName: string }): string {
  return m.cleanerId ?? `гость:${m.fullName.trim().toLowerCase()}`;
}

export interface MembersDiff<H extends MemberLike, W extends MemberLike> {
  /** есть в выезде, нет в карточке — убрать */
  toRemove: H[];
  /** есть в карточке, нет в выезде — добавить */
  toAdd: W[];
  /** есть и там и там — пара «как записано / как в карточке» */
  kept: { have: H; want: W }[];
}

export function diffMembers<H extends MemberLike, W extends MemberLike>(
  have: H[],
  wanted: W[],
): MembersDiff<H, W> {
  const wantedByKey = new Map(wanted.map((m) => [memberKey(m), m]));
  const haveByKey = new Map(have.map((m) => [memberKey(m), m]));
  return {
    toRemove: have.filter((m) => !wantedByKey.has(memberKey(m))),
    toAdd: wanted.filter((m) => !haveByKey.has(memberKey(m))),
    kept: have
      .filter((m) => wantedByKey.has(memberKey(m)))
      .map((m) => ({ have: m, want: wantedByKey.get(memberKey(m)) as W })),
  };
}

/**
 * Что изменилось в составе ЗАКРЫТОГО выезда — словами для журнала.
 *
 * Закрытый выезд — это уже начисленная зарплата, поэтому каждое движение
 * должно быть названо: кому доначислили, у кого сняли, кому поменяли сумму.
 * «Обновлён по карточке» здесь недостаточно.
 */
export function describeClosedChanges(parts: {
  added: { fullName: string; rate: number; cleanerId: string | null }[];
  removed: { fullName: string; rate: number; cleanerId: string | null }[];
  repriced: { fullName: string; before: number; after: number }[];
  /** штатные, которым смена НЕ начислилась — у них уже есть смена за этот день */
  skipped: { fullName: string }[];
}): string {
  const bits: string[] = [];
  const staffAdded = parts.added.filter((m) => m.cleanerId);
  const guestsAdded = parts.added.filter((m) => !m.cleanerId);
  const staffRemoved = parts.removed.filter((m) => m.cleanerId);
  const guestsRemoved = parts.removed.filter((m) => !m.cleanerId);
  if (staffAdded.length) {
    bits.push(
      `доначислено: ${staffAdded.map((m) => `${m.fullName} (${m.rate})`).join(', ')}`,
    );
  }
  if (staffRemoved.length) {
    bits.push(
      `снято: ${staffRemoved.map((m) => `${m.fullName} (${m.rate})`).join(', ')}`,
    );
  }
  if (guestsAdded.length) {
    bits.push(
      `разовые добавлены: ${guestsAdded.map((m) => `${m.fullName} (${m.rate})`).join(', ')}`,
    );
  }
  if (guestsRemoved.length) {
    bits.push(`разовые убраны: ${guestsRemoved.map((m) => m.fullName).join(', ')}`);
  }
  if (parts.repriced.length) {
    bits.push(
      `сумма изменена: ${parts.repriced
        .map((m) => `${m.fullName} ${m.before} → ${m.after}`)
        .join(', ')}`,
    );
  }
  if (parts.skipped.length) {
    bits.push(
      `смена не начислена (уже есть смена за этот день): ${parts.skipped
        .map((m) => m.fullName)
        .join(', ')}`,
    );
  }
  return bits.join('; ');
}
