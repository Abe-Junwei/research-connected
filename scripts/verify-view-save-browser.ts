import {mountGraphApp} from '../src/app';
import {DEFAULT_SETTINGS} from '../src/settings-model';
import {saveGraphSnapshot, type ResearchProject} from '../src/project-state';
import {syntheticGraph} from './perf-fixture';
export async function verifyViewSave(): Promise<void> {
 const settings=structuredClone(DEFAULT_SETTINGS);settings.s2Reconcile=false;
 const snapshot=saveGraphSnapshot(syntheticGraph(12));const project:ResearchProject={version:1,seedId:snapshot.seedId,name:'Test',updatedAt:1,views:[],snapshot};settings.researchProjects={[project.seedId]:project};
 const host=document.createElement('div');host.style.cssText='width:1000px;height:700px';document.body.append(host);
 let previous:ResearchProject['snapshot'],reused=false;
 const app=mountGraphApp(host,{getSettings:()=>settings,loadSavedProject:()=>project,saveProject:async p=>{reused=previous===p.snapshot;previous=p.snapshot;settings.researchProjects[p.seedId]=p;},getJson:async()=>{throw new Error('Offline test')},openExternal(){}});
 try {for(let i=0;i<2;i++){host.querySelector('canvas')!.dispatchEvent(new Event('pointerup'));await new Promise(r=>setTimeout(r,600));}if(!reused)throw new Error('View save did not reuse graph snapshot');}finally{app.destroy();host.remove();}
}
