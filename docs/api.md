# 本机界面接口

服务导出 `startServer({dataDir,projectDir,staticDir,port=8765,host='127.0.0.1',openPath,voice,secretCodec})` → `{url,port,runtime,close()}`。ESM Node，无需转译。所有 `/api/` 请求需要主页 GET 设置的 HttpOnly `xiaoyou_session` cookie，Origin 必须等于实际服务 URL。错误为非 2xx `{error}`。客户端 fetch 默认同源 cookie。GET `/api/events` 为 EventSource。

- GET `/api/state` → `{settings,todos,logs,skills,mcp,approvals,history,voice,busy,dataDir,url}`。
- `settings` 为 `{provider,baseUrl,model,apiKeySet,city,port,reducedMotion,speech,micEnabled,fullAccess,voicePackId,ttsPythonPath,projectDir,voiceModelPath?,disabledSkills?,applications?}`，绝不返回 apiKey。
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

`fullAccess` 为布尔值，默认 `true`（包括旧配置未指定该字段时）。开启时所有工具免确认，文件工具允许项目外路径，`open_application.name` 接受程序路径/名称；关闭时恢复文件边界、保护文件及逐次确认。`runtime.approve` 同样遵循此权限；已取消信号始终拒绝。保存权限设置后立即生效并持久化，当前对话执行期间不能修改设置。

## 1.0.0 本机语音包 API

全部接口要求同源本机会话。`voicePackId: 'system'` 使用系统朗读，其他值为语音文件 SHA256 的前 24 位；`ttsPythonPath` 留空自动查找独立引擎环境。配置中不存原音频或生成音频。

- GET `/api/voice-packs` → `{packs:[{id,name,transcript,duration,status,error?}],selectedId,directory}`，发现目录中新 MP3，成功导入后自动选择。后台每 5 秒也扫描一次；失败文件限频重试，不替换现用语音。
- POST `/api/voice-packs/import?name=<MP3文件名>`，body 为原始 `audio/mpeg`，最大 15 MiB → `{pack,selectedId}`。同内容按 SHA256 去重。损坏音频拒绝；有效但转录失败允许人工填写参考文字。
- PATCH `/api/voice-packs/:id` `{transcript}` → `{pack}`；1–2000 字符，与参考录音实际文字一致。
- GET `/api/voice-packs/:id/audio` → `audio/mpeg`，原始音频试听。
- GET `/api/tts/status` → `{installed,installing,busy,error?,progress,pythonPath}`。依赖检查区别完整/缺失环境。
- POST `/api/tts/install` `{}` →202，后台启动隔离安装，客户端轮询状态；不需要管理员，不保存用户录音至外部。
- POST `/api/tts/speak` `{text,voicePackId?}` → `audio/wav`；最多 6000 字符，省略 ID 使用已选语音包。参考 WAV、参考文字及新文字传给本机 F5-TTS。连接关闭会取消合成。
- POST `/api/tts/cancel` `{}` → `{stopped:true}`，终止当前合成进程；下次请求重新加载。全局 `/api/cancel` 同样取消语音。

打包程序携带语音辅助源码和安装脚本；大型 Python 依赖和模型首次使用单独安装，未被塞入便携 EXE。模型加载使用本地缓存，首次下载需可访问模型源。
