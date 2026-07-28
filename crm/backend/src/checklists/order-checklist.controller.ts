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
import { ChecklistsService } from './checklists.service';
import {
  AddChecklistItemDto,
  ApplyChecklistTemplateDto,
  ToggleChecklistItemDto,
} from './dto/checklist.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';

/**
 * Чек-лист качества конкретного заказа (ТЗ 8). Доступ такой же, как к заказу
 * (`OrdersService.getOne`): менеджер видит только свои заказы, директор/ops — все.
 */
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrderChecklistController {
  constructor(private service: ChecklistsService) {}

  @Get(':id/checklist')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getOrderChecklist(user, id);
  }

  @Post(':id/checklist')
  apply(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ApplyChecklistTemplateDto,
  ) {
    return this.service.applyTemplate(user, id, dto);
  }

  @Post(':id/checklist/items')
  addItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddChecklistItemDto,
  ) {
    return this.service.addItem(user, id, dto);
  }

  @Patch(':orderId/checklist/items/:itemId')
  toggleItem(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Param('itemId') itemId: string,
    @Body() dto: ToggleChecklistItemDto,
  ) {
    return this.service.toggleItem(user, orderId, itemId, dto);
  }

  @Delete(':orderId/checklist/items/:itemId')
  removeItem(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.service.removeItem(user, orderId, itemId);
  }

  @Post(':id/checklist/complete')
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.complete(user, id);
  }

  @Delete(':id/checklist')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removeChecklist(user, id);
  }
}
