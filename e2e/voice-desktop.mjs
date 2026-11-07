import {_electron as electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
const data=await mkdtemp(path.join(tmpdir(),'xy-desktop-voice-'));
let app;
try{
 const resources=path.resolve('release/win-unpacked/resources');
 for(const name of ['tts_worker.py','install-tts.ps1','requirements-tts.txt'])assert.ok((await stat(path.join(resources,'voice',name))).size>0);
 assert.deepEqual(JSON.parse(await readFile(path.join(resources,'defaults/mcp.json'),'utf8')),{mcpServers:{}});
 assert.doesNotMatch(await readFile(path.join(resources,'defaults/skills/小优/SKILL.md'),'utf8'),/Kugou|kugou|D:\\/);
 app=await electron.launch({executablePath:path.resolve('release/win-unpacked/小优.exe'),args:['--user-data-dir='+data],env:{...process.env,XIAOYOU_PORT:'8766'},timeout:60000});
 assert.equal(await app.evaluate(({app})=>app.getVersion()),'1.0.0');
 const page=await app.firstWindow();
 await page.getByText('主人，很高兴再见到你',{exact:true}).waitFor({timeout:30000});
 const state=await page.evaluate(async()=>await(await fetch('/api/state')).json());
 assert.equal(state.settings.voicePackId,'df0c198a5d8fc42318c721b4');
 assert.equal(state.settings.fullAccess,true);assert.equal(state.voice.ready,true);
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()),true);
 await page.keyboard.press('Escape');await page.waitForTimeout(300);
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()),false);
 await page.keyboard.press('F11');await page.waitForTimeout(300);
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()),true);
 await page.getByRole('button',{name:'打开设置',exact:true}).click();
 const voice=page.getByLabel('朗读音色');await voice.waitFor();
 assert.equal(await voice.inputValue(),state.settings.voicePackId);
 await page.getByRole('button',{name:'安装本地 F5-TTS 引擎',exact:true}).waitFor({state:'attached'});
 await voice.scrollIntoViewIfNeeded();await page.screenshot({path:'.runtime/voice-desktop.png'});
 console.log('PASS packaged 1.0.0 desktop: built-in selected, seeded clean defaults, worker resources, install control, bundled ASR ready, full access, fullscreen Esc/F11');
}finally{
 if(app)await app.evaluate(({app})=>app.exit(0));
 await rm(data,{recursive:true,force:true,maxRetries:20,retryDelay:250});
}
