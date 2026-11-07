import {useCallback,useEffect,useRef,useState} from 'react';
import {api,responseError} from './api';
// @ts-ignore tested standalone DSP and wake state
import {advanceWake,pcm16} from './voice-core.mjs';
type Options={onCommand:(text:string)=>void;speechEnabled:boolean;busy:boolean;voicePackId?:string};
export function useVoice({onCommand,speechEnabled,busy,voicePackId}:Options){
 const [enabled,setEnabled]=useState(false),[status,setStatus]=useState('麦克风已关闭'),[partial,setPartial]=useState(''),[speaking,setSpeaking]=useState(false),[error,setError]=useState('');
 const socket=useRef<WebSocket|null>(null),stream=useRef<MediaStream|null>(null),audio=useRef<AudioContext|null>(null),processor=useRef<ScriptProcessorNode|null>(null),armed=useRef(false),speakingRef=useRef(false),busyRef=useRef(busy),commandRef=useRef(onCommand),lastWake=useRef(0),active=useRef(false),mount=useRef(true);
 busyRef.current=busy;commandRef.current=onCommand;
 const cleanup=useCallback(()=>{active.current=false;socket.current?.close();socket.current=null;processor.current?.disconnect();processor.current=null;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;audio.current?.close().catch(()=>{});audio.current=null;armed.current=false;if(mount.current){setEnabled(false);setPartial('');setStatus('麦克风已关闭');}},[]);
 const playback=useRef<HTMLAudioElement|null>(null),playbackUrl=useRef<string|null>(null),synthesis=useRef<AbortController|null>(null),generation=useRef(0),localActive=useRef(false),cancelled=useRef<Promise<unknown>>(Promise.resolve());
 const releasePlayback=useCallback(()=>{if(playback.current){playback.current.onended=null;playback.current.onerror=null;playback.current.pause();playback.current.removeAttribute('src');playback.current.load();playback.current=null;}if(playbackUrl.current){URL.revokeObjectURL(playbackUrl.current);playbackUrl.current=null;}},[]);
 const finish=useCallback((token:number)=>{if(token!==generation.current)return;releasePlayback();synthesis.current=null;localActive.current=false;speakingRef.current=false;if(mount.current){setSpeaking(false);setStatus(active.current?'说“小优”唤醒':'麦克风已关闭');}socket.current?.readyState===1&&socket.current.send('{"type":"reset"}');},[releasePlayback]);
 const stop=useCallback(()=>{generation.current++;synthesis.current?.abort();synthesis.current=null;if(localActive.current){cancelled.current=api('/api/tts/cancel',{}).catch(()=>{});localActive.current=false;}window.speechSynthesis?.cancel();releasePlayback();speakingRef.current=false;if(mount.current){setSpeaking(false);setStatus(active.current?'说“小优”唤醒':'麦克风已关闭');}socket.current?.readyState===1&&socket.current.send('{"type":"reset"}');},[releasePlayback]);
 const speak=useCallback((text:string)=>{
  if(!speechEnabled)return;
  stop();setError('');
  const spoken=text.replace(/```[\s\S]*?```/g,'代码已显示在面板中。').replace(/[#*`]/g,'').slice(0,6000).trim();if(!spoken)return;
  const token=generation.current;
  speakingRef.current=true;setSpeaking(true);setStatus(voicePackId&&voicePackId!=='system'?'正在合成小优的声音…':'小优正在说话');
  if(voicePackId&&voicePackId!=='system'){
   const controller=new AbortController();synthesis.current=controller;localActive.current=true;
   void (async()=>{try{
    await cancelled.current;if(controller.signal.aborted||token!==generation.current)return;
    const response=await fetch('/api/tts/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:spoken,voicePackId}),signal:controller.signal});
    if(!response.ok)throw await responseError(response,'本地语音合成失败，请检查设置中的 F5-TTS 引擎');
    const blob=await response.blob();if(controller.signal.aborted||token!==generation.current)return;
    const url=URL.createObjectURL(blob);playbackUrl.current=url;const player=new Audio(url);playback.current=player;
    player.onended=()=>finish(token);player.onerror=()=>{if(token!==generation.current)return;setError('合成语音播放失败，请重试');finish(token);};
    setStatus('小优正在说话');await player.play();
   }catch(e){if(controller.signal.aborted||token!==generation.current)return;if(mount.current)setError(e instanceof Error?e.message:String(e));finish(token);}})();
   return;
  }
  if(!window.speechSynthesis){setError('当前浏览器不支持系统朗读，请在设置中选择本地音色');finish(token);return;}
  const utterance=new SpeechSynthesisUtterance(spoken);utterance.lang='zh-CN';const voice=window.speechSynthesis.getVoices().find(v=>v.lang.toLowerCase().startsWith('zh'));if(voice)utterance.voice=voice;utterance.rate=1.03;utterance.onend=()=>finish(token);utterance.onerror=()=>finish(token);window.speechSynthesis.speak(utterance);
 },[speechEnabled,voicePackId,stop,finish]);
 const start=useCallback(async(once=false)=>{setError('');try{const res=await fetch('/api/voice/status');const health=await res.json();if(!health.ready)throw Error(health.error||'语音资源未就绪');const media=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,channelCount:1}});if(!mount.current){media.getTracks().forEach(t=>t.stop());return;}stream.current=media;const context=new AudioContext();audio.current=context;await context.resume();const source=context.createMediaStreamSource(media);const node=context.createScriptProcessor(4096,1,1);processor.current=node;const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/voice`);socket.current=ws;active.current=true;armed.current=once;lastWake.current=Date.now();setEnabled(true);setStatus('正在加载中文语音模型…');ws.onmessage=event=>{const data=JSON.parse(event.data);if(data.type==='ready')setStatus(once?'请说出你的要求':'说“小优”唤醒');if(data.type==='error'){setError(data.error);cleanup();}if(data.type==='partial')setPartial(data.text||'');if(data.type==='final'){setPartial('');if(speakingRef.current||busyRef.current)return;if(armed.current&&Date.now()-lastWake.current>20000)armed.current=false;const next=advanceWake({armed:armed.current,speaking:speakingRef.current},data.text||'');armed.current=next.armed;if(next.armed){lastWake.current=Date.now();setStatus('我在，请说…');}else setStatus('说“小优”唤醒');if(next.command)commandRef.current(next.command);}};ws.onerror=()=>setError('语音连接失败，请重试');ws.onclose=()=>{if(active.current)cleanup();};node.onaudioprocess=event=>{if(ws.readyState!==WebSocket.OPEN||speakingRef.current||busyRef.current)return;const pcm=pcm16(event.inputBuffer.getChannelData(0),context.sampleRate);ws.send(pcm.buffer);};source.connect(node);const gain=context.createGain();gain.gain.value=0;node.connect(gain);gain.connect(context.destination);
 }catch(e){cleanup();setError(e instanceof Error?e.message:String(e));}},[cleanup]);
 const toggle=useCallback(()=>{active.current?cleanup():void start(false);},[cleanup,start]);
 const listenOnce=useCallback(()=>{stop();if(active.current){armed.current=true;lastWake.current=Date.now();setStatus('请说出你的要求');}else void start(true);},[start,stop]);
 useEffect(()=>{if(!speechEnabled)stop();},[speechEnabled,stop]);
 useEffect(()=>{mount.current=true;return()=>{mount.current=false;stop();cleanup();};},[cleanup,stop]);
 return {enabled,status,partial,speaking,toggle,listenOnce,speak,stop,error};
}
