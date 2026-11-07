"""Local Chinese voice cloning sidecar. stdout is UTF-8 JSONL only.

Preparation uses libsndfile/FFmpeg + Vosk, never the synthesis model. F5-TTS
is loaded lazily and reused. No reference recording is sent to a service.
"""
import argparse
import contextlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

SAMPLE_RATE = 24000
MAX_REFERENCE_SECONDS = 12


def complete_file(location, minimum_bytes):
    try:
        return location.is_file() and location.stat().st_size >= minimum_bytes
    except OSError:
        return False


def local_model_options(cache):
    """Only use staged official weights after their complete download is present."""
    pretrained = Path(cache) / "pretrained"
    options = {}
    checkpoint, vocab = pretrained / "f5-model.safetensors", pretrained / "vocab.txt"
    if complete_file(checkpoint, 1348435761) and complete_file(vocab, 1):
        options.update(ckpt_file=str(checkpoint), vocab_file=str(vocab))
    vocos = pretrained / "vocos"
    if complete_file(vocos / "config.yaml", 20) and complete_file(vocos / "pytorch_model.bin", 54365991):
        options["vocoder_local_path"] = str(vocos)
    return options


def emit(message, output=None):
    print(json.dumps(message, ensure_ascii=False, allow_nan=False), file=output or sys.stdout, flush=True)


def configure_cache(directory):
    cache = Path(directory).resolve()
    cache.mkdir(parents=True, exist_ok=True)
    for variable, child in [("HF_HOME", "huggingface"), ("HF_HUB_CACHE", "huggingface/hub"),
                            ("TORCH_HOME", "torch"), ("XDG_CACHE_HOME", "other"),
                            ("MPLCONFIGDIR", "matplotlib")]:
        location = cache / child
        location.mkdir(parents=True, exist_ok=True)
        os.environ[variable] = str(location)
    os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    return cache


def configure_ffmpeg():
    import imageio_ffmpeg
    from pydub import AudioSegment
    executable = imageio_ffmpeg.get_ffmpeg_exe()
    AudioSegment.converter = executable
    os.environ["PATH"] = str(Path(executable).parent) + os.pathsep + os.environ.get("PATH", "")
    return executable


