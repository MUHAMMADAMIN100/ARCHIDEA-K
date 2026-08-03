import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  login: string;
  role: Role;
  fullName: string;
  /** расширенный доступ: видит данные как директор, но без финансов */
  canManageOps: boolean;
  /** полный доступ к модулю задач: все задачи компании, а не только свои (ТЗ 1.2) */
  canManageTasks: boolean;
  canSeeTrash: boolean;
  /** персональный запрет на финансы — сильнее роли (см. permissions.ts) */
  noFinance: boolean;
  /** Владелец компании: единственный, кто удаляет сотрудников */
  isOwner: boolean;
}

/** Видит ли пользователь данные всей компании (директор или ops-менеджер) */
export function seesAll(user: AuthUser): boolean {
  return user.role === Role.DIRECTOR || user.canManageOps === true;
}

/** Достаёт текущего пользователя (из JWT) в параметр метода */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: AuthUser = request.user;
    return data ? user?.[data] : user;
  },
);
