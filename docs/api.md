# 本机界面接口

服务导出 `startServer({dataDir,projectDir,staticDir,port=8765,host='127.0.0.1',openPath,voice,secretCodec})` → `{url,port,runtime,close()}`。ESM Node，无需转译。所有 `/api/` 请求需要主页 GET 设置的 HttpOnly `xiaoyou_session` cookie，Origin 必须等于实际服务 URL。错误为非 2xx `{error}`。客户端 fetch 默认同源 cookie。GET `/api/events` 为 EventSource。

- GET `/api/state` → `{settings,todos,logs,skills,mcp,approvals,history,voice,busy,dataDir,url}`。
- `settings` 为 `{provider,baseUrl,model,apiKeySet,city,port,reducedMotion,speech,micEnabled,projectDir,voiceModelPath?,disabledSkills?,applications?}`，绝不返回 apiKey。
- `todos` 为 `{id,text,done}[]`；`logs` 为 `{id,time,level,message}[]`；`skills` 为 `{name,enabled}[]`；`mcp` 为 `{name,connected,count?,error?}[]`；`history` 为 `{role:'user'|'assistant',content}[]`。
- POST `/api/settings` 更新以上字段，另接受 `apiKey`；省略则保留原 key。返回 `{settings}`。更换 projectDir 重新读取 Skill、MCP、对话记忆。端口改变下次启动生效。
- POST `/api/test-model` 保存配置后真实调用当前模型，返回 `{text}`。
- POST `/api/chat` `{message}` → SSE：`start {id}`、`delta {text}`、`tool {name,status,error?}`、`done {id,text}`、`error {error}`。只允许一个并发对话。客户端解析事件分隔符 `\n\n`。工具确认另通过 events 接收。
- POST `/api/cancel` → `{stopped:true}`。
- GET `/api/events` SSE：`log` 为日志条目；`state` 为完整 state；`todos` 为数组；`approval` 为 `{id,tool,target,preview?,args?,reason}`；`approval-resolved` 为 `{id,accepted}`。断线重连后 GET state 恢复 pending approvals。
- POST `/api/approvals/:id` `{accepted:boolean}`；120 秒过期，取消生成也拒绝。
- POST `/api/greeting` → `{text:'主人，很高兴再见到你'}`，同时记录问候。
- POST `/api/todos` `{text}` → `{todos}`；PATCH `/api/todos/:id` `{done}` → `{todos}`；DELETE `/api/todos/:id` → `{todos}`。
- GET `/api/weather` → `{city,current:{temperature_2m,weather_code,relative_humidity_2m},daily:{time,weather_code,temperature_2m_max,temperature_2m_min},updatedAt}` 或 `{error}`。
- POST `/api/mcp/reload` → `{mcp}`。
- POST `/api/open-path` `{target:'memory'|'project'|'data'}`，由桌面 shell 打开明确目录。
- GET `/api/voice/status` → `{ready,error?,modelPath?,...}`；语音 WebSocket 接口由 voice 模块扩展。

`runtime` 提供 `server`（HTTP server）、`authenticate(req)`、`settings()`、`log(level,message)`、`broadcast(event,data)`、`state()`、`memory.append(role,content)`、`tools.execute(name,args,{signal,approve?})`、`mcp`。`voice(runtime)` 可在启动后附加，返回 `{status(),close()}`，存入 `runtime.voice`。

桌面桥 `window.xiaoyou` 可选提供 `toggleFullscreen()`、`openExternal(url)`、`openDataDir()`、`onMicToggle(callback)`。网页使用 Fullscreen API。密钥 codec 接口 `encrypt(plain):string` / `decrypt(cipher):string`，桌面注入 safeStorage。
