import * as THREE from 'three';
import { Terrain } from '../engine/terrain/Terrain.js';
import { createDefaultTerrainGraph, createTerrainPresetGraph, compileTerrainGraph } from '../engine/blueprint/graph.js';
import { NODE_TYPES } from '../engine/graph/nodes.js';
import { previewGraph } from '../engine/graph/compiler.js';
import { BUILTIN_TEXTURE_ASSETS, createBuiltinTexture } from '../engine/textures/assets.js';
import { TerrainRenderer } from '../engine/renderer/TerrainRenderer.js';
import { WaterRenderer } from '../engine/renderer/WaterRenderer.js';
import { PhysicsWorld } from '../engine/physics/PhysicsWorld.js';
import { FixedStepLoop } from '../engine/physics/FixedStepLoop.js';
import { CpuTerrainSurfaceDebug } from './CpuTerrainSurfaceDebug.js';
import './physics-demo.css';

class BlueprintNodeEditor {
  private graph: ReturnType<typeof createDefaultTerrainGraph>;
  private host: HTMLElement; private viewport: HTMLElement; private viewportMarker: Comment; private apply: (g: ReturnType<typeof createDefaultTerrainGraph>) => void;
  private zoom=1; private assetCanvases=new Map<string,HTMLCanvasElement>(); private selected:number|null=null; private pending:number|null=null; private timer=0; private previewTimer=0;
  constructor(host:HTMLElement,graph:ReturnType<typeof createDefaultTerrainGraph>,apply:(g:ReturnType<typeof createDefaultTerrainGraph>)=>void,viewport:HTMLElement){
    this.host=host;this.viewport=viewport;this.viewportMarker=document.createComment("terrain-preview-home");viewport.parentNode!.insertBefore(this.viewportMarker,viewport);this.graph=structuredClone(graph);this.graph.nodes.forEach((n,i)=>{n.x??=30+(i%5)*300;n.y??=30+Math.floor(i/5)*380;});this.apply=apply;this.shell();this.render();
  }
  private el<T extends Element=HTMLElement>(id:string):T{return this.host.querySelector<T>('#'+id)!;}
  open():void{
    this.host.classList.add('open');
    this.el('v2g-preview-slot').append(this.viewport);
    this.viewport.classList.add('v2g-live-preview');
    const side=document.querySelector<HTMLElement>('.pv2-side');
    if(side)this.el('v2g-preview-inspector-slot').append(side);
    requestAnimationFrame(()=>{this.fit();window.dispatchEvent(new Event('resize'));});
  }
  private close():void{this.viewport.classList.remove('v2g-live-preview');this.viewportMarker.parentNode?.insertBefore(this.viewport,this.viewportMarker);this.host.classList.remove('open','preview-expanded');window.dispatchEvent(new Event('resize'));}
  private node(id:number):any{return this.graph.nodes.find(n=>n.id===id);}
  private shell():void{
    this.host.innerHTML=`<div class="v2-graph-window">
      <header class="v2-graph-toolbar">
        <div class="v2g-brand"><span class="v2g-brand-mark">◈</span><div><b>Terrain</b><small>WORLD GRAPH</small></div></div>
        <div class="v2g-toolbar-separator"></div>
        <select id="v2g-preset" aria-label="Пресет мира"><option value="regions">Регионы</option><option value="plains">Равнины</option><option value="mountains">Горы</option><option value="desert">Пустыня</option><option value="islands">Острова</option></select>
        <button data-a="preset" title="Загрузить пресет" aria-label="Загрузить пресет">⟳</button>
        <label class="v2g-seed-label">SEED <input id="v2g-seed" type="number"></label>
        <button data-a="random" title="Случайный seed" aria-label="Случайный seed">⚄</button>
        <div class="v2g-toolbar-separator"></div>
        <select id="v2g-add" aria-label="Тип нового узла"></select><button data-a="add" title="Добавить узел" aria-label="Добавить узел">＋</button>
        <button data-a="assets" title="Библиотека текстур" aria-label="Библиотека текстур">▧</button>
        <button data-a="diagnostics" title="Предпросмотр и инспектор" aria-label="Предпросмотр и инспектор">◫</button>
        <button data-a="physics" title="Отладка физики" aria-label="Отладка физики">⚙</button>
        <button data-a="wire" title="Показать сетку" aria-label="Показать сетку">▦</button>
        <label class="v2g-sun-control" title="Время суток">☼ <input id="v2g-sun-time" type="range" min="0" max="1" step="0.001" value="0.36"></label>
        <div class="v2g-toolbar-spacer"></div>
        <button data-a="fit" title="Уместить все узлы" aria-label="Уместить все узлы">⌖</button>
        <button data-a="minus" title="Уменьшить масштаб">−</button><span id="v2g-zoom">100%</span><button data-a="plus" title="Увеличить масштаб">＋</button>
        <div class="v2g-toolbar-separator"></div>
        <button data-a="export" title="Экспорт Blueprint" aria-label="Экспорт Blueprint">⇧</button>
        <button data-a="import" title="Импорт Blueprint" aria-label="Импорт Blueprint">⇩</button><input id="v2g-file" type="file" accept=".json" hidden>
        <span id="v2g-status">Граф готов</span>
        <button data-a="apply" class="v2g-apply-button">Применить</button>
        <button data-a="close" title="Вернуться в сцену" aria-label="Вернуться в сцену">↗</button>
      </header>
      <main class="v2-graph-body">
        <div id="v2g-scroll" class="v2-graph-scroll">
          <div id="v2g-world" class="v2-graph-world"><svg id="v2g-links"></svg><div id="v2g-nodes"></div></div>
          <div class="v2g-canvas-help">Колесо + Ctrl — масштаб · перетаскивание фона — перемещение · выход → вход — связь · Delete — удалить узел</div>
        </div>
      </main>
      <section class="v2-graph-preview-dock">
        <div class="v2-graph-preview-caption"><b>ПРЕДПРОСМОТР СЦЕНЫ</b><span>Живой рендер</span><button data-a="preview" aria-label="Открыть окно предпросмотра">⤢</button></div>
        <div id="v2g-preview-slot"></div>
        <aside class="v2g-preview-inspector"><div class="v2g-preview-inspector-title">ИНСПЕКТОР СЦЕНЫ</div><div id="v2g-preview-inspector-slot"></div></aside>
      </section>
      <aside class="v2g-asset-drawer"><div class="v2g-asset-heading"><b>Библиотека материалов</b><span>Выберите материал, чтобы добавить его в граф</span></div><div id="v2g-assets-list"></div></aside>
    </div>`;
    const sel=this.el<HTMLSelectElement>('v2g-add');
    for(const [type,t] of Object.entries(NODE_TYPES)){const o=document.createElement('option');o.value=type;o.textContent=(t as any).t;sel.append(o);}
    this.host.querySelectorAll<HTMLButtonElement>('[data-a]').forEach(b=>b.onclick=()=>this.action(b.dataset.a||''));
    this.el<HTMLInputElement>('v2g-seed').onchange=e=>{this.graph.seed=Number((e.target as HTMLInputElement).value)||0;this.schedule();};
    this.el<HTMLInputElement>('v2g-file').onchange=e=>void this.importFile(e.currentTarget as HTMLInputElement);
    this.el('v2g-scroll').addEventListener('wheel',e=>{const w=e as WheelEvent;if(!w.ctrlKey)return;w.preventDefault();const r=this.el('v2g-scroll').getBoundingClientRect();this.zoomAt(this.zoom*(w.deltaY<0?1.1:.91),w.clientX-r.left,w.clientY-r.top);},{passive:false});
    this.el('v2g-scroll').addEventListener('pointerdown',e=>this.pan(e as PointerEvent));
  }
  private action(a:string):void{
    if(a==='close'){this.close();return;}
    if(a==='preview'){this.host.classList.toggle('preview-expanded');requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));return;}
    if(a==='assets'){this.host.classList.toggle('assets-open');this.host.classList.remove('diagnostics-open');return;}
    if(a==='diagnostics'){this.host.classList.add('preview-expanded');this.host.classList.remove('assets-open');requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));return;}
    if(a==='physics'){const input=document.querySelector<HTMLInputElement>('#pv2-physics-debug')!;input.checked=!input.checked;input.dispatchEvent(new Event('change'));}
    if(a==='wire'){const input=document.querySelector<HTMLInputElement>('#pv2-wire')!;input.checked=!input.checked;input.dispatchEvent(new Event('change'));}
    if(a==='add')this.add(this.el<HTMLSelectElement>('v2g-add').value);
    if(a==='preset'){const preset=this.el<HTMLSelectElement>('v2g-preset').value as any;this.graph=createTerrainPresetGraph(preset,this.graph.seed);this.graph.nodes.forEach((n,i)=>{n.x=30+(i%5)*250;n.y=30+Math.floor(i/5)*250;});this.selected=null;this.render();this.applyNow();}
    if(a==='apply')this.applyNow();
    if(a==='fit')this.fit();
    if(a==='plus')this.zoomAt(this.zoom*1.2);
    if(a==='minus')this.zoomAt(this.zoom/1.2);
    if(a==='random'){this.graph.seed=Math.floor(Math.random()*99999);this.el<HTMLInputElement>('v2g-seed').value=String(this.graph.seed);this.schedule();}
    if(a==='export'){const blob=new Blob([JSON.stringify(this.graph,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='terrain-blueprint.json';link.click();URL.revokeObjectURL(url);}
    if(a==='import')this.el<HTMLInputElement>('v2g-file').click();
  }
  private add(type:string):void{
    if((NODE_TYPES as any)[type]?.sink&&this.graph.nodes.some(n=>n.type===type)){this.status('Такой выход уже есть');return;}
    const id=Math.max(0,...this.graph.nodes.map(n=>n.id))+1,sc=this.el('v2g-scroll');
    this.graph.nodes.push({id,type,x:(sc.scrollLeft+120)/this.zoom,y:(sc.scrollTop+100)/this.zoom,p:{},d:{},in:{}});
    this.selected=id;this.render();this.schedule();
  }
  private remove(id:number):void{
    this.graph.nodes=this.graph.nodes.filter(n=>n.id!==id);
    for(const n of this.graph.nodes){const inputs=n.in;if(!inputs)continue;for(const k of Object.keys(inputs))if(inputs[k]===id)delete inputs[k];}
    this.selected=null;this.pending=null;this.render();this.schedule();
  }
  private cycle(from:number,to:number,seen=new Set<number>()):boolean{
    if(from===to)return true;if(seen.has(from))return false;seen.add(from);
    const n=this.node(from);return !!n&&Object.values(n.in||{}).some(v=>typeof v==='number'&&this.cycle(v,to,seen));
  }
  private connect(from:number,to:number,port:string):void{
    const a=this.node(from),b=this.node(to),input=(NODE_TYPES as any)[b.type].i.find((p:any[])=>p[0]===port);
    if(!a||!b||!input||from===to)return;
    if((NODE_TYPES as any)[a.type].o==='c'&&input[1]!=='c'){this.status('Нельзя соединить цвет с числовым входом');return;}
    if(this.cycle(from,to)){this.status('Нельзя создавать циклическую связь');return;}
    b.in[port]=from;this.pending=null;this.render();this.schedule();
  }
  private render():void{
    this.el<HTMLInputElement>('v2g-seed').value=String(this.graph.seed||0);
    const host=this.el('v2g-nodes');host.innerHTML='';
    for(const n of this.graph.nodes){
      const t=(NODE_TYPES as any)[n.type];if(!t)continue;const nodeParams=n.p??(n.p={}),nodeDefaults=n.d??(n.d={}),nodeInputs=n.in??(n.in={});
      const card=document.createElement('section');card.className='v2-gnode'+(t.o==='c'?' color':'')+(this.selected===n.id?' selected':'');card.dataset.id=String(n.id);card.style.left=(n.x||0)+'px';card.style.top=(n.y||0)+'px';
      const head=document.createElement('header');const mark=document.createElement('span');mark.className='v2g-node-mark';mark.textContent=t.sink?'◉':t.o==='c'?'◈':'ƒ';const title=document.createElement('span');title.textContent=t.t;head.append(mark,title);head.onpointerdown=e=>this.drag(e,n,card);card.append(head);
      const cv=document.createElement('canvas');cv.width=cv.height=80;cv.className='v2-gnode-preview';card.append(cv);
      for(const [port,ty,def] of t.i){
        const row=document.createElement('div');row.className='v2-gport';
        const dot=document.createElement('button');dot.className='v2-gdot v2-gin'+(ty==='c'?' color':'');dot.dataset.node=String(n.id);dot.dataset.port=port;dot.onclick=()=>{
          if(this.pending!==null)this.connect(this.pending,n.id,port);
          else if(nodeInputs[port]!=null){delete nodeInputs[port];this.render();this.schedule();}
        };
        const label=document.createElement('span');label.textContent=port;row.append(dot,label);
        if(def!==null&&ty==='f'&&nodeInputs[port]==null){const input=document.createElement('input');input.type='number';input.step='any';input.value=String(nodeDefaults[port]??def);input.onchange=()=>{nodeDefaults[port]=Number(input.value);this.schedule();};row.append(input);}
        card.append(row);
      }
      for(const [key,def,kind] of t.p){
        const row=document.createElement('div');row.className='v2-gparam';const label=document.createElement('label');label.textContent=key;row.append(label);
        if(kind==='asset'){
          const select=document.createElement('select');for(const asset of BUILTIN_TEXTURE_ASSETS){const option=document.createElement('option');option.value=asset.id;option.textContent=asset.name;select.append(option);}select.value=String(nodeParams[key]??def);select.onchange=()=>{nodeParams[key]=select.value;this.schedule();};row.append(select);
        }else{
          const input=document.createElement('input');input.type=kind==='color'?'color':'number';input.step='any';input.value=String(n.p[key]??def);
          input.onchange=()=>{nodeParams[key]=kind==='color'?input.value:Number(input.value);this.schedule();};row.append(input);
        }
        card.append(row);
      }
      const foot=document.createElement('footer');
      if(!t.sink){const out=document.createElement('button');out.className='v2-gdot v2-gout'+(this.pending===n.id?' active':'');out.dataset.node=String(n.id);out.textContent='●';out.onclick=()=>{this.pending=this.pending===n.id?null:n.id;this.render();};foot.append('Выход ',out);}
      if(!['out_height','out_color','out_water','out_fog'].includes(n.type)){const del=document.createElement('button');del.textContent='Удалить';del.onclick=()=>this.remove(n.id);foot.append(del);}
      card.append(foot);card.onpointerdown=()=>{this.selected=n.id;host.querySelectorAll('.v2-gnode').forEach(el=>el.classList.toggle('selected',Number((el as HTMLElement).dataset.id)===n.id));};host.append(card);
    }
    this.el('v2g-world').style.transform='scale('+this.zoom+')';this.updateWorldBounds();
    this.drawLinks();this.renderAssetLibrary();
    this.el('v2g-zoom').textContent=Math.round(this.zoom*100)+'%';this.preview();
  }
  private assetCanvas(id:string):HTMLCanvasElement{
    let canvas=this.assetCanvases.get(id);if(canvas)return canvas;
    const texture=createBuiltinTexture(id,128),data=texture.image.data as Uint8Array,ctxCanvas=document.createElement('canvas');ctxCanvas.width=ctxCanvas.height=128;
    const ctx=ctxCanvas.getContext('2d')!;const pixels=new Uint8ClampedArray(data);ctx.putImageData(new ImageData(pixels,128,128),0,0);texture.dispose();this.assetCanvases.set(id,ctxCanvas);return ctxCanvas;
  }
  private renderAssetLibrary():void{
    const host=this.el('v2g-assets-list');host.innerHTML='';
    for(const asset of BUILTIN_TEXTURE_ASSETS){
      const card=document.createElement('button');card.className='v2g-asset-card';card.type='button';card.title=asset.description;
      const preview=document.createElement('canvas');preview.width=preview.height=96;preview.getContext('2d')!.drawImage(this.assetCanvas(asset.id),0,0,96,96);
      const name=document.createElement('b');name.textContent=asset.name;const category=document.createElement('span');category.textContent=asset.category;
      const action=document.createElement('small');action.textContent='+ Добавить узел';
      card.append(preview,name,category,action);card.onclick=()=>this.addAsset(asset.id);host.append(card);
    }
  }
  private addAsset(assetId:string):void{
    const id=Math.max(0,...this.graph.nodes.map(n=>n.id))+1,sc=this.el('v2g-scroll');
    this.graph.nodes.push({id,type:'tex_asset',x:(sc.scrollLeft+120)/this.zoom,y:(sc.scrollTop+100)/this.zoom,p:{asset:assetId,tile:4,tri:0},d:{},in:{}});
    this.selected=id;this.render();this.schedule();this.status('Текстура добавлена в граф. Соедини выход с узлом цвета.');
  }
  
  private drawLinks():void{
    const world=this.el('v2g-world'),svg=this.el<SVGSVGElement>('v2g-links'),r=world.getBoundingClientRect();svg.innerHTML='';svg.setAttribute('width',String(world.offsetWidth));svg.setAttribute('height',String(world.offsetHeight));
    for(const n of this.graph.nodes)for(const [port,source] of Object.entries(n.in||{})){
      const src=this.node(source as number);if(!src)continue;
      const a=this.host.querySelector<HTMLElement>('.v2-gout[data-node="'+src.id+'"]'),b=this.host.querySelector<HTMLElement>('.v2-gin[data-node="'+n.id+'"][data-port="'+port+'"]');if(!a||!b)continue;
      const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect(),path=document.createElementNS('http://www.w3.org/2000/svg','path');
      const x1=(ar.left+ar.width/2-r.left)/this.zoom,y1=(ar.top+ar.height/2-r.top)/this.zoom,x2=(br.left+br.width/2-r.left)/this.zoom,y2=(br.top+br.height/2-r.top)/this.zoom;
      path.setAttribute('d',`M${x1} ${y1} C${x1+65} ${y1},${x2-65} ${y2},${x2} ${y2}`);path.setAttribute('stroke',(NODE_TYPES as any)[src.type].o==='c'?'#ffb86b':'#7fd1ff');path.setAttribute('stroke-width','2');path.setAttribute('fill','none');svg.append(path);
    }
  }
  private drag(e:PointerEvent,n:any,card:HTMLElement):void{
    if(e.button!==0)return;e.stopPropagation();const sx=e.clientX,sy=e.clientY,x=n.x||0,y=n.y||0;
    const move=(v:PointerEvent)=>{n.x=Math.max(0,x+(v.clientX-sx)/this.zoom);n.y=Math.max(0,y+(v.clientY-sy)/this.zoom);card.style.left=n.x+'px';card.style.top=n.y+'px';this.drawLinks();};
    const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});
  }
  private pan(e:PointerEvent):void{
    if((e.target as HTMLElement).closest('.v2-gnode,button,input'))return;const sc=this.el('v2g-scroll'),x=e.clientX,y=e.clientY,l=sc.scrollLeft,t=sc.scrollTop;
    const move=(v:PointerEvent)=>{sc.scrollLeft=l-(v.clientX-x);sc.scrollTop=t-(v.clientY-y);};const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});
  }
  private zoomAt(z:number,x?:number,y?:number):void{
    const sc=this.el('v2g-scroll'),fx=x??sc.clientWidth/2,fy=y??sc.clientHeight/2,cx=(sc.scrollLeft+fx)/this.zoom,cy=(sc.scrollTop+fy)/this.zoom;
    this.zoom=Math.max(.35,Math.min(1.6,z));this.el('v2g-world').style.transform='scale('+this.zoom+')';this.updateWorldBounds();this.el('v2g-zoom').textContent=Math.round(this.zoom*100)+'%';sc.scrollLeft=cx*this.zoom-fx;sc.scrollTop=cy*this.zoom-fy;this.drawLinks();
  }
  private updateWorldBounds():void{
    const width=Math.max(1500,...this.graph.nodes.map(n=>(n.x||0)+300))+80;
    const height=Math.max(900,...this.graph.nodes.map(n=>(n.y||0)+390))+80;
    const world=this.el('v2g-world');world.style.width=width+'px';world.style.height=height+'px';
  }
  private fit():void{
    const sc=this.el('v2g-scroll'),xs=this.graph.nodes.map(n=>n.x||0),ys=this.graph.nodes.map(n=>n.y||0),x0=Math.min(...xs),y0=Math.min(...ys),x1=Math.max(...xs)+240,y1=Math.max(...ys)+340;
    this.zoomAt(Math.min(1.2,Math.max(.35,Math.min(sc.clientWidth/(x1-x0+80),sc.clientHeight/(y1-y0+80)))));sc.scrollLeft=Math.max(0,(x0-40)*this.zoom);sc.scrollTop=Math.max(0,(y0-40)*this.zoom);
  }
  private preview():void{
    window.clearTimeout(this.previewTimer);this.previewTimer=window.setTimeout(()=>{try{
      const r=previewGraph(this.graph,0,0,400,40,null);
      for(const cv of this.host.querySelectorAll<HTMLCanvasElement>('.v2-gnode-preview')){
        const n=this.node(Number(cv.parentElement?.dataset.id)),s=n&&r.map.get(n.id),ctx=cv.getContext('2d')!;ctx.clearRect(0,0,80,80);
        if(n?.type==='tex_asset'){ctx.drawImage(this.assetCanvas(String(n.p?.asset??'b_grass')),0,0,80,80);continue;}
        if(!s){ctx.fillStyle='#17242a';ctx.fillRect(0,0,80,80);continue;}
        const img=ctx.createImageData(40,40);for(let i=0;i<1600;i++){let a,b,c;if(s.c){a=s.data[i*3];b=s.data[i*3+1];c=s.data[i*3+2];}else{a=b=c=(s.data[i]-s.min)/Math.max(1e-6,s.max-s.min);}img.data[i*4]=Math.max(0,Math.min(255,a*255));img.data[i*4+1]=Math.max(0,Math.min(255,b*255));img.data[i*4+2]=Math.max(0,Math.min(255,c*255));img.data[i*4+3]=255;}const tmp=document.createElement('canvas');tmp.width=tmp.height=40;tmp.getContext('2d')!.putImageData(img,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(tmp,0,0,80,80);
      }
    }catch(e){this.status(e instanceof Error?e.message:'Ошибка превью');}},180);
  }
  private schedule():void{this.status('Изменения…');this.preview();window.clearTimeout(this.timer);this.timer=window.setTimeout(()=>this.applyNow(),450);}
  private applyNow():void{try{this.apply(structuredClone(this.graph));this.status('Применено ✔');}catch(e){this.status(e instanceof Error?e.message:'Ошибка компиляции');}}
  private status(s:string):void{this.el('v2g-status').textContent=s;}
  private async importFile(input:HTMLInputElement):Promise<void>{const file=input.files?.[0];if(!file)return;try{const g=JSON.parse(await file.text());if(!g||!Array.isArray(g.nodes))throw new Error('Неверный граф');this.graph=g;this.render();this.applyNow();}catch(e){this.status(e instanceof Error?e.message:'Ошибка импорта');}input.value='';}
}


