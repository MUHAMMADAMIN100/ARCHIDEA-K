import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useFetch } from '../api/hooks';
import { Badge, EmptyState, ErrorState, SkeletonList } from './ui';
import { formatDateTimeTz } from '../lib/date';
import {
  AUDIT_ACTION_COLOR,
  AUDIT_ACTION_LABEL,
  AUDIT_ENTITY_LABEL,
  auditFieldLabel,
  formatAuditValue,
} from '../lib/labels';
import type { AuditEntry, AuditPage } from '../types';

/**
 * Куда идти за историей конкретного объекта. У каждой сущности своя проверка
 * доступа на бэкенде (например, менеджер видит историю только СВОИХ заказов),
 * поэтому используем выделенные ручки контроллеров, а не общую /audit —
 * общая лента (страница «История») доступна только руководству и уронила бы
 * панель в карточке заказа для обычного менеджера.
 *
 * SERVICE — особый случай: контроллер тарифов принимает не id, а ключ услуги
 * (`Tariff.key`), поэтому вызывающая сторона должна передать в entityId именно
 * ключ, а не cuid.
 */
const ENTITY_HISTORY_URL: Record<string, (id: string) => string> = {
  ORDER: (id) => `/orders/${id}/history`,
  CLIENT: (id) => `/clients/${id}/history`,
  USER: (id) => `/users/${id}/history`,
  // особый режим: не история объекта «сотрудник», а список ЕГО действий в CRM
  USER_ACTIVITY: (id) => `/users/${id}/activity`,
  SERVICE: (id) => `/tariffs/${id}/history`,
  SHIFT_GROUP: (id) => `/shift-groups/${id}/history`,
};

function resolveUrl(entity: string, entityId: string): string {
  const build = ENTITY_HISTORY_URL[entity];
  if (build) return build(entityId);
  // для сущностей без выделенной ручки — общая лента с фильтром
  // (доступна только руководству, см. AuditController)
  const q = new URLSearchParams({ entity, entityId, limit: '100' });
  return `/audit?${q.toString()}`;
}

/**
 * Одна запись журнала: кто, когда, что за действие, краткое описание и
 * раскрываемый список изменённых полей.
 */
export function AuditEntryRow({
  entry,
  showEntity = false,
  compact = false,
}: {
  entry: AuditEntry;
  /** Показывать тип и название объекта — нужно в общей ленте, но не в карточке */
  showEntity?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasChanges = !!entry.changes?.length;

  return (
    <div
      className={`rounded-xl border border-navy-100 ${compact ? 'p-2.5' : 'p-3'}`}
    >
      <div
        className={`flex flex-wrap items-center gap-2 ${
          hasChanges ? 'press cursor-pointer select-none' : ''
        }`}
        onClick={hasChanges ? () => setOpen((v) => !v) : undefined}
      >
        {hasChanges ? (
          open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-navy-600" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-navy-600" />
          )
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}
        <Badge className={AUDIT_ACTION_COLOR[entry.action]}>
          {AUDIT_ACTION_LABEL[entry.action]}
        </Badge>
        {showEntity && (
          <Badge className="border-navy-200 bg-navy-50 text-navy-600">
            {AUDIT_ENTITY_LABEL[entry.entity] ?? entry.entity}
          </Badge>
        )}
        <span className="text-sm font-medium text-navy-800">
          {entry.actorName}
        </span>
        <span className="text-xs text-navy-600">
          {formatDateTimeTz(entry.createdAt)}
        </span>
      </div>

      {showEntity && (
        <div className="mt-1 text-sm text-navy-700">{entry.entityTitle}</div>
      )}
      {entry.summary && (
        <div className="mt-1 text-sm text-navy-600">{entry.summary}</div>
      )}

      {hasChanges && open && (
        // раскрытые поля проявляются целым блоком: построчная анимация на
        // длинной истории превращается в мельтешение
        <ul className="mt-2 animate-fade-in space-y-1 border-t border-navy-50 pt-2 text-sm">
          {entry.changes!.map((c, i) => (
            <li key={i} className="text-navy-600">
              <span className="font-medium text-navy-800">
                {auditFieldLabel(c.field)}:
              </span>{' '}
              {formatAuditValue(c.before)} → {formatAuditValue(c.after)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Переиспользуемая лента истории для карточек (заказ, клиент, сотрудник,
 * услуга, выезд): «Показать ещё» тут не нужен — короткая история последних
 * изменений, полную ленту смотрят на странице «История».
 */
export function HistoryPanel({
  entity,
  entityId,
  limit = 20,
  compact = false,
}: {
  entity: string;
  entityId: string;
  limit?: number;
  compact?: boolean;
}) {
  const url = entityId ? resolveUrl(entity, entityId) : null;
  const { data, loading, error, reload } = useFetch<AuditEntry[] | AuditPage>(
    url,
  );

  // ручки истории объекта отдают массив, общая /audit — { items, nextCursor }
  const entries = useMemo(() => {
    const raw = Array.isArray(data) ? data : data?.items ?? [];
    return raw.slice(0, limit);
  }, [data, limit]);

  if (error) {
    return <ErrorState text={error} onRetry={reload} />;
  }
  if (loading && !data) {
    return compact ? (
      <div className="py-3 text-center text-xs text-navy-600">
        Загрузка истории…
      </div>
    ) : (
      <SkeletonList rows={4} />
    );
  }
  if (entries.length === 0) {
    return (
      <EmptyState text="Изменений пока нет — здесь появится история после первой правки" />
    );
  }

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {entries.map((entry) => (
        <AuditEntryRow key={entry.id} entry={entry} compact={compact} />
      ))}
    </div>
  );
}
