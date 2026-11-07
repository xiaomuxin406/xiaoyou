import {it,expect,afterEach} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {startServer} from '../server/index.mjs';

const cleanups=[];
afterEach(async()=>{for(const f of cleanups.splice(0).reverse())await f();});
async function setup(){
 const dir=await mkdtemp(path.join(tmpdir(),'xy-packs-'));
 cleanups.push(()=>rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 const calls=[];
 const tts={status:async()=>({installed:true,installing:false}),request:async request=>{
  calls.push(request);
  if(request.op==='prepare'){
   const data=await readFile(request.input);if(data.toString()==='broken')throw Error('损坏的音频');
   await writeFile(request.output,'prepared wave');return {transcript:'主人很高兴再见到你',duration:3.2};
  }
  await writeFile(request.output,Buffer.from('RIFF0000WAVE'));return {sampleRate:24000,duration:1};
 },cancel:()=>{},close:async()=>{}};
 const s=await startServer({dataDir:dir,port:0,ttsEngine:tts});cleanups.push(()=>s.close());
 const cookie=(await fetch(s.url)).headers.get('set-cookie').split(';')[0];
 const api=(p,body,method=body?'POST':'GET',headers={})=>fetch(s.url+p,{method,headers:{cookie,Origin:s.url,...(body&&!(body instanceof Buffer)?{'Content-Type':'application/json'}:{}),...headers},body:body instanceof Buffer?body:body?JSON.stringify(body):undefined});
 return {...s,dir,api,calls};
}

it('imports MP3, selects it, edits transcript and synthesizes new text from normalized reference',async()=>{
 const s=await setup();const data=await readFile('voice-packs/ttsmaker-file-2026-11-7-20-30-54.mp3');
 const response=await s.api('/api/voice-packs/import?name=sample.mp3',data,'POST',{'Content-Type':'audio/mpeg'});
 expect(response.status).toBe(200);const {pack,selectedId}=await response.json();
 expect(pack.transcript).toBe('主人很高兴再见到你');expect(selectedId).toBe(pack.id);
 expect((await s.runtime.state()).settings.voicePackId).toBe(pack.id);
 expect((await s.api('/api/voice-packs/'+pack.id,{transcript:'主人，很高兴再见到你。'},'PATCH')).status).toBe(200);
 const audio=await s.api('/api/tts/speak',{text:'今天天气不错',voicePackId:pack.id});
 expect(audio.headers.get('content-type')).toContain('audio/wav');expect(Buffer.from(await audio.arrayBuffer()).toString()).toContain('WAVE');
 expect(s.calls.at(-1)).toMatchObject({op:'infer',text:'今天天气不错',transcript:'主人，很高兴再见到你。'});
 expect(s.calls.at(-1).reference).toMatch(/\.wav$/);
 expect((await s.api('/api/voice-packs/'+pack.id+'/audio')).headers.get('content-type')).toContain('audio/mpeg');
 const saved=JSON.parse(await readFile(path.join(s.dir,'config.local.json'),'utf8'));expect(saved.voicePackId).toBe(pack.id);
 await s.close();const reopened=await startServer({dataDir:s.dir,port:0,ttsEngine:{...s.runtime.tts,close:async()=>{}}});cleanups.push(()=>reopened.close());
 expect((await reopened.runtime.state()).settings.voicePackId).toBe(pack.id);
});

it('rejects untrusted, invalid or corrupted uploads without replacing current voice',async()=>{
 const s=await setup();
 expect((await fetch(s.url+'/api/voice-packs')).status).toBe(401);
 expect((await s.api('/api/voice-packs/import?name=bad.txt',Buffer.from('abc'),'POST')).status).toBe(400);
 expect((await s.api('/api/voice-packs/import?name=bad.mp3',Buffer.from('broken'),'POST')).status).toBe(400);
 expect((await s.runtime.state()).settings.voicePackId).toBe('system');
 expect((await s.api('/api/settings',{voicePackId:123})).status).toBe(400);
 expect((await s.api('/api/tts/speak',{text:'你好',voicePackId:'../../outside'})).status).toBe(400);
});

it('discovers a new MP3 from the voice pack directory and auto selects exactly once',async()=>{
 const s=await setup();
 const dir=path.join(s.dir,'voice-packs');const {mkdir}=await import('node:fs/promises');await mkdir(dir,{recursive:true});
 await writeFile(path.join(dir,'new.mp3'),await readFile('voice-packs/ttsmaker-file-2026-11-7-20-30-54.mp3'));
 const first=await(await s.api('/api/voice-packs')).json();expect(first.packs).toHaveLength(1);expect(first.selectedId).toBe(first.packs[0].id);
 await s.api('/api/settings',{voicePackId:'system'});
 const second=await(await s.api('/api/voice-packs')).json();expect(second.selectedId).toBe('system');expect(second.packs).toHaveLength(1);
});

it('reuses completed speech and regenerates it after reference text changes',async()=>{
 const s=await setup();const {pack}=await(await s.api('/api/voice-packs/import?name=voice.mp3',Buffer.from('voice'),'POST')).json();
 const wave=await readFile('voice-packs/builtin.wav');
 s.runtime.tts.request=async input=>{s.calls.push(input);await writeFile(input.output,wave);return {sampleRate:24000,duration:5.256};};
 const speak=async()=>{const response=await s.api('/api/tts/speak',{text:'主人，今天一起完成计划。',voicePackId:pack.id});expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(wave);};
 await speak();await speak();
 expect(s.calls.filter(c=>c.op==='infer')).toHaveLength(1);
 await s.api('/api/voice-packs/'+pack.id,{transcript:'新的参考文字。'},'PATCH');
 await speak();expect(s.calls.filter(c=>c.op==='infer')).toHaveLength(2);
});

it('resets an unavailable cloned voice when switching project directories and keeps settings saveable',async()=>{
 const s=await setup();
 const {pack}=await(await s.api('/api/voice-packs/import?name=old.mp3',Buffer.from('old voice'),'POST')).json();
 const projectDir=path.join(s.dir,'new-project');
 const switched=await s.api('/api/settings',{projectDir,voicePackId:pack.id});
 expect(switched.status).toBe(200);
 expect((await switched.json()).settings.voicePackId).toBe('system');
 expect((await s.runtime.state()).settings.projectDir).toBe(projectDir);
 expect((await s.api('/api/settings',{projectDir,voicePackId:'system',city:'北京'})).status).toBe(200);
 const saved=JSON.parse(await readFile(path.join(s.dir,'config.local.json'),'utf8'));
 expect(saved).toMatchObject({projectDir,voicePackId:'system',city:'北京'});
});

it('validates a selected voice against the destination project instead of the previous project',async()=>{
 const source=await setup(),destination=await setup();
 const {pack}=await(await destination.api('/api/voice-packs/import?name=destination.mp3',Buffer.from('destination voice'),'POST')).json();
 await destination.close();
 const switched=await source.api('/api/settings',{projectDir:destination.dir,voicePackId:pack.id});
 expect(switched.status).toBe(200);
 expect((await switched.json()).settings.voicePackId).toBe(pack.id);
 const audio=await source.api('/api/tts/speak',{text:'使用新项目中的声音'});
 expect(audio.status).toBe(200);await audio.arrayBuffer();
 expect(source.calls.at(-1).reference).toBe(path.join(destination.dir,'.runtime','voice-packs',pack.id+'.wav'));
 expect((await source.api('/api/settings',{voicePackId:'a'.repeat(24)})).status).toBe(400);
});

it('interrupts synthesis from the previous project when switching project directories',async()=>{
 const s=await setup();
 const {pack}=await(await s.api('/api/voice-packs/import?name=old.mp3',Buffer.from('old voice'),'POST')).json();
 let rejectPending,started=false;
 s.runtime.tts.request=async()=>{started=true;return new Promise((_resolve,reject)=>{rejectPending=reject;});};
 s.runtime.tts.cancel=()=>rejectPending?.(Error('已停止语音生成'));
 const pending=s.api('/api/tts/speak',{text:'旧项目的回复',voicePackId:pack.id});
 try{
  await expect.poll(()=>started).toBe(true);
  expect((await s.api('/api/settings',{projectDir:path.join(s.dir,'new-project'),voicePackId:'system'})).status).toBe(200);
  let response;
  void pending.then(value=>{response=value;});
  await expect.poll(()=>response?.status,{timeout:1000}).toBe(400);
  expect(await response.json()).toMatchObject({error:'已停止语音生成'});
 }finally{rejectPending?.(Error('test cleanup'));await pending;}
});
