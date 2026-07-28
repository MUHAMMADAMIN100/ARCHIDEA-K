import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TrashService } from './trash.service';
import { assertTrashType } from './trash.registry';
import { TrashListQueryDto, TrashPurgeQueryDto } from './dto/trash-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { can } from '../common/permissions';

/** Корзина и архив (ТЗ 1.3 / 6) */
@Controller('trash')
@UseGuards(JwtAuthGuard)
export class TrashController {
  constructor(private service: TrashService) {}

  private requireView(user: AuthUser) {
    if (!can(user, 'trash:view')) {
      throw new ForbiddenException('Нет доступа к корзине');
    }
  }

  private requirePurge(user: AuthUser) {
    if (!can(user, 'trash:purge')) {
      throw new ForbiddenException('Безвозвратное удаление доступно только руководителю');
    }
  }

  /** Бейдж в меню: сколько записей в каждом разделе корзины */
  @Get('counts')
  counts(@CurrentUser() user: AuthUser) {
    this.requireView(user);
    return this.service.counts(user);
  }

  /** Список удалённого с фильтрами; без type — по 20 из каждого раздела */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: TrashListQueryDto) {
    this.requireView(user);
    return this.service.list(user, q);
  }

  /** Возврат записи из корзины */
  @Post(':type/:id/restore')
  restore(
    @CurrentUser() user: AuthUser,
    @Param('type') typeParam: string,
    @Param('id') id: string,
  ) {
    this.requireView(user);
    return this.service.restore(user, assertTrashType(typeParam), id);
  }

  /** Безвозвратное удаление одной записи — только директор */
  @Delete(':type/:id')
  purgeOne(
    @CurrentUser() user: AuthUser,
    @Param('type') typeParam: string,
    @Param('id') id: string,
  ) {
    this.requirePurge(user);
    return this.service.purge(user, assertTrashType(typeParam), id);
  }

  /** Полная очистка корзины (по типу и/или сроку) — только директор, требует confirm=true */
  @Delete()
  purgeMany(@CurrentUser() user: AuthUser, @Query() q: TrashPurgeQueryDto) {
    this.requirePurge(user);
    return this.service.purgeMany(user, q);
  }
}
