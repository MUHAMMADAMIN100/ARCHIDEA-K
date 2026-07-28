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
import { ProposalStatus } from '@prisma/client';
import { ProposalsService } from './proposals.service';
import {
  ChangeProposalStatusDto,
  CreateProposalDto,
  SendProposalDto,
  UpdateProposalDto,
} from './dto/proposal.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';

/**
 * Коммерческие предложения (ТЗ 9.1/9.2).
 * Доступ — по клиенту: менеджер видит и ведёт только КП своих клиентов,
 * директор (и ops-менеджер) — все.
 */
@UseGuards(JwtAuthGuard)
@Controller('proposals')
export class ProposalsController {
  constructor(private service: ProposalsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('clientId') clientId?: string,
    @Query('orderId') orderId?: string,
    @Query('status') status?: ProposalStatus,
    @Query('managerId') managerId?: string,
  ) {
    return this.service.list(user, {
      from,
      to,
      clientId,
      orderId,
      status,
      managerId,
    });
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getOne(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProposalDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProposalDto,
  ) {
    return this.service.update(user, id, dto);
  }

  /** Смена статуса после отправки: принято или отклонено */
  @Patch(':id/status')
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ChangeProposalStatusDto,
  ) {
    return this.service.changeStatus(user, id, dto);
  }

  /** ТЗ 9.2 — отметка об отправке: кто и когда отправил */
  @Post(':id/send')
  send(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SendProposalDto,
  ) {
    return this.service.send(user, id, dto);
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
