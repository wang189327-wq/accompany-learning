param(
    [Parameter(Mandatory=$true)][string]$GradleHome,
    [Parameter(Mandatory=$true)][string]$SdkRoot,
    [ValidateSet('Debug','Release')][string]$Configuration='Debug',
    [switch]$Distribution
)
$ErrorActionPreference='Stop'
$gradle=Join-Path $GradleHome 'bin\gradle.bat'
if (!(Test-Path -LiteralPath $gradle)) { throw 'GradleHome 应指向 Gradle 8.11.1 目录。' }
if (!(Test-Path -LiteralPath (Join-Path $SdkRoot 'platforms\android-35\android.jar'))) { throw '请安装 Android SDK Platform 35。' }
if ($Distribution -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'push\push.local.properties'))) { throw '通用发行构建拒绝本地推送配置，请移出该配置后再构建。' }
if ($Configuration -eq 'Release' -and !$Distribution -and !(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'push\push.local.properties'))) { throw '请先填写 push/push.local.properties，再构建推送正式包。' }
node (Join-Path $PSScriptRoot 'prepare-assets.cjs')
if ($LASTEXITCODE -ne 0) { throw '网页资源生成失败。' }
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('StudyPush-'+[guid]::NewGuid().ToString('N'))
$android=Join-Path $temporary 'android'
New-Item -ItemType Directory -Path $android -Force|Out-Null
foreach ($name in @('src','res')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $android -Recurse -Force
}
$push=Join-Path $android 'push'
New-Item -ItemType Directory -Path $push -Force|Out-Null
foreach ($name in @('src','settings.gradle','build.gradle','gradle.properties')) {
    $item=Join-Path $PSScriptRoot ('push\'+$name)
    if (Test-Path -LiteralPath $item) { Copy-Item -LiteralPath $item -Destination $push -Recurse -Force }
}
New-Item -ItemType Directory -Path (Join-Path $android 'build') -Force|Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'build\assets') -Destination (Join-Path $android 'build') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'AndroidManifest.xml') -Destination $android
$project=Join-Path $android 'push'
$sdkPath=([IO.Path]::GetFullPath($SdkRoot)).Replace('\','/')
# Java properties require Unicode escapes when the SDK directory contains Chinese characters.
$escaped=-join ($sdkPath.ToCharArray()|ForEach-Object { if ([int]$_ -gt 127) { '\u{0:x4}' -f [int]$_ } else { [string]$_ } })
[IO.File]::WriteAllText((Join-Path $project 'local.properties'),'sdk.dir='+$escaped+"`n",[Text.Encoding]::ASCII)
try {
    $configSource=Join-Path $PSScriptRoot 'push\push.local.properties'
    if (Test-Path -LiteralPath $configSource) { Copy-Item -LiteralPath $configSource -Destination $push }
    $distributionFlag='-Pdistribution='+$Distribution.IsPresent.ToString().ToLower()
    & $gradle -p $project ('assemble'+$Configuration) $distributionFlag --console=plain --no-daemon
    if ($LASTEXITCODE -ne 0) { throw ('推送APK构建失败，临时构建目录：'+$project) }
    $built=@(Get-ChildItem -LiteralPath (Join-Path $project ('build\outputs\apk\'+$Configuration.ToLower())) -Filter '*.apk' -File)
    if ($built.Count -ne 1) { throw '构建结果APK数量不符合预期。' }
    $release=Join-Path $PSScriptRoot 'release'
    New-Item -ItemType Directory -Path $release -Force|Out-Null
    $manifest=[xml](Get-Content -LiteralPath (Join-Path $PSScriptRoot 'AndroidManifest.xml') -Raw)
    $version=$manifest.manifest.GetAttribute('versionName','http://schemas.android.com/apk/res/android')
    $suffix=if ($Configuration -eq 'Debug') { '-debug' } else { '' }
    $target=Join-Path $release ('accompany-learning-v'+$version+$suffix+'.apk')
    if (Test-Path -LiteralPath $target) { throw '目标安装包已存在，拒绝覆盖历史文件。' }
    Copy-Item -LiteralPath $built[0].FullName -Destination $target -Force
    $hash=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower()
    [IO.File]::WriteAllText(($target+'.sha256'),$hash+'  '+[IO.Path]::GetFileName($target)+"`n")
    Write-Output ('推送APK：'+$target)
    if ($Configuration -eq 'Debug') { Write-Output '这是调试签名构建，用于编译验收，不可作为已有正式App的覆盖更新。' }
} finally {
    # Validate the exact temporary root before recursive cleanup of SDK parameters.
    $tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([char]92)+[char]92
    $resolvedTemp=[IO.Path]::GetFullPath($temporary)
    if ($resolvedTemp.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedTemp -Leaf) -match '^StudyPush-[0-9a-f]{32}$') {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
    } else { throw '临时目录校验失败，未执行清理。' }
}
