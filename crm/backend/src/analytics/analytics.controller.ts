import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsPeriod, AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private service: AnalyticsService) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user);
  }

  /**
   * Полная аналитика за период. Все разрезы считаются за один и тот же
   * промежуток, поэтому цифры на экране сопоставимы между собой.
   */
  @Get('full')
  full(
    @CurrentUser() user: AuthUser,
    @Query('period') period?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const allowed: AnalyticsPeriod[] = [
      'day',
      'week',
      'month',
      'quarter',
      'year',
      'all',
    ];
    const p = allowed.includes(period as AnalyticsPeriod)
      ? (period as AnalyticsPeriod)
      : 'month';
    return this.service.full(user, p, from, to);
  }
}
