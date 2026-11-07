$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'install-tts.ps1'
$bytes = [IO.File]::ReadAllBytes($installer)
$hasUtf8Bom = $bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191
$tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ('xiaoyou-installer-' + [guid]::NewGuid())
$previousPath = $env:PATH
try {
    New-Item -ItemType Directory -Path $tempDirectory | Out-Null
    $pythonResult = @(& python -c 'import sys; print(sys.executable)')
    $realPython = $pythonResult[-1]
    # A native launcher genuinely writes stderr for the absent first candidate.
    # Later candidates must still be attempted under Windows PowerShell 5.1.
    $launcher = @'
@echo off
if "%~1"=="-3.10" (
  echo Requested Python version not installed 1>&2
  exit /b 103
)
echo %XIAOYOU_TEST_REAL_PYTHON%
exit /b 0
'@
    [IO.File]::WriteAllText((Join-Path $tempDirectory 'py.cmd'), $launcher, [Text.Encoding]::ASCII)
    $env:XIAOYOU_TEST_REAL_PYTHON = [string]$realPython
    $env:PATH = $tempDirectory + [IO.Path]::PathSeparator + $previousPath
    $parseErrors = $null
    $tree = [Management.Automation.Language.Parser]::ParseFile($installer, [ref]$null, [ref]$parseErrors)
    if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
    $functionNode = $tree.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Find-CompatiblePython' }, $true)
    . ([scriptblock]::Create($functionNode.Extent.Text))
    $found = Find-CompatiblePython
    if ($found -ne $realPython) { throw "Fallback failed: expected $realPython, got $found" }
    if ($ErrorActionPreference -ne 'Stop') { throw 'Probe changed the caller error policy' }
    if (-not $hasUtf8Bom) { throw 'Installer must be UTF-8 with BOM for Windows PowerShell 5.1 Chinese text' }
    Write-Host "PASS PowerShell $($PSVersionTable.PSVersion): missing 3.10 falls back to 3.11; UTF-8 BOM valid"
} finally {
    $env:PATH = $previousPath
    Remove-Item Env:XIAOYOU_TEST_REAL_PYTHON -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tempDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
