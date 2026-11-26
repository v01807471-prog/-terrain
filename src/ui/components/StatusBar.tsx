import type {EditorTelemetry} from '../EditorTelemetry';

export default function StatusBar({activeTool,telemetry}:{activeTool:string;telemetry:EditorTelemetry|null}){
 const ready=telemetry!==null;
 return <footer className="statusbar">
  <span><i className="status-green"/>{ready?'ENGINE LIVE':'ENGINE WAITING'}</span>
  <span>FPS <b>{telemetry?telemetry.fps.toFixed(0):'—'}</b></span>
  <span>LOD <b>{telemetry?.lodLevels??'—'}</b></span>
  <span>TRIANGLES <b>{telemetry?telemetry.triangles.toLocaleString():'—'}</b></span>
  <span>TILES <b>{telemetry?telemetry.visibleTiles+' / '+telemetry.totalTiles:'—'}</b></span>
  <span className="status-right">ACTIVE TOOL <b>{activeTool.toUpperCase()}</b></span>
 </footer>;
}
