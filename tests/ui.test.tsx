// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App from '../src/App';
vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('handles F11 through narrow desktop bridge',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({settings:{speech:false},todos:[],logs:[],skills:[],mcp:[],approvals:[],history:[],voice:{ready:false}})})));
 vi.stubGlobal('EventSource',class{addEventListener(){} close(){}});
 const toggle=vi.fn(async()=>false);window.xiaoyou={toggleFullscreen:toggle,openExternal:async()=>{},openDataDir:async()=>{},onMicToggle:()=>()=>{}};
 render(<App/>);await screen.findByText('主人，很高兴再见到你');fireEvent.keyDown(window,{key:'F11'});expect(toggle).toHaveBeenCalledTimes(1);delete window.xiaoyou;
});
it('shows greeting and routes unconfigured model to settings, not fake replies',async()=>{
 const state={settings:{provider:'deepseek',model:'deepseek-chat',baseUrl:'https://api.deepseek.com',apiKeySet:false,city:'',port:8765,projectDir:'D:/Project',speech:false},todos:[],logs:[],skills:[],mcp:[],approvals:[],history:[],voice:{ready:false},url:'http://127.0.0.1:8765'};
 vi.stubGlobal('fetch',vi.fn(async(url)=>({ok:true,json:async()=>String(url).includes('state')?state:{error:'请配置城市'}})));
 vi.stubGlobal('EventSource',class{addEventListener(){} close(){}});
 render(<App/>);
 expect(await screen.findByText('主人，很高兴再见到你')).toBeVisible();
 fireEvent.change(screen.getByLabelText('给小优发送消息'),{target:{value:'你好'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
 expect(await screen.findByRole('dialog',{name:'小优设置'})).toBeVisible();
});
it('persists todo via API and displays returned item',async()=>{
 const state={settings:{provider:'deepseek',model:'deepseek-chat',apiKeySet:false,speech:false},todos:[],logs:[],skills:[],mcp:[],approvals:[],history:[],voice:{ready:false}};
 vi.stubGlobal('fetch',vi.fn(async(url,options)=>({ok:true,json:async()=>String(url).includes('/api/state')?state:String(url).includes('/api/todos')?{todos:[{id:'1',text:JSON.parse(options.body).text,done:false}]}:{error:'请配置城市'}})));
 vi.stubGlobal('EventSource',class{addEventListener(){} close(){}});
 render(<App/>);await screen.findByText('主人，很高兴再见到你');fireEvent.change(screen.getByLabelText('新待办事项'),{target:{value:'阅读报告'}});fireEvent.click(screen.getByRole('button',{name:'添加待办'}));expect(await screen.findByText('阅读报告')).toBeVisible();
});
