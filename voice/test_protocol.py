import unittest,subprocess,json,sys,base64,wave
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PYTHON=ROOT/'.runtime/voice-env/Scripts/python.exe'
SCRIPT=ROOT/'voice/recognizer.py'
class VoiceProtocol(unittest.TestCase):
 def run_helper(self,model,messages):
  p=subprocess.run([str(PYTHON),str(SCRIPT),'--model',str(model)],input=''.join(json.dumps(m)+'\n' for m in messages),text=True,encoding='utf-8',capture_output=True,timeout=40)
  return p,[json.loads(s) for s in p.stdout.splitlines() if s.strip()]
 def test_invalid_model_reports_structured_error(self):
  p,lines=self.run_helper(ROOT/'.runtime/no-such-model',[])
  self.assertTrue(lines,'helper must emit actionable JSON error')
  self.assertEqual(lines[0]['type'],'error')
  self.assertNotEqual(p.returncode,0)
 def test_real_chinese_audio_and_flush(self):
  with wave.open(str(ROOT/'.runtime/downloads/wake-test.wav'),'rb') as w:
   pcm=w.readframes(w.getnframes())
  p,lines=self.run_helper(ROOT/'voice/models/vosk-model-small-cn-0.22',[{'type':'audio','data':base64.b64encode(pcm).decode()},{'type':'flush'},{'type':'close'}])
  self.assertEqual(p.returncode,0,p.stderr)
  self.assertEqual(lines[0]['type'],'ready')
  texts=''.join(x.get('text','') for x in lines if x['type']=='final')
  self.assertIn('打开',texts)
  self.assertIn('记事本',texts)
if __name__=='__main__': unittest.main()
