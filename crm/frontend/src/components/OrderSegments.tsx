import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '../api/client';
import { Modal } from './ui';
import { useToast } from './Toast';

/**
 * Разбивка объекта на блоки, этажи и помещения (ТЗ: объём работ).
 *
 * Зачем: большой объект не описывается одной цифрой площади. Бригада должна
 * знать, сколько корпусов и этажей, какие помещения и сколько метров в
 * каждом — иначе на месте выясняется, что «в 1200 м²» входил ещё и подвал.
 *
 * Дерево правится целиком и одним запросом сохраняется: менеджер работает со
 * структурой объекта как с единым целым.
 */

interface RoomDraft {
  key: string;
  title: string;
  area: string;
  note: string;
}

interface FloorDraft {
  key: string;
  title: string;
  rooms: RoomDraft[];
}

interface BlockDraft {
  key: string;
  title: string;
  floors: FloorDraft[];
}

interface ServerNode {
  id: string;
  kind: 'BLOCK' | 'FLOOR' | 'ROOM';
  title: string;
  area: number | null;
  note: string | null;
  children: ServerNode[];
}

interface Props {
  orderId: string;
  /** Площадь заказа — с ней сверяется итог разбивки */
  orderArea: number;
  readOnly?: boolean;
  onClose: () => void;
  /** Разбивка сохранена; площадь передаётся, если её подставили в заказ */
  onSaved: (appliedArea: number | null) => void;
}

let seq = 0;
const nextKey = () => `n${++seq}`;

function toDrafts(nodes: ServerNode[]): BlockDraft[] {
  return nodes.map((block) => ({
    key: nextKey(),
    title: block.title,
    floors: block.children.map((floor) => ({
      key: nextKey(),
      title: floor.title,
      rooms: floor.children.map((room) => ({
        key: nextKey(),
        title: room.title,
        area: room.area != null ? String(room.area) : '',
        note: room.note ?? '',
      })),
    })),
  }));
}

const areaOf = (r: RoomDraft) => Math.max(0, Math.round(Number(r.area) || 0));

