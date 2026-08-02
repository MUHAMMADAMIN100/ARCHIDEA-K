import { useState } from 'react';
import { Send } from 'lucide-react';
import { api } from '../api/client';
import { useFetch } from '../api/hooks';
import { useToast } from './Toast';

interface Status {
  linked: boolean;
  chatId: string | null;
  name: string | null;
  enabled: boolean;
}

/**
 * Подключение Telegram сотрудником самому себе.
 *
 * Раньше chat_id вносил руководитель руками — приходилось спрашивать его у
 * каждого. Теперь кнопка выдаёт ссылку с одноразовым кодом: сотрудник
 * открывает её, жмёт «Старт», и бот привязывается сам.
 *
 * Блок показывается только в СВОЁМ профиле: нажать «Старт» за другого
 * человека нельзя, а видеть чужую ссылку незачем.
 */
export function TelegramLink() {
  const toast = useToast();
  const { data, reload } = useFetch<Status>('/telegram/status');
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; url?: string; message?: string }>(
        '/telegram/link',
      );
      if (!res.data.ok || !res.data.url) {
        toast.error(res.data.message || 'Не удалось получить ссылку');
        return;
      }
      setUrl(res.data.url);
      window.open(res.data.url, '_blank', 'noopener');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось получить ссылку');
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    try {
      await api.delete('/telegram/link');
      setUrl(null);
      reload();
      toast.success('Telegram отключён');
    } catch {
      toast.error('Не удалось отключить');
    }
  };

  return (
    <div className="card mb-5 p-6">
      <h3 className="mb-1 font-bold text-navy-900">Telegram</h3>
      <p className="mb-3 text-sm text-navy-600">
        Новые заявки, напоминания о звонках и изменения по заказам приходят в
        личный чат с ботом.
      </p>

      {data?.linked ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-800">
            <Send className="h-4 w-4" />
            Подключён{data.name ? ` — ${data.name}` : ''}
          </span>
          <button onClick={unlink} className="btn-ghost">
            Отключить
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <button onClick={connect} disabled={busy} className="btn-primary">
            <Send className="h-4 w-4" />
            {busy ? 'Готовим ссылку…' : 'Подключить Telegram'}
          </button>
          {url && (
            <p className="animate-fade-in text-xs text-navy-600">
              Если Telegram не открылся сам — перейдите по ссылке и нажмите
              «Старт»:{' '}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand-600 underline underline-offset-2"
              >
                {url}
              </a>
              <br />
              Ссылка одноразовая и действует сутки. После нажатия «Старт»
              обновите страницу.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
