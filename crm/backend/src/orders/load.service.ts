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
    const start = from ? dayUTC(from) : new Date();
    const end = to ? dayUTC(to) : new Date(start.getTime() + 13 * 86400000);

    const groups = await this.prisma.shiftGroup.findMany({
      where: {
        ...NOT_DELETED,
        date: { gte: start, lte: end },
      },
      select: {
        date: true,
        address: true,
        members: { select: { id: true } },
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
    for (const g of groups) {
      const key = dayKey(g.date);
      const day = byDate.get(key) ?? {
        date: key,
        booked: 0,
        visits: 0,
        addresses: [],
      };
      day.booked += g.members.length;
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
