import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readdir,readFile,writeFile,rm,copyFile,stat} from 'node:fs/promises';
import {readJson,saveJson} from './storage.mjs';

const MAX_BYTES=15*1024*1024;
export class VoicePacks {
 constructor({getProject,engine,select,log=()=>{}}){Object.assign(this,{getProject,engine,select,log});this.queue=Promise.resolve();this.failures=new Map();}
 get directory(){return path.join(this.getProject(),'voice-packs');}
 get cache(){return path.join(this.getProject(),'.runtime','voice-packs');}
 async records(){return readJson(path.join(this.cache,'index.json'),[]);}
 async save(records){await saveJson(path.join(this.cache,'index.json'),records);}
 serial(fn){const result=this.queue.catch(()=>{}).then(fn);this.queue=result;return result;}
 async import(name,data){return this.serial(()=>this.importFile(name,data));}
 async importFile(name,data){
  if(typeof name!=='string'||!name.toLowerCase().endsWith('.mp3'))throw Error('仅支持上传 .mp3 语音文件');
  if(!data.length||data.length>MAX_BYTES)throw Error('MP3 文件必须为 1 字节至 15 MiB');
  const id=createHash('sha256').update(data).digest('hex').slice(0,24);const records=await this.records();const existing=records.find(p=>p.id===id);
  if(existing){await this.select(id);return existing;}
  await mkdir(this.cache,{recursive:true});await mkdir(this.directory,{recursive:true});const source=path.join(this.cache,id+'.mp3'),reference=path.join(this.cache,id+'.wav');
  await writeFile(source,data);let prepared;
  try{this.log('info','正在识别语音包：'+path.basename(name));const builtin=await readJson(path.join(this.directory,'builtin.json'),null);if(builtin?.id===id&&builtin.transcript){await copyFile(path.join(this.directory,'builtin.wav'),reference);prepared=builtin;}else prepared=await this.engine.request({op:'prepare',input:source,output:reference});}
  catch(e){await rm(source,{force:true});await rm(reference,{force:true});throw e;}
  const basename=path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');const original=path.join(this.directory,basename);
  try{await stat(original);if(!(await readFile(original)).equals(data))await copyFile(source,path.join(this.directory,id+'-'+basename));}catch(e){if(e.code!=='ENOENT')throw e;await copyFile(source,original);}
  const record={id,name:basename,transcript:prepared.transcript||'',duration:prepared.duration,status:prepared.transcript?'ready':'needs-text',...(prepared.error?{error:prepared.error}:{})};
  records.push(record);await this.save(records);await this.select(id);this.log('success','语音包已自动启用：'+record.name);return record;
 }
 async scan(){return this.serial(async()=>{await mkdir(this.directory,{recursive:true});for(const entry of await readdir(this.directory,{withFileTypes:true})){if(!entry.isFile()||!entry.name.toLowerCase().endsWith('.mp3'))continue;const file=path.join(this.directory,entry.name);if((await stat(file)).size>MAX_BYTES)continue;const data=await readFile(file);const id=createHash('sha256').update(data).digest('hex').slice(0,24);if((await this.records()).some(p=>p.id===id))continue;const last=this.failures.get(id)||0;if(Date.now()-last<30000)continue;try{await this.importFile(entry.name,data);this.failures.delete(id);}catch(e){this.failures.set(id,Date.now());this.log('error',entry.name+'：'+e.message);}}return this.records();});}
 async find(id){if(typeof id!=='string'||!/^[a-f0-9]{24}$/.test(id))throw Error('语音包标识无效');const record=(await this.records()).find(p=>p.id===id);if(!record)throw Error('语音包不存在，请重新导入');return record;}
 async update(id,transcript){return this.serial(async()=>{await this.find(id);if(typeof transcript!=='string'||!transcript.trim()||transcript.length>2000)throw Error('参考文字必须为 1–2000 字符');const records=await this.records();const record=records.find(p=>p.id===id);record.transcript=transcript.trim();record.status='ready';delete record.error;await this.save(records);return record;});}
 async audio(id){await this.find(id);return readFile(path.join(this.cache,id+'.mp3'));}
 async speak(id,text,signal){const pack=await this.find(id);if(typeof text!=='string'||!text.trim()||text.length>6000)throw Error('合成文字必须为 1–6000 字符');if(!pack.transcript)throw Error('请先校正语音包的参考文字');const output=path.join(this.cache,randomUUID()+'.wav');try{await this.engine.request({op:'infer',reference:path.join(this.cache,id+'.wav'),transcript:pack.transcript,text:text.trim(),output},{signal});signal?.throwIfAborted();return await readFile(output);}finally{await rm(output,{force:true});}}
}
