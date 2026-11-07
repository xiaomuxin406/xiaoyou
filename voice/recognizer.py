"""Vosk JSON-lines sidecar. Audio: base64 signed PCM16 mono, 16kHz."""
import argparse
import base64
import json
import os
import sys
from pathlib import Path


def emit(kind, **values):
    print(json.dumps({"type": kind, **values}, ensure_ascii=False), flush=True)


def main():
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    try:
        from vosk import KaldiRecognizer, Model, SetLogLevel
        SetLogLevel(-1)
        model_path = Path(args.model).resolve(strict=True)
        # Kaldi's Windows file loader does not accept Unicode absolute paths.
        # Python changes directory with wide-character APIs; Kaldi sees ASCII '.'.
        os.chdir(model_path)
        model = Model(".")
        recognizer = KaldiRecognizer(model, 16000)
    except Exception as exc:
        emit("error", error="中文语音模型加载失败，请检查模型目录：" + str(exc))
        return 1
    emit("ready", sampleRate=16000)
    for line in sys.stdin:
        try:
            if len(line) > 600000:
                raise ValueError("音频消息过大")
            message = json.loads(line)
            kind = message.get("type")
            if kind == "close":
                break
            if kind == "reset":
                recognizer.Reset()
            elif kind == "flush":
                emit("final", text=json.loads(recognizer.FinalResult()).get("text", ""))
                recognizer.Reset()
            elif kind == "audio":
                pcm = base64.b64decode(message["data"], validate=True)
                if len(pcm) % 2:
                    raise ValueError("PCM16 音频长度错误")
                if recognizer.AcceptWaveform(pcm):
                    emit("final", text=json.loads(recognizer.Result()).get("text", ""))
                else:
                    emit("partial", text=json.loads(recognizer.PartialResult()).get("partial", ""))
            else:
                raise ValueError("未知语音协议消息")
        except Exception as exc:
            emit("error", error=str(exc))
    return 0


if __name__ == "__main__":
    sys.exit(main())
