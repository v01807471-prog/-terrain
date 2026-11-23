import type { StrokeHistoryEntry } from './StrokeHistory.js';

export type StrokeValueReader = (index: number) => number;

/**
 * Собирает уникальные изменения одного мазка в legacy-формат idx/old/nw.
 * Буфер меток переиспользуется между мазками и не создаёт карту правок мира.
 */
export class StrokeJournal {
  private readonly marks: Uint32Array;
  private strokeId = 0;
  private readonly indices: number[] = [];
  private readonly oldValues: number[] = [];
  private active = false;

  constructor(readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 0x7fffffff) {
      throw new Error('Размер журнала мазков должен быть положительным целым числом в диапазоне Int32');
    }
    this.marks = new Uint32Array(capacity);
  }

  get size(): number {
    return this.indices.length;
  }

  /** Начинает мазок и отбрасывает незавершённую запись предыдущего мазка. */
  begin(): void {
    if (this.strokeId === 0xffffffff) {
      this.marks.fill(0);
      this.strokeId = 1;
    } else {
      this.strokeId++;
    }
    this.indices.length = 0;
    this.oldValues.length = 0;
    this.active = true;
  }

  /** Запоминает исходное значение индекса только при первом касании в мазке. */
  capture(index: number, currentValue: number): boolean {
    if (!this.active) {
      throw new Error('Нельзя записывать изменение вне активного мазка');
    }
    if (!Number.isInteger(index) || index < 0 || index >= this.capacity) {
      throw new Error('Индекс изменения выходит за границы журнала мазков');
    }
    if (this.marks[index] === this.strokeId) return false;

    this.marks[index] = this.strokeId;
    this.indices.push(index);
    this.oldValues.push(currentValue);
    return true;
  }

  /** Завершает мазок, считывая итоговые значения из исходного хранилища. */
  finish(readCurrentValue: StrokeValueReader): StrokeHistoryEntry | null {
    if (!this.active) return null;
    if (this.indices.length === 0) {
      this.reset();
      return null;
    }

    const idx = Int32Array.from(this.indices);
    const old = Float32Array.from(this.oldValues);
    const nw = new Float32Array(idx.length);
    for (let i = 0; i < idx.length; i++) nw[i] = readCurrentValue(idx[i]);

    this.reset();
    return { idx, old, nw };
  }

  /** Отменяет незавершённый мазок без создания записи истории. */
  cancel(): void {
    this.reset();
  }

  private reset(): void {
    this.indices.length = 0;
    this.oldValues.length = 0;
    this.active = false;
  }
}
