import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditCleanup } from './audit.cleanup';
import { AuditController } from './audit.controller';

/**
 * Журнал изменений (ТЗ 2).
 *
 * Модуль глобальный: писать в журнал должны почти все сервисы, и тянуть
 * импорт в каждый модуль — лишний шум.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditCleanup],
  exports: [AuditService],
})
export class AuditModule {}
