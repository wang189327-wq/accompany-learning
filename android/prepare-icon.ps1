$ErrorActionPreference = 'Stop'
$pythonLauncher = Get-Command py -ErrorAction SilentlyContinue
$script = Join-Path $PSScriptRoot 'prepare-icon.py'
if ($pythonLauncher) {
    & $pythonLauncher.Source -3 $script
} else {
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (!$python) { throw '需要 Python 3 和 Pillow。' }
    & $python.Source $script
}
if ($LASTEXITCODE -ne 0) { throw '图标生成失败。' }