export function OrderSegments({
  orderId,
  orderArea,
  readOnly,
  onClose,
  onSaved,
}: Props) {
  const toast = useToast();
  const [blocks, setBlocks] = useState<BlockDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applyArea, setApplyArea] = useState(false);

  useEffect(() => {
    api
      .get<{ blocks: ServerNode[] }>(`/orders/${orderId}/segments`)
      .then((r) => setBlocks(toDrafts(r.data.blocks ?? [])))
      .catch(() => setBlocks([]))
      .finally(() => setLoading(false));
  }, [orderId]);

  const total = blocks.reduce(
    (sum, b) =>
      sum +
      b.floors.reduce(
        (fs, f) => fs + f.rooms.reduce((rs, r) => rs + areaOf(r), 0),
        0,
      ),
    0,
  );
  /*
   * Как только считать нечего, галочку снимаем, а не просто гасим. Раньше
   * состояние оставалось включённым: человек ставил галочку, потом стирал
   * площади — и в заказ уезжал ноль вместо прежней площади.
   */
  useEffect(() => {
    if (total === 0 && applyArea) setApplyArea(false);
  }, [total, applyArea]);

  const rooms = blocks.reduce(
    (n, b) => n + b.floors.reduce((fn, f) => fn + f.rooms.length, 0),
    0,
  );

  const addBlock = () =>
    setBlocks((prev) => [
      ...prev,
      { key: nextKey(), title: `Блок ${prev.length + 1}`, floors: [] },
    ]);

  const addFloor = (bi: number) =>
    setBlocks((prev) =>
      prev.map((b, i) =>
        i === bi
          ? {
              ...b,
              floors: [
                ...b.floors,
                { key: nextKey(), title: `${b.floors.length + 1} этаж`, rooms: [] },
              ],
            }
          : b,
      ),
    );

  const addRoom = (bi: number, fi: number) =>
    setBlocks((prev) =>
      prev.map((b, i) =>
        i === bi
          ? {
              ...b,
              floors: b.floors.map((f, j) =>
                j === fi
                  ? {
                      ...f,
                      rooms: [
                        ...f.rooms,
                        { key: nextKey(), title: '', area: '', note: '' },
                      ],
                    }
                  : f,
              ),
            }
          : b,
      ),
    );

  const save = async () => {
    const payload = {
      blocks: blocks
        .filter((b) => b.title.trim())
        .map((b) => ({
          title: b.title.trim(),
          floors: b.floors
            .filter((f) => f.title.trim())
            .map((f) => ({
              title: f.title.trim(),
              rooms: f.rooms
                .filter((r) => r.title.trim())
                .map((r) => ({
                  title: r.title.trim(),
                  area: areaOf(r) || undefined,
                  note: r.note.trim() || undefined,
                })),
            })),
        })),
      applyArea,
    };

    setSaving(true);
    try {
      const { data } = await api.put(`/orders/${orderId}/segments`, payload);
      toast.success('Разбивка объекта сохранена');
      onSaved(applyArea ? (data?.totalArea ?? total) : null);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось сохранить разбивку');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Разбивка объекта" wide>
      <div className="space-y-4">
        <p className="text-sm text-navy-600">
          Опишите объект по частям: корпус или блок, внутри — этажи, внутри
          этажей — помещения с площадью. Бригада получит понятный объём работ, а
          не одну цифру.
        </p>

        {loading ? (
          <p className="text-sm text-navy-500">Загружаем…</p>
        ) : (
          <div className="space-y-3">
            {blocks.map((b, bi) => (
              <div
                key={b.key}
                className="rounded-xl border border-navy-200 bg-white p-3"
              >
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="label">Блок / корпус</label>
                    <input
                      className="input-sm w-full"
                      value={b.title}
                      disabled={readOnly}
                      onChange={(e) =>
                        setBlocks((prev) =>
                          prev.map((x, i) =>
                            i === bi ? { ...x, title: e.target.value } : x,
                          ),
                        )
                      }
                      maxLength={120}
                      placeholder="Например: Корпус А"
                    />
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      aria-label="Убрать блок"
                      className="mb-1 rounded-lg p-1 text-navy-400 hover:bg-red-50 hover:text-red-600"
                      onClick={() =>
                        setBlocks((prev) => prev.filter((_, i) => i !== bi))
                      }
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="mt-2 space-y-2 border-l-2 border-navy-100 pl-3">
                  {b.floors.map((f, fi) => (
                    <div key={f.key} className="rounded-lg bg-navy-50/60 p-2">
                      <div className="flex items-end gap-2">
                        <div className="flex-1">
                          <label className="label">Этаж</label>
                          <input
                            className="input-sm w-full"
                            value={f.title}
                            disabled={readOnly}
                            onChange={(e) =>
                              setBlocks((prev) =>
                                prev.map((x, i) =>
                                  i === bi
                                    ? {
                                        ...x,
                                        floors: x.floors.map((y, j) =>
                                          j === fi
                                            ? { ...y, title: e.target.value }
                                            : y,
                                        ),
                                      }
                                    : x,
                                ),
                              )
                            }
                            maxLength={120}
                            placeholder="Например: 2 этаж"
                          />
                        </div>
                        {!readOnly && (
                          <button
                            type="button"
                            aria-label="Убрать этаж"
                            className="mb-1 rounded-lg p-1 text-navy-400 hover:bg-white hover:text-red-600"
                            onClick={() =>
                              setBlocks((prev) =>
                                prev.map((x, i) =>
                                  i === bi
                                    ? {
                                        ...x,
                                        floors: x.floors.filter(
                                          (_, j) => j !== fi,
                                        ),
                                      }
                                    : x,
                                ),
                              )
                            }
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      <div className="mt-2 space-y-1.5">
                        {f.rooms.map((r, ri) => (
                          <div key={r.key} className="flex flex-wrap items-end gap-2">
                            <div className="min-w-[9rem] flex-1">
                              <label className="label">Помещение</label>
                              <input
                                className="input-sm w-full"
                                value={r.title}
                                disabled={readOnly}
                                onChange={(e) =>
                                  setBlocks((prev) =>
                                    prev.map((x, i) =>
                                      i === bi
                                        ? {
                                            ...x,
                                            floors: x.floors.map((y, j) =>
                                              j === fi
                                                ? {
                                                    ...y,
                                                    rooms: y.rooms.map((z, k) =>
                                                      k === ri
                                                        ? {
                                                            ...z,
                                                            title: e.target.value,
                                                          }
                                                        : z,
                                                    ),
                                                  }
                                                : y,
                                            ),
                                          }
                                        : x,
                                    ),
                                  )
                                }
                                maxLength={120}
                                placeholder="Например: Кабинет 201"
                              />
                            </div>
                            <div className="w-24">
                              <label className="label">м²</label>
                              <input
                                type="number"
                                min={0}
                                className="input-sm w-full"
                                value={r.area}
                                disabled={readOnly}
                                onChange={(e) =>
                                  setBlocks((prev) =>
                                    prev.map((x, i) =>
                                      i === bi
                                        ? {
                                            ...x,
                                            floors: x.floors.map((y, j) =>
                                              j === fi
                                                ? {
                                                    ...y,
                                                    rooms: y.rooms.map((z, k) =>
                                                      k === ri
                                                        ? { ...z, area: e.target.value }
                                                        : z,
                                                    ),
                                                  }
                                                : y,
                                            ),
                                          }
                                        : x,
                                    ),
                                  )
                                }
                                placeholder="0"
                              />
                            </div>
                            {!readOnly && (
                              <button
                                type="button"
                                aria-label="Убрать помещение"
                                className="mb-1 rounded-lg p-1 text-navy-400 hover:bg-white hover:text-red-600"
                                onClick={() =>
                                  setBlocks((prev) =>
                                    prev.map((x, i) =>
                                      i === bi
                                        ? {
                                            ...x,
                                            floors: x.floors.map((y, j) =>
                                              j === fi
                                                ? {
                                                    ...y,
                                                    rooms: y.rooms.filter(
                                                      (_, k) => k !== ri,
                                                    ),
                                                  }
                                                : y,
                                            ),
                                          }
                                        : x,
                                    ),
                                  )
                                }
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        ))}
                        {!readOnly && (
                          <button
                            type="button"
                            className="btn-ghost !px-2 !py-1 text-xs"
                            onClick={() => addRoom(bi, fi)}
                          >
                            <Plus className="h-3.5 w-3.5" /> Помещение
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn-ghost !px-2 !py-1 text-xs"
                      onClick={() => addFloor(bi)}
                    >
                      <Plus className="h-3.5 w-3.5" /> Этаж
                    </button>
                  )}
                </div>
              </div>
            ))}

            {!readOnly && (
              <button
                type="button"
                className="btn-ghost w-full justify-center text-sm"
                onClick={addBlock}
              >
                <Plus className="h-4 w-4" /> Добавить блок
              </button>
            )}
          </div>
        )}

        {/* Итог: сколько получилось и сходится ли с площадью заказа */}
        <div className="rounded-xl bg-navy-50 px-3 py-2 text-sm">
          <div className="flex justify-between text-navy-700">
            <span>Помещений</span>
            <span className="tabular-nums">{rooms}</span>
          </div>
          <div className="flex justify-between font-semibold text-navy-900">
            <span>Площадь по разбивке</span>
            <span className="tabular-nums">{total} м²</span>
          </div>
          <div className="flex justify-between text-navy-600">
            <span>Площадь в заказе</span>
            <span className="tabular-nums">{orderArea} м²</span>
          </div>
          {total > 0 && total !== orderArea && (
            <p className="mt-1 text-xs font-medium text-amber-700">
              Разбивка не сходится с площадью заказа на{' '}
              {Math.abs(total - orderArea)} м²
            </p>
          )}
        </div>

        {!readOnly && (
          <>
            <label className="flex items-center gap-2 text-sm text-navy-700">
              <input
                type="checkbox"
                checked={applyArea}
                onChange={(e) => setApplyArea(e.target.checked)}
                disabled={total === 0}
              />
              Подставить {total} м² в площадь заказа
            </label>
            <p className="-mt-2 text-xs text-navy-500">
              Сумма заказа при этом не пересчитывается — проверьте её в карточке.
            </p>
          </>
        )}

        <div className="flex gap-2">
          <button className="btn-ghost flex-1 justify-center" onClick={onClose}>
            {readOnly ? 'Закрыть' : 'Отмена'}
          </button>
          {!readOnly && (
            <button
              className="btn-primary flex-1 justify-center"
              onClick={save}
              disabled={saving}
            >
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
