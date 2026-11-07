import {chromium} from '@playwright/test';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {startServer} from '../server/index.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'xiaoyou-interrupt-'));
let requestCount=0,closedCount=0;
const provider=http.createServer(async(req,res)=>{
 for await(const _ of req){}
 const count=++requestCount;
 res.on('close',()=>closedCount++);
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 res.flushHeaders();
 if(count===2)res.write('data: '+JSON.stringify({choices:[{delta:{content:'保留这段已生成文字'}}]})+'\n\n');
 if(count===3)res.end('data: '+JSON.stringify({choices:[{delta:{content:'新问题正常回复'}}]})+'\n\ndata: [DONE]\n\n');
});
await new Promise(r=>provider.listen(0,'127.0.0.1',r));
await writeFile(path.join(dir,'config.local.json'),JSON.stringify({apiKey:'fixture',baseUrl:`http://127.0.0.1:${provider.address().port}/v1`,model:'fixture',speech:false}));
const service=await startServer({dataDir:dir,projectDir:dir,staticDir:path.resolve('dist'),port:0});
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}});
 await page.goto(service.url);
 await page.getByText('主人，很高兴再见到你',{exact:true}).waitFor();
 const send=async text=>{await page.getByLabel('给小优发送消息').fill(text);await page.getByRole('button',{name:'发送消息',exact:true}).click();};
 await send('先不输出文字');
 while(requestCount<1)await new Promise(r=>setTimeout(r,20));
 await page.getByRole('button',{name:'中断思考',exact:true}).click();
 await page.getByRole('status').filter({hasText:'已中断思考'}).waitFor();
 await page.getByRole('button',{name:'发送消息',exact:true}).waitFor();
 assert.equal((await service.runtime.state()).busy,false);
 assert.equal(await page.locator('.typing').count(),0);
 await send('输出一部分后等待');
 await page.getByText('保留这段已生成文字',{exact:true}).waitFor();
 await page.screenshot({path:'.runtime/interrupt-button.png'});
 await page.getByRole('button',{name:'中断思考',exact:true}).click();
 await page.getByRole('status').filter({hasText:'已中断思考'}).waitFor();
 assert.equal(await page.getByText('保留这段已生成文字',{exact:true}).count(),1);
 await send('继续聊一个新问题');
 await page.getByText('新问题正常回复',{exact:true}).waitFor();
 assert.ok(closedCount>=2,'provider stream connections should close after cancellation');
 console.log('PASS: cancel before first token, cancel partial stream, upstream disconnect, preserve content, send new message');
}finally{await browser.close();await service.close();provider.closeAllConnections();await new Promise(r=>provider.close(r));await rm(dir,{recursive:true,force:true});}
