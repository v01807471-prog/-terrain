import { NODE_TYPES } from '../engine/graph/nodes.js';
import { previewGraph } from '../engine/graph/compiler.js';
import type { TerrainGraph } from '../engine/blueprint/graph.js';

type ApplyGraph = (graph: TerrainGraph) => void;

const labels: Record<string, string> = {
  scale: 'Масштаб', ox: 'Сдвиг X', oz: 'Сдвиг Z', oct: 'Октавы', ns: 'Сид узла',
  v: 'Значение', e: 'Степень', lo: 'Мин', hi: 'Макс', e0: 'От', e1: 'До',
  im: 'Вход мин', iM: 'Вход макс', om: 'Выход мин', oM: 'Выход макс',
  step: 'Шаг', sharp: 'Резкость', col: 'Цвет', color: 'Цвет', on: 'Включено',
  shallow: 'Мелкая вода', deep: 'Глубокая вода', level: 'Уровень моря',
  clarity: 'Прозрачность', wave: 'Высота волн', wscale: 'Размер волн',
  wspeed: 'Скорость волн', glint: 'Блики', foam: 'Пена', opacity: 'Непрозрачность',
  shore: 'Берег', fade: 'Дальность', near: 'Начало тумана', far: 'Конец тумана',
  asset: 'Текстура', tile: 'Размер тайла', tri: 'Триплан'
};

export class BlueprintNodeEditor {
  private graph: TerrainGraph;
  private readonly host: HTMLElement;
  private readonly apply: ApplyGraph;
  private zoom = 1;
  private selected: number | null = null;
  private pendingOutput: number | null = null;
  private previewTimer = 0;

  constructor(host: HTMLElement, graph: TerrainGraph, apply: ApplyGraph) {
    this.host = host;
    this.graph = structuredClone(graph);
    this.apply = apply;
    this.renderShell();
    this.render();
  }

  setGraph(graph: TerrainGraph): void {
    this.graph = structuredClone(graph);
    this.render();
  }

  private node(id: number): any { return this.graph.nodes.find(n => n.id === id); }

