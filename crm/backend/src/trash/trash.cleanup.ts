import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TrashService } from './trash.service';

/**
 * Автоочистка корзины (ТЗ 6): записи старше TRASH_RETENTION_DAYS (по умолчанию
 * 45 дней) удаляются физически. Записи, не прошедшие purgeGuard (например,
 * сотрудник с непереброшенными задачами), пропускаются — их придётся
 * разобрать вручную через DELETE /trash/:type/:id.
 */
@Injectable()
export class TrashCleanupService {
  private readonly logger = new Logger('TrashCleanup');

  constructor(private trash: TrashService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanup() {
    const retentionDays = this.trash.retentionDays();
    try {
      const { deleted, total } = await this.trash.purgeExpired(retentionDays);
      if (total > 0) {
        this.logger.log(
          `Автоочистка корзины (> ${retentionDays} дн.): ${total} записей — ${JSON.stringify(deleted)}`,
        );
      }
    } catch (e) {
      this.logger.error('Ошибка автоочистки корзины', e as Error);
    }
  }
}
