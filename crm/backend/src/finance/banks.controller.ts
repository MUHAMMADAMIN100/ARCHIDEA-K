import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { BanksService } from './banks.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { can } from '../common/permissions';
import { CreateBankDto, UpdateBankDto } from './dto/bank.dto';

/**
 * Справочник банков (ТЗ 3.1).
 *
 * Читать может любой сотрудник: банк выбирают при внесении оплаты, а оплату
 * принимает менеджер.
 *
 * Править — только тот, кому открыты деньги компании. Это не «настройка вроде
 * услуг»: название банка подписывает каналы поступления в книге доходов, а
 * отключение всех банков останавливает безналичную оплату целиком. Поэтому
 * право то же, что на саму книгу, — finance:manage.
 */
@UseGuards(JwtAuthGuard)
@Controller('banks')
export class BanksController {
  constructor(private service: BanksService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get('manage')
  listAll(@CurrentUser() user: AuthUser) {
    this.assertCanManage(user);
    return this.service.listAll();
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBankDto) {
    this.assertCanManage(user);
    return this.service.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateBankDto,
  ) {
    this.assertCanManage(user);
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertCanManage(user);
    return this.service.remove(user, id);
  }

  private assertCanManage(user: AuthUser) {
    if (!can(user, 'finance:manage')) {
      throw new ForbiddenException(
        'Справочник банков ведёт руководитель с доступом к финансам',
      );
    }
  }
}
