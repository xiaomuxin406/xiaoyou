import path from 'node:path';
import {mkdir,stat} from 'node:fs/promises';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import readline from 'node:readline';
import {randomUUID} from 'node:crypto';

const execute=promisify(execFile);
const dependencyProbe=`import importlib.util,json
names=['f5_tts','torch','torchaudio','soundfile','vosk','scipy','imageio_ffmpeg']
print(json.dumps([name for name in names if importlib.util.find_spec(name) is None]))`;
const stopped=()=>Error('已停止语音生成');

export class TtsEngine {
 constructor({root,dataDir,getSettings,modelPath,log=()=>{}}){
  Object.assign(this,{root,dataDir,getSettings,modelPath,log});
  this.child=null;this.workerPython='';this.starting=null;this.epoch=0;this.closed=false;
  this.pending=new Map();this.queue=Promise.resolve();this.probes=new Map();
  this.installing=false;this.progress='';this.error='';this.installer=null;
 }

 async selection(){
  const configured=this.getSettings().ttsPythonPath?.trim();
  const executable=process.platform==='win32'?path.join('Scripts','python.exe'):path.join('bin','python');
  const candidates=configured?[configured]:[
   path.join(this.dataDir,'.runtime','tts-env',executable),
   path.join(this.root,'.runtime','tts-env',executable),
  ];
  for(const candidate of candidates){
   try{const info=await stat(candidate);if(info.isFile())return {python:candidate,key:`${candidate}:${info.mtimeMs}:${info.size}`};}catch{}
  }
  return {python:'',error:configured?`配置的 Python 路径不存在或不可访问：${configured}`:'本机语音引擎尚未安装，请在语音包设置中点击安装'};
 }

 async python(){return (await this.selection()).python;}

 async installation({refresh=false}={}){
  const selected=await this.selection();
  if(!selected.python)return {...selected,installed:false};
  const cached=this.probes.get(selected.key);
  if(!refresh&&cached&&Date.now()-cached.time<15000)return cached.promise;
  const promise=(async()=>{
   try{
    const {stdout}=await execute(selected.python,['-c',dependencyProbe],{windowsHide:true,timeout:10000,maxBuffer:65536,env:{...process.env,PYTHONUTF8:'1'}});
    const missing=JSON.parse(stdout.trim());
    if(!Array.isArray(missing))throw Error('依赖检查返回了无效结果');
    return {...selected,installed:missing.length===0,error:missing.length?`语音引擎依赖不完整（缺少 ${missing.join('、')}），请重新安装`:undefined};
   }catch(error){return {...selected,installed:false,error:'无法检查 Python 语音依赖，请检查路径或重新安装：'+error.message.slice(-500)};}
  })();
  this.probes.clear();this.probes.set(selected.key,{time:Date.now(),promise});
  return promise;
 }

 async status(){
  const installed=await this.installation();
  if(this.child&&(!installed.installed||this.workerPython!==installed.python))this.cancel();
  return {installed:installed.installed,installing:this.installing,busy:this.pending.size>0||!!this.starting,
   progress:this.progress,error:installed.error||this.error||undefined,pythonPath:installed.python};
 }

