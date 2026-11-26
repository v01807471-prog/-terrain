import {useEffect,useState} from 'react';
import type {EditorTelemetry} from '../EditorTelemetry';
import type {EditorSection,ToolId} from '../types';
import {setLegacyValue} from '../bridge';

function Slider({label,id,min,max,step,initial,value}:{label:string;id:string;min:number;max:number;step:number;initial:number;value?:number}){
 const [current,setCurrent]=useState(initial);
 useEffect(()=>{if(value!==undefined)setCurrent(value)},[value]);
 return <label className="inspector-control"><span>{label}<b>{current.toFixed(1)}</b></span><input type="range" min={min} max={max} step={step} value={current} onChange={e=>{const next=Number(e.target.value);setCurrent(next);setLegacyValue(id,next)}}/></label>;
}
type Props={tool:ToolId;section:EditorSection;telemetry:EditorTelemetry|null;onSectionChange:(section:EditorSection)=>void;onLegacy:(selector:string)=>void};

export default function Inspector({tool,section,telemetry,onSectionChange,onLegacy}:Props){
 return <aside className="inspector">
  <div className="inspector-tabs">{(['tool','world','render'] as EditorSection[]).map(s=><button key={s} className={section===s?'active':''} onClick={()=>onSectionChange(s)}>{s[0].toUpperCase()+s.slice(1)}</button>)}</div>
  {section==='tool'&&<>
   <div className="panel-heading"><span>SCULPT BRUSH</span><b>{tool.toUpperCase()}</b></div>
   <Slider label="Brush radius" id="brushRadius" min={1} max={24} step={.5} initial={4.5} value={telemetry?.brushRadius}/>
   <Slider label="Strength" id="brushStrength" min={.1} max={10} step={.1} initial={2.2} value={telemetry?.brushStrength}/>
   <Slider label="Falloff" id="brushSoftness" min={.05} max={1} step={.05} initial={.7} value={telemetry?.brushSoftness}/>
   {tool==='slope'&&<Slider label="Slope" id="brushSlope" min={0} max={1} step={.05} initial={.35} value={telemetry?.brushSlope}/>}
   <div className="panel-divider"/>
   <button className="wide-button" onClick={()=>onLegacy('#clearEdits')}>Clear sculpt layers</button>
   <p className="panel-note">UNDO {telemetry?.undoEntries??'—'} · REDO {telemetry?.redoEntries??'—'} · параметры синхронизируются с движком</p>
  </>}
  {section==='world'&&<>
   <div className="panel-heading"><span>WORLD GRAPH</span><b>PROCEDURAL</b></div>
   <p className="panel-note">Build terrain from noise, ridges, masks and blend operators.</p>
   <button className="wide-button accent" onClick={()=>onLegacy('#openGraph')}>Open node graph ↗</button>
   <div className="panel-divider"/>
   <button className="wide-button" onClick={()=>onLegacy('#importWorld')}>Import heightmap</button>
  </>}
  {section==='render'&&<>
   <div className="panel-heading"><span>RENDER QUALITY</span><b>GPU</b></div>
   <p className="panel-note">Adjust clipmap density, texture filtering and render scale.</p>
   <div className="render-chip"><span>LOD levels</span><b>{telemetry?.lodLevels??'—'}</b></div>
   <div className="render-chip"><span>Visible tiles</span><b>{telemetry?telemetry.visibleTiles+' / '+telemetry.totalTiles:'—'}</b></div>
   <button className="wide-button" onClick={()=>onLegacy('#devToggle')}>Open quality settings</button>
   <div className="panel-divider"/>
   <div className="render-chip"><span>Terrain</span><b>Legacy Clipmap</b></div>
   <div className="render-chip"><span>Shading</span><b>Procedural GLSL</b></div>
  </>}
 </aside>;
}
