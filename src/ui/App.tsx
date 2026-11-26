import {useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {clickLegacy} from './bridge';
import {connectLegacyTelemetry,editorTelemetryStore} from './EditorTelemetry';
import {TOOL_DEFINITIONS,type ToolId,type EditorSection} from './types';
import TopBar from './components/TopBar';
import ToolRail from './components/ToolRail';
import ViewportHud from './components/ViewportHud';
import Inspector from './components/Inspector';
import StatusBar from './components/StatusBar';

export default function App(){
 const [tool,setTool]=useState<ToolId>('raise');
 const [section,setSection]=useState<EditorSection>('tool');
 const telemetry=useSyncExternalStore(editorTelemetryStore.subscribe,editorTelemetryStore.getSnapshot,editorTelemetryStore.getSnapshot);
 const active=useMemo(()=>TOOL_DEFINITIONS.find(t=>t.id===tool)!,[tool]);
 const choose=(id:ToolId)=>{setTool(id);clickLegacy('[data-tool="'+id+'"]')};
 useEffect(()=>connectLegacyTelemetry(window,editorTelemetryStore),[]);
 useEffect(()=>{
  const next=TOOL_DEFINITIONS.find(item=>item.id===telemetry?.activeTool);
  if(next)setTool(next.id);
 },[telemetry?.activeTool]);
 useEffect(()=>{
  const onKey=(e:KeyboardEvent)=>{
   if(e.target instanceof HTMLElement&&(e.target.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)))return;
   const next=TOOL_DEFINITIONS.find(t=>t.key===e.key);
   if(next)choose(next.id);
  };
  window.addEventListener('keydown',onKey);
  return()=>window.removeEventListener('keydown',onKey);
 },[]);
 return <div className="editor-shell">
  <TopBar onUndo={()=>clickLegacy('#undo')} onRedo={()=>clickLegacy('#redo')} onGraph={()=>clickLegacy('#openGraph')} onExport={()=>clickLegacy('#exportWorld')}/>
  <ToolRail activeTool={tool} onChoose={choose} onUndo={()=>clickLegacy('#undo')} onRedo={()=>clickLegacy('#redo')} onAdvanced={()=>clickLegacy('#devToggle')}/>
  <ViewportHud telemetry={telemetry}/>
  <Inspector tool={tool} section={section} telemetry={telemetry} onSectionChange={setSection} onLegacy={clickLegacy}/>
  <StatusBar activeTool={telemetry?.activeTool??active.label} telemetry={telemetry}/>
 </div>;
}
