import { StrokeHistory, type StrokeHistoryEntry } from './StrokeHistory.js';

export function runStrokeHistorySelfTests(): { passed: string[] } {
  const passed: string[] = [];
  const assert = (condition: boolean, message: string): void => {
    if (!condition) throw new Error('Stroke history self-test: ' + message);
    passed.push(message);
  };
  const makeEntry = (index: number, oldValue: number, newValue: number): StrokeHistoryEntry => ({
    idx: Int32Array.of(index),
    old: Float32Array.of(oldValue),
    nw: Float32Array.of(newValue)
  });

  const history = new StrokeHistory(2);
  const values = Float32Array.of(11, 21, 31, 41);
  const first = makeEntry(0, 10, 11);
  const second = makeEntry(1, 20, 21);
  const third = makeEntry(2, 30, 31);
  const fourth = makeEntry(3, 40, 41);
  const apply = (entry: StrokeHistoryEntry, useNewValues: boolean): void => {
    const source = useNewValues ? entry.nw : entry.old;
    for (let i = 0; i < entry.idx.length; i++) values[entry.idx[i]] = source[i];
  };

  assert(!history.undo(apply) && !history.redo(apply),
    'пустая история безопасно отклоняет undo и redo');
  history.record(first);
  history.record(second);
  history.record(third);
  assert(history.undoStack.length === 2
    && history.undoStack[0] === second
    && history.undoStack[1] === third,
  'ограничение истории удаляет только самый старый мазок');

  assert(history.undo(apply)
    && values[2] === 30
    && history.undoStack.length === 1
    && history.redoStack[0] === third,
  'undo восстанавливает старые значения и переносит запись в redo');
  assert(history.redo(apply)
    && values[2] === 31
    && history.undoStack[1] === third
    && history.redoStack.length === 0,
  'redo повторно применяет новые значения и возвращает запись в undo');

  history.undo(apply);
  history.record(fourth);
  assert(history.redoStack.length === 0 && history.undoStack.at(-1) === fourth,
    'новый мазок после undo очищает устаревшую ветку redo');
  history.clear();
  assert(history.undoStack.length === 0 && history.redoStack.length === 0,
    'сброс области правок очищает обе части истории');

  return { passed };
}
