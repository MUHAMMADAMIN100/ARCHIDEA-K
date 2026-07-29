import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, ErrorState, Spinner, EmptyState } from '../components/ui';
import { PeriodFilter, Period, SearchInput, UserPicker } from '../components/common';
import { AuditEntryRow } from '../components/HistoryPanel';
import { AUDIT_ACTION_LABEL, AUDIT_ENTITY_LABEL } from '../lib/labels';
import { useToast } from '../components/Toast';
import type { AuditAction, AuditEntry, AuditPage } from '../types';

const ACTIONS = Object.keys(AUDIT_ACTION_LABEL) as AuditAction[];

/**
 * Общая лента журнала изменений (ТЗ 2). Доступ проверяется на бэкенде
 * (@RequirePermissions('audit:view') — директор и ops-менеджер); здесь мы
 * просто показываем понятное сообщение, если сервер вернул 403, вместо
 * пустого экрана или бесконечного спиннера.
 *
 * Пагинация курсорная («Показать ещё»), а не бесконечная прокрутка — так
 * пользователь всегда видит, сколько уже загружено, и список предсказуемо
 * не «прыгает» при повторном заходе.
 */
export function History() {
  const toast = useToast();
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>({ from: '', to: '' });

  const [items, setItems] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const buildQuery = (afterCursor?: string | null) => {
    const q = new URLSearchParams();
    if (entity) q.set('entity', entity);
    if (action) q.set('action', action);
    if (actorId) q.set('actorId', actorId);
    if (search.trim()) q.set('search', search.trim());
    if (period.from) q.set('from', period.from);
    if (period.to) q.set('to', period.to);
    if (afterCursor) q.set('cursor', afterCursor);
    return q.toString();
  };

  // при смене любого фильтра — заново с первой страницы
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setForbidden(null);
    api
      .get<AuditPage>(`/audit?${buildQuery()}`)
      .then((res) => {
        if (cancelled) return;
        setItems(res.data.items);
        setCursor(res.data.nextCursor);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setItems([]);
        setCursor(null);
        if (e?.response?.status === 403) {
          setForbidden(
            e?.response?.data?.message || 'Журнал изменений доступен руководству',
          );
        } else {
          setError(
            e?.response?.data?.message || 'Не удалось загрузить журнал изменений',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, action, actorId, search, period.from, period.to, reloadTick]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await api.get<AuditPage>(`/audit?${buildQuery(cursor)}`);
      setItems((prev) => [...prev, ...res.data.items]);
      setCursor(res.data.nextCursor);
    } catch (e: any) {
      toast.error(
        e?.response?.data?.message || 'Не удалось загрузить продолжение ленты',
      );
    } finally {
      setLoadingMore(false);
    }
  };

  if (forbidden) {
    return (
      <div>
        <PageHeader title="Журнал изменений" />
        <ErrorState text={forbidden} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Журнал изменений"
        subtitle="Кто и что менял в CRM: заказы, клиенты, сотрудники, тарифы, финансы"
      />

      <div className="card mb-4 space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="input max-w-[200px]"
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
          >
            <option value="">Все объекты</option>
            {Object.entries(AUDIT_ENTITY_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="input max-w-[200px]"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            <option value="">Все действия</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {AUDIT_ACTION_LABEL[a]}
              </option>
            ))}
          </select>
          <div className="min-w-[200px] max-w-[260px] flex-1">
            {/* Список сотрудников (только активные — так же, как везде в CRM,
                где выбирают исполнителя); уволенных сотрудников можно найти
                поиском по имени ниже. */}
            <UserPicker
              value={actorId || null}
              onChange={(id) => setActorId(id ?? '')}
              placeholder="Все сотрудники"
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Поиск по объекту, описанию, сотруднику"
            />
          </div>
        </div>
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>

      {error && items.length === 0 ? (
        <ErrorState text={error} onRetry={() => setReloadTick((t) => t + 1)} />
      ) : loading && items.length === 0 ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState text="По заданным фильтрам изменений не найдено. Проверьте период и фильтры выше." />
      ) : (
        <div className="space-y-2">
          {items.map((entry) => (
            <AuditEntryRow key={entry.id} entry={entry} showEntity />
          ))}
          {cursor && (
            <div className="pt-2 text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="btn-ghost"
              >
                {loadingMore ? 'Загрузка…' : 'Показать ещё'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