const root = document.querySelector<HTMLDivElement>('#physics-v2-root');
if (!root) throw new Error('Не найден контейнер Physics V2');

root.innerHTML = `
  <main class="pv2-shell">
    <section class="pv2-main">
      <header class="pv2-header">
        <div>
          <div class="pv2-eyebrow">TERRAIN ENGINE · V2 PLAYGROUND</div>
          <h1 class="pv2-title">Исследование рельефа V2</h1>
          <p class="pv2-subtitle">Управляй персонажем на процедурном ландшафте. Камера следует за героем, а Clipmap перестраивает детализацию вокруг активной камеры.</p>
        </div>
        <div class="pv2-header-actions"><button class="pv2-button" id="pv2-toggle-editor" aria-expanded="true">Скрыть редактор</button><span class="pv2-status">● LEGACY НЕ ИЗМЕНЁН</span></div>
      </header>
      <div class="pv2-viewport" id="pv2-viewport">
        <div class="pv2-overlay">
          <span class="pv2-chip">Режим: <b id="pv2-state">исследование</b></span>
          
        </div>
        
      </div>
    </section>
    <aside class="pv2-side">
      <section class="pv2-panel">
        <h2>Персонаж и сцена</h2>
        <div class="pv2-buttons">
          <button class="pv2-button primary" id="pv2-reset">↻ Вернуть героя</button>
          <button class="pv2-button" id="pv2-drop">↓ Уронить шар</button>
          <button class="pv2-button" id="pv2-drop-pair">⚪ Уронить пару шаров</button>
          <button class="pv2-button" id="pv2-pause">Ⅱ Пауза физики</button>
          <button class="pv2-button" id="pv2-camera">◎ Камера за героем</button>
          <label class="pv2-toggle"><input id="pv2-wire" type="checkbox"> Сетка рельефа по уровням LOD</label>
          <label class="pv2-toggle"><input id="pv2-physics-debug" type="checkbox"> Контакты физики героя</label>
          <label class="pv2-toggle"><input id="pv2-cpu-surface" type="checkbox"> Показать CPU-сетку столкновений (только диагностика)</label>
        </div>
        <p class="pv2-note">В обычной игре CPU-сетка не рисуется: физика вычисляет высоту напрямую из Terrain, а GPU строит видимую поверхность шейдером. Включай сетку только для сравнения CPU и GPU.</p>
      </section>
      <section class="pv2-panel">
        <h2>Показания</h2>
        <div class="pv2-statgrid">
          <div class="pv2-stat"><span>Скорость героя</span><b id="pv2-player-speed">0.0 м/с</b></div>
          <div class="pv2-stat"><span>Высота героя</span><b id="pv2-player-height">— м</b></div>
          <div class="pv2-stat"><span>Сфер в сцене</span><b id="pv2-bodies">0</b></div>
          <div class="pv2-stat"><span>Скорость шара</span><b id="pv2-speed">— м/с</b></div>
          <div class="pv2-stat"><span>FPS рендера</span><b id="pv2-fps">—</b></div>
          <div class="pv2-stat"><span>Видимых тайлов</span><b id="pv2-tiles">—</b></div>
        </div>
      </section>
      <section class="pv2-panel">
        <h2>Диагностика движка</h2>
        <div class="pv2-diagnostic-grid">
          <div><span>Кадр CPU</span><b id="pv2-diag-frame">—</b></div>
          <div><span>Компиляция Blueprint</span><b id="pv2-diag-compile">—</b></div>
          <div><span>Обновление тайлов</span><b id="pv2-diag-terrain">—</b></div>
          <div><span>Камера CPU</span><b id="pv2-diag-camera">—</b></div>
          <div><span>Физика CPU</span><b id="pv2-diag-physics">—</b></div>
          <div><span>Рендер submit</span><b id="pv2-diag-render">—</b></div>
          <div><span>Шаги физики</span><b id="pv2-diag-steps">—</b></div>
          <div><span>Проб физики по Terrain</span><b id="pv2-diag-samples">—</b></div>
          <div><span>Контакты Terrain</span><b id="pv2-diag-terrain-contacts">—</b></div>
          <div><span>Проверки пар сфер</span><b id="pv2-diag-pair-tests">—</b></div>
          <div><span>Контакты сфер</span><b id="pv2-diag-sphere-contacts">—</b></div>
          <div><span>Draw calls</span><b id="pv2-diag-calls">—</b></div>
          <div><span>Треугольники</span><b id="pv2-diag-tris">—</b></div>
          <div><span>GPU-программы</span><b id="pv2-diag-programs">—</b></div>
          <div><span>Геометрии / текстуры</span><b id="pv2-diag-resources">—</b></div>
          <div><span>Тайлы готовы / очередь</span><b id="pv2-diag-queue">—</b></div>
          <div><span>Память правок</span><b id="pv2-diag-edits">—</b></div>
          <div><span>Потерянное время</span><b id="pv2-diag-dropped">—</b></div>
          <div><span>Состояние</span><b id="pv2-diag-health">—</b></div>
        </div>
        <p class="pv2-note">Время CPU — замер JavaScript, не точное время выполнения GPU. Draw calls и треугольники берутся из счётчиков Three.js. Счётчики контактов показывают последний фиксированный шаг физики.</p>
      </section>
      <section class="pv2-panel">
        <h2>Физика шара</h2>
        <div class="pv2-control">
          <label for="pv2-friction">Трение <output id="pv2-friction-value">0.65</output></label>
          <input id="pv2-friction" type="range" min="0" max="1.5" step="0.05" value="0.65">
        </div>
        <div class="pv2-control">
          <label for="pv2-bounce">Упругость <output id="pv2-bounce-value">0.12</output></label>
          <input id="pv2-bounce" type="range" min="0" max="0.9" step="0.03" value="0.12">
        </div>
        <p class="pv2-note">Шар использует отдельный heightfield-решатель. Капсула героя использует фиксированный шаг и проверку опорной области нижней полусферы.</p>
      </section>
      <section class="pv2-panel">
        <h2>Blueprint рельефа</h2>
        <p class="pv2-note">Визуальный граф V2: создавай узлы, соединяй входы и выходы, меняй параметры и сразу смотри результат в игре. Граф компилируется для CPU-физики и GPU-шейдера.</p>
        <p class="pv2-note">Узлы высоты, цвета, океана и тумана доступны в одной схеме. Импорт и экспорт графов поддерживаются.</p>
        <button class="pv2-button primary" id="pv2-open-blueprint">Открыть визуальный редактор узлов</button>
        <p id="pv2-blueprint-status" class="pv2-note">Соединяй узлы мышью. Изменения автоматически компилируются для CPU и GPU.</p>
        <label class="pv2-toggle"><input id="pv2-water" type="checkbox" checked> Показывать процедурную воду</label>
        <label class="pv2-toggle"><input id="pv2-water-hole" type="checkbox"> Пример сухой пещеры в центре</label>
        <label class="pv2-toggle"><input id="pv2-day-cycle" type="checkbox" checked> Автоматическая смена дня и ночи</label>
        <div class="pv2-control"><label for="pv2-time">Время суток <output id="pv2-time-value">12:00</output></label><input id="pv2-time" type="range" min="0" max="1" step="0.001" value="0.36"></div>
        <p class="pv2-footer">Отсечение тайлов выполняется по пирамиде видимости активной камеры. Обратные грани поверхности отсекаются материалом FrontSide и проверкой gl_FrontFacing.</p>
      </section>
    </aside>
  </main>
  <div id="pv2-blueprint-editor"></div>
`;

