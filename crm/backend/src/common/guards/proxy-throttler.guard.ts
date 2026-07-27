import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * ThrottlerGuard за прокси Railway/Vercel.
 *
 * Ключ лимита — req.ip. Express вычисляет его с учётом `trust proxy` (main.ts)
 * как первый НЕдоверенный адрес справа в X-Forwarded-For, и клиент подделать
 * его не может.
 *
 * РАНЬШЕ здесь брался ЛЕВЫЙ элемент X-Forwarded-For — а он полностью
 * подконтролен клиенту (прокси дописывает реальный адрес справа). Из-за этого
 * атакующий менял заголовок на каждый запрос и получал новый счётчик — лимиты
 * на /auth/login и глобальный лимит не срабатывали вовсе (обход брутфорса/DoS).
 */
@Injectable()
export class ProxyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.ip ?? 'unknown';
  }
}
