import {useCallback,useEffect,useRef,useState} from 'react';
import {api,responseError,TtsStatus,VoicePack,VoicePacksResponse} from './api';
import {useVoice} from './useVoice';

type Props={selectedId?:string;onSelect:(id:string)=>void;onChanged?:()=>void;ttsPythonPath?:string;onPythonPathChange:(path:string)=>void;onBusyChange?:(busy:boolean)=>void};
export function VoicePacks({selectedId,onSelect,onChanged,ttsPythonPath,onPythonPathChange,onBusyChange}:Props){
 const [packs,setPacks]=useState<VoicePack[]>([]),[engine,setEngine]=useState<TtsStatus|null>(null),[directory,setDirectory]=useState(''),[transcript,setTranscript]=useState(''),[testText,setTestText]=useState('主人，我是小优。今天有什么想完成的事？'),[working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const alive=useRef(true),preview=useRef<HTMLAudioElement|null>(null);
 const voice=useVoice({onCommand:()=>{},speechEnabled:true,busy:false,voicePackId:selectedId});
 const pack=packs.find(p=>p.id===selectedId);
 useEffect(()=>{onBusyChange?.(working);},[working,onBusyChange]);
 const refreshStatus=useCallback(async()=>{const status=await api<TtsStatus>('/api/tts/status');if(alive.current)setEngine(status);return status;},[]);
 useEffect(()=>{alive.current=true;void api<VoicePacksResponse>('/api/voice-packs').then(result=>{if(!alive.current)return;setPacks(result.packs||[]);setDirectory(result.directory||'');if(result.selectedId)onSelect(result.selectedId);}).catch(e=>{if(alive.current)setError(e.message);});void refreshStatus().catch(e=>{if(alive.current)setError(e.message);});return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!engine?.installing)return;const timer=setInterval(()=>{void refreshStatus().catch(e=>{if(alive.current)setError(e.message);});},1500);return()=>clearInterval(timer);},[engine?.installing,refreshStatus]);
 useEffect(()=>{setTranscript(pack?.transcript||'');voice.stop();preview.current?.pause();},[selectedId,pack?.transcript,voice.stop]);
 async function importPack(file:File){
  setError('');setNotice('');if(!/\.mp3$/i.test(file.name)){setError('请选择 MP3 文件');return;}if(!file.size||file.size>15*1024*1024){setError('MP3 文件须大于 0 且不超过 15 MB');return;}
  setWorking(true);try{const response=await fetch('/api/voice-packs/import?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'audio/mpeg'},body:file});if(!response.ok)throw await responseError(response,'音色导入失败');const result=await response.json() as {pack:VoicePack;selectedId:string};if(!alive.current)return;setPacks(current=>[...current.filter(p=>p.id!==result.pack.id),result.pack]);onSelect(result.selectedId||result.pack.id);onChanged?.();setNotice('音色已导入并选中。请核对参考文字，再试听合成效果。');}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setWorking(false);}
 }
 async function saveTranscript(){if(!pack)return;setWorking(true);setError('');try{const result=await api<{pack:VoicePack}>('/api/voice-packs/'+encodeURIComponent(pack.id),{transcript},'PATCH');if(!alive.current)return;setPacks(current=>current.map(p=>p.id===pack.id?result.pack:p));setNotice('参考文字已保存');onChanged?.();}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setWorking(false);}}
 async function install(){setWorking(true);setError('');try{await api('/api/settings',{ttsPythonPath:''});onPythonPathChange('');await api('/api/tts/install',{});await refreshStatus();}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setWorking(false);}}
 const local=!!selectedId&&selectedId!=='system',dirty=!!pack&&transcript!==pack.transcript;
 return <section className="voice-packs" aria-label="音色包管理">
  <h3>小优的音色 <span>参考音频用于生成新的中文回答</span></h3>
  <label>朗读音色<select aria-label="朗读音色" value={selectedId||''} disabled={working} onChange={e=>{onSelect(e.target.value);setError('');setNotice('');}}>
   {!selectedId&&<option value="" disabled>正在读取音色…</option>}
   <option value="system">系统中文朗读</option>{packs.map(item=><option key={item.id} value={item.id}>{item.name}{item.status==='needs-text'?' · 待填写参考文字':''}</option>)}
  </select></label>
  <label className="voice-import">导入 MP3 音色<input aria-label="导入 MP3 音色" type="file" accept=".mp3,audio/mpeg" disabled={working} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void importPack(file);}}/><small>支持不超过 15 MB 的 MP3。导入后自动选中；请使用清晰、无背景音乐的单人录音。</small></label>
  {pack&&<div className="voice-reference">
   <div className="voice-pack-heading"><b>{pack.name}</b><span>{Number.isFinite(pack.duration)?pack.duration.toFixed(1)+' 秒':'参考音频'} · {pack.status==='ready'?'参考已就绪':'需要参考文字'}</span></div>
   <label>原始参考音频<audio ref={preview} controls preload="none" src={'/api/voice-packs/'+encodeURIComponent(pack.id)+'/audio'} onPlay={()=>voice.stop()} onError={()=>setError('参考音频无法播放，请检查文件后重新导入')}/></label>
   <label>参考音频中的原文<textarea rows={3} value={transcript} onChange={e=>setTranscript(e.target.value)} placeholder="逐字填写这段录音说出的内容，包含标点。"/><small>这段文字须与参考录音一致，合成时会用它学习音色。</small></label>
   <button className="secondary" disabled={working||!transcript.trim()||!dirty} onClick={()=>void saveTranscript()}>保存参考文字</button>
   {pack.error&&<p className="error" role="alert">{pack.error}</p>}
  </div>}
  <div className="voice-engine">
   <p className="muted">本地 F5-TTS · {engine?.installing?'正在安装':engine?.installed?'已安装':engine?'尚未安装':'正在检查…'}</p>
   {!engine?.installed&&<p className="muted">克隆音色需要本地 F5-TTS 引擎和模型。首次安装及合成会下载依赖，CPU 合成可能需要较长时间。</p>}
   <label>Python 路径（可留空自动查找）<input value={ttsPythonPath||''} onChange={e=>onPythonPathChange(e.target.value)} placeholder="例如 C:\Python311\python.exe"/><small>可填写已安装 F5-TTS 环境的 Python。安装按钮会创建并选用独立环境。</small></label>
   <div className="voice-actions">{!engine?.installed&&<button className="secondary" disabled={working||!!engine?.installing} onClick={()=>void install()}>{engine?.installing?'正在安装引擎…':'安装本地 F5-TTS 引擎'}</button>}<button className="text-button" disabled={working} onClick={()=>{setError('');void refreshStatus().catch(e=>setError(e.message));}}>刷新引擎状态 ↻</button></div>
   {engine?.progress&&<p className="voice-progress" role="status">{engine.progress}</p>}{engine?.error&&<p className="error" role="alert">{engine.error}</p>}
  </div>
  <label>合成试听文字<textarea rows={2} value={testText} onChange={e=>setTestText(e.target.value)} maxLength={500}/></label>
  <div className="voice-actions"><button className="secondary" disabled={working||!testText.trim()||voice.speaking||(local&&(!engine?.installed||engine.installing||pack?.status!=='ready'||dirty))} onClick={()=>{preview.current?.pause();voice.speak(testText);}}>合成试听</button>{voice.speaking&&<button className="secondary" onClick={voice.stop}>停止试听</button>}<span className="muted" role="status">{voice.speaking?voice.status:''}</span></div>
  {local&&dirty&&<p className="muted">请先保存参考文字，再合成试听。</p>}
  {(error||voice.error)&&<p className="error" role="alert">{error||voice.error}</p>}{notice&&<p className="success" role="status">{notice}</p>}{directory&&<p className="voice-directory">音色保存在本机：{directory}</p>}
 </section>;
}
