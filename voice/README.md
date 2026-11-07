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

## 本地中文声音克隆

`tts_worker.py` 使用 F5-TTS 1.1.10 的 `F5TTS_v1_Base` 和 Vocos，将参考 MP3 中的声音用于朗读新的文字。它并非播放或拼接原始 MP3。建议选择 6–12 秒、单人、无背景音乐的清晰录音；至少需要 1 秒，较短录音的声音一致性可能较差。导入时会解码真实音频、转为单声道 24 kHz PCM16，并最多截取前 12 秒，再用 Vosk 识别这一段的实际文字。请确认参考文字与录音一致，必要时校正。

安装仅写入指定虚拟环境和缓存，不需要管理员权限。支持 64 位 Python 3.10–3.12，推荐 3.10。默认使用 PyTorch 2.5.1 CPU；有兼容 NVIDIA 显卡时可指定 `-TorchBackend cu121` 或 `cu124`，并以 `--device cuda` 启动工作进程。CPU 合成可能明显慢于实时。

```powershell
.\voice\install-tts.ps1 -TargetDirectory 'D:\项目\小优\.runtime\tts-env' -CacheDirectory 'D:\项目\小优\voice\models\tts-cache' -DownloadModels
```

首次安装及模型下载需要网络（F5 权重约 1.3 GB，另有声码器及 PyTorch 依赖）；下载完成后语音处理和推理在本机运行。安装脚本自带 FFmpeg 二进制，无需系统安装 FFmpeg。F5 及其声码器模型保存在 `--cache-dir`，不会写入全局 Hugging Face 用户缓存。不要在 Python 环境中自动补装 F5 的完整依赖清单：本项目明确跳过 Gradio、bitsandbytes、torchcodec 等非本流程必需组件。F5 顶层模块会导入训练模块，因此仍需安装其导入依赖 datasets、accelerate、wandb；工作进程不会启动训练或上传日志。

```powershell
.\.runtime\tts-env\Scripts\python.exe -u voice\tts_worker.py --vosk-model voice\models\vosk-model-small-cn-0.22 --cache-dir voice\models\tts-cache --device cpu
```

进程启动即输出 `{"type":"ready"}`，此时尚未加载 F5。stdin/stdout 使用 UTF-8 JSONL，每行一条请求，stderr 为诊断。输入 EOF 后退出，单个请求失败不会终止进程。

- 准备：`{"id":"1","op":"prepare","input":"D:/参考.mp3","output":"D:/音色/reference.wav"}`；返回 `id,ok,transcript,duration,originalDuration,sampleRate`，其中 transcript 来自最终截取的 WAV。
- 合成：`{"id":"2","op":"infer","reference":"D:/音色/reference.wav","transcript":"录音中的实际文字","text":"现在要朗读的新回复。","output":"D:/输出/reply.wav"}`；返回 `id,ok,duration,sampleRate`。参考文字不能为空，以避免 F5 自动加载 Whisper。
- 错误：`{"id":"2","ok":false,"error":"原因"}`。成功时 `ok:true`。首次合成延迟包括 F5 加载；后续请求复用同一实例。

加 `--download-models` 可提前下载、加载检查模型后退出。支持从缓存目录的 `pretrained/f5-model.safetensors`、`pretrained/vocab.txt`、`pretrained/vocos/config.yaml`、`pretrained/vocos/pytorch_model.bin` 读取预先下载的官方权重；只会采用达到完整官方文件大小的权重，未完成的下载不会被当成可用模型。未预置时使用 Hugging Face 正常下载。

自动识别失败时，只要录音解码和质量检查通过，仍会保留处理后的 WAV 并返回空参考文字及错误说明，用户可以手动输入录音原文后合成。损坏、静音和过短文件仍会拒绝。安装脚本默认使用 `https://pypi.org/simple`，可通过 `-IndexUrl` 指定其他包源；PyTorch 使用官方专用源。pip 连接超时为 120 秒并关闭进度条。

轻量测试：`.\.runtime\tts-env\Scripts\python.exe -m unittest discover -s voice -p test_tts_worker.py -v`；不需要模型权重或联网。

许可证：F5-TTS 代码为 MIT；官方 `F5TTS_v1_Base` 预训练权重为 CC-BY-NC-4.0（仅限非商业使用），项目代码的许可证不改变模型权重的限制。Vocos 代码及模型为 MIT。仅使用你有权使用的声音录音。

- F5-TTS：https://github.com/SWivid/F5-TTS ，权重：https://huggingface.co/SWivid/F5-TTS
- 模型许可证：https://huggingface.co/SWivid/F5-TTS/blob/main/LICENSE
- Vocos：https://github.com/gemelo-ai/vocos ，模型：https://huggingface.co/charactr/vocos-mel-24khz
