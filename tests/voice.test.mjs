import {it,expect} from 'vitest';
import {advanceWake,pcm16} from '../src/voice-core.mjs';
it('wake only arms one following utterance, ignores unrelated and suppresses playback',()=>{
 expect(advanceWake({armed:false},'今天天气')).toEqual({armed:false,command:null});
 expect(advanceWake({armed:false},'小优')).toEqual({armed:true,command:null});
 expect(advanceWake({armed:true},'打开记事本')).toEqual({armed:false,command:'打开记事本'});
 expect(advanceWake({armed:false},'小 优，打开记事本')).toEqual({armed:false,command:'打开记事本'});
 expect(advanceWake({armed:true,speaking:true},'删除文件')).toEqual({armed:false,command:null});
});
it('downsamples and clips PCM to signed little-endian 16k mono',()=>{
 const p=pcm16(new Float32Array([2,2,2,-2,-2,-2,0,0,0]),48000);
 expect([...p]).toEqual([32767,-32768,0]);
});
