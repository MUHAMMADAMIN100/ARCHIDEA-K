import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { NOT_DELETED } from '../common/soft-delete';
import { dayKey, dayUTC } from '../common/time/dushanbe';

/** Занятость одного дня */
export interface LoadDay {
  date: string;
  /** Сколько человек уже расписано на выезды этого дня */
  booked: number;
  /** Сколько выездов запланировано */
  visits: number;
  /** Объекты этого дня — чтобы было видно, куда именно едут */
  addresses: string[];
}

/**
 * Загрузка бригад по дням (ТЗ: планирование).
 *
 * Отвечает на вопрос, который до этого решался в голове у управляющего:
 * «сколько людей уже занято в четверг и кого можно поставить на новый объект».
 * Считается по выездам: у каждого есть день и состав.
 */
@Injectable()
export class LoadService {
  constructor(private prisma: PrismaService) {}

  async byDays(_user: AuthUser, from?: string, to?: string) {
    /*
     * Даты приходят из адресной строки. Мусор вместо даты давал Invalid Date,
     * с ним падал запрос к базе, и календарь показывал ошибку вместо загрузки.
     * Непонятную дату просто игнорируем — берём период по умолчанию.
     */
    const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const start = isDay(from) ? dayUTC(from as string) : new Date();
    let end = isDay(to) ? dayUTC(to as string) : new Date(start.getTime() + 13 * 86400000);

    // окно ограничено кварталом: календарь показывает месяц, а запрос на
    // десять лет перебирал бы все выезды компании ради одной полосы загрузки
    const MAX_DAYS = 92;
    if (end.getTime() < start.getTime()) end = start;
    if (end.getTime() - start.getTime() > MAX_DAYS * 86400000) {
      end = new Date(start.getTime() + MAX_DAYS * 86400000);
    }

    const groups = await this.prisma.shiftGroup.findMany({
      where: {
        ...NOT_DELETED,
        date: { gte: start, lte: end },
      },
      select: {
        date: true,
        address: true,
        // cleanerId нужен, чтобы не посчитать одного человека дважды:
        // у него может быть два выезда в один день
        members: { select: { id: true, cleanerId: true } },
      },
      orderBy: { date: 'asc' },
    });

    /*
     * Всего людей в компании — верхняя граница загрузки. Считаем действующих
     * клинеров: именно они выезжают на объекты.
     */
    const total = await this.prisma.cleaner.count({
      where: { ...NOT_DELETED, isActive: true },
    });

    const byDate = new Map<string, LoadDay>();
    /*
     * Людей считаем по головам, а не по строкам состава: один и тот же клинер
     * может стоять в двух выездах одного дня, и тогда «5 из 3 человек»
     * выглядело бы арифметической ошибкой. Разовые (без cleanerId) считаются
     * каждый за себя — их отличает только строка состава.
     */
    const peopleByDate = new Map<string, Set<string>>();
    for (const g of groups) {
      const key = dayKey(g.date);
      const day = byDate.get(key) ?? {
        date: key,
        booked: 0,
        visits: 0,
        addresses: [],
      };
      const people = peopleByDate.get(key) ?? new Set<string>();
      for (const m of g.members) people.add(m.cleanerId ?? `guest:${m.id}`);
      peopleByDate.set(key, people);
      day.booked = people.size;
      day.visits += 1;
      if (g.address && !day.addresses.includes(g.address)) {
        day.addresses.push(g.address);
      }
      byDate.set(key, day);
    }

    // дни без выездов тоже нужны: свободный день — это тоже ответ
    const days: LoadDay[] = [];
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
      const key = dayKey(new Date(t));
      days.push(byDate.get(key) ?? { date: key, booked: 0, visits: 0, addresses: [] });
    }

    return { total, days };
  }
}
