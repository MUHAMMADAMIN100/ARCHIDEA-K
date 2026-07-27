import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { JWT_SECRET } from './jwt-secret';

/** Сколько неудачных попыток подряд до блокировки аккаунта */
const MAX_FAILED = 5;
/** На сколько блокируется аккаунт после превышения */
const LOCK_MS = 15 * 60 * 1000;

/** Срок жизни сессии: обычный вход и «Запомнить меня» */
export const SESSION_MS = 12 * 60 * 60 * 1000; // 12 часов
export const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней

/**
 * Хэш-заглушка: сравниваем с ней, когда пользователя нет — чтобы время
 * ответа не выдавало существование логина (защита от перебора логинов).
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.6Zs0Tq7B1Zq5vQXK8YQzYtqQZ7Dd4mC';

export interface LoginMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  /** Запись в журнал входов (сбой журнала не должен ломать вход) */
  private async record(params: {
    login: string;
    userId?: string | null;
    success: boolean;
    reason?: string;
    meta?: LoginMeta;
  }) {
    try {
      await this.prisma.loginAttempt.create({
        data: {
          login: params.login.slice(0, 100),
          userId: params.userId ?? null,
          success: params.success,
          reason: params.reason,
          ip: params.meta?.ip?.slice(0, 60),
          userAgent: params.meta?.userAgent?.slice(0, 200),
        },
      });
    } catch {
      /* журнал не критичен для работы входа */
    }
  }

  /**
   * Проверка логина/пароля и выдача JWT.
   * Текст ошибки одинаковый во всех случаях — не подсказываем атакующему,
   * существует ли логин и что именно неверно.
   */
  async login(dto: LoginDto, meta?: LoginMeta) {
    const login = dto.login.trim().toLowerCase();
    const fail = new UnauthorizedException('Неверный логин или пароль');

    const user = await this.prisma.user.findUnique({ where: { login } });

    // пользователя нет — всё равно считаем хэш, чтобы время ответа совпадало
    if (!user) {
      await bcrypt.compare(dto.password, DUMMY_HASH);
      await this.record({ login, success: false, reason: 'NO_USER', meta });
      throw fail;
    }

    if (!user.isActive) {
      await bcrypt.compare(dto.password, DUMMY_HASH);
      await this.record({
        login,
        userId: user.id,
        success: false,
        reason: 'INACTIVE',
        meta,
      });
      throw fail;
    }

    // аккаунт временно заблокирован после серии неудач
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.record({
        login,
        userId: user.id,
        success: false,
        reason: 'LOCKED',
        meta,
      });
      const minutes = Math.max(
        1,
        Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000),
      );
      throw new UnauthorizedException(
        `Слишком много неудачных попыток. Вход заблокирован на ${minutes} мин.`,
      );
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      // АТОМАРНЫЙ инкремент на уровне БД: параллельные попытки не могут
      // «перебить» друг друга (иначе read-modify-write из-за задержки bcrypt
      // позволял пустить залп запросов и ни разу не достичь порога блокировки)
      const bumped = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: { increment: 1 } },
        select: { failedLogins: true },
      });
      const lock = bumped.failedLogins >= MAX_FAILED;
      if (lock) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) },
        });
      }
      await this.record({
        login,
        userId: user.id,
        success: false,
        reason: 'BAD_PASSWORD',
        meta,
      });
      if (lock) {
        throw new UnauthorizedException(
          `Слишком много неудачных попыток. Вход заблокирован на ${
            LOCK_MS / 60000
          } мин.`,
        );
      }
      throw fail;
    }

    // успех — сбрасываем счётчик и снимаем блокировку
    if (user.failedLogins !== 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: null },
      });
    }
    await this.record({ login, userId: user.id, success: true, meta });

    const remember = dto.remember === true;
    const token = await this.jwt.signAsync(
      // ep — версия сессии: при смене пароля она растёт и старые токены гаснут
      { sub: user.id, role: user.role, ep: user.sessionEpoch },
      {
        secret: JWT_SECRET,
        expiresIn: remember ? '30d' : '12h',
      },
    );

    return {
      token,
      maxAge: remember ? REMEMBER_MS : SESSION_MS,
      user: {
        id: user.id,
        login: user.login,
        fullName: user.fullName,
        role: user.role,
        canManageOps: user.canManageOps,
      },
    };
  }

  /**
   * Журнал попыток входа (для руководителя): последние записи + сводка,
   * чтобы было видно подбор пароля и заблокированные аккаунты.
   */
  async loginAttempts(limit = 100) {
    const take = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [items, failed24h, locked] = await Promise.all([
      this.prisma.loginAttempt.findMany({
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.loginAttempt.count({
        where: { success: false, createdAt: { gte: dayAgo } },
      }),
      this.prisma.user.findMany({
        where: { lockedUntil: { gt: new Date() } },
        select: { id: true, login: true, fullName: true, lockedUntil: true },
      }),
    ]);
    return { items, failed24h, locked };
  }

  /** «Выйти со всех устройств» — гасит все ранее выданные токены */
  async revokeAllSessions(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { sessionEpoch: { increment: 1 } },
    });
    return { ok: true };
  }

  /** Хелпер хэширования пароля (используется в сиде и при создании юзеров) */
  static hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, 12);
  }
}
