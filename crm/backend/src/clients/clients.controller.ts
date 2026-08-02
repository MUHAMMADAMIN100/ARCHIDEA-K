import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ClientTag, LeadSource } from '@prisma/client';
import { ClientsService } from './clients.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('clients')
export class ClientsController {
  constructor(private service: ClientsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('tag') tag?: ClientTag,
    @Query('source') source?: LeadSource,
    @Query('managerId') managerId?: string,
    @Query('sort') sort?: 'recent' | 'name',
    @Query('repeat') repeat?: string,
  ) {
    return this.service.list(user, {
      search,
      tag,
      source,
      managerId,
      sort,
      // ТЗ 9.4 — фильтр «повторные клиенты»
      repeat: repeat === 'true' || repeat === '1',
    });
  }

  /**
   * Все теги, которые уже есть у клиентов. Формы показывают их кнопками,
   * поэтому справочник тегов ведётся сам собой: завели новый — он сразу
   * стал вариантом для всех.
   */
  @Get('labels')
  labels(@CurrentUser() user: AuthUser) {
    return this.service.labels(user);
  }

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const csv = await this.service.exportCsv(user);
    res.setHeader('Content-Disposition', 'attachment; filename="clients.csv"');
    // BOM для корректной кириллицы в Excel
    res.send('﻿' + csv);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getOne(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateClientDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.service.update(user, id, dto);
  }

  /** Удаление переносит клиента и его заказы в корзину (ТЗ 6) */
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ) {
    return this.service.remove(user, id, reason);
  }

  /** История изменений клиента (ТЗ 2) */
  @Get(':id/history')
  history(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.history(user, id);
  }
}
