import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { api } from '../api/client';
import { ScrollArea } from './ScrollArea';
import type { NotificationItem } from '../types';
import { formatDateTime, notificationTarget } from '../lib/labels';

export function NotificationsBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

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
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return; // клик по самой панели
      if (ref.current && !ref.current.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  /*
   * Панель рисуется через портал в body, а положение считается вручную.
   *
   * Раньше это был обычный выпадающий блок внутри шапки. Шапка размыта
   * (backdrop-blur), а значит образует собственный слой: z-index панели
   * считался ВНУТРИ неё и не мог перебить закреплённую колонку воронки —
   * уведомления уходили под карточки должников. В портале перекрыть панель
   * нечем: она вне всех слоёв страницы.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bell = ref.current?.getBoundingClientRect();
      if (!bell) return;
      const edge = 12;
      const gap = 8;
      const vw = window.innerWidth;
      const wide = vw >= 640;
      const width = wide ? 320 : vw - edge * 2;
      // на широком экране прижимаем правый край панели к правому краю кнопки
      const left = wide
        ? Math.max(edge, Math.min(bell.right - width, vw - width - edge))
        : edge;
      setPos({ top: bell.bottom + gap, left, width });
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

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
        className="press relative rounded-xl border border-navy-200 bg-white p-2.5 text-navy-600 hover:bg-navy-50"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={popRef}
            style={{
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              width: pos?.width,
              // до первого замера не показываем — иначе кадр мигает в углу
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="fixed z-[70] animate-drop-in rounded-2xl border border-navy-100 bg-white p-2 shadow-pop"
          >
          <ScrollArea
            axis="y"
            innerClassName="max-h-[70vh] overscroll-contain"
            label="Уведомления"
          >
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
                  target ? 'press cursor-pointer hover:bg-navy-50' : 'cursor-default'
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
          </ScrollArea>
          </div>,
          document.body,
        )}
    </div>
  );
}
