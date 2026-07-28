import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { JWT_SECRET } from '../jwt-secret';

/** Достаём JWT сначала из httpOnly-cookie, затем из заголовка Authorization */
function cookieExtractor(req: Request): string | null {
  if (req?.cookies?.access_token) return req.cookies.access_token;
  return null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: JWT_SECRET,
    });
  }

  async validate(payload: { sub: string; ep?: number }): Promise<AuthUser> {
    const user = await this.prisma.user.findFirst({
      // deletedAt: null — сотрудник, отправленный в корзину, войти не может
      where: { id: payload.sub, deletedAt: null },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Пользователь не найден или отключён');
    }
    // версия сессии: при смене пароля и «выйти со всех устройств» она растёт,
    // и все ранее выданные токены (в т.ч. украденные) перестают действовать
    if ((payload.ep ?? -1) !== user.sessionEpoch) {
      throw new UnauthorizedException('Сессия устарела, войдите заново');
    }
    return {
      id: user.id,
      login: user.login,
      role: user.role,
      fullName: user.fullName,
      canManageOps: user.canManageOps,
      canManageTasks: user.canManageTasks,
    };
  }
}
