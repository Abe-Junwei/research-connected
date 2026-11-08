import { SimilarityMap } from '../src/map-canvas';
import { mountGraphSurface } from '../src/graph-surface';
import { syntheticGraph } from './perf-fixture';
const host=document.createElement('div');host.style.cssText='width:1000px;height:700px;display:flex';document.body.append(host);
const s=mountGraphSurface(host,{canvasLabel:'pan benchmark',title:'',hint:''});const map=new SimilarityMap(s.canvas,s.tooltip,s.stage);map.setLayout('radial');const graph=syntheticGraph(Number(new URLSearchParams(location.search).get("n") ?? 300));map.setGraph(graph.nodes,graph.edges,graph.seedScore);
const internal=map as unknown as {introAt:number;introHold:boolean;night:boolean;draw():void;tx:number};internal.introAt=0;internal.introHold=false;internal.night=new URLSearchParams(location.search).get("theme") !== "light";
const ctx=s.canvas.getContext('2d')!;const measure=ctx.measureText.bind(ctx);let calls=0;ctx.measureText=text=>{calls++;return measure(text)};
map.setViewState({zoom:1.5,centerX:0,centerY:0,selectedId:null});internal.draw();calls=0;const times:number[]=[];for(let i=0;i<30;i++){internal.tx+=1;const start=performance.now();internal.draw();times.push(performance.now()-start)}
times.sort((a,b)=>a-b);document.body.textContent=JSON.stringify({nodes:graph.nodes.length,edges:graph.edges.length,frames:30,measureTextCalls:calls,medianMs:times[15],p95Ms:times[28]});map.destroy();
