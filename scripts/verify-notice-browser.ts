import {createNotice} from '../web/notice';
const host=document.createElement('div');host.id='cpo-web-notice';host.setAttribute('role','status');document.body.append(host);
const set=window.setTimeout,clear=window.clearTimeout;let next=0;const pending=new Map<number,()=>void>();let delay=0;
window.setTimeout=((fn:()=>void,ms:number)=>{delay=ms;pending.set(++next,fn);return next}) as typeof window.setTimeout;
window.clearTimeout=((id:number)=>{pending.delete(id)}) as typeof window.clearTimeout;
try{const show=createNotice(host);show('First');if(delay!==10000)throw Error('Wrong timeout');show('Second','error');if(pending.size!==1)throw Error('Old message timer survives');[...pending.values()][0]!();if(!host.hidden)throw Error('Timeout did not hide');show('Third');host.querySelector<HTMLButtonElement>('button')!.click();if(!host.hidden||pending.size)throw Error('Manual close failed');show('');if(!host.hidden||host.childElementCount)throw Error('Empty message remains');document.body.textContent='PASS 10-second timeout, replacement and manual dismissal';}catch(e){document.body.textContent=String(e)}finally{window.setTimeout=set;window.clearTimeout=clear;}
