import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ProxyThrottlerGuard } from './common/guards/proxy-throttler.guard';
import { CsrfGuard } from './common/guards/csrf.guard';

import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CleanersModule } from './cleaners/cleaners.module';
import { ClientsModule } from './clients/clients.module';
import { OrdersModule } from './orders/orders.module';
import { TasksModule } from './tasks/tasks.module';
import { TariffsModule } from './tariffs/tariffs.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { LeadsModule } from './leads/leads.module';
import { PayrollModule } from './payroll/payroll.module';
import { ReportsModule } from './reports/reports.module';
import { SetupModule } from './setup/setup.module';
import { BackupModule } from './backup/backup.module';
// ── Модули доработки по ТЗ ──
import { TrashModule } from './trash/trash.module'; // корзина/архив (ТЗ 1.3, 6)
import { FinanceModule } from './finance/finance.module'; // доходы, расходы, премии (ТЗ 7)
import { ChecklistsModule } from './checklists/checklists.module'; // чек-листы (ТЗ 8)
import { ProposalsModule } from './proposals/proposals.module'; // КП (ТЗ 9)
import { RemindersModule } from './reminders/reminders.module'; // напоминания (ТЗ 10.1)
import { TelegramModule } from './telegram/telegram.module'; // уведомления в Telegram (ТЗ 10.2)
import { AppController } from './app.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // Глобальный rate-limit за 60 сек с одного IP. Лимит высокий, потому что
    // весь трафик CRM идёт через общий egress-адрес Vercel (rewrite /api →
    // Railway) и делит один ключ; жёсткие лимиты — точечно на /auth/login
    // (8/мин) и /leads/intake (6/мин). Это защита от лавины, а не от поллинга.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1200 }]),
    PrismaModule,
    AuditModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    CleanersModule,
    ClientsModule,
    OrdersModule,
    TasksModule,
    TariffsModule,
    AnalyticsModule,
    LeadsModule,
    PayrollModule,
    ReportsModule,
    SetupModule,
    BackupModule,
    TrashModule,
    FinanceModule,
    ChecklistsModule,
    ProposalsModule,
    RemindersModule,
    TelegramModule,
  ],
  controllers: [AppController],
  providers: [
    // Rate-limit применяется первым (до аутентификации); ключ — реальный IP за прокси
    { provide: APP_GUARD, useClass: ProxyThrottlerGuard },
    // CSRF: изменяющие запросы со сторонних сайтов отклоняются
    { provide: APP_GUARD, useClass: CsrfGuard },
    // Глобальная JWT-защита: все роуты требуют авторизации, кроме @Public
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
