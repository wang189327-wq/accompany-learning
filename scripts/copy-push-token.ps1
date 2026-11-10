$ErrorActionPreference='Stop'
$bytes=New-Object byte[] 32
$random=[Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($bytes) } finally { $random.Dispose() }
$token=-join ($bytes|ForEach-Object { $_.ToString('x2') })
Set-Clipboard -Value $token
Write-Output 'Copied a new 64-character job token. Paste the SAME value into C9_PUSH_JOB_TOKEN in both functions. Do not send it in chat.'