const viewport = document.querySelector<HTMLDivElement>('#pv2-viewport')!;
const shell = document.querySelector<HTMLElement>('.pv2-shell')!;
const editorToggle = document.querySelector<HTMLButtonElement>('#pv2-toggle-editor')!;
editorToggle.addEventListener('click', () => {
  const collapsed = shell.classList.toggle('pv2-editor-collapsed');
  editorToggle.textContent = collapsed ? 'Показать редактор' : 'Скрыть редактор';
  editorToggle.setAttribute('aria-expanded', String(!collapsed));
  requestAnimationFrame(resize);
});
const scene = new THREE.Scene();
scene.background = new THREE.Color('#91aeb4');
scene.fog = new THREE.Fog('#91aeb4', 100, 320);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2400);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.domElement.tabIndex = 0;
viewport.prepend(renderer.domElement);

const hemisphere = new THREE.HemisphereLight('#e5f5f1', '#38464a', 1.8);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight('#fff0d5', 3.1);
sun.position.set(-25, 42, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -55;
sun.shadow.camera.right = 55;
sun.shadow.camera.top = 55;
sun.shadow.camera.bottom = -55;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 220;
sun.shadow.bias = -0.00018;
sun.shadow.normalBias = 0.035;
sun.shadow.radius = 5;
scene.add(sun);
scene.add(sun.target);

const LOD0_CELL_SIZE = 1;
let blueprintCompileMs = 0;
let blueprintGraph = createDefaultTerrainGraph(17);
let blueprint = compileTerrainGraph(blueprintGraph);
scene.background = new THREE.Color(blueprint.fogColor);
scene.fog = new THREE.Fog(blueprint.fogColor, blueprint.fogNear, blueprint.fogFar);
const terrain = new Terrain(blueprint.heightAt, {
  seed: 17, editCellSize: 0.5, editChunkSize: 32, normalSampleDistance: 0.35
});
const terrainRenderer = new TerrainRenderer(scene, terrain, blueprint, {
  levels: 8, gridSize: 128, tileSize: 32, baseCellSize: LOD0_CELL_SIZE, showWireframe: false
});
const waterRenderer = new WaterRenderer(scene, { seaLevel: 8, extent: 8192 });
waterRenderer.applyBlueprint(blueprint.water, blueprint.heightFunctionGLSL, blueprint.fog);
const blueprintStatus = document.querySelector<HTMLParagraphElement>('#pv2-blueprint-status')!;
const graphEditorHost = document.querySelector<HTMLDivElement>('#pv2-blueprint-editor')!;
const graphEditor = new BlueprintNodeEditor(graphEditorHost, blueprintGraph, (nextGraph) => {
  const compileStart = performance.now();
  const nextBlueprint = compileTerrainGraph(nextGraph);
  blueprintCompileMs = performance.now() - compileStart;
  terrain.setBaseHeight(nextBlueprint.heightAt);
  terrainRenderer.setBlueprint(nextBlueprint);
  waterRenderer.applyBlueprint(nextBlueprint.water, nextBlueprint.heightFunctionGLSL, nextBlueprint.fog);
  blueprintGraph = nextGraph;
  blueprint = nextBlueprint;
  scene.background = new THREE.Color(nextBlueprint.fogColor);
  scene.fog = new THREE.Fog(nextBlueprint.fogColor, nextBlueprint.fogNear, nextBlueprint.fogFar);
  blueprintStatus.textContent = 'Blueprint применён: CPU, физика и GPU обновлены без перезапуска.';
  blueprintStatus.style.color = '#8affc1';
}, viewport);
document.querySelector('#pv2-open-blueprint')!.addEventListener('click', () => graphEditor.open());
graphEditor.open();
document.querySelector<HTMLInputElement>('#pv2-water')!.addEventListener('change', (event) => {
  waterRenderer.mesh.visible = (event.currentTarget as HTMLInputElement).checked;
});
document.querySelector<HTMLInputElement>('#pv2-water-hole')!.addEventListener('change', (event) => {
  const enabled = (event.currentTarget as HTMLInputElement).checked;
  waterRenderer.setExclusionCircles(enabled ? [{ x: 0, z: 0, radius: 18, feather: 5 }] : []);
});
let dayTime = 0.36;
let dayCycle = true;
const dayNightToggle = document.querySelector<HTMLInputElement>('#pv2-day-cycle')!;
const dayTimeInput = document.querySelector<HTMLInputElement>('#pv2-time')!;
const dayTimeLabel = document.querySelector<HTMLOutputElement>('#pv2-time-value')!;
function updateDayNight(delta: number): void {
  if (dayCycle) dayTime = (dayTime + delta / 240) % 1;
  const angle = (dayTime - 0.25) * Math.PI * 2;
  const height = Math.sin(angle);
  const daylight = THREE.MathUtils.smoothstep(height, -0.12, 0.28);
  const sunDirection = new THREE.Vector3(Math.cos(angle), Math.max(-0.12, height), 0.28).normalize();
  sun.position.copy(playerMesh.position).addScaledVector(sunDirection, 90);
  sun.target.position.copy(playerMesh.position);
  sun.shadow.camera.updateProjectionMatrix();
  sun.intensity = 0.06 + daylight * 3.0;
  sun.color.set('#7189bd').lerp(new THREE.Color('#fff0d5'), daylight);
  hemisphere.intensity = 0.25 + daylight * 1.55;
  const sky = new THREE.Color('#071323').lerp(new THREE.Color(blueprint.fogColor), daylight);
  scene.background = sky;
  if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(sky);
  terrainRenderer.setLighting(sunDirection, sun.intensity);
  const hours = Math.floor(dayTime * 24), minutes = Math.floor((dayTime * 24 - hours) * 60);
  dayTimeLabel.textContent = String(hours).padStart(2,'0')+':'+String(minutes).padStart(2,'0');
  if (document.activeElement !== dayTimeInput) dayTimeInput.value = String(dayTime);
}
dayNightToggle.addEventListener('change',()=>{dayCycle=dayNightToggle.checked;});
dayTimeInput.addEventListener('input',()=>{dayTime=Number(dayTimeInput.value);const toolbarTime=document.querySelector<HTMLInputElement>('#v2g-sun-time');if(toolbarTime)toolbarTime.value=String(dayTime);updateDayNight(0);});
document.querySelector<HTMLInputElement>('#v2g-sun-time')!.addEventListener('input',e=>{dayTime=Number((e.currentTarget as HTMLInputElement).value);dayTimeInput.value=String(dayTime);updateDayNight(0);});
const cpuSurfaceDebug = new CpuTerrainSurfaceDebug(scene, terrain, LOD0_CELL_SIZE, 16);

const world = new PhysicsWorld(terrain, { fixedDelta: 1 / 60, maxSubSteps: 10, maxFrameDelta: 0.1, terrainCellSize: LOD0_CELL_SIZE });
const loop = new FixedStepLoop(world, 1 / 60, 10, 0.1);
const sphereMeshes = new Map<string, THREE.Mesh>();
// Все шары используют одну геометрию и один материал: меньше GPU-ресурсов.
const sphereGeometry = new THREE.SphereGeometry(1.15, 24, 16);
const sphereMaterial = new THREE.MeshStandardMaterial({
  color: '#e9a95e', roughness: 0.28, metalness: 0.12
});
let nextId = 1;
let paused = false;
let friction = 0.65;
let restitution = 0.12;
let totalSteps = 0;

const playerRadius = 0.48;
const playerHeight = 1.35;
const player = {
  x: 0, z: 0, y: terrain.getGroundHeight(0, 0, LOD0_CELL_SIZE) + playerHeight * 0.5 + playerRadius,
  vx: 0, vy: 0, vz: 0, yaw: 0, grounded: true
};
const playerMesh = new THREE.Mesh(
  new THREE.CapsuleGeometry(playerRadius, playerHeight, 6, 12),
  new THREE.MeshStandardMaterial({ color: '#f0b66f', roughness: 0.62 })
);
playerMesh.castShadow = true;
playerMesh.receiveShadow = true;
scene.add(playerMesh);

// Убрана фальшивая круглая тень-спрайт; персонаж использует shadow casting Three.js.

// Диагностика опоры капсулы: зелёные точки — высота земли,
// вертикальные отрезки — зазор до нижней поверхности капсулы.
// Плотная выборка нижней полусферы: центр + два кольца по 16 точек.
const playerSupportSamples: Array<[number, number]> = [[0, 0]];
for (const radial of [0.45, 0.88]) {
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    playerSupportSamples.push([
      Math.cos(angle) * playerRadius * radial,
      Math.sin(angle) * playerRadius * radial
    ]);
  }
}
const physicsDebug = new THREE.Group();
physicsDebug.visible = false;
const contactLinePositions = new Float32Array(playerSupportSamples.length * 2 * 3);
const contactLineGeometry = new THREE.BufferGeometry();
contactLineGeometry.setAttribute('position', new THREE.BufferAttribute(contactLinePositions, 3));
const contactLines = new THREE.LineSegments(
  contactLineGeometry,
  new THREE.LineBasicMaterial({ color: '#ffcf5a', transparent: true, opacity: 0.95, depthWrite: false })
);
physicsDebug.add(contactLines);
const contactMarkerGeometry = new THREE.SphereGeometry(0.065, 8, 6);
const contactMarkers = playerSupportSamples.map(() => {
  const marker = new THREE.Mesh(contactMarkerGeometry,
    new THREE.MeshBasicMaterial({ color: '#45f0b2', depthTest: true }));
  physicsDebug.add(marker);
  return marker;
});
scene.add(physicsDebug);

