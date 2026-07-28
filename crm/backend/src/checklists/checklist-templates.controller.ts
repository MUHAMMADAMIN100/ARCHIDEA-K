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
import { CleaningType } from '@prisma/client';
import { ChecklistsService } from './checklists.service';
import {
  CreateChecklistTemplateDto,
  UpdateChecklistTemplateDto,
} from './dto/checklist.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';

/** Шаблоны чек-листов контроля качества (ТЗ 8) */
@UseGuards(JwtAuthGuard)
@Controller('checklist-templates')
export class ChecklistTemplatesController {
  constructor(private service: ChecklistsService) {}

  @Get()
  list(
    @Query('cleaningType') cleaningType?: CleaningType,
    @Query('serviceKey') serviceKey?: string,
  ) {
    return this.service.listTemplates({ cleaningType, serviceKey });
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateChecklistTemplateDto,
  ) {
    return this.service.createTemplate(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateChecklistTemplateDto,
  ) {
    return this.service.updateTemplate(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removeTemplate(user, id);
  }
}
