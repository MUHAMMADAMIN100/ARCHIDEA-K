import { Module } from '@nestjs/common';
import { ChecklistsService } from './checklists.service';
import { ChecklistTemplatesController } from './checklist-templates.controller';
import { OrderChecklistController } from './order-checklist.controller';
import { OrdersModule } from '../orders/orders.module';

/**
 * Чек-листы контроля качества (ТЗ 8). AuditService и NotificationsService —
 * глобальные модули, импортировать их отдельно не нужно.
 */
@Module({
  imports: [OrdersModule],
  providers: [ChecklistsService],
  controllers: [ChecklistTemplatesController, OrderChecklistController],
  exports: [ChecklistsService],
})
export class ChecklistsModule {}
