import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Первичное наполнение реальными данными компании (идемпотентно):
 * - сотрудники с должностями и обязанностями;
 * - две бригады клинеров со ставками (бригадир 330, клинер 230 сомони/смена).
 *
 * Ничего не перезаписывает: существующие логины/клинеры не трогаются
 * (кроме одноразового заполнения пустых полей должности/обязанностей).
 */

// Пароли НЕ хранятся в коде — ни открытым текстом, ни хэшем. Пароль берётся
// только из переменной окружения SEED_PW_<LOGIN> (напр. SEED_PW_ANISA) либо
// из SEED_DEFAULT_PASSWORD. Если ни та, ни другая не задана — сотрудник
// создаётся со случайным паролем, который никуда не выводится (войти нельзя
// до тех пор, пока пароль не задан через окружение или вручную).
const TEAM: {
  login: string;
  fullName: string;
  role: Role;
  position: string;
  duties: string[];
  mainTask: string;
  /** получает ли заявки с сайта (только продажи/клиентский сервис) */
  acceptsLeads: boolean;
  /** ТЗ 1.2 — полный доступ к модулю задач всей компании */
  canManageTasks?: boolean;
}[] = [
  {
    login: 'anisa',
    fullName: 'Аниса Мукими',
    role: Role.DIRECTOR,
    acceptsLeads: false,
    position: 'Директор',
    duties: [
      'Стратегическое управление компанией',
      'Контроль всех направлений работы',
      'Финансовые и кадровые решения',
      'Развитие Archidea Cleaning',
    ],
    mainTask: 'Рост и устойчивое развитие компании Archidea Cleaning.',
  },
  {
    // Второй основатель с полным доступом (как Аниса).
    // Пароль — только через SEED_PW_ADMIN в переменных окружения.
    login: 'admin',
    fullName: 'Администратор',
    role: Role.DIRECTOR,
    acceptsLeads: false,
    position: 'Основатель',
    duties: [
      'Полный доступ ко всем разделам системы',
      'Финансовые и кадровые решения',
      'Контроль всех направлений работы',
    ],
    mainTask: 'Полный контроль и управление Archidea Cleaning.',
  },
  {
    login: 'munim',
    fullName: 'Муним Акназаров',
    role: Role.MANAGER,
    acceptsLeads: false,
    position: 'Операционный управляющий',
    duties: [
      'Организация работы всей компании',
      'Контроль внутренних процессов',
      'Упаковка компании и соблюдение корпоративных стандартов',
      'Подготовка новых сотрудников',
      'Обеспечение сотрудников всем необходимым',
      'Закупка расходных материалов и оборудования',
      'Контроль дисциплины',
      'Решение внутренних организационных вопросов',
    ],
    mainTask:
      'Следить за тем, чтобы вся компания работала как единый механизм.',
  },
  {
    login: 'muslim',
    fullName: 'Муслим Мукими',
    role: Role.MANAGER,
    acceptsLeads: true, // отдел продаж — заявки с сайта идут ему
    position: 'Управляющий отделом продаж и клиентского сервиса',
    duties: [
      'Общение с клиентами на всех этапах сотрудничества',
      'Контроль качества выполнения работ на объектах',
      'Высокий уровень Premium-сервиса',
      'Решение спорных вопросов с клиентами',
      'Выполнение плана продаж',
      'Репутация компании перед клиентами',
    ],
    mainTask:
      'Каждый клиент должен остаться доволен сервисом и захотеть обратиться в Archidea Cleaning снова.',
  },
  {
    login: 'ubaydullo',
    fullName: 'Убайдулло',
    role: Role.MANAGER,
    acceptsLeads: false,
    position: 'Логист',
    duties: [
      'Работа склада',
      'Полная комплектация каждой бригады',
      'Исправность оборудования',
      'Своевременная доставка сотрудников на объекты',
      'Контроль инвентаря',
      'Учёт оборудования и расходных материалов',
    ],
    mainTask:
      'Чтобы каждая команда приезжала вовремя и была полностью готова к работе.',
  },
  {
    login: 'fariza',
    fullName: 'Фариза',
    role: Role.MANAGER,
    acceptsLeads: false,
    position: 'Руководитель отдела маркетинга / SMM',
    duties: [
      'Развитие бренда Archidea Cleaning',
      'Организация рекламных кампаний',
      'Поиск рекламных интеграций и партнёров',
      'Создание контент-плана',
      'Продвижение компании в социальных сетях',
      'Организация фото- и видеосъёмок',
      'Выполнение маркетинговых целей компании',
    ],
    mainTask:
      'Увеличивать узнаваемость компании, привлекать новых клиентов и укреплять бренд Archidea Cleaning.',
  },
  {
    login: 'iroda',
    fullName: 'Ирода',
    role: Role.MANAGER,
    acceptsLeads: false,
    // ТЗ 1.2: ведёт задачи всей компании, оставаясь менеджером
    canManageTasks: true,
    position: 'Менеджер',
    duties: [
      'Ведение задач всей компании',
      'Назначение и контроль исполнителей',
      'Работа с клиентами и заявками',
    ],
    mainTask: 'Чтобы ни одна задача компании не осталась без исполнителя и срока.',
  },
];

