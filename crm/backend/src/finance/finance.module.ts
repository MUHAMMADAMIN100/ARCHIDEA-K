import { Module } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';
import { BonusesService } from './bonuses.service';
import { BonusesController } from './bonuses.controller';

/**
 * Финансы: доходы/расходы и премии (ТЗ 7).
 *
 * FinanceService экспортируется — им пользуются другие модули без импорта
 * FinanceModule (см. Р в audit/notifications): orders.service вызывает
 * recordOrderIncome/removeOrderIncome при смене этапа заказа, reports.service —
 * пишет расходы по ведомости. Модуль намеренно не @Global(): в отличие от
 * аудита и уведомлений, финансы нужны заметно меньшему числу модулей —
 * явный импорт FinanceModule нагляднее показывает эту зависимость.
 */
@Module({
  controllers: [FinanceController, BonusesController],
  providers: [FinanceService, BonusesService],
  exports: [FinanceService, BonusesService],
})
export class FinanceModule {}
