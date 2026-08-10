import { useEffect, useRef, useState } from 'react';
import {
  Save,
  Check,
  SprayCan,
  Package,
  Hammer,
  Armchair,
  LayoutGrid,
  Box,
  Flame,
  Shirt,
  Plus,
  Pencil,
  History as HistoryIcon,
  Trash2,
  Eye,
  EyeOff,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../api/client';
import { useFetch, deleteRecord, removeFrom } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { userSeesFinance } from '../types';
import { Skeleton, PageHeader, Modal, Badge, ErrorState } from '../components/ui';
import { useToast } from '../components/Toast';
import { useDialog } from '../components/Dialog';
import { Tabs } from '../components/common';
import { HistoryPanel } from '../components/HistoryPanel';
import type {
  ExtraService,
  PaymentBank,
  Tariff,
  Tariffs as TariffsData,
} from '../types';

/**
 * Ключ услуги теперь произвольная строка (ТЗ 1.1 — директор заводит новые
 * услуги), а не жёсткий enum CleaningType. Словари ниже — просто подсказки
 * оформления для трёх «базовых» услуг; для остальных используется запасная
 * иконка/описание, иначе сборка падала на индексации по string (см. отчёт).
 */
const TYPE_META: Record<string, { icon: LucideIcon; desc: string }> = {
  GENERAL: {
    icon: SprayCan,
    desc: 'Глубокая уборка всей площади до блеска, даже в труднодоступных местах',
  },
  POST_RENOVATION: {
    icon: Hammer,
    desc: 'Удаление строительной пыли и следов ремонта, подготовка к заселению',
  },
  FURNITURE: {
    icon: Armchair,
    desc: 'Чистка мягкой мебели от пятен и запахов — цена за посадочное место',
  },
};
const DEFAULT_TYPE_META = { icon: Package, desc: '' };

const EXTRA_META: Record<string, { icon: LucideIcon }> = {
  windows: { icon: LayoutGrid },
  fridge: { icon: Box },
  oven: { icon: Flame },
  ironing: { icon: Shirt },
};

const LEVELS: { key: 'priceLight' | 'priceMedium' | 'priceHeavy'; label: string }[] = [
  { key: 'priceLight', label: 'Лёгкая' },
  { key: 'priceMedium', label: 'Средняя' },
  { key: 'priceHeavy', label: 'Тяжёлая' },
];

/** Только цифры, без ведущих нулей; пустая строка допустима */
const sanitize = (v: string) => v.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');

/**
 * Состав работ из текстового поля: по пункту на строку.
 * Пустые строки между абзацами не должны становиться пустыми пунктами.
 */
const splitWorks = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);
const toInt = (v: string) => Math.round(Number(v || 0));

type PriceMap = Record<string, { light: string; medium: string; heavy: string }>;

/** Что сейчас редактируем модалкой создания/правки услуги */
type TariffModalState = { item: Tariff | null } | null;
type ExtraModalState = { item: ExtraService | null } | null;

