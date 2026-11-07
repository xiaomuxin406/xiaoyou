import {chromium} from '@playwright/test';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {startServer} from '../server/index.mjs';

// Protocol fixture verifies the actual production UI/API path; real model inference
// is separately exercised by voice/tts_worker.py with the provided MP3.
const dir=await mkdtemp(path.join(tmpdir(),'xy-voice-e2e-'));
const source=path.resolve('voice-packs/ttsmaker-file-2026-11-7-20-30-54.mp3');
const wave=await readFile('voice-packs/builtin.wav');
let syntheses=0,cancelled=0;
const engine={status:async()=>({installed:true,installing:false,busy:false}),request:async input=>{
 if(input.op==='prepare'){await writeFile(input.output,wave);return {transcript:'你好，很高兴认识你。',duration:5.256};}
 syntheses++;await writeFile(input.output,wave);return {sampleRate:24000,duration:5.256};
},cancel:()=>{cancelled++;},close:async()=>{}};
const service=await startServer({dataDir:dir,staticDir:path.resolve('dist'),port:0,ttsEngine:engine});
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 await page.goto(service.url);await page.getByRole('button',{name:'打开设置'}).click();
 await page.getByLabel('导入 MP3 音色').setInputFiles(source);
 await page.getByText('音色已导入并选中。请核对参考文字，再试听合成效果。').waitFor();
 const selected=await page.getByLabel('朗读音色').inputValue();assert.match(selected,/^[a-f0-9]{24}$/);
 assert.equal((await service.runtime.state()).settings.voicePackId,selected);
 await page.getByLabel('参考音频中的原文',{exact:false}).fill('你好，很高兴认识你。接下来，请录入我的声音吧。');
 await page.getByRole('button',{name:'保存参考文字',exact:true}).click();
 await page.getByText('参考文字已保存',{exact:true}).waitFor();
 await page.getByLabel('合成试听文字',{exact:false}).fill('主人，今天我们一起完成新的计划。');
 await page.getByRole('button',{name:'合成试听',exact:true}).click();
 await page.getByRole('button',{name:'停止试听',exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.voice-actions [role="status"]')?.textContent==='小优正在说话');
 assert.equal(syntheses,1);
 await page.getByRole('button',{name:'停止试听',exact:true}).click();
 await page.getByRole('button',{name:'合成试听',exact:true}).waitFor();
 await page.getByRole('button',{name:'合成试听',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.voice-actions [role="status"]')?.textContent==='小优正在说话');
 assert.equal(syntheses,1,'identical completed speech should play from the local cache');
 await page.getByRole('button',{name:'停止试听',exact:true}).click();
 await page.getByRole('button',{name:'保存设置',exact:true}).click();
 await page.reload();await page.getByRole('button',{name:'打开设置'}).click();
 await page.getByLabel('朗读音色').waitFor();assert.equal(await page.getByLabel('朗读音色').inputValue(),selected);
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 await mkdir(path.join(dir,'voice-packs'),{recursive:true});
 // Different ID without corrupting the actual MP3 payload: metadata at the end.
 const added=Buffer.concat([await readFile(source),Buffer.from('new-reference')]);
 await writeFile(path.join(dir,'voice-packs','新增音色.mp3'),added);
 await page.waitForTimeout(5500);
 assert.notEqual((await service.runtime.state()).settings.voicePackId,selected);
 await page.getByRole('button',{name:'打开设置'}).click();
 await page.getByRole('option',{name:'新增音色.mp3',exact:true}).waitFor({state:'attached'});
 await page.getByLabel('朗读音色').scrollIntoViewIfNeeded();
 await page.screenshot({path:'.runtime/voice-packs-settings.png'});
 console.log('PASS production UI/API upload, reference edit, synthesized playback, cached repeat, stop, persisted selection, directory auto-switch; fixture engine used');
}finally{await browser.close();await service.close();await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
