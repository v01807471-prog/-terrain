import type {EditorTelemetry} from '../EditorTelemetry';

export default function ViewportHud({telemetry}:{telemetry:EditorTelemetry|null}){
 const coordinates=telemetry?telemetry.cameraPosition.map(value=>value.toFixed(1)).join(' / '):'—';
 return <div className="viewport-hud">
  <div className="viewport-label"><i className="live-dot"/>{telemetry?'LIVE VIEWPORT · '+telemetry.lodLevels+' LOD':'VIEWPORT · WAITING FOR ENGINE'}</div>
  <div className="viewport-help">LMB sculpt · RMB look · WASD move · Shift faster</div>
  <div className="viewport-coordinates">CAMERA XYZ <b>{coordinates}</b></div>
 </div>;
}