export function Tariffs() {
  const toast = useToast();
  const dialog = useDialog();
  const { user } = useAuth();
  // /tariffs/manage — полный список, включая скрытые (для страницы управления);
  // калькулятор лендинга продолжает ходить в публичный /tariffs
  const { data, loading, error, reload, setData } = useFetch<TariffsData>('/tariffs/manage');

  // Цены храним строками — чтобы поле можно было очистить и не было «прилипшего» нуля
  const [prices, setPrices] = useState<PriceMap>({});
  const [extraPrices, setExtraPrices] = useState<Record<string, string>>({});
  const [tariffModal, setTariffModal] = useState<TariffModalState>(null);
  const [extraModal, setExtraModal] = useState<ExtraModalState>(null);
  const [historyKey, setHistoryKey] = useState<{ key: string; title: string } | null>(null);

  /*
   * Заполняем поля цен ТОЛЬКО для услуг, которых ещё нет в состоянии.
   *
   * Раньше засев был одноразовым (флаг seeded). Из-за этого услуга, созданная
   * ПОСЛЕ первой загрузки страницы, оставалась с пустыми полями: в карточке
   * было видно подсказку «0», хотя в базе лежали настоящие цены. Хуже другое —
   * нажатие «Сохранить» на такой карточке отправляло пустое поле как ноль и
   * действительно обнуляло цены. Отсюда и «цены не сохраняются».
   *
   * Уже введённые значения при этом не затираем: фоновое обновление
   * (возврат на вкладку, поллинг) не должно сбрасывать то, что человек печатает.
   */
  useEffect(() => {
    if (!data) return;
    setPrices((prev) => {
      const next = { ...prev };
      let added = false;
      for (const t of data.tariffs) {
        if (next[t.key]) continue;
        next[t.key] = {
          light: String(t.priceLight),
          medium: String(t.priceMedium),
          heavy: String(t.priceHeavy),
        };
        added = true;
      }
      return added ? next : prev;
    });
    setExtraPrices((prev) => {
      const next = { ...prev };
      let added = false;
      for (const e of data.extras) {
        if (next[e.key] !== undefined) continue;
        next[e.key] = String(e.price);
        added = true;
      }
      return added ? next : prev;
    });
  }, [data]);

  if (error) return <ErrorState text={error ?? undefined} onRetry={reload} />;
  /*
   * Заглушка повторяет обе сетки страницы: три колонки услуг и четыре —
   * дополнительных. Так при появлении цен ничего не переезжает, а по форме
   * заглушки сразу понятно, что грузится.
   */
  if (loading || !data)
    return (
      <div className="animate-page-in" role="status" aria-label="Загрузка">
        <div className="mb-8 grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72 rounded-md" />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-md" />
          ))}
        </div>
      </div>
    );

  const saveTariff = (t: Tariff) => {
    const p = prices[t.key];
    if (!p) return;
    /*
     * Пустое поле — это «не менял», а НЕ ноль. Раньше оно уходило нулём и
     * молча обнуляло цену услуги: заказы после этого считались по нулю.
     * Поэтому пустое значение подменяем текущим с сервера.
     */
    const num = (raw: string, fallback: number) =>
      raw.trim() === '' ? fallback : Number(raw);
    // у услуги без уровней (мебель и т.п.) одна цена — во все три поля
    const light = num(p.light, t.priceLight);
    const medium = t.hasLevels ? num(p.medium, t.priceMedium) : light;
    const heavy = t.hasLevels ? num(p.heavy, t.priceHeavy) : light;
    // оптимистично: кнопка сразу показывает «Сохранено», запрос — в фоне
    setData((d) =>
      d
        ? {
            ...d,
            tariffs: d.tariffs.map((x) =>
              x.key === t.key
                ? { ...x, priceLight: light, priceMedium: medium, priceHeavy: heavy }
                : x,
            ),
          }
        : d,
    );
    // нормализуем строки в полях к сохранённым числам — иначе очищенное поле
    // (пустая строка ≠ "0") навсегда осталось бы в состоянии «Сохранить»
    setPrices((prev) => ({
      ...prev,
      [t.key]: { light: String(light), medium: String(medium), heavy: String(heavy) },
    }));
    toast.success('Цены обновлены');
    api
      .patch(`/tariffs/tariff/${t.key}`, {
        priceLight: light,
        priceMedium: medium,
        priceHeavy: heavy,
        pricePerSqm: medium, // совместимость со старым бэкендом на время деплоя
      })
      .catch(() => {
        toast.error('Не удалось сохранить цены');
        reload(); // вернуть серверные значения
      });
  };

  const saveExtra = (key: string) => {
    // пустое поле — «не менял», а не ноль (см. saveTariff)
    const raw = extraPrices[key] ?? '';
    const current = data.extras.find((e) => e.key === key)?.price ?? 0;
    const price = raw.trim() === '' ? current : Number(raw);
    setData((d) =>
      d
        ? {
            ...d,
            extras: d.extras.map((x) => (x.key === key ? { ...x, price } : x)),
          }
        : d,
    );
    setExtraPrices((prev) => ({ ...prev, [key]: String(price) }));
    toast.success('Цена обновлена');
    api.patch(`/tariffs/extra/${key}`, { price }).catch(() => {
      toast.error('Не удалось сохранить цену');
      reload();
    });
  };

  /** Скрыть/показать услугу — быстрое действие прямо с карточки, без модалки */
  const toggleTariffActive = async (t: Tariff) => {
    const nextActive = !t.isActive;
    setData((d) =>
      d ? { ...d, tariffs: d.tariffs.map((x) => (x.key === t.key ? { ...x, isActive: nextActive } : x)) } : d,
    );
    try {
      await api.patch(`/tariffs/tariff/${t.key}`, { isActive: nextActive });
      toast.success(nextActive ? 'Услуга снова видна в заказах' : 'Услуга скрыта');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось изменить видимость услуги');
      reload();
    }
  };

  const toggleExtraActive = async (e: ExtraService) => {
    const nextActive = !e.isActive;
    setData((d) =>
      d ? { ...d, extras: d.extras.map((x) => (x.key === e.key ? { ...x, isActive: nextActive } : x)) } : d,
    );
    try {
      await api.patch(`/tariffs/extra/${e.key}`, { isActive: nextActive });
      toast.success(nextActive ? 'Доп. услуга снова видна' : 'Доп. услуга скрыта');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Не удалось изменить видимость');
      reload();
    }
  };

  const removeTariff = async (t: Tariff) => {
    const ok = await dialog.confirm({
      title: `Удалить услугу «${t.title}»?`,
      message: 'Услуга будет перемещена в корзину. Её можно восстановить в разделе «Корзина» в течение 90 дней.',
      confirmText: 'В корзину',
      danger: true,
    });
    if (!ok) return;
    await deleteRecord({
      remove: () =>
        removeFrom(setData, (d) =>
          d ? { ...d, tariffs: d.tariffs.filter((x) => x.key !== t.key) } : d,
        ),
      request: () => api.delete(`/tariffs/tariff/${t.key}`),
      onDone: () => toast.success('Услуга перенесена в корзину'),
      onFail: (m) => toast.error(m),
      refresh: ['/tariffs'],
    });
  };

  const removeExtra = async (e: ExtraService) => {
    const ok = await dialog.confirm({
      title: `Удалить доп. услугу «${e.title}»?`,
      message: 'Доп. услуга будет перемещена в корзину. Её можно восстановить в разделе «Корзина» в течение 90 дней.',
      confirmText: 'В корзину',
      danger: true,
    });
    if (!ok) return;
    await deleteRecord({
      remove: () =>
        removeFrom(setData, (d) =>
          d ? { ...d, extras: d.extras.filter((x) => x.key !== e.key) } : d,
        ),
      request: () => api.delete(`/tariffs/extra/${e.key}`),
      onDone: () => toast.success('Доп. услуга перенесена в корзину'),
      onFail: (m) => toast.error(m),
      refresh: ['/tariffs'],
    });
  };

  return (
    <div className="animate-page-in">
      <PageHeader
        title="Управление тарифами"
        action={
          <button className="btn-primary" onClick={() => setTariffModal({ item: null })}>
            <Plus className="h-4 w-4" />
            Добавить услугу
          </button>
        }
      />

      {/* Услуги */}
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-600">
        Услуги — цена по степени загрязнения
      </h3>
      <div className="mb-8 grid gap-4 lg:grid-cols-3">
        {data.tariffs.map((t) => {
          const meta = TYPE_META[t.key] ?? DEFAULT_TYPE_META;
          const p = prices[t.key] ?? { light: '', medium: '', heavy: '' };
          const dirty = t.hasLevels
            ? p.light !== String(t.priceLight) ||
              p.medium !== String(t.priceMedium) ||
              p.heavy !== String(t.priceHeavy)
            : p.light !== String(t.priceLight);
          return (
            <div key={t.key} className={`card flex flex-col p-5 ${!t.isActive ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy-100 text-navy-600">
                  <meta.icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h4 className="font-bold leading-tight text-navy-900">{t.title}</h4>
                    {t.isSystem && (
                      <Badge className="border border-navy-200 bg-navy-50 text-navy-600">Базовая</Badge>
                    )}
                    {!t.isActive && (
                      <Badge className="border border-amber-200 bg-amber-50 text-amber-700">Скрыта</Badge>
                    )}
                  </div>
                  {/*
                    Сначала описание из справочника, и только потом заготовка
                    из кода. Раньше показывалась одна заготовка: руководитель
                    правил описание в карточке услуги, на сайте оно менялось,
                    а в CRM оставался прежний текст — у своих услуг его не было
                    вовсе.
                  */}
                  {(t.description || meta.desc) && (
                    <p className="mt-0.5 text-xs text-navy-600">
                      {t.description || meta.desc}
                    </p>
                  )}
                </div>
              </div>

              {t.hasLevels ? (
                <div className="mt-4 space-y-2.5">
                  {LEVELS.map((lv, i) => {
                    const value = [p.light, p.medium, p.heavy][i];
                    return (
                      <div key={lv.key} className="flex items-center gap-3">
                        <span className="w-20 shrink-0 text-sm text-navy-600">
                          {lv.label}
                        </span>
                        <div className="relative flex-1">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={value}
                            onChange={(e) => {
                              const v = sanitize(e.target.value);
                              setPrices((prev) => ({
                                ...prev,
                                [t.key]: {
                                  ...(prev[t.key] ?? { light: '', medium: '', heavy: '' }),
                                  [i === 0 ? 'light' : i === 1 ? 'medium' : 'heavy']: v,
                                },
                              }));
                            }}
                            placeholder="0"
                            className="input pr-24 font-bold"
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-navy-600">
                            сомони / {t.unit}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4">
                  <label className="mb-1.5 block text-xs font-medium text-navy-600">
                    Цена
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={p.light}
                      onChange={(e) => {
                        const v = sanitize(e.target.value);
                        setPrices((prev) => ({
                          ...prev,
                          [t.key]: { light: v, medium: v, heavy: v },
                        }));
                      }}
                      placeholder="0"
                      className="input pr-28 text-lg font-bold"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-navy-600">
                      сомони / {t.unit}
                    </span>
                  </div>
                </div>
              )}

              <button
                onClick={() => saveTariff(t)}
                disabled={!dirty}
                className={`mt-4 w-full ${dirty ? 'btn-primary' : 'btn-ghost !text-navy-600'}`}
              >
                {dirty ? (
                  <>
                    <Save className="h-4 w-4" />
                    Сохранить
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Сохранено
                  </>
                )}
              </button>

              <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-navy-100 pt-2">
                <button
                  type="button"
                  className="press inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-navy-600 hover:bg-navy-50"
                  onClick={() => setTariffModal({ item: t })}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Редактировать
                </button>
                <button
                  type="button"
                  className="press inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-navy-600 hover:bg-navy-50"
                  onClick={() => setHistoryKey({ key: t.key, title: t.title })}
                >
                  <HistoryIcon className="h-3.5 w-3.5" />
                  История
                </button>
                <button
                  type="button"
                  className="press inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-navy-600 hover:bg-navy-50"
                  onClick={() => toggleTariffActive(t)}
                >
                  {t.isActive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {t.isActive ? 'Скрыть' : 'Показать'}
                </button>
                {t.isSystem ? (
                  <span
                    className="ml-auto inline-flex cursor-not-allowed items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-navy-600"
                    title="Базовая услуга — на неё завязаны лендинг и старые заказы, удалить нельзя. Можно только скрыть."
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <button
                    type="button"
                    className="press ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-red-500 hover:bg-red-50"
                    onClick={() => removeTariff(t)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Доп. услуги */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-navy-600">
          Дополнительные услуги — фиксированная цена
        </h3>
        <button className="btn-ghost text-sm" onClick={() => setExtraModal({ item: null })}>
          <Plus className="h-4 w-4" />
          Добавить доп. услугу
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data.extras.map((e) => {
          const dirty = (extraPrices[e.key] ?? '') !== String(e.price);
          const Icon = EXTRA_META[e.key]?.icon ?? Box;
          return (
            <div key={e.key} className={`card flex flex-col p-5 ${!e.isActive ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy-100 text-navy-600">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h4 className="font-bold leading-tight text-navy-900">{e.title}</h4>
                    {e.isSystem && (
                      <Badge className="border border-navy-200 bg-navy-50 text-navy-600">Базовая</Badge>
                    )}
                    {!e.isActive && (
                      <Badge className="border border-amber-200 bg-amber-50 text-amber-700">Скрыта</Badge>
                    )}
                  </div>
                </div>
              </div>

              <label className="mb-1.5 mt-4 block text-xs font-medium text-navy-600">
                Цена
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  value={extraPrices[e.key] ?? ''}
                  onChange={(ev) =>
                    setExtraPrices((prev) => ({
                      ...prev,
                      [e.key]: sanitize(ev.target.value),
                    }))
                  }
                  placeholder="0"
                  className="input pr-24 text-lg font-bold"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-navy-600">
                  {e.hasQty ? 'сомони / шт' : 'сомони'}
                </span>
              </div>

              <button
                onClick={() => saveExtra(e.key)}
                disabled={!dirty}
                className={`mt-3 w-full ${dirty ? 'btn-primary' : 'btn-ghost !text-navy-600'}`}
              >
                {dirty ? (
                  <>
                    <Save className="h-4 w-4" />
                    Сохранить
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Сохранено
                  </>
                )}
              </button>

              <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-navy-100 pt-2">
                <button
                  type="button"
                  className="press inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-navy-600 hover:bg-navy-50"
                  onClick={() => setExtraModal({ item: e })}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Изменить
                </button>
                <button
                  type="button"
                  className="press inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-navy-600 hover:bg-navy-50"
                  onClick={() => toggleExtraActive(e)}
                >
                  {e.isActive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {e.isActive ? 'Скрыть' : 'Показать'}
                </button>
                {e.isSystem ? (
                  <span
                    className="ml-auto inline-flex cursor-not-allowed items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-navy-600"
                    title="Базовая доп. услуга — удалить нельзя, можно только скрыть."
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <button
                    type="button"
                    className="press ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-red-500 hover:bg-red-50"
                    onClick={() => removeExtra(e)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/*
        Банки для безналичной оплаты (ТЗ 3.1). Раздел про деньги компании:
        название банка подписывает каналы поступления в книге доходов,
        поэтому ведёт его тот же, кто ведёт саму книгу.
      */}
      {userSeesFinance(user) && <BanksSection />}

      {tariffModal && (
        <TariffModal
          tariff={tariffModal.item}
          onClose={() => setTariffModal(null)}
          onSaved={() => {
            setTariffModal(null);
            reload();
          }}
        />
      )}

      {extraModal && (
        <ExtraModal
          extra={extraModal.item}
          onClose={() => setExtraModal(null)}
          onSaved={() => {
            setExtraModal(null);
            reload();
          }}
        />
      )}

      {historyKey && (
        <Modal open onClose={() => setHistoryKey(null)} title={`История: ${historyKey.title}`}>
          <HistoryPanel entity="SERVICE" entityId={historyKey.key} />
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  Банки для безналичной оплаты (ТЗ 3.1)
// ═══════════════════════════════════════════════════════════

/**
 * Справочник банков.
 *
 * В ТЗ названы Алиф и Душанбе Сити, но список банков в городе меняется —
 * поэтому он лежит в базе, а не в коде. Три базовых записи скрываются, но не
 * удаляются: на них ссылаются уже проведённые платежи.
 */
function BanksSection() {
  const toast = useToast();
  const dialog = useDialog();
  const { data, loading, reload } = useFetch<PaymentBank[]>('/banks/manage');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const banks = data ?? [];

  const add = async () => {
    const value = title.trim();
    if (value.length < 2) {
      toast.error('Укажите название банка');
      return;
    }
    setSaving(true);
    try {
      await api.post('/banks', { title: value });
      setTitle('');
      reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось добавить банк');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (b: PaymentBank) => {
    try {
      await api.patch(`/banks/${b.id}`, { isActive: !b.isActive });
      reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось изменить банк');
    }
  };

  const remove = async (b: PaymentBank) => {
    const ok = await dialog.confirm({
      title: `Удалить банк «${b.title}»?`,
      message: 'Он исчезнет из списка при внесении оплаты.',
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    await deleteRecord({
      remove: () => undefined,
      request: () => api.delete(`/banks/${b.id}`),
      onDone: () => {
        toast.success('Банк удалён');
        reload();
      },
      onFail: (m) => toast.error(m),
    });
  };

  return (
    <div className="mt-8">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-600">
        Банки для безналичной оплаты
      </h3>
      <div className="card p-5">
        <p className="mb-3 text-sm text-navy-600">
          Эти банки предлагаются при внесении оплаты по заказу. Скрытый банк не
          показывается в новых платежах, но остаётся в уже проведённых.
        </p>

        {loading && banks.length === 0 ? (
          <Skeleton className="h-20" />
        ) : (
          <ul className="space-y-1.5">
            {banks.map((b) => (
              <li
                key={b.id}
                className={`flex items-center justify-between gap-2 rounded-lg bg-navy-50 px-3 py-2 ${
                  b.isActive ? '' : 'opacity-60'
                }`}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="truncate font-medium text-navy-900">{b.title}</span>
                  {b.isSystem && (
                    <Badge className="border border-navy-200 bg-white text-navy-600">
                      Базовый
                    </Badge>
                  )}
                  {!b.isActive && (
                    <Badge className="border border-amber-200 bg-amber-50 text-amber-700">
                      Скрыт
                    </Badge>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="press inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-navy-600 hover:bg-white"
                    onClick={() => toggle(b)}
                  >
                    {b.isActive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {b.isActive ? 'Скрыть' : 'Показать'}
                  </button>
                  {!b.isSystem && (
                    <button
                      type="button"
                      className="press inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-red-600 hover:bg-red-50"
                      onClick={() => remove(b)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Удалить
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            className="input flex-1 min-w-[12rem]"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={60}
            placeholder="Название банка"
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
          />
          <button className="btn-primary" onClick={add} disabled={saving}>
            <Plus className="h-4 w-4" />
            Добавить банк
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  Создание / правка услуги
// ═══════════════════════════════════════════════════════════

type ServiceTab = 'edit' | 'history';

function TariffModal({
  tariff,
  onClose,
  onSaved,
}: {
  tariff: Tariff | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = !!tariff;
  const [tab, setTab] = useState<ServiceTab>('edit');
  const [title, setTitle] = useState(tariff?.title ?? '');
  const [description, setDescription] = useState(tariff?.description ?? '');
  const [unit, setUnit] = useState(tariff?.unit ?? 'м²');
  const [hasLevels, setHasLevels] = useState(tariff?.hasLevels ?? true);
  const [light, setLight] = useState(String(tariff?.priceLight ?? ''));
  const [medium, setMedium] = useState(String(tariff?.priceMedium ?? ''));
  const [heavy, setHeavy] = useState(String(tariff?.priceHeavy ?? ''));
  const [sortOrder, setSortOrder] = useState(String(tariff?.sortOrder ?? 100));
  const [isActive, setIsActive] = useState(tariff?.isActive ?? true);
  /*
   * Состав работ: что входит и что не входит (ТЗ: объём работ).
   * В поле — по пункту на строку: так его заполняют, читая с бумажного бланка.
   */
  const [included, setIncluded] = useState(
    (tariff?.includedWorks ?? []).join('\n'),
  );
  const [excluded, setExcluded] = useState(
    (tariff?.excludedWorks ?? []).join('\n'),
  );
  /** Выработка: сколько единиц успевает один человек за смену */
  const [outputPerDay, setOutputPerDay] = useState(
    tariff?.outputPerDay != null ? String(tariff.outputPerDay) : '',
  );
  const [saving, setSaving] = useState(false);

  const canSubmit = title.trim().length >= 2;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    const mediumNum = toInt(medium);
    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      unit: unit.trim() || 'м²',
      hasLevels,
      priceLight: hasLevels ? toInt(light) : mediumNum,
      priceMedium: mediumNum,
      priceHeavy: hasLevels ? toInt(heavy) : mediumNum,
      sortOrder: toInt(sortOrder),
      isActive,
      includedWorks: splitWorks(included),
      excludedWorks: splitWorks(excluded),
      outputPerDay: outputPerDay ? toInt(outputPerDay) : 0,
    };
    /*
     * Окно закрывается сразу, запрос уходит фоном — как и везде в системе.
     * Раньше кнопка держала человека, пока сервер отвечал; при отказе
     * список всё равно перезапросится и покажет, что ничего не изменилось.
     */
    toast.success(isEdit ? 'Услуга обновлена' : 'Услуга добавлена');
    onSaved();
    const request =
      isEdit && tariff
        ? api.patch(`/tariffs/tariff/${tariff.key}`, {
            // у базовой услуги ключ и единицу измерения бэкенд менять не даёт
            ...payload,
            unit: tariff.isSystem ? undefined : payload.unit,
          })
        : api.post('/tariffs/tariff', payload);
    request.catch((e: any) => {
      toast.error(e?.response?.data?.message || 'Не удалось сохранить услугу');
      onSaved();
    });
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Услуга: ${tariff!.title}` : 'Новая услуга'} wide>
      <div className="space-y-4">
        {isEdit && (
          <Tabs
            items={[
              { value: 'edit', label: 'Изменить' },
              { value: 'history', label: 'История' },
            ]}
            value={tab}
            onChange={setTab}
          />
        )}

        {tab === 'history' && isEdit ? (
          <HistoryPanel entity="SERVICE" entityId={tariff!.key} />
        ) : (
          <div className="space-y-3">
            {/*
              Поле «Ключ услуги» убрано: ключ нужен системе (по нему заказ
              связан с услугой и считает калькулятор сайта), но человеку он не
              нужен. Пока поле было пустым, кнопка «Сохранить» оставалась
              заблокированной — заполненные цены выглядели как «не сохраняются».
              Теперь ключ формируется из названия на сервере.
            */}
            {isEdit && tariff!.isSystem && (
              <p className="rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-600">
                Это базовая услуга — ключ и единица измерения зафиксированы: на них завязаны
                калькулятор на сайте и уже оформленные заказы.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Название *</label>
                <input
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  placeholder="Например: Мытьё окон под ключ"
                />
              </div>
              <div>
                <label className="label">Единица измерения</label>
                <input
                  className="input"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  maxLength={20}
                  placeholder="м², место, шт"
                  disabled={isEdit && tariff!.isSystem}
                />
              </div>
            </div>

            <div>
              <label className="label">Описание</label>
              <textarea
                className="input min-h-[60px] resize-none"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                placeholder="Короткое описание для карточки услуги"
              />
            </div>

            {/*
              Состав работ (ТЗ: объём работ). Списки печатаются в КП: спор
              «а окна вы должны были мыть?» решается только тем, что клиент
              прочитал заранее.
            */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Что входит в услугу</label>
                <textarea
                  className="input min-h-[110px] resize-none"
                  value={included}
                  onChange={(e) => setIncluded(e.target.value)}
                  placeholder={
                    'По пункту на строку:\nМытьё полов\nПротирка пыли\nСанузел до блеска'
                  }
                />
              </div>
              <div>
                <label className="label">Что НЕ входит</label>
                <textarea
                  className="input min-h-[110px] resize-none"
                  value={excluded}
                  onChange={(e) => setExcluded(e.target.value)}
                  placeholder={
                    'По пункту на строку:\nМытьё окон снаружи\nВынос строительного мусора'
                  }
                />
              </div>
            </div>

            <div>
              <label className="label">
                Выработка: сколько {unit || 'м²'} успевает один человек за смену
              </label>
              <input
                type="number"
                min={0}
                className="input"
                value={outputPerDay}
                onChange={(e) => setOutputPerDay(e.target.value)}
                placeholder="Например: 60"
              />
              <p className="mt-1 text-xs text-navy-600">
                По ней система считает срок работ и нужное число людей. Пусто —
                срок не рассчитывается.
              </p>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-navy-700">
              <input
                type="checkbox"
                className="h-4 w-4 accent-navy-500"
                checked={hasLevels}
                onChange={(e) => setHasLevels(e.target.checked)}
              />
              Цена различается по степени загрязнения
            </label>

            {hasLevels ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label">Лёгкая</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="input"
                    value={light}
                    onChange={(e) => setLight(sanitize(e.target.value))}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="label">Средняя</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="input"
                    value={medium}
                    onChange={(e) => setMedium(sanitize(e.target.value))}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="label">Тяжёлая</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="input"
                    value={heavy}
                    onChange={(e) => setHeavy(sanitize(e.target.value))}
                    placeholder="0"
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="label">Цена</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="input"
                  value={medium}
                  onChange={(e) => setMedium(sanitize(e.target.value))}
                  placeholder="0"
                />
              </div>
            )}

            {/* «Порядок в списке» убран из формы: технический параметр,
                который только путал — порядок задаётся по умолчанию */}
            <div>
              <label className="flex items-center gap-2 text-sm text-navy-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-navy-500"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Показывать в заказах и на сайте
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="btn-ghost">
                Отмена
              </button>
              <button onClick={submit} disabled={!canSubmit || saving} className="btn-primary">
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════
//  Создание / правка доп. услуги
// ═══════════════════════════════════════════════════════════

function ExtraModal({
  extra,
  onClose,
  onSaved,
}: {
  extra: ExtraService | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = !!extra;
  const [tab, setTab] = useState<ServiceTab>('edit');
  const [title, setTitle] = useState(extra?.title ?? '');
  const [price, setPrice] = useState(String(extra?.price ?? ''));
  const [hasQty, setHasQty] = useState(extra?.hasQty ?? false);
  const [sortOrder, setSortOrder] = useState(String(extra?.sortOrder ?? 100));
  const [isActive, setIsActive] = useState(extra?.isActive ?? true);
  const [saving, setSaving] = useState(false);

  const canSubmit = title.trim().length >= 2;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    const payload = {
      title: title.trim(),
      price: toInt(price),
      hasQty,
      sortOrder: toInt(sortOrder),
      isActive,
    };
    try {
      if (isEdit && extra) {
        await api.patch(`/tariffs/extra/${extra.key}`, payload);
        toast.success('Доп. услуга обновлена');
      } else {
        await api.post('/tariffs/extra', payload);
        toast.success('Доп. услуга добавлена');
      }
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось сохранить доп. услугу');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Доп. услуга: ${extra!.title}` : 'Новая доп. услуга'}>
      <div className="space-y-4">
        {isEdit && (
          <Tabs
            items={[
              { value: 'edit', label: 'Изменить' },
              { value: 'history', label: 'История' },
            ]}
            value={tab}
            onChange={setTab}
          />
        )}

        {tab === 'history' && isEdit ? (
          <HistoryPanel entity="SERVICE" entityId={extra!.key} />
        ) : (
          <div className="space-y-3">
            {/* ключ формируется из названия на сервере — см. service-key.ts */}

            <div>
              <label className="label">Название *</label>
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="Например: Химчистка ковра"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Цена</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="input"
                  value={price}
                  onChange={(e) => setPrice(sanitize(e.target.value))}
                  placeholder="0"
                />
              </div>
              {/* «Порядок в списке» убран: технический параметр, который путал */}
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-navy-700">
              <input
                type="checkbox"
                className="h-4 w-4 accent-navy-500"
                checked={hasQty}
                onChange={(e) => setHasQty(e.target.checked)}
              />
              Цена умножается на количество (например мытьё окон за штуку)
            </label>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-navy-700">
              <input
                type="checkbox"
                className="h-4 w-4 accent-navy-500"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Показывать в заказах и на сайте
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="btn-ghost">
                Отмена
              </button>
              <button onClick={submit} disabled={!canSubmit || saving} className="btn-primary">
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
