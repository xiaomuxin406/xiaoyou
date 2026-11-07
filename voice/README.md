# 离线中文识别资源

- 引擎：Vosk 0.3.45，Apache-2.0，https://github.com/alphacep/vosk-api
- 模型：vosk-model-small-cn-0.22，约 42 MiB 压缩包，Apache-2.0。
- 官方来源：https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip
- 官方许可证表：https://alphacephei.com/vosk/models （已于 2026-11-07 检查）。
- 下载包 SHA256：3af8b0e7e0f835ae9d414ce5df580237a3cfb08d586c9fbbb0f7ff29ad5b14ba。
- 模型和编译产物不纳入 Git；最终分发包携带模型、语音辅助 exe 及其 _internal 目录。

开发安装（项目根目录 PowerShell）：

```powershell
python -m venv .runtime/voice-env
.\.runtime\voice-env\Scripts\python.exe -m pip install -r voice/requirements.txt
.\.runtime\voice-env\Scripts\python.exe -m PyInstaller --noconfirm --clean --onedir --name xiaoyou-voice --collect-all vosk --distpath voice/dist --workpath voice/build --specpath voice voice/recognizer.py
```

JSONL 协议：以 `--model 模型目录` 启动，输出 `{type:"ready",sampleRate:16000}`；输入 `{type:"audio",data:"base64 PCM16 mono 16kHz"}`、`{type:"flush"}`、`{type:"reset"}`、`{type:"close"}`。输出 partial/final 文本或结构化 error。stdout 只输出 UTF-8 JSON，诊断走 stderr。Windows 原生 Kaldi 不支持中文绝对文件路径，辅助进程通过切换当前目录后从 `.` 加载模型兼容中文项目目录。

识别为概率结果，噪声、口音、麦克风距离会影响准确率；用户可审阅识别文字后使用键盘修正。唤醒“小优”不是独立低功耗唤醒芯片，而是本机连续中文识别，不上传音频。
