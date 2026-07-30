import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { api } from '../api/client';
import type { NotificationItem } from '../types';
import { formatDateTime, notificationTarget } from '../lib/labels';

export function NotificationsBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const [list, count] = await Promise.all([
        api.get<NotificationItem[]>('/notifications'),
        api.get<{ count: number }>('/notifications/unread-count'),
      ]);
      setItems(list.data);
      setUnread(count.data.count);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    load();
    // опрос каждые 30 сек, но не когда вкладка скрыта (экономим запросы)
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const openAndRead = () => {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && unread > 0) {
      // оптимистично гасим счётчик и помечаем прочитанными, запрос в фоне
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
      api.patch('/notifications/read-all').catch(() => {});
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={openAndRead}
        className="relative rounded-xl border border-navy-200 bg-white p-2.5 text-navy-600 hover:bg-navy-50"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/*
       * Ширина 320 px с привязкой к правому краю вылезала за левую границу
       * экрана телефона — заголовок и текст обрезались. Считаем ширину от
       * экрана и не даём быть шире 320 px.
       */}
      {open && (
        <div className="absolute right-0 z-50 mt-2 max-h-[70vh] w-[calc(100vw-1.5rem)] max-w-[20rem] overflow-y-auto overscroll-contain rounded-2xl border border-navy-100 bg-white p-2 shadow-card">
          <div className="px-3 py-2 text-sm font-bold text-navy-900">
            Уведомления
          </div>
          {items.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-navy-400">
              Уведомлений нет
            </div>
          )}
          {items.map((n) => {
            const target = notificationTarget(n);
            return (
              <button
                key={n.id}
                type="button"
                disabled={!target}
                onClick={() => {
                  if (!target) return;
                  setOpen(false);
                  navigate(target);
                }}
                className={`block w-full rounded-xl px-3 py-2.5 text-left ${
                  target ? 'cursor-pointer hover:bg-navy-50' : 'cursor-default'
                }`}
              >
                <div className="text-sm font-semibold text-navy-800">
                  {n.title}
                </div>
                <div className="text-sm text-navy-600">{n.message}</div>
                <div className="mt-0.5 text-xs text-navy-400">
                  {formatDateTime(n.createdAt)}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
