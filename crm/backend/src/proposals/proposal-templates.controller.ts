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
import { ProposalsService } from './proposals.service';
import {
  CreateProposalTemplateDto,
  UpdateProposalTemplateDto,
} from './dto/proposal.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';

/**
 * Шаблоны КП (ТЗ 9.1). Смотреть могут все авторизованные (нужно для
 * выбора шаблона при создании КП), править и удалять — только с правом
 * proposals:templates (директор, ops-менеджер).
 */
@UseGuards(JwtAuthGuard)
@Controller('proposal-templates')
export class ProposalTemplatesController {
  constructor(private service: ProposalsService) {}

  @Get()
  list() {
    return this.service.listTemplates();
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProposalTemplateDto,
  ) {
    return this.service.createTemplate(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProposalTemplateDto,
  ) {
    return this.service.updateTemplate(user, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ) {
    return this.service.removeTemplate(user, id, reason);
  }
}
