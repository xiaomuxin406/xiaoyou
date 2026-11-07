import {afterAll,afterEach,beforeAll,expect,it} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {TtsEngine} from '../server/tts.mjs';

const exec = promisify(execFile);
const engines=[];
let directory,python,otherPython,previousPythonPath;
const modules=['f5_tts','torch','torchaudio','soundfile','vosk','scipy','imageio_ffmpeg'];
const fixture = `import sys,json,time,os
print(json.dumps({'type':'ready'}),flush=True)
for line in sys.stdin:
    message=json.loads(line)
    if message.get('op')=='crash': sys.exit(7)
    if message.get('op')=='progress': print(json.dumps({'type':'progress','id':message['id'],'phase':'synthesizing'}),flush=True)
    time.sleep(message.get('delay',0))
    print(json.dumps({'id':message['id'],'ok':True,'pid':os.getpid(),'python':sys.executable,'text':message.get('text','')}),flush=True)
`;

beforeAll(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'xy-tts-process-'));
 await mkdir(path.join(directory,'voice'),{recursive:true});
 await writeFile(path.join(directory,'voice','tts_worker.py'),fixture);
 const base=(await exec('python',['-c','import sys; print(sys.executable)'],{encoding:'utf8'})).stdout.trim();
 const first=path.join(directory,'.runtime','tts-env');
 const second=path.join(directory,'second-env');
 await exec(base,['-m','venv','--without-pip',first],{timeout:30000});
 await exec(base,['-m','venv','--without-pip',second],{timeout:30000});
 const executable=process.platform==='win32'?path.join('Scripts','python.exe'):path.join('bin','python');
 python=path.join(first,executable);otherPython=path.join(second,executable);
 const moduleDirectory=path.join(directory,'fixture-modules');
 await mkdir(moduleDirectory);
 for(const name of modules) await writeFile(path.join(moduleDirectory,name+'.py'),'# Presence fixture; no ML imports needed by protocol fixture.\n');
 previousPythonPath=process.env.PYTHONPATH;
 process.env.PYTHONPATH=moduleDirectory;
},60000);

afterEach(async()=>{for(const engine of engines.splice(0))await engine.close();});
afterAll(async()=>{
 if(previousPythonPath===undefined)delete process.env.PYTHONPATH;else process.env.PYTHONPATH=previousPythonPath;
 if(directory)await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
});

function engine(settings={ttsPythonPath:python}){
 const value=new TtsEngine({root:directory,dataDir:directory,modelPath:directory,getSettings:()=>settings});
 engines.push(value);return value;
}

it('reports synthesis phase and elapsed time while the worker is processing',async()=>{
 const value=engine();const pending=value.request({op:'progress',delay:0.3});
 await expect.poll(async()=>(await value.status()).phase).toBe('synthesizing');
 expect(await value.status()).toMatchObject({busy:true,phase:'synthesizing'});
 expect((await value.status()).elapsedSeconds).toBeGreaterThanOrEqual(0);
 await pending;
 expect(await value.status()).toMatchObject({busy:false,phase:'idle',elapsedSeconds:0});
});

it('does not retain an intentional cancellation as an engine failure',async()=>{
 const value=engine();const controller=new AbortController();
 const pending=value.request({op:'infer',delay:2},{signal:controller.signal}).catch(error=>error);
 await expect.poll(async()=>(await value.status()).busy).toBe(true);
 controller.abort();await pending;
 expect((await value.status()).error).toBeUndefined();
});

it('does not call a bare interpreter an installed voice engine',async()=>{
 const missing=path.join(directory,'incomplete-modules');await mkdir(missing,{recursive:true});
 const saved=process.env.PYTHONPATH;process.env.PYTHONPATH=missing;
 try{
  const value=engine();const status=await value.status();
  expect(status.installed).toBe(false);expect(status.error).toContain('f5_tts');
  await expect(value.request({op:'infer'})).rejects.toThrow(/依赖|安装/);
 }finally{process.env.PYTHONPATH=saved;}
});

it('honors an invalid explicit Python path instead of falling back',async()=>{
 const value=engine({ttsPythonPath:path.join(directory,'missing-python.exe')});
 const status=await value.status();expect(status.installed).toBe(false);
 expect(status.error).toMatch(/Python|路径/);
 await expect(value.request({op:'infer'})).rejects.toThrow(/Python|路径/);
});

