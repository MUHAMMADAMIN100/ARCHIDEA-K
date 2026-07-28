import { Module } from '@nestjs/common';
import { TrashService } from './trash.service';
import { TrashController } from './trash.controller';
import { TrashCleanupService } from './trash.cleanup';

/**
 * Корзина и архив (ТЗ 1.3 / 6).
 *
 * TrashService экспортируется — остальные модули (orders, clients, tasks,
 * cleaners, users, reports, tariffs, finance, bonuses, proposals, reminders,
 * payroll) вызывают его softDelete() вместо прямого prisma.<model>.delete().
 */
@Module({
  providers: [TrashService, TrashCleanupService],
  controllers: [TrashController],
  exports: [TrashService],
})
export class TrashModule {}
