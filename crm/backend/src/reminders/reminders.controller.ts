import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { CreateReminderDto, ReminderQueryDto, UpdateReminderDto } from './dto/reminder.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';

/** Напоминания перезвонить клиенту (предзаказ) — ТЗ 10.1 */
@UseGuards(JwtAuthGuard)
@Controller('reminders')
export class RemindersController {
  constructor(private service: RemindersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ReminderQueryDto) {
    return this.service.list(user, q);
  }

  @Get('counts')
  counts(@CurrentUser() user: AuthUser) {
    return this.service.counts(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReminderDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateReminderDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Post(':id/done')
  done(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.done(user, id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.cancel(user, id);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ) {
    return this.service.remove(user, id, reason);
  }
}
