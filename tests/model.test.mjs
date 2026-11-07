import {it,expect} from 'vitest';
import http from 'node:http';
import {streamCompletion} from '../server/model.mjs';
it('accepts standard CRLF event streams split across arbitrary chunks',async()=>{
 const server=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: {"choices":[{"delta":{"content":"你好"}}]}\r');setTimeout(()=>res.end('\n\r\ndata: [DONE]\r\n\r\n'),5);});await new Promise(r=>server.listen(0,'127.0.0.1',r));try{let text='';const result=await streamCompletion({apiKey:'test',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture'},[],[],{onDelta:t=>text+=t});expect(text).toBe('你好');expect(result.content).toBe('你好');}finally{await new Promise(r=>server.close(r));}
});