 async start({signal}={}){
  if(this.closed)throw Error('语音引擎已关闭');
  signal?.throwIfAborted();const beforeProbe=this.epoch;
  const installed=await this.installation();
  signal?.throwIfAborted();
  if(beforeProbe!==this.epoch||this.closed)throw stopped();
  if(!installed.installed)throw Error(installed.error);
  if(this.child&&this.workerPython===installed.python){
   return this.starting?this.starting.promise:this.child;
  }
  if(this.child)this.cancel();
  const epoch=this.epoch;
  const child=spawn(installed.python,['-u',path.join(this.root,'voice','tts_worker.py'),'--vosk-model',this.modelPath,'--cache-dir',path.join(this.dataDir,'.runtime','tts-models')],
   {windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1'}});
  this.child=child;this.workerPython=installed.python;this.error='';
  const lines=readline.createInterface({input:child.stdout});
  let readyResolve,readyReject,ready=false,failed=false,diagnostic='';
  const promise=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  this.starting={child,promise};
  const timer=setTimeout(()=>{fail(Error('语音引擎启动超时，请检查 Python 依赖'));child.kill();},15000);
  const fail=error=>{
   if(failed)return;failed=true;clearTimeout(timer);lines.close();readyReject(error);
   // Requests belong to their child: an old close event must not affect its replacement.
   for(const [id,pending] of this.pending){if(pending.child===child){this.pending.delete(id);pending.reject(error);}}
   if(this.child===child){this.child=null;this.workerPython='';this.error=error.message;}
   if(this.starting?.child===child)this.starting=null;
  };
  child.stderr.on('data',chunk=>{diagnostic=chunk.toString('utf8').trim().slice(-1000);if(this.child===child)this.progress=diagnostic;});
  child.stdin.on('error',error=>fail(Error('语音引擎通信失败：'+error.message)));
  lines.on('line',line=>{
   let reply;try{reply=JSON.parse(line);}catch{return;}
   if(reply.type==='ready'&&!ready){
    ready=true;clearTimeout(timer);
    if(this.starting?.child===child)this.starting=null;
    if(this.child!==child||epoch!==this.epoch){readyReject(stopped());child.kill();return;}
    readyResolve(child);return;
   }
   const pending=this.pending.get(reply.id);
   if(!pending||pending.child!==child)return;
   this.pending.delete(reply.id);
   reply.ok?pending.resolve(reply):pending.reject(Error(reply.error||'语音处理失败'));
  });
  child.once('error',error=>fail(Error('语音引擎启动失败：'+error.message)));
  child.once('close',code=>fail(Error('语音引擎已退出：'+code+(diagnostic?' '+diagnostic.slice(-300):''))));
  return promise;
 }

 request(message,{signal,timeout=15*60*1000}={}){
  let resolve,reject,settled=false,started=false,child,timer,id;
  const result=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const finish=(fn,value)=>{
   if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
   if(id&&this.pending.get(id)?.child===child)this.pending.delete(id);
   fn(value);
  };
  const abort=()=>{if(started)this.cancel();finish(reject,stopped());};
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  const task=async()=>{
   if(settled)return;
   started=true;
   timer=setTimeout(()=>{const error=Error('语音处理超时');this.error=error.message;this.cancel(error);finish(reject,error);},timeout);
   try{
    child=await this.start({signal});
    if(settled||signal?.aborted)return;
    id=randomUUID();
    this.pending.set(id,{child,resolve:value=>{this.error='';finish(resolve,value);},reject:error=>{this.error=error.message;finish(reject,error);}});
    child.stdin.write(JSON.stringify({...message,id})+'\n',error=>{
     if(error&&this.pending.get(id)?.child===child){this.pending.delete(id);finish(reject,error);}
    });
   }catch(error){if(!settled){this.error=error.message;finish(reject,error);}}
   return result;
  };
  this.queue=this.queue.catch(()=>{}).then(task).catch(()=>{});
  return result;
 }

 cancel(error=stopped()){
  this.epoch++;const child=this.child;this.child=null;this.workerPython='';this.starting=null;
  for(const [id,pending] of this.pending){if(pending.child===child){this.pending.delete(id);pending.reject(error);}}
  child?.kill();
 }

 async install(){
  if(this.installing)return;
  if(this.closed)throw Error('语音引擎已关闭');
  this.installing=true;this.error='';this.progress='正在创建独立 Python 环境并安装本机语音引擎…';
  try{
   await mkdir(path.join(this.dataDir,'.runtime'),{recursive:true});
   if(this.closed){this.installing=false;return;}
   const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(this.root,'voice','install-tts.ps1'),'-TargetDirectory',path.join(this.dataDir,'.runtime','tts-env'),'-CacheDirectory',path.join(this.dataDir,'.runtime','tts-models')],
    {windowsHide:true,stdio:['ignore','pipe','pipe']});
   this.installer=child;let finished=false;
   const output=chunk=>{if(this.installer===child)this.progress=chunk.toString('utf8').trim().slice(-1500);};
   child.stdout.on('data',output);child.stderr.on('data',output);
   const finish=async error=>{
    if(finished)return;finished=true;this.probes.clear();
    if(!error&&!this.closed){const check=await this.installation({refresh:true});if(!check.installed)error=check.error;}
    if(this.installer===child)this.installer=null;
    this.installing=false;
    if(this.closed)return;
    this.error=error||'';if(!error)this.progress='本机语音引擎安装完成';
    this.log(error?'error':'success',error||'本机语音引擎安装完成');
   };
   child.once('error',error=>{void finish('安装启动失败：'+error.message);});
   child.once('close',code=>{void finish(code?'安装失败：'+this.progress:'');});
  }catch(error){this.installing=false;this.error=error.message;throw error;}
 }

 async close(){
  this.closed=true;this.cancel();
  const installer=this.installer;
  if(installer?.pid&&installer.exitCode===null&&installer.signalCode===null){
   // Target only this owned installer and its pip/venv descendants.
   if(process.platform==='win32'){
    try{await execute('taskkill.exe',['/PID',String(installer.pid),'/T','/F'],{windowsHide:true,timeout:10000});}
    catch{installer.kill();}
   }else installer.kill();
  }
  this.installing=false;
 }
}
