import { useMemo, useRef, useState } from 'react';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../api/client';
import { useFetch } from '../api/hooks';
import { useToast } from '../components/Toast';
import { useDialog } from '../components/Dialog';
import { Spinner, PageHeader, Badge, ErrorState } from '../components/ui';
import { OrderModal } from '../components/OrderModal';
import { useAuth } from '../auth/AuthContext';
import {
  STAGE_COLOR,
  STAGE_LABEL,
  STAGE_ORDER,
  TYPE_LABEL,
  formatPrice,
  formatVolume,
} from '../lib/labels';
import { userSeesAll } from '../types';
import type { BoardColumn, FunnelStage, Order } from '../types';

// основной конвейер этапов (без «Отказа» — он отдельной кнопкой на мобильном)
const PIPELINE: FunnelStage[] = STAGE_ORDER.filter((s) => s !== 'REJECTED');

/** Короткая дата для карточки: «27 июл» */
function cardDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
  });
}

const NO_MANAGER = '__none__';

// Тело карточки заказа. Вынесено на уровень модуля (а не внутрь Funnel),
// чтобы при поллинге/оптимистичных обновлениях карточки НЕ пересоздавались
// (иначе новая ссылка на компонент → полный ремоунт всех карточек и рывок).
function OrderCardBody({
  o,
  isTouch,
  onChange,
}: {
  o: Order;
  isTouch: boolean;
  onChange: (orderId: string, newStage: FunnelStage) => void;
}) {
  const idx = PIPELINE.indexOf(o.stage);
  const prevStage = idx > 0 ? PIPELINE[idx - 1] : null;
  const nextStage =
    idx >= 0 && idx < PIPELINE.length - 1 ? PIPELINE[idx + 1] : null;
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-navy-900">{o.client?.fullName}</div>
        {o.isLarge && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
            КРУПНЫЙ
          </span>
        )}
      </div>
      <div className="mt-1 text-xs text-navy-400">
        {TYPE_LABEL[o.cleaningType]} · {formatVolume(o)}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-bold text-navy-700">
          {formatPrice(o.finalPrice ?? o.estimatedPrice)}
        </span>
        {o.cleaners && o.cleaners.length > 0 && (
          <span className="text-xs text-navy-400">👥 {o.cleaners.length}</span>
        )}
      </div>

      {/* Менеджер и дата заявки */}
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-navy-100 pt-1.5 text-[11px] text-navy-400">
        <span className="truncate">
          {o.manager?.fullName ?? 'без менеджера'}
        </span>
        <span className="shrink-0">{cardDate(o.createdAt)}</span>
      </div>

      {/* Мобильные контролы смены этапа — только на тач-устройствах */}
      {isTouch && (
        <div
          className="mt-3 border-t border-navy-100 pt-2"
          onClick={(e) => e.stopPropagation()}
        >
          {o.stage === 'REJECTED' ? (
            <button
              onClick={() => onChange(o.id, 'NEW')}
              className="flex w-full items-center justify-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-navy-600 hover:bg-navy-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Вернуть в работу
            </button>
          ) : (
            <div className="flex items-center justify-between gap-1">
              <button
                onClick={() => prevStage && onChange(o.id, prevStage)}
                disabled={!prevStage}
                className="flex items-center gap-0.5 rounded-lg px-1.5 py-1 text-xs font-medium text-navy-600 hover:bg-navy-50 disabled:opacity-30"
                title={prevStage ? STAGE_LABEL[prevStage] : ''}
              >
                <ChevronLeft className="h-4 w-4" />
                Назад
              </button>
              <button
                onClick={() => onChange(o.id, 'REJECTED')}
                className="rounded-lg px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
              >
                Отказ
              </button>
              <button
                onClick={() => nextStage && onChange(o.id, nextStage)}
                disabled={!nextStage}
                className="flex items-center gap-0.5 rounded-lg px-1.5 py-1 text-xs font-medium text-navy-600 hover:bg-navy-50 disabled:opacity-30"
                title={nextStage ? STAGE_LABEL[nextStage] : ''}
              >
                Далее
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function Funnel() {
  const toast = useToast();
  const dialog = useDialog();
  const { user } = useAuth();
  // фильтр по менеджеру — только для тех, кто видит всю компанию
  const canFilter = userSeesAll(user);
  const [managerFilter, setManagerFilter] = useState<string>('ALL');
  // на тач-устройствах (телефон/планшет) перетаскивание неудобно —
  // отключаем drag и показываем стрелки для смены этапа
  const isTouch = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(pointer: coarse)').matches,
    [],
  );

  // счётчик незавершённых операций смены этапа + флаг перетаскивания —
  // пока они активны, авто-обновление доски на паузе (иначе карточка
  // «доезжает и сбрасывается», когда поллинг подтянет старое состояние)
  const draggingRef = useRef(false);
  const inFlightRef = useRef(0);

  const { data, loading, error, reload, setData } = useFetch<BoardColumn[]>(
    '/orders/board',
    {
      pollMs: 10000,
      pollPaused: () => draggingRef.current || inFlightRef.current > 0,
    },
  );
  const [openOrder, setOpenOrder] = useState<Order | null>(null);

  // Оптимистичное перемещение карточки между этапами (до ответа сервера)
  const applyPatch = (orderId: string, patch: Partial<Order>) => {
    setData((cols) => {
      if (!cols) return cols;
      let moved: Order | undefined;
      const without = cols.map((c) => ({
        ...c,
        orders: c.orders.filter((o) => {
          if (o.id === orderId) {
            moved = { ...o, ...patch };
            return false;
          }
          return true;
        }),
      }));
      if (!moved) return cols;
      const target = patch.stage ?? moved.stage;
      return without.map((c) =>
        c.stage === target ? { ...c, orders: [moved as Order, ...c.orders] } : c,
      );
    });
  };

  /**
   * Смена этапа заказа — общая логика для drag (ПК) и стрелок (мобильный).
   * Оптимистично: карточка переезжает мгновенно, запрос уходит в фон,
   * доску не перезапрашиваем; откат только при ошибке.
   */
  const changeStage = async (orderId: string, newStage: FunnelStage) => {
    let rejectionReason: string | undefined;
    if (newStage === 'REJECTED') {
      const reason = await dialog.prompt({
        title: 'Причина отказа',
        message: 'Укажите, почему клиент отказался.',
        placeholder: 'Например: дорого, выбрали другую компанию',
        confirmText: 'Сохранить',
      });
      if (!reason) return; // отмена — не двигаем
      rejectionReason = reason;
    }

    applyPatch(orderId, { stage: newStage, rejectionReason });
    inFlightRef.current += 1;
    try {
      await api.patch(`/orders/${orderId}/stage`, {
        stage: newStage,
        rejectionReason,
      });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось сменить этап');
      reload(); // вернуть серверное состояние
    } finally {
      inFlightRef.current -= 1;
    }
  };

  const onDragStart = () => {
    draggingRef.current = true;
  };

  const onDragEnd = (result: DropResult) => {
    // клик после отпускания приходит раньше таймера и будет подавлен
    setTimeout(() => {
      draggingRef.current = false;
    }, 0);
    const { source, destination, draggableId } = result;
    if (!destination || source.droppableId === destination.droppableId) return;
    void changeStage(draggableId, destination.droppableId as FunnelStage);
  };

  if (!data) {
    if (error && !loading) return <ErrorState onRetry={reload} />;
    return <Spinner />;
  }

  // менеджеры, у которых есть заказы (для выпадающего фильтра)
  const managerOptions = (() => {
    const map = new Map<string, string>();
    let hasNone = false;
    for (const col of data) {
      for (const o of col.orders) {
        if (o.manager) map.set(o.manager.id, o.manager.fullName);
        else hasNone = true;
      }
    }
    const list = [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    return { list, hasNone };
  })();

  // доска с учётом фильтра по менеджеру
  const board =
    !canFilter || managerFilter === 'ALL'
      ? data
      : data.map((col) => ({
          ...col,
          orders: col.orders.filter((o) =>
            managerFilter === NO_MANAGER
              ? !o.manager
              : o.manager?.id === managerFilter,
          ),
        }));

  return (
    <div>
      <PageHeader
        title="Воронка продаж"
        subtitle={
          isTouch
            ? 'Меняйте этап стрелками или нажмите карточку для деталей'
            : 'Перетаскивайте карточки между этапами или нажмите для деталей'
        }
      />

      {canFilter && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-navy-400">Менеджер:</span>
          <select
            className="input max-w-[240px]"
            value={managerFilter}
            onChange={(e) => setManagerFilter(e.target.value)}
          >
            <option value="ALL">Все менеджеры</option>
            {managerOptions.list.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
            {managerOptions.hasNone && (
              <option value={NO_MANAGER}>Без менеджера</option>
            )}
          </select>
          {managerFilter !== 'ALL' && (
            <button
              onClick={() => setManagerFilter('ALL')}
              className="text-xs font-medium text-navy-400 underline-offset-2 hover:text-navy-600 hover:underline"
            >
              Сбросить
            </button>
          )}
        </div>
      )}

      <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {board.map((col) => (
            <div key={col.stage} className="flex w-72 shrink-0 flex-col">
              <div className="mb-3 flex items-center justify-between">
                <Badge className={STAGE_COLOR[col.stage]}>{col.label}</Badge>
                <span className="text-sm font-bold text-navy-400">
                  {col.orders.length}
                </span>
              </div>

              <Droppable droppableId={col.stage} isDropDisabled={isTouch}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`flex-1 space-y-2.5 rounded-2xl p-1 transition-colors ${
                      snapshot.isDraggingOver ? 'bg-navy-100/60' : ''
                    }`}
                  >
                    {col.orders.map((o, index) => (
                      <Draggable
                        key={o.id}
                        draggableId={o.id}
                        index={index}
                        isDragDisabled={isTouch}
                      >
                        {(p, snap) => (
                          <div
                            ref={p.innerRef}
                            {...p.draggableProps}
                            {...p.dragHandleProps}
                            onClick={() => {
                              // это был драг, а не клик — модалку не открываем
                              if (draggingRef.current) return;
                              setOpenOrder(o);
                            }}
                            className={`card cursor-pointer p-3.5 text-left transition-shadow hover:shadow-lg ${
                              snap.isDragging ? 'shadow-xl ring-2 ring-navy-300' : ''
                            }`}
                          >
                            <OrderCardBody
                              o={o}
                              isTouch={isTouch}
                              onChange={changeStage}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {col.orders.length === 0 && !snapshot.isDraggingOver && (
                      <div className="rounded-xl border border-dashed border-navy-200 py-6 text-center text-xs text-navy-300">
                        {isTouch ? 'Нет заказов' : 'Перетащите сюда'}
                      </div>
                    )}
                  </div>
                )}
              </Droppable>
            </div>
          ))}
        </div>
      </DragDropContext>

      <OrderModal
        orderId={openOrder?.id ?? null}
        initial={openOrder ?? undefined}
        onClose={() => setOpenOrder(null)}
        onUpdated={reload}
        onOptimistic={applyPatch}
        onDeleted={(oid) =>
          setData((cols) =>
            cols
              ? cols.map((c) => ({
                  ...c,
                  orders: c.orders.filter((o) => o.id !== oid),
                }))
              : cols,
          )
        }
      />
    </div>
  );
}
