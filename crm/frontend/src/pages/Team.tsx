import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Trash2,
  UserRound,
  Users as UsersIcon,
  Star,
  Pencil,
  BadgeCheck,
  Target,
  Wallet,
} from 'lucide-react';
import { api } from '../api/client';
import { useFetch, deleteRecord } from '../api/hooks';
import { useToast } from '../components/Toast';
import { PhoneInput } from '../components/ContactFields';
import { formatPhone, sanitizePersonName } from '../lib/contact';
import { useDialog } from '../components/Dialog';
import { useAuth } from '../auth/AuthContext';
import { userSeesFinance } from '../types';
import { Skeleton, PageHeader, Modal, EmptyState, Badge } from '../components/ui';
import { DrillValue, DetailModal, DetailStats, DetailTable } from '../components/Drilldown';
import {
  STAGE_COLOR,
  STAGE_LABEL,
  formatDateTime,
  formatVolume,
} from '../lib/labels';
import { tempId } from '../lib/util';
import type { Brigade, Cleaner, Manager, Order } from '../types';

export function Team() {
  const toast = useToast();
  const dialog = useDialog();
  const { user } = useAuth();
  const isDirector = user?.role === 'DIRECTOR';
  /*
   * Ставки клинеров видит каждый сотрудник (решение владельца): по ним он
   * составляет платёжную ведомость. МЕНЯТЬ ставку вправе только руководитель —
   * это проверяет сервер, а форма ниже прячет само поле.
   */
  const showRates = true;

  const { data: staff } = useFetch<Manager[]>(
    isDirector ? '/users' : '/users/managers',
  );
  const {
    data: brigades,
    loading: brigadesLoading,
    reload: reloadBrigades,
    setData: setBrigades,
  } = useFetch<Brigade[]>('/brigades', { pollMs: 30000 });
  const {
    data: cleaners,
    reload: reloadCleaners,
    setData: setCleaners,
  } = useFetch<Cleaner[]>('/cleaners', { pollMs: 30000 });
  const { data: dayTasks } = useFetch<Order[]>('/cleaners/team-tasks', {
    pollMs: 20000,
  });

  const [dutyPerson, setDutyPerson] = useState<{
    name: string;
    position?: string | null;
    duties?: string | null;
    mainTask?: string | null;
  } | null>(null);
  const [editCleaner, setEditCleaner] = useState<Cleaner | null>(null);
  const [addToBrigade, setAddToBrigade] = useState<string | null | 'open'>(null);
  // бригада, по которой раскрыт состав и стоимость смены
  const [brigadeDrill, setBrigadeDrill] = useState<{
    brigade: Brigade;
    members: Cleaner[];
  } | null>(null);

  const reloadAll = () => {
    reloadBrigades();
    reloadCleaners();
  };

  const removeCleaner = async (c: Cleaner) => {
    const ok = await dialog.confirm({
      title: 'Удалить клинера?',
      message: `${c.fullName} будет удалён(а) вместе с историей смен.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    // оптимистично: убираем из плоского списка и из бригад сразу
    setCleaners((list) => (list ? list.filter((x) => x.id !== c.id) : list));
    setBrigades((bs) =>
      bs
        ? bs.map((b) => ({
            ...b,
            cleaners: b.cleaners.filter((x) => x.id !== c.id),
          }))
        : bs,
    );
    await deleteRecord({
      // список уже поправлен выше — возвращаем серверное состояние
      remove: () => () => reloadAll(),
      request: () => api.delete(`/cleaners/${c.id}`),
      onDone: () => toast.success('Клинер удалён'),
      onFail: (m) => toast.error(m),
      refresh: ['/cleaners', '/brigades'],
    });
  };

  /*
   * Назначить бригадиром.
   *
   * Кнопки для этого не было вовсе: бригадир задавался только запросом к
   * серверу. Поэтому у «Бригады №1» в шапке годами стояло имя из удалённой
   * записи, а поправить это из приложения было нельзя. Меняет старшего в
   * бригаде руководитель или управляющий — то же самое проверяет сервер.
   */
  const canSetLeader = user?.role === 'DIRECTOR' || user?.role === 'SUPERVISOR';

  const makeLeader = async (b: Brigade, c: Cleaner) => {
    const ok = await dialog.confirm({
      title: 'Назначить бригадиром?',
      message: `${c.fullName} станет бригадиром бригады «${b.name}»${
        b.leader ? `, вместо: ${b.leader.fullName}` : ''
      }.`,
      confirmText: 'Назначить',
    });
    if (!ok) return;
    // сразу на экране: звёздочка и метка переезжают, не дожидаясь сервера
    setBrigades((bs) =>
      bs
        ? bs.map((x) => {
            if (x.id === b.id) {
              return { ...x, leaderId: c.id, leader: { id: c.id, fullName: c.fullName } };
            }
            // бригадиром человек бывает только в одной бригаде — так устроен сервер
            return x.leaderId === c.id ? { ...x, leaderId: null, leader: null } : x;
          })
        : bs,
    );
    try {
      await api.patch(`/brigades/${b.id}`, { leaderId: c.id });
      toast.success(`${c.fullName} — бригадир`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось назначить бригадира');
    }
    reloadAll();
  };

  // создание/редактирование клинера — оптимистично в плоском списке,
  // вложенную структуру бригад досогласуем фоновым тихим reload
  const upsertCleaner = (
    payload: {
      fullName: string;
      phone: string | null;
      rate?: number;
      brigadeId: string | null;
    },
    existing?: Cleaner,
  ) => {
    // вставка клинера в нужную бригаду (и удаление из всех прочих)
    const placeInBrigade = (bs: Brigade[] | null, c: Cleaner) =>
      bs
        ? bs.map((b) => ({
            ...b,
            cleaners:
              b.id === c.brigadeId
                ? [...b.cleaners.filter((x) => x.id !== c.id), c]
                : b.cleaners.filter((x) => x.id !== c.id),
          }))
        : bs;

    if (existing) {
      const patched: Cleaner = {
        ...existing,
        fullName: payload.fullName,
        phone: payload.phone ?? undefined,
        rate: payload.rate ?? existing.rate,
        brigadeId: payload.brigadeId,
      };
      setCleaners((list) =>
        list ? list.map((c) => (c.id === existing.id ? patched : c)) : list,
      );
      // корректно переносим между бригадами (или убираем при «Без бригады»)
      setBrigades((bs) => placeInBrigade(bs, patched));
      api
        .patch(`/cleaners/${existing.id}`, payload)
        .then(() => reloadAll())
        .catch((e: any) => {
          toast.error(e?.response?.data?.message || 'Не удалось сохранить');
          reloadAll();
        });
    } else {
      const optimistic: Cleaner = {
        id: tempId(),
        fullName: payload.fullName,
        phone: payload.phone ?? undefined,
        rate: payload.rate ?? 230,
        isActive: true,
        brigadeId: payload.brigadeId,
      };
      setCleaners((list) => (list ? [...list, optimistic] : [optimistic]));
      // если выбрана бригада — показываем клинера в ней сразу
      setBrigades((bs) => placeInBrigade(bs, optimistic));
      api
        .post('/cleaners', payload)
        .then(() => reloadAll())
        .catch((e: any) => {
          toast.error(e?.response?.data?.message || 'Не удалось сохранить');
          setCleaners((list) =>
            list ? list.filter((c) => c.id !== optimistic.id) : list,
          );
          setBrigades((bs) =>
            bs
              ? bs.map((b) => ({
                  ...b,
                  cleaners: b.cleaners.filter((x) => x.id !== optimistic.id),
                }))
              : bs,
          );
        });
    }
  };

  /*
   * Заглушка повторяет сетку бригад — те же две колонки и та же высота.
   * Крутящийся кружок оставлял экран пустым, и при приходе данных вёрстка
   * прыгала с нуля на полный рост.
   */
  if (brigadesLoading && !brigades)
    return (
      <div
        className="grid min-w-0 animate-page-in gap-4 lg:grid-cols-2"
        role="status"
        aria-label="Загрузка"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-60 rounded-md" />
        ))}
      </div>
    );

  // отключённые клинеры скрыты (история их смен сохраняется в выплатах)
  const unassigned = (cleaners ?? []).filter((c) => !c.brigadeId && c.isActive);

  return (
    <div className="animate-page-in">
      <PageHeader
        title="Команда"
        action={
          <button onClick={() => setAddToBrigade('open')} className="btn-primary">
            <Plus className="h-4 w-4" />
            Добавить клинера
          </button>
        }
      />

      {/* ── Сотрудники ── */}
      {staff && staff.length > 0 && (
        <>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-600">
            Сотрудники
          </h3>
          <div className="mb-8 grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {staff.map((m) => (
              <StaffCard
                key={m.id}
                person={m}
                canOpenProfile={isDirector || m.id === user?.id}
                onDuties={() =>
                  setDutyPerson({
                    name: m.fullName,
                    position: m.position,
                    duties: m.duties,
                    mainTask: m.mainTask,
                  })
                }
              />
            ))}
          </div>
        </>
      )}

      {/* ── Бригады ── */}
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-600">
        Бригады клинеров
      </h3>
      {!brigades || brigades.length === 0 ? (
        <EmptyState text="Бригад пока нет" />
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          {brigades.map((b) => {
            const members = b.cleaners.filter((c) => c.isActive);
            return (
            <div key={b.id} className="card min-w-0 p-5">
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-100 text-navy-700">
                  <UsersIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-navy-900">{b.name}</div>
                  <div className="text-xs text-navy-600">
                    <DrillValue
                      tone="muted"
                      className="text-xs"
                      disabled={members.length === 0}
                      title="Состав бригады и стоимость её смены"
                      onClick={() => setBrigadeDrill({ brigade: b, members })}
                    >
                      {members.length} чел.
                    </DrillValue>
                    {' · бригадир: '}
                    {b.leader?.fullName ?? 'не назначен'}
                  </div>
                </div>
                <button
                  onClick={() => setAddToBrigade(b.id)}
                  className="press rounded-lg p-2 text-navy-600 transition hover:bg-navy-50 hover:text-navy-700"
                  title="Добавить в бригаду"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-2">
                {members.length === 0 && (
                  <div className="text-sm text-navy-600">Нет клинеров</div>
                )}
                {[...members]
                  .sort((x, y) =>
                    x.id === b.leaderId ? -1 : y.id === b.leaderId ? 1 : 0,
                  )
                  .map((c) => {
                    const isLeader = c.id === b.leaderId;
                    return (
                      <div
                        key={c.id}
                        className={`flex min-w-0 items-center gap-2 rounded-xl border p-2 sm:gap-3 sm:p-2.5 ${
                          isLeader
                            ? 'border-amber-200 bg-amber-50/60'
                            : 'border-navy-100'
                        }`}
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                            isLeader
                              ? 'bg-amber-100 text-amber-600'
                              : 'bg-navy-100 text-navy-700'
                          }`}
                        >
                          {isLeader ? (
                            <Star className="h-4 w-4" />
                          ) : (
                            <UserRound className="h-4 w-4" />
                          )}
                        </span>
                        {/*
                          Имя, телефон и ставка идут столбиком друг под
                          другом. Раньше ставка стояла сбоку и не сжималась —
                          имени с телефоном оставалось несколько пикселей, и
                          «телефон не указан» вставало вертикально по букве.
                        */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-sm font-medium text-navy-900">
                            <span className="truncate">{c.fullName}</span>
                            {isLeader && (
                              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">
                                Бригадир
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-navy-600">
                            {c.phone ? formatPhone(c.phone) : 'телефон не указан'}
                          </div>
                          {showRates && (
                            <span className="mt-1 inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-navy-50 px-2 py-1 text-xs font-semibold text-navy-700">
                              <Wallet className="h-3.5 w-3.5 shrink-0 text-navy-600" />
                              {c.rate} с/смена
                            </span>
                          )}
                        </div>
                        {isLeader && c.duties && (
                          <button
                            onClick={() =>
                              setDutyPerson({
                                name: c.fullName,
                                position: `Бригадир — ${b.name}`,
                                duties: c.duties,
                              })
                            }
                            className="press shrink-0 rounded-lg p-1.5 text-navy-600 hover:bg-navy-50 hover:text-navy-700"
                            title="Обязанности"
                          >
                            <BadgeCheck className="h-4 w-4" />
                          </button>
                        )}
                        {/*
                          Звёздочка стоит рядом с карандашом и мусоркой — в том
                          же ряду действий над человеком. У самого бригадира её
                          нет: он уже бригадир, нажимать не на что.
                        */}
                        {canSetLeader && !isLeader && (
                          <button
                            onClick={() => makeLeader(b, c as Cleaner)}
                            className="press shrink-0 rounded-lg p-1.5 text-navy-400 hover:bg-amber-50 hover:text-amber-600"
                            title="Назначить бригадиром"
                            aria-label={`Назначить бригадиром: ${c.fullName}`}
                          >
                            <Star className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => setEditCleaner(c as Cleaner)}
                          className="press shrink-0 rounded-lg p-1.5 text-navy-600 hover:bg-navy-50 hover:text-navy-700"
                          title="Редактировать"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => removeCleaner(c as Cleaner)}
                          className="press shrink-0 rounded-lg p-1.5 text-navy-600 hover:bg-red-50 hover:text-red-600"
                          title="Удалить"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* ── Клинеры без бригады ── */}
      {unassigned.length > 0 && (
        <>
          <h3 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-navy-600">
            Без бригады
          </h3>
          <div className="card space-y-2 p-5">
            {unassigned.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-xl border border-navy-100 p-2.5"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-100 text-navy-700">
                  <UserRound className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-navy-900">
                    {c.fullName}
                  </div>
                  <div className="text-xs text-navy-600">
                    {c.phone ? formatPhone(c.phone) : 'телефон не указан'}
                  </div>
                </div>
                {showRates && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-navy-50 px-2 py-1 text-xs font-semibold text-navy-700">
                    <Wallet className="h-3.5 w-3.5 text-navy-600" />
                    {c.rate} с/смена
                  </span>
                )}
                <button
                  onClick={() => setEditCleaner(c)}
                  className="press rounded-lg p-1.5 text-navy-600 hover:bg-navy-50 hover:text-navy-700"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => removeCleaner(c)}
                  className="press rounded-lg p-1.5 text-navy-600 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Работа на сегодня ── */}
      {dayTasks && dayTasks.length > 0 && (
        <>
          <h3 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-navy-600">
            Выезды на сегодня
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {dayTasks.map((o) => (
              <div key={o.id} className="card p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-navy-900">
                    {o.client?.fullName}
                  </span>
                  <Badge className={STAGE_COLOR[o.stage]}>
                    {STAGE_LABEL[o.stage]}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-navy-600">
                  {formatVolume(o)} · {formatDateTime(o.scheduledDate)} ·{' '}
                  {o.address || 'адрес не указан'}
                </div>
                {o.cleaners && o.cleaners.length > 0 && (
                  <div className="mt-1 text-xs text-navy-600">
                    Команда: {o.cleaners.map((c) => c.fullName).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Модалки ── */}
      {dutyPerson && (
        <DutiesModal person={dutyPerson} onClose={() => setDutyPerson(null)} />
      )}
      {editCleaner && (
        <CleanerModal
          cleaner={editCleaner}
          brigades={brigades ?? []}
          onClose={() => setEditCleaner(null)}
          onSubmit={(payload) => upsertCleaner(payload, editCleaner)}
        />
      )}
      {addToBrigade !== null && (
        <CleanerModal
          brigades={brigades ?? []}
          initialBrigadeId={addToBrigade === 'open' ? undefined : addToBrigade}
          onClose={() => setAddToBrigade(null)}
          onSubmit={(payload) => upsertCleaner(payload)}
        />
      )}
      {brigadeDrill && (
        <BrigadeCostModal
          brigade={brigadeDrill.brigade}
          members={brigadeDrill.members}
          showRates={showRates}
          onPick={(c) => {
            setBrigadeDrill(null);
            setEditCleaner(c);
          }}
          onClose={() => setBrigadeDrill(null)}
        />
      )}
    </div>
  );
}

/**
 * Состав бригады со ставками и стоимостью её выезда. На самой карточке ставки
 * тоже видны, но сумму «сколько стоит смена этой бригады» никто не считает
 * глазами — а именно она нужна, когда прикидываешь себестоимость заказа.
 *
 * Без доступа к финансам окно остаётся полезным: показывает состав и роли,
 * но без единой суммы — ставок в данных просто нет.
 */
function BrigadeCostModal({
  brigade,
  members,
  showRates,
  onPick,
  onClose,
}: {
  brigade: Brigade;
  members: Cleaner[];
  showRates: boolean;
  onPick: (cleaner: Cleaner) => void;
  onClose: () => void;
}) {
  const total = members.reduce((s, c) => s + (c.rate ?? 0), 0);

  return (
    <DetailModal
      title={brigade.name}
      subtitle={`Бригадир: ${brigade.leader?.fullName ?? 'не назначен'}`}
      onClose={onClose}
    >
      <DetailStats
        items={[
          { label: 'В бригаде', value: `${members.length} чел.` },
          ...(showRates
            ? [
                {
                  label: 'Смена бригады',
                  value: `${total} сомони`,
                  tone: 'success' as const,
                },
                {
                  label: 'Средняя ставка',
                  value: members.length
                    ? `${Math.round(total / members.length)} сомони`
                    : '—',
                },
              ]
            : []),
        ]}
      />

      <DetailTable
        rows={members}
        rowKey={(c) => c.id}
        onRowClick={onPick}
        emptyText="В бригаде нет активных клинеров"
        columns={[
          {
            key: 'name',
            header: 'Клинер',
            cell: (c) => (
              <div>
                <div className="font-medium text-navy-900">{c.fullName}</div>
                <div className="text-xs text-navy-600">
                  {c.phone ? formatPhone(c.phone) : 'телефон не указан'}
                </div>
              </div>
            ),
          },
          {
            key: 'role',
            header: 'Роль',
            cell: (c) =>
              c.id === brigade.leaderId ? (
                <Badge className="bg-amber-100 text-amber-700">Бригадир</Badge>
              ) : (
                <span className="text-navy-600">Клинер</span>
              ),
          },
          ...(showRates
            ? [
                {
                  key: 'rate',
                  header: 'Ставка',
                  align: 'right' as const,
                  cell: (c: Cleaner) => (
                    <span className="font-bold text-navy-900">{c.rate} с</span>
                  ),
                },
              ]
            : []),
        ]}
        footer={
          showRates && members.length > 0 ? (
            <tr className="border-t border-navy-100 font-bold text-navy-900">
              <td className="px-3 py-2" colSpan={2}>
                Стоимость одной смены бригады
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{total} с</td>
            </tr>
          ) : undefined
        }
      />

      <p className="mt-3 text-xs text-navy-600">
        {showRates
          ? 'Нажмите на клинера, чтобы изменить его ставку или бригаду.'
          : 'Нажмите на клинера, чтобы изменить его данные или бригаду.'}
      </p>
    </DetailModal>
  );
}

/** Карточка сотрудника: должность + обязанности */
function StaffCard({
  person,
  canOpenProfile,
  onDuties,
}: {
  person: Manager;
  canOpenProfile: boolean;
  onDuties: () => void;
}) {
  const navigate = useNavigate();
  const isDirector = person.role === 'DIRECTOR';
  /*
   * min-w-0 обязателен: карточка — элемент сетки, а у него min-width: auto.
   * Длинная должность с truncate (nowrap) задавала минимальную ширину колонки,
   * сетка вырастала шире экрана телефона и уводила всю страницу влево.
   */
  return (
    <div className="card flex min-w-0 flex-col p-5">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg font-bold ${
            isDirector ? 'bg-brand-500 text-white' : 'bg-navy-100 text-navy-700'
          }`}
        >
          {person.fullName[0]}
        </span>
        <div className="min-w-0 flex-1">
          <div
            /*
              Нажимается только имя, а не вся карточка: рядом лежит кнопка
              «Обязанности», и подъём всего бокса обещал бы переход по клику
              в любом его месте. Отклик на нажатие вешаем на сам click-target.
            */
            className={`truncate font-bold text-navy-900 ${
              canOpenProfile ? 'press cursor-pointer hover:text-navy-600' : ''
            }`}
            onClick={
              canOpenProfile ? () => navigate(`/profile/${person.id}`) : undefined
            }
          >
            {person.fullName}
          </div>
          <div className="truncate text-xs text-navy-600">
            {person.position || (isDirector ? 'Руководитель' : 'Менеджер')}
          </div>
        </div>
      </div>
      {(person.duties || person.mainTask) && (
        <button
          onClick={onDuties}
          className="press mt-3 inline-flex items-center justify-center gap-1.5 rounded-xl border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-600 transition hover:bg-navy-50"
        >
          <BadgeCheck className="h-3.5 w-3.5" />
          Обязанности
        </button>
      )}
    </div>
  );
}

/** Модалка «Должностные обязанности» */
function DutiesModal({
  person,
  onClose,
}: {
  person: {
    name: string;
    position?: string | null;
    duties?: string | null;
    mainTask?: string | null;
  };
  onClose: () => void;
}) {
  const lines = (person.duties ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  // «Основная задача: …» может храниться последней строкой обязанностей
  const inlineTask = lines.find((l) => l.startsWith('Основная задача:'));
  const duties = lines.filter((l) => !l.startsWith('Основная задача:'));
  const mainTask =
    person.mainTask || (inlineTask ? inlineTask.replace('Основная задача:', '').trim() : null);

  return (
    <Modal open onClose={onClose} title={person.name}>
      {person.position && (
        <div className="mb-4 text-sm font-semibold text-navy-600">
          {person.position}
        </div>
      )}
      {duties.length > 0 && (
        <>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-600">
            Отвечает за
          </div>
          <ul className="space-y-1.5">
            {duties.map((d) => (
              <li key={d} className="flex items-start gap-2 text-sm text-navy-800">
                <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-navy-600" />
                {d}
              </li>
            ))}
          </ul>
        </>
      )}
      {mainTask && (
        <div className="mt-4 rounded-xl bg-navy-50 p-3.5">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-navy-600">
            <Target className="h-3.5 w-3.5" />
            Основная задача
          </div>
          <div className="text-sm font-medium text-navy-900">{mainTask}</div>
        </div>
      )}
      {duties.length === 0 && !mainTask && (
        <EmptyState text="Обязанности не заполнены" />
      )}
    </Modal>
  );
}

/** Создание/редактирование клинера (имя, телефон, ставка, бригада) */
function CleanerModal({
  cleaner,
  brigades,
  initialBrigadeId,
  onClose,
  onSubmit,
}: {
  cleaner?: Cleaner;
  brigades: Brigade[];
  initialBrigadeId?: string;
  onClose: () => void;
  onSubmit: (payload: {
    fullName: string;
    phone: string | null;
    rate?: number;
    brigadeId: string | null;
  }) => void;
}) {
  const toast = useToast();
  const { user } = useAuth();
  /*
   * Ставка — зарплата клинера: её видит и меняет только руководитель, сервер
   * вырезает её из ответа остальным. Поле обязано быть скрыто и здесь: иначе
   * менеджер открыл бы карточку с пустой ставкой, форма подставила бы 230 и
   * запрос ушёл бы с чужой зарплатой — сервер ответил бы 403, а на вид
   * «сохранение просто не работает».
   */
  const canEditRate = userSeesFinance(user);
  const [fullName, setFullName] = useState(cleaner?.fullName ?? '');
  const [phone, setPhone] = useState(cleaner?.phone ?? '');
  const [rate, setRate] = useState(String(cleaner?.rate ?? 230));
  const [brigadeId, setBrigadeId] = useState(
    cleaner?.brigadeId ?? initialBrigadeId ?? '',
  );

  // оптимистично: применяем изменения и закрываем модалку сразу, запрос — в фоне
  const submit = () => {
    onSubmit({
      fullName: fullName.trim(),
      phone: phone.trim() || null, // null очищает телефон (undefined бы игнорировался)
      // пустое поле или нет доступа к ставкам — ставку не трогаем
      rate: canEditRate && rate ? Number(rate) : undefined,
      brigadeId: brigadeId || null,
    });
    toast.success(cleaner ? 'Сохранено' : 'Клинер добавлен');
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={cleaner ? 'Редактирование клинера' : 'Новый клинер'}
    >
      <div className="space-y-3">
        <div>
          <label className="label">ФИО *</label>
          <input
            className="input"
            value={fullName}
            onChange={(e) => setFullName(sanitizePersonName(e.target.value))}
          />
        </div>
        <PhoneInput value={phone} onChange={setPhone} />
        {/* на телефоне два поля в ряд не влезают — подпись ломалась в три строки */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {canEditRate && (
            <div>
              <label className="label">Ставка, сомони/смена</label>
              <input
                type="text"
                inputMode="numeric"
                className="input"
                value={rate}
                onChange={(e) =>
                  setRate(e.target.value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, ''))
                }
                placeholder="230"
              />
            </div>
          )}
          <div>
            <label className="label">Бригада</label>
            <select
              className="input"
              value={brigadeId}
              onChange={(e) => setBrigadeId(e.target.value)}
            >
              <option value="">Без бригады</option>
              {brigades.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={!fullName.trim()}
            className="btn-primary"
          >
            {cleaner ? 'Сохранить' : 'Добавить'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
