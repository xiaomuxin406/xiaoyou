import path from 'node:path';

export function validatePort(value = 8765) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口必须是 1024 到 65535 之间的整数');
  return port;
}

export function resolveRuntime({ packaged, userData, resources, projectRoot }) {
  return {
    dataDir: packaged ? userData : projectRoot,
    staticDir: packaged ? path.join(resources, 'app-ui') : path.join(projectRoot, 'dist'),
    defaultProject: packaged ? path.join(userData, 'project') : projectRoot,
    seedProject: packaged ? path.join(resources, 'defaults') : projectRoot,
    ttsRoot: packaged ? resources : projectRoot,
    voicePacks: packaged ? path.join(resources, 'defaults', 'voice-packs') : path.join(projectRoot, 'voice-packs'),
    voiceExecutable: packaged ? path.join(resources, 'voice', 'xiaoyou-voice.exe') : path.join(projectRoot, 'voice', 'dist', 'xiaoyou-voice', 'xiaoyou-voice.exe'),
    voiceModel: packaged ? path.join(resources, 'voice-model') : path.join(projectRoot, 'voice', 'models', 'vosk-model-small-cn-0.22'),
  };
}

export function navigationAllowed(target, serviceUrl) {
  try { return new URL(target).origin === new URL(serviceUrl).origin; } catch { return false; }
}