  private renderShell(): void {
    this.host.innerHTML = `
      <div class="v2-graph-window">
        <header class="v2-graph-toolbar">
          <strong>◈ Blueprint · Граф мира</strong>
          <label>Сид <input id="v2-g-seed" type="number"></label>
          <button data-action="random">🎲</button>
          <select id="v2-g-add"></select><button data-action="add">+ Узел</button>
          <button data-action="fit">Уместить</button>
          <button data-action="zoom-out">−</button><span id="v2-g-zoom">100%</span><button data-action="zoom-in">+</button>
          <button data-action="export">Экспорт</button><button data-action="import">Импорт</button>
          <input id="v2-g-file" type="file" accept=".json" hidden>
          <span class="v2-g-status" id="v2-g-status">Изменения применяются автоматически</span>
          <button class="v2-g-apply" data-action="apply">Применить</button>
          <button data-action="close">Закрыть</button>
        </header>
        <div class="v2-graph-body">
          <div class="v2-graph-scroll" id="v2-g-scroll">
            <div class="v2-graph-world" id="v2-g-world">
              <svg id="v2-g-links"></svg><div id="v2-g-nodes"></div>
            </div>
          </div>
          <aside class="v2-graph-inspector">
            <b>Узел и параметры</b><div id="v2-g-inspector">Выбери узел на поле графа.</div>
            <div class="v2-g-help">Выходная точка узла → входная точка другого узла. Клик по входу отключает соединение. Перетаскивай фон для перемещения поля. Ctrl + колесо — масштаб.</div>
          </aside>
        </div>
      </div>`;
    const add = this.el<HTMLSelectElement>('v2-g-add');
    for (const [type, def] of Object.entries(NODE_TYPES)) {
      if ((def as any).sink) continue;
      const option = document.createElement('option');
      option.value = type; option.textContent = (def as any).t;
      add.append(option);
    }
    for (const [type, def] of Object.entries(NODE_TYPES)) {
      if (!(def as any).sink) continue;
      const option = document.createElement('option');
      option.value = type; option.textContent = (def as any).t;
      add.append(option);
    }
    this.host.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
      button.addEventListener('click', () => this.action(button.dataset.action || ''));
    });
    this.el<HTMLInputElement>('v2-g-seed').addEventListener('change', e => {
      this.graph.seed = Number((e.currentTarget as HTMLInputElement).value) || 0;
      this.scheduleApply();
    });
    this.el('v2-g-scroll').addEventListener('wheel', e => {
      if (!(e as WheelEvent).ctrlKey) return;
      e.preventDefault();
      const ev = e as WheelEvent, rect = this.el('v2-g-scroll').getBoundingClientRect();
      this.setZoom(this.zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1), ev.clientX - rect.left, ev.clientY - rect.top);
    }, { passive: false });
    this.el('v2-g-scroll').addEventListener('pointerdown', e => this.panStart(e as PointerEvent));
    this.el<HTMLInputElement>('v2-g-file').addEventListener('change', e => void this.importFile((e.currentTarget as HTMLInputElement)));
  }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.host.querySelector<T>('#' + id)!;
  }

  private action(name: string): void {
    if (name === 'close') { this.host.classList.remove('open'); return; }
    if (name === 'add') this.addNode(this.el<HTMLSelectElement>('v2-g-add').value);
    if (name === 'fit') this.fit();
    if (name === 'zoom-in') this.setZoom(this.zoom * 1.2);
    if (name === 'zoom-out') this.setZoom(this.zoom / 1.2);
    if (name === 'random') {
      this.graph.seed = Math.floor(Math.random() * 99999);
      this.el<HTMLInputElement>('v2-g-seed').value = String(this.graph.seed);
      this.scheduleApply();
    }
    if (name === 'apply') this.applyGraph();
    if (name === 'export') this.exportGraph();
    if (name === 'import') this.el<HTMLInputElement>('v2-g-file').click();
  }

  private addNode(type: string): void {
    if ((NODE_TYPES as any)[type]?.sink && this.graph.nodes.some(n => n.type === type)) {
      this.status('Такой выход уже существует', true); return;
    }
    const id = Math.max(0, ...this.graph.nodes.map(n => n.id)) + 1;
    const scroll = this.el('v2-g-scroll');
    this.graph.nodes.push({ id, type, x: (scroll.scrollLeft + 100) / this.zoom, y: (scroll.scrollTop + 100) / this.zoom, p: {}, d: {}, in: {} });
    this.selected = id; this.render(); this.scheduleApply();
  }

  private removeNode(id: number): void {
    this.graph.nodes = this.graph.nodes.filter(n => n.id !== id);
    for (const node of this.graph.nodes) for (const key of Object.keys(node.in || {})) if (node.in[key] === id) delete node.in[key];
    this.selected = null; this.pendingOutput = null; this.render(); this.scheduleApply();
  }

  private connect(source: number, target: number, port: string): void {
    if (source === target) return;
    const src = this.node(source), dst = this.node(target);
    const sourceType = (NODE_TYPES as any)[src.type], targetType = (NODE_TYPES as any)[dst.type];
    const input = targetType.i.find((item: any[]) => item[0] === port);
    if (!input) return;
    if (sourceType.o === 'c' && input[1] !== 'c') { this.status('Цвет нельзя подключить к числовому входу', true); return; }
    if (this.dependsOn(source, target)) { this.status('Соединение создаст цикл', true); return; }
    dst.in[port] = source; this.pendingOutput = null; this.render(); this.scheduleApply();
  }

  private dependsOn(from: number, target: number, seen = new Set<number>()): boolean {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    const node = this.node(from);
    return !!node && Object.values(node.in || {}).some(id => typeof id === 'number' && this.dependsOn(id, target, seen));
  }

  private render(): void {
    this.el<HTMLInputElement>('v2-g-seed').value = String(this.graph.seed || 0);
    const nodes = this.el('v2-g-nodes'); nodes.innerHTML = '';
    for (const n of this.graph.nodes) {
      const type = (NODE_TYPES as any)[n.type]; if (!type) continue;
      n.p ||= {}; n.d ||= {}; n.in ||= {};
      const card = document.createElement('section');
      card.className = 'v2-gnode' + (type.o === 'c' ? ' is-color' : '') + (this.selected === n.id ? ' selected' : '');
      card.dataset.id = String(n.id); card.style.left = (n.x || 0) + 'px'; card.style.top = (n.y || 0) + 'px';
      const head = document.createElement('header'); head.textContent = type.t; card.append(head);
      head.addEventListener('pointerdown', e => this.dragNode(e, n, card));
      const preview = document.createElement('canvas'); preview.width = preview.height = 96; preview.className = 'v2-gnode-preview';
      preview.title = 'Предпросмотр значения узла'; card.append(preview);
      const inputs = document.createElement('div'); inputs.className = 'v2-gnode-ports';
      for (const [port, valueType, defaultValue] of type.i) {
        const row = document.createElement('div'); row.className = 'v2-gport';
        const dot = document.createElement('button'); dot.className = 'v2-gdot v2-gin' + (valueType === 'c' ? ' color' : '');
        dot.title = 'Вход ' + port; dot.addEventListener('click', () => {
          if (this.pendingOutput != null) this.connect(this.pendingOutput, n.id, port);
          else if (n.in[port] != null) { delete n.in[port]; this.render(); this.scheduleApply(); }
        });
        const label = document.createElement('span'); label.textContent = labels[port] || port; row.append(dot, label);
        if (defaultValue !== null && valueType === 'f' && n.in[port] == null) {
          const input = document.createElement('input'); input.type = 'number'; input.step = 'any';
          input.value = String(n.d[port] ?? defaultValue);
          input.addEventListener('change', () => { n.d[port] = Number(input.value); this.scheduleApply(); });
          row.append(input);
        }
        inputs.append(row);
      }
      card.append(inputs);
      for (const [key, def, kind] of type.p) {
        const row = document.createElement('div'); row.className = 'v2-gparam';
        const label = document.createElement('label'); label.textContent = labels[key] || key; row.append(label);
        if (kind === 'color') {
          const input = document.createElement('input'); input.type = 'color'; input.value = n.p[key] ?? def;
          input.addEventListener('input', () => { n.p[key] = input.value; this.scheduleApply(); });
          row.append(input);
        } else {
          const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.value = String(n.p[key] ?? def);
          input.addEventListener('change', () => { n.p[key] = Number(input.value); this.scheduleApply(); });
          row.append(input);
        }
        card.append(row);
      }
      const footer = document.createElement('footer');
      if (!type.sink) {
        const out = document.createElement('button'); out.className = 'v2-gdot v2-gout' + (this.pendingOutput === n.id ? ' active' : '');
        out.title = 'Выход узла — нажми, затем выбери вход'; out.addEventListener('click', () => { this.pendingOutput = this.pendingOutput === n.id ? null : n.id; this.render(); });
        footer.append('Выход', out);
      }
      if (!['out_height', 'out_color', 'out_water', 'out_fog'].includes(n.type)) {
        const del = document.createElement('button'); del.textContent = 'Удалить'; del.addEventListener('click', () => this.removeNode(n.id)); footer.append(del);
      }
      card.append(footer);
      card.addEventListener('pointerdown', () => { this.selected = n.id; this.renderInspector(n); });
      nodes.append(card);
    }
    this.drawLinks();
    this.renderInspector(this.selected == null ? null : this.node(this.selected));
    this.schedulePreview();
    this.el('v2-g-world').style.transform = 'scale(' + this.zoom + ')';
    this.el('v2-g-world').style.transformOrigin = '0 0';
    this.el('v2-g-world').style.width = (3200 * this.zoom) + 'px';
    this.el('v2-g-world').style.height = (2000 * this.zoom) + 'px';
    this.el('v2-g-zoom').textContent = Math.round(this.zoom * 100) + '%';
  }

  private renderInspector(n: any): void {
    const host = this.el('v2-g-inspector'); host.innerHTML = '';
    if (!n) { host.textContent = 'Выбери узел на поле графа.'; return; }
    const title = document.createElement('h3'); title.textContent = (NODE_TYPES as any)[n.type].t; host.append(title);
    const info = document.createElement('p'); info.textContent = 'ID: ' + n.id + ' · Тип: ' + n.type; host.append(info);
    const del = document.createElement('button'); del.textContent = 'Удалить узел'; del.addEventListener('click', () => this.removeNode(n.id)); host.append(del);
  }

  private drawLinks(): void {
    const world = this.el('v2-g-world'), svg = this.el<SVGSVGElement>('v2-g-links');
    const rect = world.getBoundingClientRect();
    svg.setAttribute('width', '3200'); svg.setAttribute('height', '2000'); svg.innerHTML = '';
    for (const node of this.graph.nodes) for (const [port, source] of Object.entries(node.in || {})) {
      const src = this.node(source as number); if (!src) continue;
      const a = this.host.querySelector<HTMLElement>('.v2-gout[data-node="' + src.id + '"]');
      const b = this.host.querySelector<HTMLElement>('.v2-gin[data-node="' + node.id + '"][data-port="' + port + '"]');
      if (!a || !b) continue;
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      const x1 = (ar.left + ar.width / 2 - rect.left) / this.zoom, y1 = (ar.top + ar.height / 2 - rect.top) / this.zoom;
      const x2 = (br.left + br.width / 2 - rect.left) / this.zoom, y2 = (br.top + br.height / 2 - rect.top) / this.zoom;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M' + x1 + ' ' + y1 + ' C' + (x1 + 70) + ' ' + y1 + ',' + (x2 - 70) + ' ' + y2 + ',' + x2 + ' ' + y2);
      path.setAttribute('stroke', (NODE_TYPES as any)[src.type].o === 'c' ? '#ffb86b' : '#7fd1ff');
      path.setAttribute('stroke-width', '2'); path.setAttribute('fill', 'none'); svg.append(path);
    }
  }

  private dragNode(e: PointerEvent, node: any, card: HTMLElement): void {
    if (e.button !== 0) return;
    e.stopPropagation(); const sx = e.clientX, sy = e.clientY, x = node.x || 0, y = node.y || 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      node.x = Math.max(0, x + (ev.clientX - sx) / this.zoom);
      node.y = Math.max(0, y + (ev.clientY - sy) / this.zoom);
      card.style.left = node.x + 'px'; card.style.top = node.y + 'px'; this.drawLinks();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
  }

  private panStart(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest('.v2-gnode') || target.closest('button') || target.closest('input')) return;
    const scroll = this.el('v2-g-scroll'), sx = e.clientX, sy = e.clientY, left = scroll.scrollLeft, top = scroll.scrollTop;
    const move = (ev: PointerEvent) => { scroll.scrollLeft = left - (ev.clientX - sx); scroll.scrollTop = top - (ev.clientY - sy); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
  }

  private setZoom(value: number, x?: number, y?: number): void {
    const scroll = this.el('v2-g-scroll'), fx = x ?? scroll.clientWidth / 2, fy = y ?? scroll.clientHeight / 2;
    const cx = (scroll.scrollLeft + fx) / this.zoom, cy = (scroll.scrollTop + fy) / this.zoom;
    this.zoom = Math.max(.35, Math.min(1.6, value));
    this.el('v2-g-world').style.transform = 'scale(' + this.zoom + ')';
    this.el('v2-g-world').style.width = (3200 * this.zoom) + 'px'; this.el('v2-g-world').style.height = (2000 * this.zoom) + 'px';
    this.el('v2-g-zoom').textContent = Math.round(this.zoom * 100) + '%';
    scroll.scrollLeft = cx * this.zoom - fx; scroll.scrollTop = cy * this.zoom - fy; this.drawLinks();
  }

  private fit(): void {
    const scroll = this.el('v2-g-scroll');
    const xs = this.graph.nodes.map(n => n.x || 0), ys = this.graph.nodes.map(n => n.y || 0);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs) + 260, y1 = Math.max(...ys) + 360;
    this.setZoom(Math.min(1.2, Math.max(.35, Math.min(scroll.clientWidth / (x1 - x0 + 80), scroll.clientHeight / (y1 - y0 + 80)))));
    scroll.scrollLeft = Math.max(0, (x0 - 40) * this.zoom); scroll.scrollTop = Math.max(0, (y0 - 40) * this.zoom);
  }

  private schedulePreview(): void {
    window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => {
      try {
        const result = previewGraph(this.graph, 0, 0, 400, 48, null);
        for (const canvas of this.host.querySelectorAll<HTMLCanvasElement>('.v2-gnode-preview')) {
          const node = this.node(Number(canvas.parentElement?.dataset.id)); if (!node) continue;
          const type = (NODE_TYPES as any)[node.type], sample = result.map.get(node.id), ctx = canvas.getContext('2d')!;
          if (node.type === 'color') { ctx.fillStyle = node.p?.col || '#808080'; ctx.fillRect(0, 0, 96, 96); continue; }
          if (node.type === 'out_water') { ctx.fillStyle = node.p?.shallow || '#2f9aa3'; ctx.fillRect(0, 0, 96, 96); continue; }
          if (!sample) { ctx.fillStyle = '#151d23'; ctx.fillRect(0, 0, 96, 96); continue; }
          const data = ctx.createImageData(48, 48);
          for (let i = 0; i < 48 * 48; i++) {
            if (sample.c) {
              data.data[i * 4] = Math.round(Math.min(1, sample.data[i * 3]) * 255);
              data.data[i * 4 + 1] = Math.round(Math.min(1, sample.data[i * 3 + 1]) * 255);
              data.data[i * 4 + 2] = Math.round(Math.min(1, sample.data[i * 3 + 2]) * 255);
            } else {
              const value = Math.round(255 * (sample.data[i] - sample.min) / Math.max(1e-6, sample.max - sample.min));
              data.data[i * 4] = data.data[i * 4 + 1] = data.data[i * 4 + 2] = value;
            }
            data.data[i * 4 + 3] = 255;
          }
          ctx.putImageData(data, 0, 0);
        }
      } catch (error) { this.status(error instanceof Error ? error.message : 'Ошибка предпросмотра', true); }
    }, 160);
  }

  private scheduleApply(): void {
    this.status('Изменения…');
    window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => this.applyGraph(), 500);
  }

  private applyGraph(): void {
    try { this.apply(structuredClone(this.graph)); this.status('Граф применён ✔'); }
    catch (error) { this.status(error instanceof Error ? error.message : 'Ошибка компиляции', true); }
  }

  private status(message: string, error = false): void {
    const el = this.el('v2-g-status'); el.textContent = message; el.classList.toggle('error', error);
  }

  private exportGraph(): void {
    const blob = new Blob([JSON.stringify(this.graph, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'terrain-v2-blueprint.json'; a.click(); URL.revokeObjectURL(url);
  }

  private async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0]; if (!file) return;
    try {
      const graph = JSON.parse(await file.text()) as TerrainGraph;
      if (!graph || !Array.isArray(graph.nodes)) throw new Error('Неверный файл Blueprint');
      this.graph = graph; this.render(); this.applyGraph();
    } catch (error) { this.status(error instanceof Error ? error.message : 'Ошибка импорта', true); }
    input.value = '';
  }
}
