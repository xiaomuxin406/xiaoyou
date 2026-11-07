[CmdletBinding()]
param(
    [string]$TargetDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) '.runtime\tts-env'),
    [string]$CacheDirectory = (Join-Path $PSScriptRoot 'models\tts-cache'),
    [string]$IndexUrl = 'https://pypi.org/simple',
    [ValidateSet('cpu', 'cu121', 'cu124')]
    [string]$TorchBackend = 'cpu',
    [switch]$DownloadModels
)

$ErrorActionPreference = 'Stop'

function Invoke-Checked {
    param([string]$Executable, [string[]]$CommandArguments)
    & $Executable @CommandArguments
    if ($LASTEXITCODE -ne 0) {
        throw "命令执行失败（退出码 $LASTEXITCODE）：$Executable $($CommandArguments -join ' ')"
    }
}

function Find-CompatiblePython {
    $launcher = Get-Command py -ErrorAction SilentlyContinue
    if ($launcher) {
        foreach ($version in @('3.10', '3.11', '3.12')) {
            try {
                $candidate = @(& $launcher.Source "-$version" -c 'import sys; print(sys.executable)' 2>$null)
            } catch {
                # Windows PowerShell 5.1 turns native stderr into a terminating
                # NativeCommandError under Stop, even when redirected to $null.
                continue
            }
            if ($LASTEXITCODE -eq 0 -and $candidate -and (Test-Path -LiteralPath $candidate[-1])) {
                return [string]$candidate[-1]
            }
        }
    }
    foreach ($name in @('python3.10', 'python3.11', 'python3.12', 'python', 'python3')) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if (-not $command) { continue }
        try {
            $candidate = @(& $command.Source -c 'import sys; assert (3,10) <= sys.version_info[:2] <= (3,12); print(sys.executable)' 2>$null)
        } catch {
            continue
        }
        if ($LASTEXITCODE -eq 0 -and $candidate) { return [string]$candidate[-1] }
    }
    throw '未找到 Python 3.10、3.11 或 3.12。请先安装 64 位 Python（推荐 3.10），然后重试。'
}

try {
    if (-not [IO.Path]::IsPathRooted($TargetDirectory) -or -not [IO.Path]::IsPathRooted($CacheDirectory)) {
        throw '-TargetDirectory 和 -CacheDirectory 必须使用绝对路径。'
    }
    $TargetDirectory = [IO.Path]::GetFullPath($TargetDirectory)
    $CacheDirectory = [IO.Path]::GetFullPath($CacheDirectory)
    New-Item -ItemType Directory -Path $TargetDirectory -Force | Out-Null
    New-Item -ItemType Directory -Path $CacheDirectory -Force | Out-Null
    $venvPython = Join-Path $TargetDirectory 'Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $venvPython)) {
        $basePython = Find-CompatiblePython
        Write-Host "创建独立 Python 环境：$TargetDirectory"
        Invoke-Checked $basePython @('-m', 'venv', $TargetDirectory)
    }
    Invoke-Checked $venvPython @('-c', 'import sys,struct; assert (3,10) <= sys.version_info[:2] <= (3,12), "Python 3.10-3.12 required"; assert struct.calcsize("P")==8, "64-bit Python required"; print("Python",sys.version.split()[0])')
    $pipCache = Join-Path $CacheDirectory 'pip'
    $env:PIP_DISABLE_PIP_VERSION_CHECK = '1'
    $pipOptions = @('--cache-dir', $pipCache, '--timeout', '120', '--progress-bar', 'off', '--index-url', $IndexUrl)
    Write-Host '安装独立环境的 pip 工具……'
    Invoke-Checked $venvPython (@('-m', 'pip', 'install') + $pipOptions + @('pip==24.3.1', 'setuptools==75.6.0', 'wheel==0.45.1'))
    Write-Host "安装 PyTorch 2.5.1（$TorchBackend，首次下载可能较大）……"
    Invoke-Checked $venvPython @('-m', 'pip', 'install', '--cache-dir', $pipCache, '--timeout', '120', '--progress-bar', 'off', '--index-url', "https://download.pytorch.org/whl/$TorchBackend", 'torch==2.5.1', 'torchaudio==2.5.1')
    Write-Host '安装本机音频解码、中文识别和 F5 推理依赖……'
    Invoke-Checked $venvPython (@('-m', 'pip', 'install') + $pipOptions + @('-r', (Join-Path $PSScriptRoot 'requirements-tts.txt')))
    $bundledWheel = Join-Path (Split-Path $PSScriptRoot -Parent) '.runtime\downloads\f5_tts-1.1.10-py3-none-any.whl'
    $f5Package = if (Test-Path -LiteralPath $bundledWheel) { $bundledWheel } else { 'f5-tts==1.1.10' }
    Invoke-Checked $venvPython (@('-m', 'pip', 'install') + $pipOptions + @('--no-deps', $f5Package))
    Write-Host '检查推理模块和内置 FFmpeg……'
    Invoke-Checked $venvPython @('-c', 'import imageio_ffmpeg; from f5_tts.api import F5TTS; import vosk,soundfile; print("FFmpeg:",imageio_ffmpeg.get_ffmpeg_exe()); print("Inference imports OK")')
    if ($DownloadModels) {
        Write-Host '下载并检查 F5-TTS 和 Vocos 模型；下载完成后可离线合成……'
        $inferenceDevice = if ($TorchBackend -eq 'cpu') { 'cpu' } else { 'cuda' }
        Invoke-Checked $venvPython @('-u', (Join-Path $PSScriptRoot 'tts_worker.py'), '--vosk-model', (Join-Path $PSScriptRoot 'models\vosk-model-small-cn-0.22'), '--cache-dir', $CacheDirectory, '--device', $inferenceDevice, '--download-models')
    }
    Write-Host "语音克隆依赖安装完成。Python：$venvPython"
    Write-Host "模型缓存目录：$CacheDirectory"
    if (-not $DownloadModels) { Write-Host '首次合成会下载模型；可添加 -DownloadModels 提前下载。' }
    exit 0
} catch {
    Write-Error "语音克隆安装失败：$($_.Exception.Message)" -ErrorAction Continue
    exit 1
}