def normalize_audio(source, output):
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly

    source, output = Path(source).resolve(strict=True), Path(output).resolve()
    if source == output:
        raise ValueError("原始录音和处理后的文件不能使用同一路径")
    if not source.is_file() or source.stat().st_size == 0:
        raise ValueError("录音文件为空或不存在")
    if source.stat().st_size > 100 * 1024 * 1024:
        raise ValueError("参考录音过大，请使用小于 100 MB 的录音")
    try:
        with sf.SoundFile(str(source)) as audio:
            rate = audio.samplerate
            original_duration = len(audio) / rate
            samples = audio.read(frames=round(rate * MAX_REFERENCE_SECONDS), dtype="float32", always_2d=True).mean(axis=1)
    except (RuntimeError, OSError, ValueError):
        executable = configure_ffmpeg()
        decoded = subprocess.run(
            [executable, "-nostdin", "-hide_banner", "-i", str(source), "-t", str(MAX_REFERENCE_SECONDS),
             "-vn", "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "pipe:1"],
            capture_output=True, timeout=90, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if decoded.returncode:
            raise ValueError("无法解码录音，请选择有效的 MP3 或 WAV 文件")
        samples = np.frombuffer(decoded.stdout, dtype="<f4").copy()
        rate = SAMPLE_RATE
        match = re.search(rb"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", decoded.stderr)
        original_duration = sum(float(value) * multiplier for value, multiplier in zip(match.groups(), (3600, 60, 1))) if match else len(samples) / rate
    if len(samples) / rate < 1.0:
        raise ValueError("参考录音太短，请使用至少 1 秒的清晰说话录音")
    if not np.isfinite(samples).all():
        raise ValueError("录音包含无效音频数据")
    centered = samples - samples.mean()
    if float(np.sqrt(np.mean(centered * centered))) < 0.001 or float(np.max(np.abs(centered))) < 0.003:
        raise ValueError("参考录音为静音或音量过低，请使用清晰说话录音")
    if rate != SAMPLE_RATE:
        divisor = math.gcd(rate, SAMPLE_RATE)
        samples = resample_poly(samples, SAMPLE_RATE // divisor, rate // divisor)
    samples = np.clip(samples[:SAMPLE_RATE * MAX_REFERENCE_SECONDS], -1, 1)
    output.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output), samples, SAMPLE_RATE, subtype="PCM_16", format="WAV")
    return {"duration": len(samples) / SAMPLE_RATE, "originalDuration": original_duration, "sampleRate": SAMPLE_RATE}


class Worker:
    def __init__(self, vosk_model, cache, device="cpu", progress=None):
        self.vosk_path = Path(vosk_model).resolve()
        self.cache = cache
        self.device = device
        self.vosk_model = None
        self.f5 = None
        self.progress = progress or (lambda phase: None)

    def transcribe(self, audio_path):
        import numpy as np
        import soundfile as sf
        from scipy.signal import resample_poly
        from vosk import KaldiRecognizer, Model, SetLogLevel

        if self.vosk_model is None:
            SetLogLevel(-1)
            model_directory = self.vosk_path.resolve(strict=True)
            previous = Path.cwd()
            try:
                # Kaldi uses narrow Windows paths; Python's chdir uses Unicode.
                os.chdir(model_directory)
                self.vosk_model = Model(".")
            finally:
                os.chdir(previous)
        samples, rate = sf.read(str(audio_path), dtype="float32")
        divisor = math.gcd(rate, 16000)
        samples = resample_poly(samples, 16000 // divisor, rate // divisor)
        pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
        recognizer = KaldiRecognizer(self.vosk_model, 16000)
        segments = []
        for offset in range(0, len(pcm), 8000):
            if recognizer.AcceptWaveform(pcm[offset:offset + 8000]):
                segments.append(json.loads(recognizer.Result()).get("text", ""))
        segments.append(json.loads(recognizer.FinalResult()).get("text", ""))
        transcript = " ".join(segment.strip() for segment in segments if segment.strip()).strip()
        if not transcript:
            raise ValueError("未能识别参考录音中的中文，请使用清晰、无背景音乐的说话录音")
        return transcript

    def load_f5(self):
        if self.f5 is None:
            options = local_model_options(self.cache)
            self.progress("loading-model" if "ckpt_file" in options and "vocoder_local_path" in options else "downloading-models")
            configure_ffmpeg()
            import torch
            from f5_tts.api import F5TTS
            device = self.device
            if device == "auto":
                device = "cuda" if torch.cuda.is_available() else "cpu"
            if device == "cuda" and not torch.cuda.is_available():
                raise ValueError("未检测到可用 CUDA，请选择 CPU 或安装匹配的 CUDA 版 PyTorch")
            if device == "cpu":
                torch.set_num_threads(max(1, min(8, os.cpu_count() or 1)))
            print("正在加载本地 F5-TTS 模型；首次使用可能需要下载模型文件。", file=sys.stderr, flush=True)
            self.f5 = F5TTS(model="F5TTS_v1_Base", device=device,
                            hf_cache_dir=str(self.cache / "huggingface/hub"),
                            **options)
        return self.f5

    def handle(self, message):
        operation = message.get("op")
        if operation == "prepare":
            self.progress("preparing-reference")
            source = Path(required_text(message, "input")).resolve(strict=True)
            output = Path(required_text(message, "output")).resolve()
            info = normalize_audio(source, output)
            try:
                self.progress("recognizing-reference")
                return {"transcript": self.transcribe(output), **info}
            except Exception as exc:
                # A valid recording remains usable when automatic ASR cannot
                # determine its words. The app asks the user to supply them.
                error = "参考录音已处理，但自动识别失败，请填写录音中的实际文字：" + str(exc)
                print(error, file=sys.stderr, flush=True)
                return {"transcript": "", "error": error, **info}
        if operation == "infer":
            transcript = required_text(message, "transcript", "请提供参考文字，避免额外下载语音识别模型")
            text = required_text(message, "text")
            if len(text) > 6000:
                raise ValueError("单次合成文字过长，请分段合成")
            reference = Path(required_text(message, "reference")).resolve(strict=True)
            output = Path(required_text(message, "output")).resolve()
            if reference == output:
                raise ValueError("合成文件不能覆盖参考录音")
            import soundfile as sf
            info = sf.info(str(reference))
            if info.duration < 1 or info.duration > MAX_REFERENCE_SECONDS + 0.01:
                raise ValueError("参考录音必须先处理为 1 至 12 秒的 WAV")
            output.parent.mkdir(parents=True, exist_ok=True)
            temporary = output.with_name(output.stem + "." + uuid.uuid4().hex + ".tmp.wav")
            try:
                model = self.load_f5()
                self.progress("synthesizing")
                model.infer(ref_file=str(reference), ref_text=transcript, gen_text=text,
                            nfe_step=32, file_wave=str(temporary),
                            show_info=lambda *values: print(*values, file=sys.stderr, flush=True))
                self.progress("saving-audio")
                result = sf.info(str(temporary))
                if result.frames == 0:
                    raise ValueError("语音模型未生成有效音频")
                temporary.replace(output)
                return {"duration": result.duration, "sampleRate": result.samplerate}
            finally:
                temporary.unlink(missing_ok=True)
        raise ValueError("未知语音克隆操作：" + str(operation))


def required_text(message, key, error=None):
    value = message.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(error or ("缺少有效参数：" + key))
    return value.strip()


def main():
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vosk-model", required=True)
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--device", choices=["cpu", "cuda", "auto"], default="cpu")
    parser.add_argument("--download-models", action="store_true", help="Load/download F5 models, then exit")
    args = parser.parse_args()
    cache = configure_cache(args.cache_dir)
    protocol_output = sys.stdout
    request_id = None
    worker = Worker(args.vosk_model, cache, args.device,
                    progress=lambda phase: emit({"type": "progress", "id": request_id, "phase": phase}, protocol_output))
    if args.download_models:
        try:
            with contextlib.redirect_stdout(sys.stderr):
                worker.load_f5()
            emit({"type": "downloaded", "ok": True})
            return 0
        except Exception as exc:
            emit({"type": "error", "ok": False, "error": str(exc)})
            return 1
    emit({"type": "ready"})
    for line in sys.stdin:
        request_id = None
        try:
            if len(line) > 100000:
                raise ValueError("语音请求过大")
            message = json.loads(line)
            if not isinstance(message, dict):
                raise ValueError("语音请求必须是 JSON 对象")
            request_id = message.get("id")
            with contextlib.redirect_stdout(sys.stderr):
                result = worker.handle(message)
            emit({"id": request_id, "ok": True, **result})
        except Exception as exc:
            print(type(exc).__name__ + ": " + str(exc), file=sys.stderr, flush=True)
            emit({"id": request_id, "ok": False, "error": str(exc)})
    return 0


if __name__ == "__main__":
    sys.exit(main())
