import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {readJson} from './storage.mjs';
import path from 'node:path';
export class McpManager{
 constructor(getProject,log){this.getProject=getProject;this.log=log;this.clients=[];this.tools=new Map();this.status=[];}
 async close(){await Promise.allSettled(this.clients.map(c=>c.close()));this.clients=[];this.tools.clear();}
 async reload(){await this.close();this.status=[];let config;try{config=await readJson(path.join(this.getProject(),'mcp.json'),{mcpServers:{}});}catch(e){this.status.push({name:'配置',connected:false,error:e.message});return;}for(const [name,s]of Object.entries(config.mcpServers||{})){if(s.disabled)continue;try{const client=new Client({name:'xiaoyou',version:'0.1.0'});const transport=s.url?new StreamableHTTPClientTransport(new URL(s.url)):new StdioClientTransport({command:s.command,args:s.args||[],env:{...process.env,...s.env},cwd:this.getProject(),stderr:'pipe'});await client.connect(transport,{timeout:15000});this.clients.push(client);const list=await client.listTools({}, {timeout:15000});for(const t of list.tools){const id=('mcp_'+name+'_'+t.name).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,64);if(this.tools.has(id))throw Error('MCP 工具名冲突');this.tools.set(id,{client,original:t.name,allowed:(s.allowedReadOnlyTools||[]).includes(t.name),schema:{type:'function',function:{name:id,description:t.description||t.name,parameters:t.inputSchema}}});}this.status.push({name,connected:true,count:list.tools.length});this.log('success',`MCP ${name} 已连接`);}catch(e){this.status.push({name,connected:false,error:String(e.message).slice(0,300)});this.log('error',`MCP ${name} 连接失败`);}}}
 schemas(){return [...this.tools.values()].map(t=>t.schema);}
 async call(name,args,signal){const t=this.tools.get(name);return t.client.callTool({name:t.original,arguments:args},undefined,{timeout:30000,signal});}
}
