import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/** По ТЗ журнал действий хранится ровно 45 дней (переопределяется окружением) */
const DEFAULT_RETENTION_DAYS = 45;

/**
 * Автоочистка «Истории изменений».
 *
 * Журнал растёт с каждым действием и без ротации разбухает бесконечно.
 * Раз в сутки удаляем записи старше срока хранения; попытки входа чистим
 * тем же сроком — это такой же журнал действий.
 */
@Injectable()
export class AuditCleanup {
  private readonly logger = new Logger('AuditCleanup');

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeOld() {
    const raw = Number(process.env.AUDIT_RETENTION_DAYS);
    const days =
      Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RETENTION_DAYS;
    const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    try {
      const [audit, logins] = await Promise.all([
        this.prisma.auditLog.deleteMany({
          where: { createdAt: { lt: threshold } },
        }),
        this.prisma.loginAttempt.deleteMany({
          where: { createdAt: { lt: threshold } },
        }),
      ]);
      if (audit.count || logins.count) {
        this.logger.log(
          `Очистка журнала: изменений ${audit.count}, входов ${logins.count} (старше ${days} дн.)`,
        );
      }
    } catch (e) {
      this.logger.error('Очистка журнала не удалась', e as any);
    }
  }
}
