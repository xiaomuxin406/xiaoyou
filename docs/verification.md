# 验证记录

日期：2026-11-07。Windows 11 x64；Node 24.14、Python 3.10.6、Electron 39.8.10。

## 已完成验证

- `npm test`：12 项通过。覆盖本机鉴权/Origin、Key 脱敏、错误设置拒绝、对话记忆、待办重启、目录越界/链接越界、拒绝覆盖、真实本地模型协议流与工具循环、真实 MCP stdio 进程、取消确认、唤醒状态、PCM 降采样、界面与快捷键。
- `npm run test:desktop`：3 项通过，覆盖可写资源目录、端口范围、导航边界。
- `npm run typecheck`、`npm run build`：通过。
- `npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org`：0 vulnerabilities。宿主默认镜像不提供 audit，实际使用官方审计端点。
- Python 语音协议：2 项通过，缺失模型返回结构化错误；真实 Vosk 模型识别本机生成的中文 16kHz PCM 音频。独立 PyInstaller exe 相同输入通过，输出“小优 打开 记事本”。
- 真实 WebSocket 从浏览器会话授权到 sidecar 的识别通道通过；麦克风采集需用户启用。
- `node e2e/smoke.mjs`：实际 build 页面问候、待办新增/刷新保留/完成/删除、设置弹窗、620px 窄屏无横向溢出、无页面异常；1440×960 页面截图已目视检查。
- `node e2e/agent-flow.mjs`：实际浏览器 UI + 本地 provider fixture 流式回复，拒绝覆盖保持原内容，再确认覆盖写入新内容。没有调用付费模型。
- `node e2e/desktop.mjs`：打包后的 `win-unpacked/小优.exe` 启动自动全屏，Esc 离开、F11 恢复，中文问候和内置模型路径检查通过，桌面截图已目视检查。
- `npm run package:win`：生成 `release/Xiaoyou-0.1.0-win-x64.exe` 便携式分发文件；内含离线模型、Python 运行时及语音辅助 exe，无需最终用户另装 Python。
- 最终单文件便携 exe 已直接启动，8765 页面和 API 正常，`voice.ready=true`，初始“小优” Skill 已载入；构建文件 149,685,628 字节，SHA256 `b3a9332e9fcb8d4a217a03f0a817533983ddcef3a6414fdb52c301230bb49c67`。

## 审查与已处理问题

- Windows Vosk 无法读取中文绝对路径：改为 Python 先切换目录，再由 Kaldi 从 ASCII `.` 路径加载，真实中文目录测试通过。
- SSE CRLF 分隔符支持：新增失败回归，修复后通过。
- 桌面快捷键：主进程输入事件未覆盖自动化 CDP 输入，改为页面按键经受限 IPC 执行，真实打包桌面复测通过。
- 非法配置可能污染状态：保存前验证类型，磁盘成功落盘后才替换内存状态，回归通过。
- 保留用户指定目录，开发在 `feat/xiaoyou-desktop`，未推送/合并。首次空仓库以每次命令 Codex 作者提交，未改用户 Git 身份。
- 已尝试按 Superpowers 工作流分派实现与只读审查，但子代理仅返回就绪，未提供实质报告；最终实现、边界审阅和证据检查由主代理执行，没有宣称得到独立审查批准。

## 仍依赖用户环境的项目

- 未提供 GPT、DeepSeek、GLM API Key，未验证具体账户的可用模型、额度、供应商网络及费用；通过本机兼容协议 fixture 验证请求和工具循环。
- 未代表用户开启真实麦克风；真人发音、口音/噪声、长期唤醒准确率仍需现场体验。程序内按钮可控制监听。
- 未配置用户城市，天气空状态已检查；实际城市预报依赖 Open-Meteo 网络。
- 未提供生产 MCP 配置，仅真实本地 stdio fixture 已验证；用户的远端 HTTP/MCP 认证需按其服务配置。
- 产物未代码签名。未在独立 Windows 10 设备验证；实际构建和启动环境为 Windows 11。
- 星云按监听/思考/朗读状态浮动，不分析朗读音频频谱。未内置任意屏幕视觉操作驱动；复杂电脑控制通过所配置 MCP 或确认后的结构化命令实现。
- 首版不提供在线模型下载管理器，分发包已内置可用中文模型，设置支持替换本地模型目录。调用日志仅保留当前运行的最近 200 条，记忆与待办持久化。

## 复现

先 `npm run build`，`npm start` 保持服务，再 `node e2e/smoke.mjs`。浏览器测试需 `npx playwright install chromium`，也可设置 `CHROME_TEST_PATH` 指向测试浏览器。`node e2e/agent-flow.mjs` 会自建独立临时服务。打包后 `node e2e/desktop.mjs` 在独立 8766 端口测试，退出自己启动的实例。
## 0.1.1 中断思考增量验收

- UI 回归先出现预期失败（找不到“中断思考”按钮），实现后通过；当前 `npm test` 13 项、桌面边界测试 3 项全部通过。
- `node e2e/interrupt.mjs`：真实本机 provider SSE + 生产构建界面，验证首 token 前取消、部分输出后取消、上游连接关闭、保留已有文字、中断后继续新对话。
- 中断按钮显示处理状态、阻止重复点击，取消失败可重试；停止语音朗读，中断结果作为界面状态提示而不追加虚构对话记忆。
- 本次更新不回滚已经完成的外部操作；延续现有服务端 AbortController 与待确认动作取消机制。
