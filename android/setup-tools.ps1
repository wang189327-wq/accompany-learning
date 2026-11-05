$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$c9Root = $PSScriptRoot
$c9Tools = Join-Path $c9Root 'tools'
New-Item -ItemType Directory -Path $c9Tools -Force | Out-Null
$c9XmlPath = Join-Path $c9Tools 'repository.xml'
Invoke-WebRequest 'https://dl.google.com/android/repository/repository2-3.xml' -OutFile $c9XmlPath -TimeoutSec 90
[xml]$c9Xml = Get-Content -LiteralPath $c9XmlPath -Raw
foreach ($c9Spec in @(@{Path='build-tools;35.0.0';Folder='build-tools'},@{Path='platforms;android-35';Folder='platform'})) {
    $c9Dest = Join-Path $c9Tools $c9Spec.Folder
    if (Test-Path -LiteralPath $c9Dest) { continue }
    $c9Package = $c9Xml.SelectSingleNode("//*[local-name()='remotePackage' and @path='$($c9Spec.Path)']")
    $c9Archive = $c9Package.SelectSingleNode("./*[local-name()='archives']/*[local-name()='archive'][not(*[local-name()='host-os']) or *[local-name()='host-os']='windows']")
    $c9Complete = $c9Archive.SelectSingleNode("./*[local-name()='complete']")
    $c9Url = $c9Complete.SelectSingleNode("./*[local-name()='url']").InnerText
    $c9Hash = $c9Complete.SelectSingleNode("./*[local-name()='checksum']").InnerText
    $c9Zip = Join-Path $c9Tools ($c9Spec.Folder + '.zip')
    Write-Output ('下载：' + $c9Spec.Path)
    Invoke-WebRequest ('https://dl.google.com/android/repository/' + $c9Url) -OutFile $c9Zip -TimeoutSec 600
    if ((Get-FileHash -LiteralPath $c9Zip -Algorithm SHA1).Hash.ToLower() -ne $c9Hash.ToLower()) { throw '安卓工具校验失败' }
    Expand-Archive -LiteralPath $c9Zip -DestinationPath $c9Dest -Force
}
$c9JdkDest = Join-Path $c9Tools 'jdk'
if (!(Test-Path -LiteralPath $c9JdkDest)) {
    $c9JdkUrl = 'https://aka.ms/download-jdk/microsoft-jdk-21.0.12.1-windows-x64.zip'
    $c9JdkZip = Join-Path $c9Tools 'jdk.zip'
    $c9JdkSum = Join-Path $c9Tools 'jdk.sha256.txt'
    Write-Output '下载：Microsoft OpenJDK 21'
    Invoke-WebRequest ($c9JdkUrl + '.sha256sum.txt') -OutFile $c9JdkSum -TimeoutSec 90
    Invoke-WebRequest $c9JdkUrl -OutFile $c9JdkZip -TimeoutSec 600
    $c9Expected = ([regex]::Match((Get-Content -LiteralPath $c9JdkSum -Raw),'[a-fA-F0-9]{64}')).Value
    if ((Get-FileHash -LiteralPath $c9JdkZip -Algorithm SHA256).Hash.ToLower() -ne $c9Expected.ToLower()) { throw 'Java 工具校验失败' }
    Expand-Archive -LiteralPath $c9JdkZip -DestinationPath $c9JdkDest -Force
}
Write-Output '安卓工具准备完成；没有修改系统环境变量。'
