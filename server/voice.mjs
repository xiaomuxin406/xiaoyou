import {WebSocketServer} from 'ws';
import {spawn} from 'node:child_process';
import {access,stat} from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
export async function attachVoice(runtime,{executable,modelPath}){
 const wss=new WebSocketServer({noServer:true,maxPayload:256000});const children=new Set();let lastError='';
 const currentModel=()=>runtime.settings().voiceModelPath||modelPath;
 let ready=false;async function check(){try{await access(executable);await access(path.join(currentModel(),'am','final.mdl'));ready=true;lastError='';}catch{ready=false;lastError='离线语音资源未找到，请在设置中填写 Vosk 中文模型路径';}}
 await check();
 const upgrade=(req,socket,head)=>{if(new URL(req.url,'http://localhost').pathname!=='/api/voice')return socket.destroy();if(!runtime.authenticate(req))return socket.destroy();wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));};runtime.server.on('upgrade',upgrade);
 wss.on('connection',async ws=>{await check();const send=o=>{if(ws.readyState===1)ws.send(JSON.stringify(o));};if(!ready){send({type:'error',error:lastError});return ws.close();}const child=spawn(executable,['--model',currentModel()],{stdio:['pipe','pipe','pipe'],windowsHide:true});children.add(child);let childReady=false,stderr='';const kill=()=>{if(child.stdin.writable)child.stdin.end('{"type":"close"}\n');const t=setTimeout(()=>child.kill(),1000);t.unref();};ws.on('close',kill);child.stderr.on('data',c=>stderr=(stderr+c).slice(-2000));child.on('error',e=>{send({type:'error',error:'语音进程启动失败：'+e.message});ws.close();});const lines=readline.createInterface({input:child.stdout});lines.on('line',line=>{try{const message=JSON.parse(line);if(message.type==='ready'){childReady=true;runtime.log('success','离线中文语音已就绪');}send(message);}catch{}});ws.on('message',(data,binary)=>{if(!childReady||!child.stdin.writable)return;if(binary){if(data.length>128000||data.length%2)return ws.close(1009);child.stdin.write(JSON.stringify({type:'audio',data:data.toString('base64')})+'\n');}else{try{const m=JSON.parse(data.toString());if(['flush','reset'].includes(m.type))child.stdin.write(JSON.stringify(m)+'\n');}catch{}}});child.on('close',code=>{children.delete(child);lines.close();if(code&&ws.readyState===1)send({type:'error',error:'语音进程已退出：'+stderr.slice(0,300)});ws.close();});});
 return {status:()=>({ready,modelPath:currentModel(),error:lastError||undefined}),refresh:check,close:async()=>{runtime.server.off('upgrade',upgrade);for(const ws of wss.clients)ws.terminate();for(const child of children)child.kill();await new Promise(r=>wss.close(r));}};
}
