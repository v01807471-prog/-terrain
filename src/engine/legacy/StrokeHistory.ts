/** Записи изменений карты высот, совместимые с форматом legacy-редактора. */
export interface StrokeHistoryEntry {
  idx: Int32Array;
  old: Float32Array;
  nw: Float32Array;
}

export type ApplyStrokeHistoryEntry = (
  entry: StrokeHistoryEntry,
  useNewValues: boolean
) => void;

/**
 * Ограниченная история мазков. Модуль управляет только записями и порядком
 * undo/redo; применение данных остаётся ответственностью редактора.
 */
export class StrokeHistory {
  readonly undoStack: StrokeHistoryEntry[] = [];
  readonly redoStack: StrokeHistoryEntry[] = [];

  constructor(readonly maxEntries = 30) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('Лимит истории мазков должен быть положительным целым числом');
    }
  }

  /** Добавляет завершённое изменение и начинает новую ветку истории. */
  record(entry: StrokeHistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.maxEntries) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(apply: ApplyStrokeHistoryEntry): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    apply(entry, false);
    this.redoStack.push(entry);
    return true;
  }

  redo(apply: ApplyStrokeHistoryEntry): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    apply(entry, true);
    this.undoStack.push(entry);
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
