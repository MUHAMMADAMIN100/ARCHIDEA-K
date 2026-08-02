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
    /*
     * Опрос каждые 10 секунд плюс обновление при возврате на вкладку.
     * Раньше интервал был 30 секунд, и уведомление о новой заявке появлялось
     * с заметной задержкой — человек уже видел её в воронке, а колокольчик
     * ещё молчал.
     */
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 10000);
    const onFocus = () => {
      if (!document.hidden) load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
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
       * экрана телефона — заголовок и текст обрезались.
       *
       * Причина была в привязке: панель прижималась к правому краю самого
       * колокольчика, а справа от него ещё аватар с меню. На узком экране
       * её левый край уходил за границу на 74 пикселя, и первые буквы
       * срезались. На телефоне панель больше не привязана к кнопке — она
       * растянута между краями экрана с отступом; с sm: и выше остаётся
       * прежнее выпадающее меню под колокольчиком.
       */}
      {open && (
        <div className="fixed left-3 right-3 top-[4.5rem] z-50 max-h-[70vh] overflow-y-auto overscroll-contain rounded-2xl border border-navy-100 bg-white p-2 shadow-card sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[20rem]">
          <div className="px-3 py-2 text-sm font-bold text-navy-900">
            Уведомления
          </div>
          {items.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-navy-600">
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
                <div className="mt-0.5 text-xs text-navy-600">
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
