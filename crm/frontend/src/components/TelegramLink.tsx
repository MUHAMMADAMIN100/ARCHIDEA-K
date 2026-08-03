import { useEffect, useRef, useState } from 'react';
import { Check, Copy, RefreshCw, Send } from 'lucide-react';
import { api } from '../api/client';
import { useFetch } from '../api/hooks';
import { useToast } from './Toast';

interface Status {
  linked: boolean;
  chatId: string | null;
  name: string | null;
  enabled: boolean;
}

interface LinkResponse {
  ok: boolean;
  message?: string;
  bot?: string;
  code?: string;
  deepLink?: string;
  url?: string;
}

interface LinkData {
  bot: string;
  code: string;
  deepLink: string;
  url: string;
}

/**
 * Разбор ответа старого сервера: до этой правки он отдавал только ссылку
 * t.me. Фронтенд и сервер выкатываются по отдельности, и несколько минут
 * после сборки новая страница может разговаривать со старым сервером —
 * тогда имя бота и код достаём из самой ссылки.
 */
function parseLink(res: LinkResponse): LinkData | null {
  if (res.bot && res.code) {
    return {
      bot: res.bot,
      code: res.code,
      deepLink: res.deepLink || `tg://resolve?domain=${res.bot}&start=${res.code}`,
      url: res.url || `https://t.me/${res.bot}?start=${res.code}`,
    };
  }
  const m = res.url?.match(/t\.me\/([A-Za-z0-9_]+)\?start=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  return {
    bot: m[1],
    code: m[2],
    deepLink: `tg://resolve?domain=${m[1]}&start=${m[2]}`,
    url: m[0].startsWith('http') ? m[0] : `https://${m[0]}`,
  };
}

/**
 * Подключение Telegram сотрудником самому себе.
 *
 * Раньше chat_id вносил руководитель руками — приходилось спрашивать его у
 * каждого. Теперь кнопка выдаёт одноразовый код: сотрудник открывает бота,
 * нажимает «Старт» — и привязка происходит сама.
 *
 * Почему не одна ссылка t.me, как было. У части провайдеров Таджикистана
 * домен t.me не разрешается в DNS: браузер открывал пустую вкладку с «Не
 * удаётся получить доступ к сайту», и подключиться было нельзя вообще.
 * Приложение Telegram при этом работает. Поэтому путей теперь три, от
 * быстрого к самому надёжному:
 *   tg://resolve — открывает установленную программу, сети не требует;
 *   код сообщением — работает, даже если ни одна ссылка не открылась;
 *   t.me — прежняя ссылка, оставлена для тех, у кого она открывается.
 *
 * Блок показывается только в СВОЁМ профиле: нажать «Старт» за другого
 * человека нельзя, а видеть чужой код незачем.
 */
export function TelegramLink() {
  const toast = useToast();
  const [link, setLink] = useState<LinkData | null>(null);
  // пока показан код — проверяем связь чаще: человек уходит в Telegram и
  // возвращается, и «Подключён» должно появиться само
  const { data, reload, setData } = useFetch<Status>('/telegram/status', {
    pollMs: link ? 4000 : undefined,
  });
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // подключение произошло в другом окне — говорим об этом вслух
  const wasLinked = useRef<boolean | null>(null);
  useEffect(() => {
    if (data?.linked && wasLinked.current === false) {
      toast.success('Telegram подключён');
      setLink(null);
    }
    if (data) wasLinked.current = data.linked;
    // toast и так стабилен, следить за ним не нужно
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.linked]);

  const connect = async () => {
    setBusy(true);
    try {
      const res = await api.post<LinkResponse>('/telegram/link');
      if (!res.data.ok) {
        toast.error(res.data.message || 'Не удалось получить код');
        return;
      }
      const parsed = parseLink(res.data);
      if (!parsed) {
        toast.error('Не удалось получить код');
        return;
      }
      setLink(parsed);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось получить код');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied((c) => (c === text ? null : c)), 2000);
    } catch {
      toast.error('Не удалось скопировать — выделите текст и скопируйте вручную');
    }
  };

  /** «Я отправил код» — проверяем привязку, не перезагружая страницу */
  const check = async () => {
    setChecking(true);
    try {
      const res = await api.get<Status>('/telegram/status');
      setData(res.data);
      if (res.data.linked) {
        setLink(null);
        toast.success('Telegram подключён');
      } else {
        toast.error('Пока не подключён. Отправьте боту код и проверьте ещё раз');
      }
    } catch {
      toast.error('Не удалось проверить. Попробуйте ещё раз');
    } finally {
      setChecking(false);
    }
  };

  const unlink = async () => {
    try {
      await api.delete('/telegram/link');
      setLink(null);
      reload();
      toast.success('Telegram отключён');
    } catch {
      toast.error('Не удалось отключить');
    }
  };

  if (data?.linked) {
    return (
      <div className="card mb-5 p-6">
        <Head />
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-800">
            <Send className="h-4 w-4" />
            Подключён{data.name ? ` — ${data.name}` : ''}
          </span>
          <button onClick={unlink} className="btn-ghost">
            Отключить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card mb-5 p-6">
      <Head />

      {!link ? (
        <button onClick={connect} disabled={busy} className="btn-primary">
          <Send className="h-4 w-4" />
          {busy ? 'Готовим код…' : 'Подключить Telegram'}
        </button>
      ) : (
        <div className="animate-fade-in space-y-4">
          <div className="flex flex-wrap gap-2">
            {/*
              Обычная ссылка, а не переход из скрипта: адрес tg:// открывает
              установленную программу, и браузер спрашивает разрешение только
              на настоящее нажатие. Страница при этом остаётся на месте —
              если программы нет, ничего не сломается, инструкция ниже
              никуда не денется.
            */}
            <a href={link.deepLink} className="btn-primary">
              <Send className="h-4 w-4" />
              Открыть Telegram
            </a>
            <button onClick={check} disabled={checking} className="btn-ghost">
              <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
              Я отправил код
            </button>
          </div>

          <div className="rounded-md border border-navy-200 bg-navy-50 p-4">
            <p className="mb-3 text-sm font-semibold text-navy-900">
              Если Telegram не открылся сам — подключите вручную:
            </p>
            <ol className="space-y-3 text-sm text-navy-700">
              <li className="flex gap-2">
                <Step n={1} />
                <span>Откройте приложение Telegram на телефоне или компьютере.</span>
              </li>
              <li className="flex gap-2">
                <Step n={2} />
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5">Найдите бота через поиск:</div>
                  <CopyRow
                    value={`@${link.bot}`}
                    copied={copied === `@${link.bot}`}
                    onCopy={copy}
                  />
                </div>
              </li>
              <li className="flex gap-2">
                <Step n={3} />
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5">Отправьте ему этот код одним сообщением:</div>
                  <CopyRow
                    value={link.code}
                    copied={copied === link.code}
                    onCopy={copy}
                    strong
                  />
                </div>
              </li>
            </ol>
          </div>

          <p className="text-xs text-navy-500">
            Код действует сутки и срабатывает один раз. Ссылка на бота —{' '}
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand-600 underline underline-offset-2"
            >
              t.me/{link.bot}
            </a>{' '}
            — открывается не у всех операторов, поэтому основной способ выше.
          </p>
        </div>
      )}
    </div>
  );
}

function Head() {
  return (
    <>
      <h3 className="mb-1 font-bold text-navy-900">Telegram</h3>
      <p className="mb-3 text-sm text-navy-600">
        Новые заявки, напоминания о звонках и изменения по заказам приходят в
        личный чат с ботом.
      </p>
    </>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white">
      {n}
    </span>
  );
}

/** Значение, которое нужно перенести в Telegram, — с кнопкой «скопировать» */
function CopyRow({
  value,
  copied,
  onCopy,
  strong,
}: {
  value: string;
  copied: boolean;
  onCopy: (v: string) => void;
  strong?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code
        className={`min-w-0 break-all rounded-md border border-navy-200 bg-white px-3 py-1.5 font-mono text-navy-900 ${
          strong ? 'text-base font-bold tracking-wide' : 'text-sm'
        }`}
      >
        {value}
      </code>
      <button
        type="button"
        onClick={() => onCopy(value)}
        className="btn-ghost h-9 px-3 text-xs"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-green-600" />
            Скопировано
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            Копировать
          </>
        )}
      </button>
    </div>
  );
}
