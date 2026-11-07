import {mkdir,readFile,writeFile,appendFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export async function readJson(file,fallback){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
export async function saveJson(file,value){await mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2),'utf8');await rename(tmp,file);}
export class Memory{
 constructor(getDir){this.getDir=getDir;this.queue=Promise.resolve();this.history=[];}
 async load(){try{const text=await readFile(path.join(this.getDir(),'对话记忆.md'),'utf8');this.history=[...text.matchAll(/^(用户|小优)：([\s\S]*?)(?=\n\n(?:用户|小优)：|\n\n## |$)/gm)].slice(-24).map(m=>({role:m[1]==='用户'?'user':'assistant',content:m[2].trim()}));}catch(e){if(e.code!=='ENOENT')throw e;}}
 append(role,content){if(!['user','assistant'].includes(role)||!content)return this.queue;const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());this.history.push({role,content});this.history=this.history.slice(-24);const dir=this.getDir();this.queue=this.queue.catch(()=>{}).then(async()=>{await mkdir(dir,{recursive:true});await appendFile(path.join(dir,'对话记忆.md'),`## ${date}\n\n${role==='user'?'用户':'小优'}：${content}\n\n`,'utf8');});return this.queue;}
}