function updatePhysicsDebug(): void {
  const positions = contactLineGeometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < playerSupportSamples.length; i++) {
    const [ox, oz] = playerSupportSamples[i];
    const radialSq = ox * ox + oz * oz;
    const x = player.x + ox, z = player.z + oz;
    const groundY = terrain.getGroundHeight(x, z, LOD0_CELL_SIZE);
    const lowerCap = Math.sqrt(Math.max(0, playerRadius * playerRadius - radialSq));
    const capsuleSurfaceY = player.y - playerHalfSegment - lowerCap;
    positions.setXYZ(i * 2, x, groundY, z);
    positions.setXYZ(i * 2 + 1, x, capsuleSurfaceY, z);
    contactMarkers[i].position.set(x, groundY + 0.035, z);
  }
  positions.needsUpdate = true;
  contactLineGeometry.computeBoundingSphere();
}

let cameraYaw = Math.PI;
let cameraPitch = 0.28;
let cameraDistance = 7.5;
let draggingCamera = false;
let previousPointerX = 0;
let previousPointerY = 0;
const keys = new Set<string>();

const playerHalfSegment = playerHeight * 0.5;
const playerFixedStep = 1 / 120;
let playerAccumulator = 0;

// Проверяем не только точку под центром, а опорную область нижней полусферы капсулы.
// Для каждой точки вычисляем высоту, при которой капсула уже касается поверхности.
function getPlayerSupportHeight(x: number, z: number): number {
  const r = playerRadius;
  let support = -Infinity;
  for (const [ox, oz] of playerSupportSamples) {
    const radialSq = ox * ox + oz * oz;
    if (radialSq >= r * r) continue;
    const ground = terrain.getGroundHeight(x + ox, z + oz, LOD0_CELL_SIZE);
    const lowerCap = Math.sqrt(Math.max(0, r * r - radialSq));
    support = Math.max(support, ground + playerHalfSegment + lowerCap);
  }
  return support;
}

