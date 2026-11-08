import {mountGraphApp} from '../src/app';
import {SimilarityMap} from '../src/map-canvas';
import {DEFAULT_SETTINGS} from '../src/settings-model';
import {fixtureGet} from '../preview/fixture';
const host=document.createElement('div');host.style.cssText='width:1000px;height:700px';document.body.append(host);
const settings=structuredClone(DEFAULT_SETTINGS);settings.s2Reconcile=false;settings.semanticEmbedding=false;
const original=SimilarityMap.prototype.setGraph;let animated=false;
SimilarityMap.prototype.setGraph=function(...args){if(args[0].length>1)animated=args[4]?.animate!==false;return original.apply(this,args)};
const app=mountGraphApp(host,{getSettings:()=>settings,getJson:fixtureGet,saveProject:async p=>{settings.researchProjects[p.seedId]=p},openExternal(){},initialDoi:'10.1234/seed'});
try{for(let i=0;i<500&&!host.querySelector('.cpo-seed-title')?.textContent;i++)await new Promise(r=>setTimeout(r,20));if(!animated)throw new Error('New graph skipped progressive reveal');document.body.textContent='PASS new graph progressive reveal';}catch(e){document.body.textContent=String(e)}finally{app.destroy();SimilarityMap.prototype.setGraph=original;}