it('cancels an active child and processes the next request without old-close interference',async()=>{
 const value=engine();await value.start();
 const controller=new AbortController();
 const first=value.request({op:'infer',delay:2},{signal:controller.signal});
 const firstOutcome=first.catch(error=>error);
 await new Promise(resolve=>setTimeout(resolve,30));controller.abort();
 const second=value.request({op:'infer',delay:0.15,text:'新的回复'});
 expect(await firstOutcome).toBeInstanceOf(Error);
 expect(await second).toMatchObject({ok:true,text:'新的回复'});
 expect((await value.status()).busy).toBe(false);
});

it('aborts during startup and leaves the next request usable',async()=>{
 const value=engine();const controller=new AbortController();
 const request=value.request({op:'infer',delay:2},{signal:controller.signal});
 const outcome=request.catch(error=>error);
 await new Promise(resolve=>setImmediate(resolve));controller.abort();
 expect(await outcome).toBeInstanceOf(Error);
 expect(await value.request({op:'infer',text:'重试'})).toMatchObject({ok:true,text:'重试'});
});

it('restarts the worker when the configured Python executable changes',async()=>{
 const settings={ttsPythonPath:python};const value=engine(settings);
 const first=await value.request({op:'infer'});settings.ttsPythonPath=otherPython;
 const second=await value.request({op:'infer'});
 expect(first.pid).not.toBe(second.pid);expect(second.python.toLowerCase()).toBe(otherPython.toLowerCase());
});

it('cancels a queued request without interrupting the active request',async()=>{
 const value=engine();const first=value.request({op:'infer',delay:0.2,text:'继续'});
 const controller=new AbortController();
 const queued=value.request({op:'infer',text:'不要朗读'},{signal:controller.signal});
 const outcome=queued.catch(error=>error);controller.abort();
 expect(await outcome).toBeInstanceOf(Error);
 expect(await first).toMatchObject({ok:true,text:'继续'});
 expect(await value.request({op:'infer',text:'下一条'})).toMatchObject({ok:true,text:'下一条'});
});

it('rejects worker crashes and timeouts, then allows a clean retry',async()=>{
 const value=engine();await expect(value.request({op:'crash'})).rejects.toThrow(/退出/);
 expect((await value.status()).busy).toBe(false);
 await expect(value.request({op:'infer',delay:2},{timeout:60})).rejects.toThrow(/超时/);
 expect(await value.request({op:'infer',text:'恢复'})).toMatchObject({ok:true,text:'恢复'});
 expect((await value.status()).error).toBeUndefined();
});

it.skipIf(process.platform!=='win32')('rechecks dependencies after an installer exits successfully',async()=>{
 const incomplete=path.join(directory,'installer-modules');await mkdir(incomplete,{recursive:true});
 const saved=process.env.PYTHONPATH;process.env.PYTHONPATH=incomplete;
 const quoted=incomplete.replaceAll("'","''");
 await writeFile(path.join(directory,'voice','install-tts.ps1'),`param($TargetDirectory,$CacheDirectory)\n${modules.map(name=>`[IO.File]::WriteAllText('${quoted}\\${name}.py', '# Installed fixture')`).join('\n')}\nexit 0\n`);
 try{
  const value=engine();expect((await value.status()).installed).toBe(false);
  await value.install();
  await expect.poll(async()=>(await value.status()).installing,{timeout:10000}).toBe(false);
  expect((await value.status()).installed).toBe(true);
  expect((await value.status()).error).toBeUndefined();
 }finally{process.env.PYTHONPATH=saved;}
});

it.skipIf(process.platform!=='win32')('kills the owned installer and its child process on close',async()=>{
 const pidFile=path.join(directory,'installer-child.pid');
 const childScript=path.join(directory,'installer-child.py');
 await writeFile(childScript,`import os,time\nopen(${JSON.stringify(pidFile.replaceAll('\\','/'))},'w').write(str(os.getpid()))\ntime.sleep(60)\n`);
 const quote=value=>"'"+value.replaceAll("'","''")+"'";
 await writeFile(path.join(directory,'voice','install-tts.ps1'),`param($TargetDirectory,$CacheDirectory)\n$p=Start-Process -FilePath ${quote(python)} -ArgumentList @('-u',${quote(childScript)}) -PassThru -WindowStyle Hidden\nStart-Sleep -Seconds 60\n`);
 const value=engine();let pid;
 try{
  await value.install();
  await expect.poll(async()=>{try{pid=Number(await readFile(pidFile,'utf8'));return pid>0;}catch{return false;}},{timeout:10000}).toBe(true);
  await value.close();
  await expect.poll(()=>{try{process.kill(pid,0);return true;}catch{return false;}},{timeout:5000}).toBe(false);
  expect((await value.status()).installing).toBe(false);
 }finally{if(pid){try{process.kill(pid);}catch{}}}
});
