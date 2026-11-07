export async function streamCompletion(settings,messages,tools,{signal,onDelta}){
 if(!settings.apiKey)throw Error('请先在设置中配置模型 API Key');
 const endpoint=settings.baseUrl.replace(/\/+$/,'')+'/chat/completions';
 const timeout=AbortSignal.timeout(120000);const combined=signal?AbortSignal.any([signal,timeout]):timeout;
 const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${settings.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:settings.model,messages,stream:true,...(tools.length?{tools,tool_choice:'auto'}:{})}),signal:combined});
 if(!response.ok){const detail=(await response.text()).slice(0,600).split(settings.apiKey).join('[已隐藏]');throw Error(`模型接口 ${response.status}：${detail}`);}
 const calls=new Map();let content='';const consume=data=>{if(data==='[DONE]')return;let json;try{json=JSON.parse(data);}catch{throw Error('模型返回了无效 SSE JSON');}if(json.error)throw Error(json.error.message||'模型服务错误');const delta=json.choices?.[0]?.delta||{};if(typeof delta.content==='string'){content+=delta.content;onDelta(delta.content);}for(const part of delta.tool_calls||[]){const c=calls.get(part.index)||{id:'',type:'function',function:{name:'',arguments:''}};if(part.id)c.id=part.id;if(part.function?.name)c.function.name+=part.function.name;if(part.function?.arguments)c.function.arguments+=part.function.arguments;calls.set(part.index,c);}};
 let buffer='';const decoder=new TextDecoder();for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});if(buffer.length>2*1024*1024)throw Error('模型流事件过大');let i;while((i=buffer.indexOf('\n\n'))!==-1){const event=buffer.slice(0,i);buffer=buffer.slice(i+2);const data=event.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(data)consume(data);}}
 return{role:'assistant',content:content||null,...(calls.size?{tool_calls:[...calls.values()]}:{})};
}
