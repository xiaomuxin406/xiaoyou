import {it,expect,afterEach} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {startServer} from '../server/index.mjs';

const cleanups=[];
afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
async function setup(){
 const dir=await mkdtemp(path.join(tmpdir(),'xy-permissions-'));
 cleanups.push(()=>rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 const service=await startServer({dataDir:dir,port:0});
 cleanups.push(()=>service.close());
 const cookie=(await fetch(service.url)).headers.get('set-cookie').split(';')[0];
 const save=input=>fetch(service.url+'/api/settings',{method:'POST',headers:{cookie,Origin:service.url,'Content-Type':'application/json'},body:JSON.stringify(input)});
 return {...service,dir,save};
}

it('automatically overwrites and deletes files, executes commands and launches unconfigured executables',async()=>{
 const s=await setup();const tools=s.runtime.tools;
 const context={approve:async()=>{throw Error('不应请求确认');}};
 await writeFile(path.join(s.dir,'report.txt'),'original');
 await tools.execute('write_file',{path:'report.txt',content:'updated'},context);
 expect(await readFile(path.join(s.dir,'report.txt'),'utf8')).toBe('updated');
 const result=await tools.execute('run_command',{executable:process.execPath,args:['-e','process.stdout.write("自动执行成功")']},context);
 expect(result).toEqual({exitCode:0,output:'自动执行成功'});
 expect(await tools.execute('open_application',{name:process.execPath},context)).toEqual({opened:process.execPath});
 await tools.execute('delete_file',{path:'report.txt'},context);
 await expect(readFile(path.join(s.dir,'report.txt'))).rejects.toMatchObject({code:'ENOENT'});
 expect((await s.runtime.state()).approvals).toHaveLength(0);
});

it('can edit files outside the project and call an actual MCP subprocess without approval',async()=>{
 const s=await setup();const outer=await mkdtemp(path.join(tmpdir(),'xy-external-'));
 cleanups.push(()=>rm(outer,{recursive:true,force:true}));
 const file=path.join(outer,'report.txt');
 await s.runtime.tools.execute('write_file',{path:file,content:'外部文件'});
 expect((await s.runtime.tools.execute('read_file',{path:file})).content).toBe('外部文件');
 await writeFile(path.join(s.dir,'mcp.json'),JSON.stringify({mcpServers:{fixture:{command:process.execPath,args:[path.resolve('tests/fixtures/mcp-server.mjs')]}}}));
 await s.runtime.mcp.reload();
 const result=await s.runtime.tools.execute('mcp_fixture_echo',{text:'无需确认'},{approve:async()=>{throw Error('不应请求确认');}});
 expect(result.content[0].text).toBe('无需确认');
});

it('persists restricted mode, validates its type and still honors cancellation in full access',async()=>{
 const s=await setup();expect((await s.save({fullAccess:'yes'})).status).toBe(400);
 expect((await s.save({fullAccess:false})).status).toBe(200);
 await writeFile(path.join(s.dir,'report.txt'),'original');
 await expect(s.runtime.tools.execute('write_file',{path:'report.txt',content:'bad'},{approve:async()=>false})).rejects.toThrow(/拒绝/);
 expect(await readFile(path.join(s.dir,'report.txt'),'utf8')).toBe('original');
 await expect(s.runtime.tools.execute('read_file',{path:'../outside.txt'})).rejects.toThrow(/工作目录/);
 expect((await s.save({fullAccess:true})).status).toBe(200);
 const controller=new AbortController();controller.abort();
 await expect(s.runtime.tools.execute('write_file',{path:'new.txt',content:'bad'},{signal:controller.signal})).rejects.toThrow();
 await expect(readFile(path.join(s.dir,'new.txt'))).rejects.toMatchObject({code:'ENOENT'});
 await s.save({fullAccess:false});
 await s.close();
 const reopened=await startServer({dataDir:s.dir,port:0});cleanups.push(()=>reopened.close());
 expect((await reopened.runtime.state()).settings.fullAccess).toBe(false);
});
