// @vitest-environment jsdom
import {it,expect,vi,afterEach,beforeEach} from 'vitest';
import {render,renderHook,screen,fireEvent,waitFor,cleanup,act} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {useVoice} from '../src/useVoice';
import {Settings} from '../src/Settings';
import {VoicePacks} from '../src/VoicePacks';
import App from '../src/App';

beforeEach(()=>{vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});

it('ends an unresponsive synthesis request with an actionable timeout',async()=>{
 vi.useFakeTimers();let signal:AbortSignal|undefined;
 vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
  if(url==='/api/tts/speak'){signal=options.signal;return new Promise(()=>{});}
  return {ok:true,json:async()=>({installed:true,busy:true,phase:'synthesizing'})};
 }));
 const {result}=renderHook(()=>useVoice({onCommand:()=>{},speechEnabled:true,busy:false,voicePackId:'reference'}));
 await act(async()=>result.current.speak('你好。'));
 expect(signal).toBeDefined();
 await act(async()=>vi.advanceTimersByTimeAsync(330000));
 expect(signal?.aborted).toBe(true);expect(result.current.speaking).toBe(false);
 expect(result.current.error).toMatch(/超时/);
});

it('shows the engine phase and elapsed time during synthesis',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url)=>{
  if(url==='/api/tts/speak')return new Promise(()=>{});
  return {ok:true,json:async()=>({installed:true,busy:true,phase:'loading-model',elapsedSeconds:12})};
 }));
 const {result}=renderHook(()=>useVoice({onCommand:()=>{},speechEnabled:true,busy:false,voicePackId:'reference'}));
 act(()=>result.current.speak('你好。'));
 await waitFor(()=>expect(result.current.status).toMatch(/加载.*模型.*12.*秒/));
});
it('marks local synthesis as speaking before the response and aborts it when interrupted',async()=>{
 let synthesisSignal:AbortSignal|undefined;
 vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
  if(url==='/api/tts/speak'){synthesisSignal=options.signal;return new Promise(()=>{});}
  return {ok:true,json:async()=>({stopped:true})};
 }));
 const {result}=renderHook(()=>useVoice({onCommand:()=>{},speechEnabled:true,busy:false,voicePackId:'reference'} as any));
 act(()=>result.current.speak('今天的天气很好。'));
 expect(result.current.speaking).toBe(true);
 await waitFor(()=>expect(synthesisSignal).toBeDefined());
 act(()=>result.current.stop());
 expect(synthesisSignal?.aborted).toBe(true);
 expect(result.current.speaking).toBe(false);
});
it('stops pending synthesis when speech is disabled',async()=>{
 let signal:AbortSignal|undefined;
 vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
  if(url==='/api/tts/speak'){signal=options.signal;return new Promise(()=>{});}
  return {ok:true,json:async()=>({stopped:true})};
 }));
 const {result,rerender}=renderHook(({enabled})=>useVoice({onCommand:()=>{},speechEnabled:enabled,busy:false,voicePackId:'reference'} as any),{initialProps:{enabled:true}});
 act(()=>result.current.speak('稍后提醒我。'));
 await waitFor(()=>expect(signal).toBeDefined());
 rerender({enabled:false});
 expect(signal?.aborted).toBe(true);
 expect(result.current.speaking).toBe(false);
});
it('surfaces local synthesis failure without playing system speech',async()=>{
 const systemSpeak=vi.fn();vi.stubGlobal('speechSynthesis',{cancel:()=>{},speak:systemSpeak,getVoices:()=>[]});
 vi.stubGlobal('SpeechSynthesisUtterance',class{constructor(public text:string){}});
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,json:async()=>({error:'请先安装 F5-TTS 引擎'})})));
 const {result}=renderHook(()=>useVoice({onCommand:()=>{},speechEnabled:true,busy:false,voicePackId:'reference'} as any));
 act(()=>result.current.speak('你好。'));
 await waitFor(()=>expect(result.current.error).toContain('F5-TTS'));
 expect(result.current.speaking).toBe(false);expect(systemSpeak).not.toHaveBeenCalled();
});
it('imports an MP3 and preserves its automatic selection when settings are saved',async()=>{
 let saved:any,finishImport:((result:any)=>void)|undefined;const imported={id:'new-pack',name:'参考音色',transcript:'你好',duration:4,status:'ready'};
 vi.stubGlobal('fetch',vi.fn(async(url,options)=>({ok:true,json:async()=>{
  if(url==='/api/voice-packs')return {packs:[],selectedId:'system',directory:'D:/voices'};
  if(url==='/api/tts/status')return {installed:false,installing:false,busy:false};
  if(String(url).startsWith('/api/voice-packs/import'))return new Promise(resolve=>{finishImport=resolve;});
  if(url==='/api/settings'){saved=JSON.parse(options.body);return {};}
  return {};
 }})));
 render(<Settings state={{settings:{provider:'custom',speech:true,voicePackId:'system'},skills:[],mcp:[]} as any} onClose={()=>{}} onSave={()=>{}}/>);
 await screen.findByRole('button',{name:'安装本地 F5-TTS 引擎'});
 fireEvent.change(screen.getByLabelText('导入 MP3 音色'),{target:{files:[new File(['mp3'],'参考.mp3',{type:'audio/mpeg'})]}});
 expect(screen.getByRole('button',{name:'保存设置'})).toBeDisabled();
 await waitFor(()=>expect(finishImport).toBeDefined());
 await act(async()=>finishImport?.({pack:imported,selectedId:'new-pack'}));
 await screen.findByRole('option',{name:/参考音色/});
 expect(screen.getByLabelText('朗读音色')).toHaveValue('new-pack');
 fireEvent.click(screen.getByRole('button',{name:'保存设置'}));
 await waitFor(()=>expect(saved?.voicePackId).toBe('new-pack'));
});
it('ignores obsolete synthesis and releases the current audio URL on stop',async()=>{
 let resolveOld:(response:any)=>void=()=>{};
 const urls:string[]=[];const revoked:string[]=[];
 vi.stubGlobal('URL',class extends URL{static createObjectURL(){const url='blob:voice-'+urls.length;urls.push(url);return url;}static revokeObjectURL(url:string){revoked.push(url);}});
 vi.stubGlobal('Audio',class{onended:any;onerror:any;pause(){}load(){}removeAttribute(){}async play(){}});
 let calls=0;vi.stubGlobal('fetch',vi.fn(async(url)=>{
  if(url==='/api/tts/speak'&&calls++===0)return new Promise(resolve=>{resolveOld=resolve;});
  return {ok:true,json:async()=>({stopped:true}),blob:async()=>new Blob(['wave'])};
 }));
 const {result}=renderHook(()=>useVoice({onCommand:()=>{},speechEnabled:true,busy:false,voicePackId:'reference'}));
 act(()=>result.current.speak('第一段。'));await waitFor(()=>expect(calls).toBe(1));
 act(()=>result.current.speak('第二段。'));await waitFor(()=>expect(urls).toHaveLength(1));
 await act(async()=>resolveOld({ok:true,blob:async()=>new Blob(['old'])}));
 expect(result.current.speaking).toBe(true);expect(urls).toHaveLength(1);
 act(()=>result.current.stop());expect(result.current.speaking).toBe(false);expect(revoked).toEqual(['blob:voice-0']);
});
it('validates imported files and requires saving reference text before synthesis',async()=>{
 let saved:any;const pack={id:'reference',name:'测试音色',transcript:'原文。',duration:4,status:'ready'};
 vi.stubGlobal('fetch',vi.fn(async(url,options)=>({ok:true,json:async()=>{
  if(url==='/api/voice-packs')return {packs:[pack],selectedId:'reference',directory:'D:/voices'};
  if(url==='/api/tts/status')return {installed:true,installing:false,busy:false};
  if(url==='/api/voice-packs/reference'){saved=JSON.parse(options.body);return {pack:{...pack,transcript:saved.transcript}};}
  return {};
 }})));
 render(<VoicePacks selectedId="reference" onSelect={()=>{}} onPythonPathChange={()=>{}}/>);
 await screen.findByDisplayValue('原文。');
 fireEvent.change(screen.getByLabelText('导入 MP3 音色'),{target:{files:[new File(['wave'],'错误.wav',{type:'audio/wav'})]}});
 expect(await screen.findByRole('alert')).toHaveTextContent('MP3');
 fireEvent.change(screen.getByLabelText(/参考音频中的原文/),{target:{value:'修正后的原文。'}});
 expect(screen.getByRole('button',{name:'合成试听'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'保存参考文字'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'合成试听'})).toBeEnabled());
 expect(saved).toEqual({transcript:'修正后的原文。'});
});
it('offers a stop control after the final answer and aborts pending cloned speech',async()=>{
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(()=>null);
 const state={settings:{apiKeySet:true,speech:true,voicePackId:'reference'},todos:[],logs:[],skills:[],mcp:[],approvals:[],history:[],voice:{ready:false}};
 let speechSignal:AbortSignal|undefined;
 vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
  if(url==='/api/tts/speak'){speechSignal=options.signal;return new Promise(()=>{});}
  if(url==='/api/chat'){let read=false;return {ok:true,body:{getReader:()=>({read:async()=>{if(read)return {done:true};read=true;return {done:false,value:new TextEncoder().encode('event: delta\ndata: {"text":"已经完成。"}\n\nevent: done\ndata: {}\n\n')};}})}};}
  return {ok:true,json:async()=>url==='/api/state'?state:{}};
 }));
 vi.stubGlobal('EventSource',class{addEventListener(){}close(){}});
 render(<App/>);await screen.findByText('主人，很高兴再见到你');
 await waitFor(()=>expect(screen.getByRole('button',{name:'发送消息'})).toBeEnabled());
 fireEvent.change(screen.getByLabelText('给小优发送消息'),{target:{value:'打个招呼'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
 const stop=await screen.findByRole('button',{name:'停止朗读'});
 await waitFor(()=>expect(speechSignal).toBeDefined());
 fireEvent.click(stop);
 expect(speechSignal?.aborted).toBe(true);
 await waitFor(()=>expect(screen.queryByRole('button',{name:'停止朗读'})).not.toBeInTheDocument());
 expect(screen.getByText('已经完成。')).toBeVisible();
});
