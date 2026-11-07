"""Lightweight tests; no F5 weights or network required."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import wave

WORKER = Path(__file__).with_name("tts_worker.py")


class ProtocolTests(unittest.TestCase):
    def test_local_model_options_ignore_incomplete_checkpoints(self):
        import tts_worker
        with tempfile.TemporaryDirectory() as temp:
            checkpoint = Path(temp) / "checkpoint"
            checkpoint.write_bytes(b"partial")
            self.assertFalse(tts_worker.complete_file(checkpoint, 20))
            checkpoint.write_bytes(b"x" * 25)
            self.assertTrue(tts_worker.complete_file(checkpoint, 20))
            self.assertEqual(tts_worker.local_model_options(Path(temp)), {})

    def test_invalid_requests_do_not_kill_worker_or_load_models(self):
        with tempfile.TemporaryDirectory() as temp:
            result = subprocess.run(
                [sys.executable, "-u", str(WORKER), "--vosk-model", temp,
                 "--cache-dir", str(Path(temp) / "cache")],
                input='not json\n' + json.dumps({"id": "一", "op": "prepare", "input": "missing.mp3", "output": str(Path(temp) / "out.wav")}) + '\n' +
                json.dumps({"id": 2, "op": "infer", "reference": "missing.wav", "transcript": "", "text": "你好", "output": "out.wav"}) + '\n' +
                json.dumps({"id": 3, "op": "unknown"}) + '\n',
                text=True, encoding="utf-8", capture_output=True, timeout=15,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            messages = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual(messages[0]["type"], "ready")
            self.assertEqual(len(messages), 5)
            self.assertFalse(messages[1]["ok"])
            self.assertEqual(messages[2]["id"], "一")
            self.assertFalse(messages[2]["ok"])
            self.assertIn("参考文字", messages[3]["error"])
            self.assertEqual(messages[4]["id"], 3)
            self.assertFalse(messages[4]["ok"])


@unittest.skipUnless(importlib.util.find_spec("numpy") and importlib.util.find_spec("soundfile") and importlib.util.find_spec("scipy"), "audio dependencies not installed")
class AudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import tts_worker
        cls.worker = tts_worker

    def test_normalize_downmixes_resamples_caps_and_writes_unicode_pcm(self):
        import numpy as np
        import soundfile as sf
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "参考.wav"
            output = Path(temp) / "声音" / "已处理.wav"
            t = np.arange(32000 * 14) / 32000
            sf.write(source, np.column_stack([0.2 * np.sin(t * 1200), 0.1 * np.sin(t * 1200)]), 32000)
            info = self.worker.normalize_audio(source, output)
            with wave.open(str(output), "rb") as wav:
                self.assertEqual((wav.getnchannels(), wav.getframerate(), wav.getsampwidth()), (1, 24000, 2))
                self.assertEqual(wav.getnframes(), 288000)
            self.assertAlmostEqual(info["duration"], 12)
            self.assertAlmostEqual(info["originalDuration"], 14)

    def test_silence_and_short_recordings_are_rejected(self):
        import numpy as np
        import soundfile as sf
        with tempfile.TemporaryDirectory() as temp:
            for name, audio in [("silence", np.zeros(48000)), ("short", np.ones(12000) * 0.1)]:
                with self.subTest(name=name):
                    source = Path(temp) / (name + ".wav")
                    sf.write(source, audio, 24000)
                    with self.assertRaises(ValueError):
                        self.worker.normalize_audio(source, Path(temp) / "out.wav")

    def test_valid_audio_survives_a_transcription_failure_for_manual_correction(self):
        import numpy as np
        import soundfile as sf
        class UnavailableRecognizer(self.worker.Worker):
            def transcribe(self, audio_path):
                raise ValueError("recognizer unavailable")
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp) / "参考.wav", Path(temp) / "规范.wav"
            sf.write(source, 0.2 * np.sin(np.arange(48000) * 0.12), 24000)
            worker = UnavailableRecognizer(temp, Path(temp))
            result = worker.handle({"op": "prepare", "input": str(source), "output": str(output)})
            self.assertEqual(result["transcript"], "")
            self.assertIn("recognizer unavailable", result["error"])
            self.assertAlmostEqual(result["duration"], 2)
            self.assertEqual(sf.info(str(output)).frames, 48000)


if __name__ == "__main__":
    unittest.main()
