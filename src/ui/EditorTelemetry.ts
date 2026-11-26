export interface EditorTelemetry {
  readonly fps:number;
  readonly frameMs:number;
  readonly triangles:number;
  readonly cameraPosition:readonly [number,number,number];
  readonly lodLevels:number;
  readonly visibleTiles:number;
  readonly totalTiles:number;
  readonly activeTool:string;
  readonly brushRadius:number;
  readonly brushStrength:number;
  readonly brushSoftness:number;
  readonly brushSlope:number;
  readonly undoEntries:number;
  readonly redoEntries:number;
}

type Listener=()=>void;
const numericFields=['fps','frameMs','triangles','lodLevels','visibleTiles','totalTiles','brushRadius','brushStrength','brushSoftness','brushSlope','undoEntries','redoEntries'] as const;

export function parseEditorTelemetry(value:unknown):EditorTelemetry|null{
 if(typeof value!=='object'||value===null)return null;
 const record=value as Record<string,unknown>;
 for(const field of numericFields){
  if(typeof record[field]!=='number'||!Number.isFinite(record[field]))return null;
 }
 const camera=record.cameraPosition;
 if(!Array.isArray(camera)||camera.length!==3||!camera.every(item=>typeof item==='number'&&Number.isFinite(item)))return null;
 if(typeof record.activeTool!=='string'||record.activeTool.length===0)return null;
 const counts=['triangles','lodLevels','visibleTiles','totalTiles','undoEntries','redoEntries'] as const;
 if(counts.some(field=>!Number.isInteger(record[field])||(record[field] as number)<0))return null;
 return {
  fps:record.fps as number,
  frameMs:record.frameMs as number,
  triangles:record.triangles as number,
  cameraPosition:[camera[0] as number,camera[1] as number,camera[2] as number],
  lodLevels:record.lodLevels as number,
  visibleTiles:record.visibleTiles as number,
  totalTiles:record.totalTiles as number,
  activeTool:record.activeTool,
  brushRadius:record.brushRadius as number,
  brushStrength:record.brushStrength as number,
  brushSoftness:record.brushSoftness as number,
  brushSlope:record.brushSlope as number,
  undoEntries:record.undoEntries as number,
  redoEntries:record.redoEntries as number
 };
}

export class EditorTelemetryStore{
 private snapshot:EditorTelemetry|null=null;
 private readonly listeners=new Set<Listener>();
 readonly getSnapshot=():EditorTelemetry|null=>this.snapshot;
 readonly subscribe=(listener:Listener):(()=>void)=>{
  this.listeners.add(listener);
  return ()=>this.listeners.delete(listener);
 };
 publish(value:unknown):boolean{
  const next=parseEditorTelemetry(value);
  if(!next)return false;
  this.snapshot=next;
  for(const listener of this.listeners)listener();
  return true;
 }
}

export function connectLegacyTelemetry(target:EventTarget,store:EditorTelemetryStore):()=>void{
 const onTelemetry=(event:Event):void=>{store.publish((event as CustomEvent<unknown>).detail)};
 target.addEventListener('terrain:telemetry',onTelemetry);
 return ()=>target.removeEventListener('terrain:telemetry',onTelemetry);
}

export const editorTelemetryStore=new EditorTelemetryStore();

// Автоматические проверки контракта обмена данными между legacy runtime и React.
export function runEditorTelemetrySelfTests():{passed:string[]}{
 const passed:string[]=[];
 const assert=(condition:boolean,message:string):void=>{
  if(!condition)throw new Error('Editor telemetry self-test: '+message);
  passed.push(message);
 };
 const position=[12.5,4,-8];
 const payload={
  fps:60,frameMs:16.67,triangles:24576,cameraPosition:position,
  lodLevels:8,visibleTiles:42,totalTiles:64,activeTool:'raise',
  brushRadius:4.5,brushStrength:2.2,brushSoftness:.7,brushSlope:.35,
  undoEntries:3,redoEntries:1
 };
 const store=new EditorTelemetryStore();
 assert(store.getSnapshot()===null,'до первого события интерфейс не показывает вымышленные показатели');
 let notifications=0;
 const unsubscribe=store.subscribe(()=>notifications++);
 assert(store.publish(payload),'хранилище принимает полный набор телеметрии движка');
 assert(notifications===1,'подписчики получают уведомление после публикации');
 const snapshot=store.getSnapshot();
 assert(snapshot?.fps===60&&snapshot.triangles===24576,'снимок сохраняет показатели производительности и геометрии');
 position[0]=999;
 assert(snapshot?.cameraPosition[0]===12.5,'снимок копирует координаты камеры');
 const invalid={...payload,cameraPosition:[1,2]};
 assert(!store.publish(invalid),'неполные координаты камеры отклоняются');
 assert(store.getSnapshot()===snapshot&&notifications===1,'некорректное событие не заменяет последний снимок');
 unsubscribe();
 store.publish(payload);
 assert(notifications===1,'отписанный компонент больше не получает обновления');
 const target=new EventTarget();
 const connectedStore=new EditorTelemetryStore();
 const disconnect=connectLegacyTelemetry(target,connectedStore);
 target.dispatchEvent(Object.assign(new Event('terrain:telemetry'),{detail:payload}));
 assert(connectedStore.getSnapshot()?.activeTool==='raise','адаптер передаёт события legacy runtime в типизированное хранилище');
 const beforeDisconnect=connectedStore.getSnapshot();
 disconnect();
 target.dispatchEvent(Object.assign(new Event('terrain:telemetry'),{detail:{...payload,activeTool:'smooth'}}));
 assert(connectedStore.getSnapshot()===beforeDisconnect,'отключение адаптера прекращает обновление React-состояния');
 return {passed};
}
