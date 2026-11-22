import GUI from 'lil-gui';
import type { PlanetViewport } from '../viewport/PlanetViewport';

export class PlanetGui {
  private gui:GUI;
  constructor(viewport:PlanetViewport,container:HTMLElement){
    this.gui=new GUI({container,title:'PLANET CONTROLS',width:300});
    const config=viewport.getConfig();
    const camera=this.gui.addFolder('01 · CAMERA');
    camera.add(config,'zoomSpeed',.25,3,.05).name('Zoom velocity').onChange((v:number)=>viewport.updateConfig({zoomSpeed:v}));
    camera.add(config,'rotationSpeed',.1,3,.05).name('Orbit speed').onChange((v:number)=>viewport.updateConfig({rotationSpeed:v}));
    camera.add(config,'autoRotate').name('Auto orbit');
    const clip=this.gui.addFolder('02 · CLIPMAP');
    clip.add(config,'rings',4,17,1).name('Ring count').onChange((v:number)=>viewport.updateConfig({rings:v}));
    clip.add(config,'baseSegments',12,64,1).name('Base resolution').onChange((v:number)=>viewport.updateConfig({baseSegments:v}));
    clip.add(config,'ringGrowth',1.05,1.5,.01).name('Resolution growth').onChange((v:number)=>viewport.updateConfig({ringGrowth:v}));
    clip.add(config,'showGrid').name('Show clipmap grid').onChange((v:boolean)=>viewport.updateConfig({showGrid:v}));
    const terrain=this.gui.addFolder('03 · TERRAIN');
    terrain.add(config,'amplitude',0,2200,10).name('Relief amplitude').onChange((v:number)=>viewport.updateConfig({amplitude:v}));
    terrain.add(config,'frequency',1,14,.1).name('Noise frequency').onChange((v:number)=>viewport.updateConfig({frequency:v}));
    camera.open();clip.open();terrain.open();
  }
  destroy(){this.gui.destroy();}
}
