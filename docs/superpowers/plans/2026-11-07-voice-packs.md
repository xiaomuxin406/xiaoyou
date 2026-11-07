# 小优 1.0.0 语音包 Implementation Plan

**Goal:** 用户 MP3 成为可选择的本机中文克隆音色，导入自动切换，交付 1.0.0 便携程序并推送 GitHub。
**Architecture:** Python F5-TTS/Vosk worker + Node 语音包管理 API + React 设置与播放器。
**Spec:** `docs/superpowers/specs/2026-11-07-voice-packs-design.md`
**Constraints:** Windows 10/11；本机 127.0.0.1；现有中断/权限行为保留；语音缓存、密钥、对话记忆不进 Git。

## 1. Python 合成与参考音频准备
- [x] 新增 `voice/tts_worker.py`：JSONL `prepare`/`infer`，解码 MP3、单声道规范化、最多 12 秒、Vosk 自动转录、F5-TTS 生成新文本 WAV；stdout 只写协议。
- [x] 新增 `voice/requirements-tts.txt` 与 `voice/install-tts.ps1`，隔离环境安装及明确进度；模型缓存位置可配置；许可证记录。
- [x] `python` 测试真实 MP3 准备及真实新中文句子合成，记录音频元数据，不以 fixture 冒充模型验证。

## 2. 服务端与文件目录
- [x] 先写 `tests/voice-packs.test.mjs`，覆盖无认证、无效上传、成功导入/自动切换、重启、目录发现、参考文字校正、取消；运行确认缺少 API 的预期失败。
- [x] 新增 `server/tts.mjs` 管理 Python 进程与安装，`server/voice-packs.mjs` 管理 ID、原音、索引与串行导入，接入 `server/index.mjs`。
- [x] 预置 `voice-packs/ttsmaker-file-2026-11-7-20-30-54.mp3`，桌面复制默认包，动态查找工作环境；版本及资源映射统一为 1.0.0。
- [x] 运行服务测试，确认失败上传不改当前选项、取消终止辅助进程、关闭服务无泄漏。

## 3. 界面与播放
- [x] 新增 `src/VoicePacks.tsx`：引擎状态、安装、上传、系统/语音包下拉选择、参考文字校正、试听、测试合成。
- [x] 修改 `src/useVoice.ts`：所选语音包调用 `/api/tts/speak` 返回新 WAV；取消用 AbortController + 后端 cancel，播放结束清理对象 URL；状态与星云同步。
- [x] 保留系统语音模式与唤醒逻辑；无引擎明确提示，不假装已使用克隆音色。
- [x] 用生产网页验证上传并切换、重载保留、错误提示、试听与合成调用、中断后能继续。

## 4. 发行与仓库
- [x] `npm test`、桌面测试、类型检查、生产构建、现有中断及权限 E2E、真实克隆验证。
- [x] 打包 `Xiaoyou-1.0.0-win-x64.exe`，隔离数据启动验证语音包与设置。
- [x] 更新 README/API/验证记录；审阅实际 diff，秘密扫描，选择性提交代码和预置 MP3，不提交本机 MCP 或用户应用路径。
- [ ] 推送 `HEAD:main`，校验远程提交号和版本；最终提供可执行文件及仓库链接、实际验证范围。
