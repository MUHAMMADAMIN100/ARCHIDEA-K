import { Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { JWT_SECRET } from '../auth/jwt-secret';
import { EventsService } from './events.service';

/**
 * Живой канал через веб-сокет.
 *
 * Почему с билетом, а не кукой: браузер открывает сокет напрямую к серверу
 * приложения, а кука авторизации выдана на домен CRM и на чужой домен не
 * отправляется. Поэтому вкладка сначала просит одноразовый билет обычным
 * запросом (кука работает), а затем предъявляет его сокету. Билет живёт
 * минуту и годится только для этого.
 *
 * Поток событий на /api/events остаётся как запасной путь: если сокет не
 * поднимется (корпоративный прокси, старый браузер), вкладка продолжит
 * получать изменения по нему.
 */
@WebSocketGateway({
  path: '/socket',
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
})
export class EventsGateway implements OnGatewayConnection, OnModuleInit {
  private readonly log = new Logger('EventsGateway');

  @WebSocketServer()
  server!: Server;

  constructor(
    private events: EventsService,
    private jwt: JwtService,
    private prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    // одна подписка на весь сервер: рассылаем всем подключённым вкладкам
    this.events.changes.subscribe((e) => {
      this.server?.emit('changed', { resource: e.resource, actorId: e.actorId });
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const ticket =
      (socket.handshake.auth?.ticket as string | undefined) ??
      (socket.handshake.query?.ticket as string | undefined);
    if (!ticket) {
      socket.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        ep: number;
        ws: boolean;
      }>(ticket, { secret: JWT_SECRET });
      if (!payload?.ws) throw new Error('не билет для сокета');

      /*
       * Сверяем «поколение сессии»: после выхода со всех устройств старые
       * билеты не должны открывать канал.
       */
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { sessionEpoch: true, isActive: true },
      });
      if (!user?.isActive || user.sessionEpoch !== payload.ep) {
        throw new Error('сессия устарела');
      }
      socket.data.userId = payload.sub;
    } catch {
      socket.disconnect(true);
    }
  }
}
