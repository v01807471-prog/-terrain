import { StrokeJournal } from './StrokeJournal.js';

export function runStrokeJournalSelfTests(): { passed: string[] } {
  const passed: string[] = [];
  const assert = (condition: boolean, message: string): void => {
    if (!condition) throw new Error('Stroke journal self-test: ' + message);
    passed.push(message);
  };

  const journal = new StrokeJournal(8);
  const values = Float32Array.of(10, 20, 30, 40, 50, 60, 70, 80);
  assert(journal.finish(index => values[index]) === null,
    'пустой журнал не создаёт запись вне активного мазка');

  journal.begin();
  assert(journal.capture(2, values[2]), 'первое касание индекса добавляет его в журнал');
  assert(!journal.capture(2, -100) && journal.size === 1,
    'повторное касание индекса не перезаписывает исходное значение');
  assert(journal.capture(5, values[5]) && journal.size === 2,
    'разные индексы сохраняются в порядке первого касания');

  values[2] = 33;
  values[5] = 66;
  const entry = journal.finish(index => values[index]);
  assert(entry !== null
    && entry.idx.length === 2
    && entry.idx[0] === 2
    && entry.idx[1] === 5,
  'запись сохраняет уникальные индексы в legacy-формате');
  assert(entry !== null
    && entry.old[0] === 30
    && entry.old[1] === 60
    && entry.nw[0] === 33
    && entry.nw[1] === 66,
  'запись содержит исходные и итоговые значения из хранилища');
  assert(journal.size === 0 && journal.finish(index => values[index]) === null,
    'завершение освобождает временные списки и не дублирует команду');

  journal.begin();
  assert(journal.capture(2, values[2]),
    'следующий мазок повторно может изменить тот же индекс');
  journal.cancel();
  assert(journal.size === 0 && journal.finish(index => values[index]) === null,
    'отмена незавершённого мазка не создаёт команду');

  journal.begin();
  assert(journal.capture(4, values[4]), 'новый мазок начинает независимый журнал');
  journal.begin();
  assert(journal.size === 0 && journal.capture(4, values[4]),
    'повторный begin отбрасывает незавершённые записи прошлого мазка');

  let inactiveRejected = false;
  journal.finish(index => values[index]);
  try {
    journal.capture(1, values[1]);
  } catch {
    inactiveRejected = true;
  }
  assert(inactiveRejected, 'запись вне активного мазка обнаруживается');

  let boundsRejected = false;
  journal.begin();
  try {
    journal.capture(8, 0);
  } catch {
    boundsRejected = true;
  }
  assert(boundsRejected, 'индексы за пределами хранилища отклоняются');

  return { passed };
}
