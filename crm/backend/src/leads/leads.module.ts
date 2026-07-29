import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { ClientsModule } from '../clients/clients.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [ClientsModule, TelegramModule],
  providers: [LeadsService],
  controllers: [LeadsController],
})
export class LeadsModule {}
