import path from 'node:path';
import {startServer} from './index.mjs';
import {readJson} from './storage.mjs';
const root=process.cwd();const config=await readJson(path.join(root,'config.local.json'),{});
let voice;try{const {attachVoice}=await import('./voice.mjs');voice=r=>attachVoice(r,{executable:path.join(root,'voice/dist/xiaoyou-voice/xiaoyou-voice.exe'),modelPath:path.join(root,'voice/models/vosk-model-small-cn-0.22')});}catch{}
const server=await startServer({dataDir:root,projectDir:root,staticDir:path.join(root,'dist'),port:Number(process.env.XIAOYOU_PORT||config.port||8765),voice});console.log('小优：'+server.url);for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit();});
