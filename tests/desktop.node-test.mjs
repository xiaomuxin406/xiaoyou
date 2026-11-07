import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRuntime, validatePort, navigationAllowed } from '../desktop/runtime.mjs';
test('packaged boot uses writable userdata and external voice resources',()=>{
 const c=resolveRuntime({packaged:true,userData:'C:/Users/Test/Data',resources:'C:/Apps/Xiaoyou/resources',projectRoot:'D:/src'});
 assert.equal(c.dataDir,'C:/Users/Test/Data');
 assert.match(c.voiceExecutable.replaceAll('\\','/'),/C:\/Apps\/Xiaoyou\/resources\/voice\/xiaoyou-voice.exe$/);
 assert.match(c.staticDir.replaceAll('\\','/'),/resources\/app-ui$/);
});
test('port validation rejects floats and reserved/out of range values',()=>{
 assert.equal(validatePort(8765),8765);
 for (const p of [0,80,65536,8.5,'oops']) assert.throws(()=>validatePort(p));
});
test('navigation stays on actual loopback service origin',()=>{
 assert.equal(navigationAllowed('http://127.0.0.1:8765/settings','http://127.0.0.1:8765'),true);
 for(const url of ['https://evil.test','file:///C:/Windows','javascript:alert(1)','http://127.0.0.1:7777']) assert.equal(navigationAllowed(url,'http://127.0.0.1:8765'),false);
});