function placePlayerAt(x: number, z: number): void {
  player.x = x; player.z = z;
  player.y = getPlayerSupportHeight(x, z);
  player.vx = 0; player.vy = 0; player.vz = 0;
  player.grounded = true;
  playerAccumulator = 0;
}
function resetPlayer(): void {
  placePlayerAt(0, 0);
  player.yaw = 0;
  cameraYaw = Math.PI;
  cameraPitch = 0.28;
  cameraDistance = 7.5;
}
function updatePlayer(frameDelta: number): void {
  // Контроллер персонажа работает с фиксированным шагом, независимо от FPS.
  playerAccumulator += Math.min(frameDelta, 0.05);
  const forwardInput = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const sideInput = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const inputLength = Math.hypot(forwardInput, sideInput);
  let targetX = 0, targetZ = 0;
  if (inputLength > 0) {
    const f = forwardInput / inputLength, s = sideInput / inputLength;
    const forwardX = -Math.sin(cameraYaw), forwardZ = -Math.cos(cameraYaw);
    const rightX = Math.cos(cameraYaw), rightZ = -Math.sin(cameraYaw);
    targetX = (forwardX * f + rightX * s) * 7.5;
    targetZ = (forwardZ * f + rightZ * s) * 7.5;
    player.yaw = Math.atan2(targetX, targetZ);
  }

  let steps = 0;
  while (playerAccumulator >= playerFixedStep && steps < 8) {
    const dt = playerFixedStep;
    const blend = 1 - Math.exp(-12 * dt);
    player.vx += (targetX - player.vx) * blend;
    player.vz += (targetZ - player.vz) * blend;
    if (keys.has('Space') && player.grounded) {
      player.vy = 6.2;
      player.grounded = false;
    }

    player.vy -= 18 * dt;
    player.x += player.vx * dt;
    player.z += player.vz * dt;
    player.y += player.vy * dt;

    const supportY = getPlayerSupportHeight(player.x, player.z);
    if (player.y <= supportY) {
      player.y = supportY;
      player.vy = 0;
      player.grounded = true;
    } else {
      player.grounded = false;
    }
    playerAccumulator -= dt;
    steps++;
  }

  // Не накапливаем большой долг симуляции после подвисания вкладки.
  if (steps === 8 && playerAccumulator >= playerFixedStep) {
    playerAccumulator = Math.min(playerAccumulator, playerFixedStep);
  }
  playerMesh.position.set(player.x, player.y, player.z);
  playerMesh.rotation.y = player.yaw;
  if (physicsDebug.visible) updatePhysicsDebug();
}
function updateFollowCamera(): void {
  const horizontal = Math.cos(cameraPitch) * cameraDistance;
  const target = new THREE.Vector3(player.x, player.y + 0.55, player.z);
  camera.position.set(
    player.x + Math.sin(cameraYaw) * horizontal,
    player.y + 0.25 + Math.sin(cameraPitch) * cameraDistance,
    player.z + Math.cos(cameraYaw) * horizontal
  );

  // Не позволяем камере пересекать поверхность ни в конечной точке,
  // ни на отрезке между героем и камерой (например, за гребнем холма).
  const clearance = 0.7;
  let requiredLift = Math.max(
    0,
    terrain.getGroundHeight(camera.position.x, camera.position.z, LOD0_CELL_SIZE) + clearance - camera.position.y
  );
  const ray = new THREE.Vector3();
  for (let i = 1; i <= 12; i++) {
    const t = i / 12;
    ray.lerpVectors(target, camera.position, t);
    const ground = terrain.getGroundHeight(ray.x, ray.z, LOD0_CELL_SIZE);
    requiredLift = Math.max(requiredLift, ground + clearance - ray.y);
  }
  if (requiredLift > 0) camera.position.y += requiredLift;
  camera.lookAt(target);
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  draggingCamera = true;
  previousPointerX = event.clientX;
  previousPointerY = event.clientY;
  renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!draggingCamera) return;
  const dx = event.clientX - previousPointerX, dy = event.clientY - previousPointerY;
  previousPointerX = event.clientX; previousPointerY = event.clientY;
  cameraYaw -= dx * 0.006;
  cameraPitch = THREE.MathUtils.clamp(cameraPitch + dy * 0.004, -0.05, 0.85);
});
renderer.domElement.addEventListener('pointerup', () => { draggingCamera = false; });
renderer.domElement.addEventListener('pointercancel', () => { draggingCamera = false; });
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
renderer.domElement.addEventListener('wheel', (event) => {
  cameraDistance = THREE.MathUtils.clamp(cameraDistance + event.deltaY * 0.008, 3.5, 18);
  event.preventDefault();
}, { passive: false });
window.addEventListener('keydown', (event) => {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', () => keys.clear());

function createSphere(x: number, z: number, lift = 8): void {
  const id = `sphere-${nextId++}`, radius = 1.15;
  const y = terrain.getGroundHeight(x, z, LOD0_CELL_SIZE) + radius + lift;
  const body = world.addSphere({
    id, position: { x, y, z }, radius, mass: 1,
    friction, restitution, linearDamping: 0.008, angularDamping: 0.015
  });
  const mesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
  // Тени от десятков динамических сфер дорого пересчитывать каждый кадр.
  // Солнце и рельеф сохраняют тени, сами шары остаются освещёнными.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.position.set(body.position.x, body.position.y, body.position.z);
  scene.add(mesh);
  sphereMeshes.set(id, mesh);
}
function clearSpheres(): void {
  for (const [id, mesh] of sphereMeshes) {
    scene.remove(mesh);
    world.removeBody(id);
  }
  sphereMeshes.clear();
}
function setPauseLabel(): void {
  document.querySelector('#pv2-pause')!.textContent = paused ? '▶ Продолжить физику' : 'Ⅱ Пауза физики';
  document.querySelector('#pv2-state')!.textContent = paused ? 'пауза физики' : 'исследование';
}
function reset(): void {
  clearSpheres(); nextId = 1; loop.reset(); totalSteps = 0;
  resetPlayer(); paused = false; setPauseLabel();
}
function updateStats(): void {
  document.querySelector('#pv2-player-speed')!.textContent = `${Math.hypot(player.vx, player.vz).toFixed(1)} м/с`;
  document.querySelector('#pv2-player-height')!.textContent = `${player.y.toFixed(1)} м`;
  document.querySelector('#pv2-bodies')!.textContent = String(world.bodies.size);
  const body = world.bodies.values().next().value;
  document.querySelector('#pv2-speed')!.textContent = body
    ? `${Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z).toFixed(1)} м/с`
    : '— м/с';
}
document.querySelector('#pv2-reset')!.addEventListener('click', reset);
document.querySelector('#pv2-pause')!.addEventListener('click', () => { paused = !paused; setPauseLabel(); });
document.querySelector('#pv2-drop')!.addEventListener('click', () => createSphere(player.x + 3, player.z + 3, 12));
document.querySelector('#pv2-drop-pair')!.addEventListener('click', () => {
  createSphere(player.x + 3, player.z + 3, 12);
  createSphere(player.x + 5, player.z + 3, 12);
});
document.querySelector<HTMLInputElement>('#pv2-wire')!.addEventListener('change', (event) =>
  terrainRenderer.setWireframe((event.currentTarget as HTMLInputElement).checked));
document.querySelector<HTMLInputElement>('#pv2-cpu-surface')!.addEventListener('change', (event) => {
  const enabled = (event.currentTarget as HTMLInputElement).checked;
  cpuSurfaceDebug.setVisible(enabled);
  if (enabled) cpuSurfaceDebug.update(player.x, player.z);
});
let wireframeBeforePhysicsDebug = false;
document.querySelector<HTMLInputElement>('#pv2-physics-debug')!.addEventListener('change', (event) => {
  const enabled = (event.currentTarget as HTMLInputElement).checked;
  const wireInput = document.querySelector<HTMLInputElement>('#pv2-wire')!;
  if (enabled) {
    wireframeBeforePhysicsDebug = wireInput.checked;
    wireInput.checked = false;
    terrainRenderer.setWireframe(false);
  } else if (wireframeBeforePhysicsDebug) {
    wireInput.checked = true;
    terrainRenderer.setWireframe(true);
  }
  physicsDebug.visible = enabled;
  if (physicsDebug.visible) updatePhysicsDebug();
});
document.querySelector('#pv2-camera')!.addEventListener('click', () => {
  cameraYaw = player.yaw + Math.PI; cameraPitch = 0.28; cameraDistance = 7.5;
});
const frictionInput = document.querySelector<HTMLInputElement>('#pv2-friction')!;
const bounceInput = document.querySelector<HTMLInputElement>('#pv2-bounce')!;
frictionInput.addEventListener('input', () => {
  friction = Number(frictionInput.value);
  document.querySelector('#pv2-friction-value')!.textContent = friction.toFixed(2);
});
bounceInput.addEventListener('input', () => {
  restitution = Number(bounceInput.value);
  document.querySelector('#pv2-bounce-value')!.textContent = restitution.toFixed(2);
});

function resize(): void {
  const width = viewport.clientWidth, height = viewport.clientHeight;
  camera.aspect = width / height; camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(viewport); resize();

let previousTime = performance.now(), fpsFrames = 0, fpsElapsed = 0;
let physicsCpuMs = 0, renderSubmitMs = 0, frameCpuMs = 0, droppedPhysicsTime = 0, physicsStepsLastFrame = 0;
let terrainUpdateCpuMs = 0, cameraCpuMs = 0;
let diagnosticElapsed = 0;
function setDiagnostic(id: string, value: string): void {
  const element = document.querySelector<HTMLElement>(`#${id}`);
  if (element) element.textContent = value;
}
function updateDiagnostics(culling: ReturnType<TerrainRenderer['update']>): void {
  const info = renderer.info;
  const programs = info.programs?.length ?? 0;
  setDiagnostic('pv2-diag-frame', `${frameCpuMs.toFixed(2)} ms`);
  setDiagnostic('pv2-diag-compile', `${blueprintCompileMs.toFixed(2)} ms`);
  setDiagnostic('pv2-diag-terrain', `${terrainUpdateCpuMs.toFixed(2)} ms`);
  setDiagnostic('pv2-diag-camera', `${cameraCpuMs.toFixed(2)} ms`);
  setDiagnostic('pv2-diag-physics', `${physicsCpuMs.toFixed(2)} ms`);
  setDiagnostic('pv2-diag-render', `${renderSubmitMs.toFixed(2)} ms`);
  setDiagnostic('pv2-diag-steps', `${physicsStepsLastFrame} / кадр`);
  setDiagnostic('pv2-diag-samples', String(world.diagnostics.terrainSamples));
  setDiagnostic('pv2-diag-terrain-contacts', String(world.diagnostics.terrainContacts));
  setDiagnostic('pv2-diag-pair-tests', String(world.diagnostics.spherePairTests));
  setDiagnostic('pv2-diag-sphere-contacts', String(world.diagnostics.sphereContacts));
  setDiagnostic('pv2-diag-calls', String(info.render.calls));
  setDiagnostic('pv2-diag-tris', info.render.triangles.toLocaleString('ru-RU'));
  setDiagnostic('pv2-diag-programs', String(programs));
  setDiagnostic('pv2-diag-resources', `${info.memory.geometries} / ${info.memory.textures}`);
  setDiagnostic('pv2-diag-queue', `${culling.readyTiles} / ${culling.totalTiles} · ${culling.queuedTiles} в очереди`);
  setDiagnostic('pv2-diag-edits', `${(terrain.allocatedEditBytes / 1024).toFixed(1)} КБ`);
  setDiagnostic('pv2-diag-dropped', `${(droppedPhysicsTime * 1000).toFixed(1)} ms`);
  const slow = frameCpuMs > 24 || physicsCpuMs > 8 || droppedPhysicsTime > 0.02;
  const warming = culling.queuedTiles > 0;
  setDiagnostic('pv2-diag-health', slow ? 'Есть нагрузка' : warming ? 'Загрузка по очереди' : 'Норма');
}
function animate(now: number): void {
  const frameStart = performance.now();
  const delta = Math.min((now - previousTime) / 1000, 0.05);
  previousTime = now; fpsFrames++; fpsElapsed += delta;
  if (fpsElapsed >= 0.5) {
    document.querySelector('#pv2-fps')!.textContent = String(Math.round(fpsFrames / fpsElapsed));
    fpsFrames = 0; fpsElapsed = 0;
  }
  updateDayNight(delta);
  updatePlayer(delta);
  if (cpuSurfaceDebug.group.visible) cpuSurfaceDebug.update(player.x, player.z);
  const physicsStart = performance.now();
  physicsStepsLastFrame = 0;
  droppedPhysicsTime = 0;
  if (!paused) {
    const result = loop.advance(delta);
    physicsStepsLastFrame = result.steps;
    droppedPhysicsTime = result.droppedTime;
    totalSteps += result.steps;
    for (const [id, mesh] of sphereMeshes) {
      const body = world.bodies.get(id);
      if (!body) continue;
      const p = world.getInterpolatedPosition(id, result.alpha);
      mesh.position.set(p.x, p.y, p.z);
      mesh.quaternion.set(body.orientation.x, body.orientation.y, body.orientation.z, body.orientation.w);
    }
  }
  physicsCpuMs = performance.now() - physicsStart;
  const cameraStart = performance.now();
  updateFollowCamera();
  cameraCpuMs = performance.now() - cameraStart;
  const terrainStart = performance.now();
  const culling = terrainRenderer.update(camera);
  waterRenderer.update(camera, now / 1000, culling.lodScale);
  if (scene.fog instanceof THREE.Fog) {
    scene.fog.near = blueprint.fogNear * culling.lodScale;
    scene.fog.far = blueprint.fogFar * culling.lodScale;
  }
  terrainUpdateCpuMs = performance.now() - terrainStart;
  document.querySelector('#pv2-tiles')!.textContent = `${culling.visibleTiles}/${culling.totalTiles}`;
  updateStats();
  const renderStart = performance.now();
  renderer.render(scene, camera);
  renderSubmitMs = performance.now() - renderStart;
  frameCpuMs = performance.now() - frameStart;
  diagnosticElapsed += delta;
  if (diagnosticElapsed >= 0.5) { updateDiagnostics(culling); diagnosticElapsed = 0; }
  requestAnimationFrame(animate);
}
resetPlayer();
updateFollowCamera();
requestAnimationFrame(animate);
window.addEventListener('beforeunload', () => {
  resizeObserver.disconnect(); renderer.dispose(); terrainRenderer.dispose(); waterRenderer.dispose(scene); cpuSurfaceDebug.dispose(); 
  sphereGeometry.dispose(); sphereMaterial.dispose();
});

/* V2 visual graph editor, ported from the legacy node workflow while keeping V1 untouched. */