const LEADER_RATE = 330;
const CLEANER_RATE = 230;

const BRIGADES: {
  name: string;
  leader: { fullName: string; duties: string[]; mainTask: string };
  members: string[];
}[] = [
  {
    name: 'Бригада №1 — Кибриё',
    leader: {
      fullName: 'Кибриё',
      duties: [
        'Управление первой бригадой',
        'Организация работы сотрудников на объекте',
        'Контроль качества уборки',
        'Соблюдение стандартов компании',
        'Выполнение работ в установленный срок',
        'Проверка объекта перед сдачей клиенту',
      ],
      mainTask:
        'Обеспечить безупречное качество уборки и эффективную работу своей команды.',
    },
    members: [
      'Мафтуна',
      'Замира',
      'Зиёда',
      'Хадиса',
      'Муслима',
      'Зулайхо',
      'Робия',
      'Рафоат',
    ],
  },
  {
    name: 'Бригада №2 — Нозима',
    leader: {
      fullName: 'Нозима',
      duties: [
        'Управление второй бригадой',
        'Организация сотрудников на объекте',
        'Контроль качества уборки',
        'Выполнение задач в срок',
        'Соблюдение стандартов Archidea Cleaning',
      ],
      mainTask:
        'Поддерживать высокий уровень качества и дисциплины в своей команде.',
    },
    members: [
      'Марьям',
      'Фируза',
      'Шахло',
      'Мастона',
      'Нозия',
      'Сохиба',
      'Фотима',
    ],
  },
];

