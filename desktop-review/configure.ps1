param([Parameter(Mandatory=$true)][string]$Endpoint)
$ErrorActionPreference='Stop'
$uri=[uri]$Endpoint
if($uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment){throw '请输入HTTPS云端根地址'}
$folder=Join-Path $env:USERPROFILE '.c9-study-plan'
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$private=Join-Path $folder 'review-worker.json'
$secret=Read-Host '请输入阿里云配置的C9_AI_WORKER_TOKEN（不是软件访问码）' -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try{$token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr);if($token.Length -lt 32){throw '电脑专用访问码至少32位'};@{endpoint=$uri.GetLeftPart([UriPartial]::Authority);gateway='http://127.0.0.1:18789';agent='c9-review';workerToken=$token} | ConvertTo-Json | Set-Content -LiteralPath $private -Encoding utf8}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr);$token=$null}
Write-Output '本机配置已保存；确认OpenClaw及新版云端接口运行后，执行start.ps1。'
