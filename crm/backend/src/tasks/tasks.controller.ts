import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TaskPriority, TaskStatus, TaskType } from '@prisma/client';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private service: TasksService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user);
  }

  // создавать/удалять задачи может директор или ops-менеджер (проверка в сервисе)
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body()
    dto: {
      title: string;
      description?: string;
      type?: TaskType;
      assigneeId?: string;
      assigneeIds?: string[];
      priority?: TaskPriority;
      deadline?: string;
    },
  ) {
    return this.service.create(user, dto);
  }

  // исполнитель меняет свой статус; директор/ops — статус любого (userId)
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('status') status: TaskStatus,
    @Body('userId') userId?: string,
  ) {
    return this.service.updateStatus(user, id, status, userId);
  }

  // перенос задачи на другой день (перетаскивание в календаре)
  @Patch(':id/date')
  updateDate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('deadline') deadline: string | null,
  ) {
    return this.service.updateDate(user, id, deadline);
  }

  // полное редактирование задачи (в т.ч. смена состава исполнителей)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    dto: {
      title?: string;
      description?: string | null;
      type?: TaskType;
      priority?: TaskPriority;
      deadline?: string | null;
      assigneeIds?: string[];
    },
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id);
  }
}