@Injectable()
export class SetupService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Setup');

  constructor(private prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      await this.ensureTeam();
      await this.syncPasswords();
      await this.ensureBrigades();
    } catch (e) {
      this.logger.error('Инициализация данных компании не удалась', e as any);
    }
  }

  /**
   * Разовая синхронизация паролей уже существующих сотрудников с окружением.
   *
   * Зачем нужна: ensureTeam() назначает пароль ТОЛЬКО при создании сотрудника.
   * Если аккаунты завели раньше, чем появились переменные SEED_PW_<LOGIN>
   * (типичная ситуация при первом деплое), пароли у них случайные и никуда не
   * выведены — войти невозможно, а повторный запуск ничего не исправляет.
   *
   * Включается флагом SEED_RESET_PASSWORDS=true (или 1). Для каждого сотрудника
   * из TEAM с заданным SEED_PW_<LOGIN>: пароль перезаписывается, снимается
   * блокировка после неудачных попыток, аккаунт активируется, а sessionEpoch
   * увеличивается — все ранее выданные токены перестают действовать.
   *
   * ВАЖНО: флаг разовый. Пока он включён, при каждом рестарте пароли
   * возвращаются к значениям из окружения, то есть смена пароля сотрудником
   * внутри CRM будет откатываться. Снимите флаг сразу после проверки входа.
   */
  private async syncPasswords() {
    const flag = (process.env.SEED_RESET_PASSWORDS || '').trim().toLowerCase();
    if (flag !== 'true' && flag !== '1') return;

    this.logger.warn(
      'SEED_RESET_PASSWORDS включён — пароли сотрудников синхронизируются с ' +
        'переменными окружения. Снимите флаг после того, как убедитесь, что вход работает.',
    );

    for (const t of TEAM) {
      const raw = this.envPassword(t.login);
      if (!raw) continue;

      try {
        const user = await this.prisma.user.findUnique({
          where: { login: t.login },
        });
        if (!user) {
          // сотрудника нет — его только что создал ensureTeam() уже с нужным
          // паролем, либо логин отличается от ожидаемого
          continue;
        }

        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            passwordHash: await bcrypt.hash(raw, 12),
            failedLogins: 0,
            lockedUntil: null,
            isActive: true,
            sessionEpoch: { increment: 1 },
          },
        });
        // сам пароль в лог НЕ пишем: логи Railway живут долго и видны всем,
        // у кого есть доступ к панели
        this.logger.log(`Пароль синхронизирован: @${t.login}`);
      } catch (e) {
        this.logger.error(
          `Не удалось синхронизировать пароль для @${t.login}`,
          e as any,
        );
      }
    }
  }

  /** Пароль из окружения для конкретного логина (или null, если не задан) */
  private envPassword(login: string): string | null {
    const raw =
      process.env[`SEED_PW_${login.toUpperCase()}`] ||
      process.env.SEED_DEFAULT_PASSWORD;
    return raw && raw.length >= 8 ? raw : null;
  }

  /**
   * bcrypt-хэш пароля при первом создании сотрудника. Приоритет:
   * 1) env SEED_PW_<LOGIN> / SEED_DEFAULT_PASSWORD (единственный рабочий способ);
   * 2) случайный пароль (в лог НЕ выводится — войти будет нельзя).
   * Паролей и их хэшей в коде нет.
   */
  private async resolvePasswordHash(t: {
    login: string;
  }): Promise<{ passwordHash: string; generated: boolean }> {
    const fromEnv = this.envPassword(t.login);
    if (fromEnv) {
      return { passwordHash: await bcrypt.hash(fromEnv, 12), generated: false };
    }
    const random = randomBytes(9).toString('base64url');
    return { passwordHash: await bcrypt.hash(random, 12), generated: true };
  }

  private async ensureTeam() {
    for (const t of TEAM) {
      // ищем и по логину, и по ФИО — переименование логина не должно
      // «воскрешать» сотрудника с паролем по умолчанию
      const existing = await this.prisma.user.findFirst({
        where: { OR: [{ login: t.login }, { fullName: t.fullName }] },
      });
      if (!existing) {
        const { passwordHash, generated } = await this.resolvePasswordHash(t);
        await this.prisma.user.create({
          data: {
            login: t.login,
            passwordHash,
            fullName: t.fullName,
            role: t.role,
            position: t.position,
            duties: t.duties.join('\n'),
            mainTask: t.mainTask,
            acceptsLeads: t.acceptsLeads,
          },
        });
        this.logger.log(`Сотрудник создан: ${t.fullName} (@${t.login})`);
        if (generated) {
          // ПАРОЛЬ В ЛОГ НЕ ПИШЕМ: логи Railway доступны всем, у кого есть
          // доступ к панели, и хранятся долго. Задавайте пароль через env.
          this.logger.warn(
            `Пароль для @${t.login} сгенерирован случайно и НЕ выводится в лог. ` +
              `Задайте SEED_PW_${t.login.toUpperCase()} и пересоздайте сотрудника, ` +
              `либо назначьте пароль вручную в разделе «Сотрудники».`,
          );
        }
      } else if (!existing.position) {
        // одноразовое заполнение должности/обязанностей у уже созданных
        await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            position: t.position,
            duties: t.duties.join('\n'),
            mainTask: t.mainTask,
            acceptsLeads: t.acceptsLeads,
          },
        });
      }
    }
  }

  /**
   * Бригады создаются ОДИН раз — если в базе уже есть хоть одна бригада,
   * ничего не трогаем (правки директора: ставки, составы, названия,
   * удаления — не должны «откатываться» при рестарте сервера).
   */
  private async ensureBrigades() {
    const existing = await this.prisma.brigade.count();
    if (existing > 0) return;

    for (const b of BRIGADES) {
      const brigade = await this.prisma.brigade.create({
        data: { name: b.name },
      });
      this.logger.log(`Бригада создана: ${b.name}`);

      // бригадир
      const leader = await this.ensureCleaner(
        b.leader.fullName,
        LEADER_RATE,
        brigade.id,
        b.leader.duties.join('\n') + `\nОсновная задача: ${b.leader.mainTask}`,
      );
      await this.prisma.brigade.update({
        where: { id: brigade.id },
        data: { leaderId: leader.id },
      });

      // состав
      for (const name of b.members) {
        await this.ensureCleaner(name, CLEANER_RATE, brigade.id, null);
      }
    }
  }

  /** Существующих клинеров не изменяем — только создаём отсутствующих */
  private async ensureCleaner(
    fullName: string,
    rate: number,
    brigadeId: string,
    duties: string | null,
  ) {
    const existing = await this.prisma.cleaner.findFirst({
      where: { fullName },
    });
    if (existing) return existing;
    return this.prisma.cleaner.create({
      data: { fullName, rate, brigadeId, duties },
    });
  }
}
