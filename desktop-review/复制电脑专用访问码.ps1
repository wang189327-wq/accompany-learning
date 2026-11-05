$ErrorActionPreference='Stop'
$config=Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.c9-study-plan\review-worker.json') -Raw | ConvertFrom-Json
if(!$config.workerToken -or $config.workerToken.Length -lt 32){throw '请先运行init-private.cjs'}
Set-Clipboard -Value $config.workerToken
Write-Output '电脑专用访问码已复制。请粘贴到阿里云环境变量C9_AI_WORKER_TOKEN，不要粘贴到聊天或软件访问码栏。'
