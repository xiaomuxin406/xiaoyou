# 小优 · 中文语音日常智能体

Windows 10/11 x64，Electron 桌面程序与本机网页共用界面。启动全屏，中心星云随监听、思考与朗读状态流动。默认本机网页：[http://127.0.0.1:8765](http://127.0.0.1:8765)。

## 直接使用

打开 `release/Xiaoyou-0.1.1-win-x64.exe`（便携版）。包内已携带中文 Vosk 模型和语音辅助程序，不需要安装 Node 或 Python。首次解压启动可能需要片刻。当前产物未代码签名。

1. 右上角 **设置** 选择 GPT、DeepSeek、GLM 或自定义 OpenAI 兼容服务，填写 API Key、接口地址和模型名称，保存后测试连接。模型名称以你的服务商账户实际可用项为准。GPT 当前接入 Chat Completions 兼容接口；不支持仅提供 Responses API 的服务。
2. 填写天气城市（如 Beijing / Shanghai），保存。天气来自 Open-Meteo，失败时明确提示。
3. 点击 **开启语音唤醒**，允许麦克风后说“小优”，再说要求；也可以连续说“小优，打开记事本”。点击输入框旁的语音按钮可直接说话；始终支持文字输入。
4. 覆盖文件、删除文件、启动程序、执行命令和外部 MCP 调用会展示具体确认内容。拒绝或停止生成不会继续执行待确认动作。普通工作目录内新文件可直接创建。
5. 全屏按钮或 F11 切换，Esc 离开全屏。关闭窗口可保留托盘后台或退出；托盘可重新打开界面和切换麦克风。

启动问候为“主人，很高兴再见到你”。桌面自动朗读；网页受到自动播放限制时点击“启用语音 · 问候”。中文朗读使用系统中文声音，缺少时请安装 Windows 中文语音包。正在朗读或生成回复时暂停采集到识别进程，避免自我唤醒。

## 项目文件与数据

源码运行时，工作目录为本项目；便携版运行时配置和待办存于 `%APPDATA%/xiaoyou-agent`（以设置显示的数据目录为准），默认项目为其 `project` 子目录。设置可改为你自己的项目目录，例如 `D:\codex项目\小优`。

- `<项目>/skills/小优/SKILL.md`：初始人格与虚拟晨间、工作、晚间场景。可添加其他 `skills/<名称>/SKILL.md`，在设置中启用/禁用。
- `<项目>/mcp.json`：MCP 注册配置；修改后点击“重新加载 MCP”。不要配置不可信进程，连接本机 stdio 服务会按配置启动该程序。
- `<项目>/对话记忆.md`：UTF-8，仅记录日期和实际双方对话，不混入调用日志或密钥。近期最多 24 条对话用于模型上下文。
- `<数据目录>/config.local.json`：本机设置。桌面通过 Electron safeStorage / Windows 保护密钥；`npm start` 独立 Node 模式密钥保存在此本机 JSON，请保护该目录并勿提交或共享。
- `<数据目录>/.runtime/todos.json`：待办。操作日志在当前运行期间显示，保留最近 200 条；关闭后不长期保存。

内置文件工具限制在允许项目目录中，拒绝跳出根目录的符号链接，保护 `.git`、`.runtime`、`node_modules`、`.env`、配置与记忆文件。需要更广泛的操作可在具体命令或 MCP 调用面板确认；不要批准不了解的命令。

## MCP 示例

```json
{
  "mcpServers": {
    "myTools": {
      "command": "C:/path/to/tool-server.exe",
      "args": [],
      "env": {},
      "allowedReadOnlyTools": ["list_items"]
    },
    "remote": {
      "url": "http://127.0.0.1:3000/mcp",
      "disabled": true
    }
  }
}
```

支持 stdio 和 Streamable HTTP。工具名带服务前缀避免重名。默认所有外部工具需要确认；只有你在 `allowedReadOnlyTools` 明确列出的可信只读工具可免确认。配置错误不妨碍普通文字聊天。

## 网页与端口

桌面运行期间用浏览器打开 `http://127.0.0.1:8765`。修改设置里的端口后重启程序。也可启动时设环境变量 `XIAOYOU_PORT`。服务只监听本机回环地址，不能从其他电脑访问。网页全屏需要点击按钮；网页不能绕过浏览器自动播放和麦克风权限限制。

## 开发与构建

```powershell
npm install
npm run build
npm start
```

另开终端执行 `npm run desktop` 打开桌面。不要同时让独立服务和桌面占用同一端口。开发热更新可运行 `npm run dev`，代理至本机 8765 服务；正式验收使用 build 后的共用页面。

```powershell
npm test
npm run test:desktop
npm run typecheck
npm run package:win
```

离线语音构建及许可证见 [voice/README.md](voice/README.md)。首次源码构建需按其中说明安装 Python 依赖并下载模型到 `voice/models/vosk-model-small-cn-0.22`，生成 `voice/dist/xiaoyou-voice`；打包会自动带入。模型目录可在设置中替换。网络下载已准备在当前工作区内，Git 不跟踪大型模型与产物。

详细 API 见 [docs/api.md](docs/api.md)。验证记录见 [docs/verification.md](docs/verification.md)。

## 使用限制

需要你自己的模型 API Key；此项目不附带付费模型额度。语音识别会受口音、噪声影响；可查看文字并修正。程序具备文件、配置应用与结构化命令执行能力；具体复杂电脑操作取决于所接 MCP 工具，未内置通用视觉点击驱动。星云依据朗读状态变化，并非逐采样的语音频谱。对话发送到所选模型服务，音频默认仅在本机识别。
## 0.1.1 · 中断思考

对话生成期间，输入框右侧显示带文字的“中断思考”按钮。点击后取消当前模型请求并停止朗读；完成后提示“已中断思考”，保留已生成文字，可继续发送新消息。尚未生成文字时中断也会清除等待动画。已完成的文件写入或其他外部操作不会因中断而撤销。
