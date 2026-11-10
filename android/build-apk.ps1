$ErrorActionPreference = 'Stop'
$c9Root = $PSScriptRoot
$c9Tools = if ($env:C9_BUILD_TOOLS_ROOT) { $env:C9_BUILD_TOOLS_ROOT } else { Join-Path $c9Root 'tools' }
$c9Java = Get-ChildItem -LiteralPath (Join-Path $c9Tools 'jdk') -Filter java.exe -File -Recurse | Select-Object -First 1
if (!$c9Java) { throw '请先运行 setup-tools.ps1 下载编译工具' }
$c9JavaBin = $c9Java.Directory.FullName
$c9Aapt = Get-ChildItem -LiteralPath (Join-Path $c9Tools 'build-tools') -Filter aapt2.exe -File -Recurse | Select-Object -First 1
$c9BuildTools = $c9Aapt.Directory.FullName
$c9Platform = Get-ChildItem -LiteralPath (Join-Path $c9Tools 'platform') -Filter android.jar -File -Recurse | Select-Object -First 1
$c9Build = Join-Path ([IO.Path]::GetTempPath()) ('C9StudyPlanAndroidBuild-' + [guid]::NewGuid().ToString('N'))
$c9Release = Join-Path $c9Root 'release'
foreach ($c9Dir in @($c9Build,$c9Release,(Join-Path $c9Build 'classes'),(Join-Path $c9Build 'dex'),(Join-Path $c9Root 'signing'))) { New-Item -ItemType Directory -Path $c9Dir -Force | Out-Null }
function Invoke-C9Tool([string]$c9Exe,[string[]]$c9Args) { & $c9Exe @c9Args; if ($LASTEXITCODE -ne 0) { throw ('编译命令失败：'+[IO.Path]::GetFileName($c9Exe)) } }
Invoke-C9Tool 'node' @((Join-Path $c9Root 'widget-layouts.test.cjs'))
Invoke-C9Tool 'node' @((Join-Path $c9Root 'prepare-assets.cjs'))
Copy-Item -LiteralPath (Join-Path $c9Root 'res'),(Join-Path $c9Root 'src'),(Join-Path $c9Root 'build\assets'),(Join-Path $c9Root 'AndroidManifest.xml') -Destination $c9Build -Recurse -Force
$c9AndroidJar = Join-Path $c9Build 'android.jar'
Copy-Item -LiteralPath $c9Platform.FullName -Destination $c9AndroidJar
Invoke-C9Tool $c9Aapt.FullName @('compile','--dir',(Join-Path $c9Build 'res'),'-o',(Join-Path $c9Build 'resources.zip'))
Invoke-C9Tool $c9Aapt.FullName @('link','--auto-add-overlay','--manifest',(Join-Path $c9Build 'AndroidManifest.xml'),'-I',$c9AndroidJar,'--min-sdk-version','26','--target-sdk-version','35','-A',(Join-Path $c9Build 'assets'),'-R',(Join-Path $c9Build 'resources.zip'),'-o',(Join-Path $c9Build 'unsigned.apk'))
$c9Sources = @(Get-ChildItem -LiteralPath (Join-Path $c9Build 'src') -Filter '*.java' -File -Recurse | ForEach-Object FullName)
Invoke-C9Tool (Join-Path $c9JavaBin 'javac.exe') (@('-encoding','UTF-8','--release','8','-classpath',$c9AndroidJar,'-d',(Join-Path $c9Build 'classes')) + $c9Sources)
$c9Classes = @(Get-ChildItem -LiteralPath (Join-Path $c9Build 'classes') -Filter '*.class' -File -Recurse | ForEach-Object FullName)
Invoke-C9Tool $c9Java.FullName (@('-cp',(Join-Path $c9BuildTools 'lib\d8.jar'),'com.android.tools.r8.D8','--lib',$c9AndroidJar,'--min-api','26','--output',(Join-Path $c9Build 'dex')) + $c9Classes)
Add-Type -AssemblyName System.IO.Compression
$c9Zip = [IO.Compression.ZipFile]::Open((Join-Path $c9Build 'unsigned.apk'),[IO.Compression.ZipArchiveMode]::Update)
try {
    # Windows aapt2 may store nested asset paths with backslashes. Android's
    # AssetManager resolves slash paths, including PDF fonts and CMaps.
    foreach ($c9Entry in @($c9Zip.Entries)) {
        if ($c9Entry.FullName.StartsWith('assets/') -and $c9Entry.FullName.Contains('\')) {
            $c9Normalized = $c9Entry.FullName.Replace('\','/')
            if ($c9Zip.GetEntry($c9Normalized)) { throw ('重复资源路径：'+$c9Normalized) }
            $c9Memory = New-Object IO.MemoryStream
            $c9InputStream = $c9Entry.Open()
            try { $c9InputStream.CopyTo($c9Memory) } finally { $c9InputStream.Dispose() }
            $c9Replacement = $c9Zip.CreateEntry($c9Normalized,[IO.Compression.CompressionLevel]::Optimal)
            $c9Replacement.LastWriteTime = $c9Entry.LastWriteTime
            $c9OutputStream = $c9Replacement.Open()
            try { $c9Data = $c9Memory.ToArray(); $c9OutputStream.Write($c9Data,0,$c9Data.Length) } finally { $c9OutputStream.Dispose(); $c9Memory.Dispose() }
            $c9Entry.Delete()
        }
    }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($c9Zip,(Join-Path $c9Build 'dex\classes.dex'),'classes.dex',[IO.Compression.CompressionLevel]::Optimal) | Out-Null
} finally { $c9Zip.Dispose() }
Invoke-C9Tool (Join-Path $c9BuildTools 'zipalign.exe') @('-f','-p','4',(Join-Path $c9Build 'unsigned.apk'),(Join-Path $c9Build 'aligned.apk'))
$c9SignRoot = if ($env:C9_EXISTING_SIGNING_ROOT) { $env:C9_EXISTING_SIGNING_ROOT } else { Join-Path $c9Root 'signing' }
$c9Key = Join-Path $c9SignRoot 'accompany-release.p12'
$c9Secret = Join-Path $c9SignRoot 'credentials.json'
if ($env:C9_EXISTING_SIGNING_ROOT -and (!(Test-Path -LiteralPath $c9Key) -or !(Test-Path -LiteralPath $c9Secret))) { throw '原签名文件缺失，停止生成，避免更换签名' }
if (!(Test-Path -LiteralPath $c9Key)) {
    if (!(Test-Path -LiteralPath $c9Secret)) { $c9Password = -join ([Security.Cryptography.RandomNumberGenerator]::GetBytes(32) | ForEach-Object { $_.ToString('x2') }); @{password=$c9Password} | ConvertTo-Json | Set-Content -LiteralPath $c9Secret -Encoding UTF8 }
    $env:C9_SIGN_STORE_PASSWORD = (Get-Content -LiteralPath $c9Secret -Raw | ConvertFrom-Json).password
    Invoke-C9Tool (Join-Path $c9JavaBin 'keytool.exe') @('-genkeypair','-keystore',$c9Key,'-storetype','PKCS12','-alias','accompanyrelease','-keyalg','RSA','-keysize','3072','-validity','36500','-dname','CN=Accompany Learning, OU=Private, O=Accompany Learning, C=CN','-storepass:env','C9_SIGN_STORE_PASSWORD','-keypass:env','C9_SIGN_STORE_PASSWORD')
}
$env:C9_SIGN_STORE_PASSWORD = (Get-Content -LiteralPath $c9Secret -Raw | ConvertFrom-Json).password
$c9Apk = Join-Path $c9Build 'AccompanyLearning-v1.3.apk'
try {
    Invoke-C9Tool $c9Java.FullName @('-jar',(Join-Path $c9BuildTools 'lib\apksigner.jar'),'sign','--ks',$c9Key,'--ks-key-alias','accompanyrelease','--ks-pass','env:C9_SIGN_STORE_PASSWORD','--key-pass','env:C9_SIGN_STORE_PASSWORD','--v1-signing-enabled','true','--v2-signing-enabled','true','--v3-signing-enabled','true','--out',$c9Apk,(Join-Path $c9Build 'aligned.apk'))
} finally { Remove-Item Env:C9_SIGN_STORE_PASSWORD -ErrorAction SilentlyContinue }
Invoke-C9Tool $c9Java.FullName @('-jar',(Join-Path $c9BuildTools 'lib\apksigner.jar'),'verify','--verbose','--print-certs',$c9Apk)
Invoke-C9Tool (Join-Path $c9BuildTools 'zipalign.exe') @('-c','-p','4',$c9Apk)
$c9Output = Join-Path $c9Release 'accompany-learning-v1.3.apk'
Copy-Item -LiteralPath $c9Apk -Destination $c9Output -Force
$c9Hash = (Get-FileHash -LiteralPath $c9Apk -Algorithm SHA256).Hash.ToLower()
Set-Content -LiteralPath (Join-Path $c9Release 'SHA256.txt') -Value ($c9Hash + '  ' + [IO.Path]::GetFileName($c9Output)) -Encoding UTF8
Invoke-C9Tool 'node' @((Join-Path $c9Root '../scripts/release-record.cjs'),$c9Output)
Write-Output ('APK 已生成：' + $c9Output)
