$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$c9Source = [Drawing.Bitmap]::new((Join-Path $PSScriptRoot 'artwork\cover-original.png'))
$c9Padding = [int][math]::Ceiling($c9Source.Width/4)
$c9Size = $c9Source.Width + 2*$c9Padding
$c9Icon = [Drawing.Bitmap]::new($c9Size,$c9Size)
$c9Graphics = [Drawing.Graphics]::FromImage($c9Icon)
try {
    # AdaptiveIconDrawable masks the central 72/108 of each layer. Keep the
    # original image exactly in that viewport; extend its edge pixels only
    # into the extra area used for launcher motion, with no solid-color rim.
    $c9Graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $c9Width = $c9Source.Width
    $c9Height = $c9Source.Height
    foreach ($c9Edge in @(
        @(0,0,$c9Padding,$c9Padding,0,0,1,1),
        @($c9Padding,0,$c9Width,$c9Padding,0,0,$c9Width,1),
        @(($c9Padding+$c9Width),0,$c9Padding,$c9Padding,($c9Width-1),0,1,1),
        @(0,$c9Padding,$c9Padding,$c9Height,0,0,1,$c9Height),
        @(($c9Padding+$c9Width),$c9Padding,$c9Padding,$c9Height,($c9Width-1),0,1,$c9Height),
        @(0,($c9Padding+$c9Height),$c9Padding,$c9Padding,0,($c9Height-1),1,1),
        @($c9Padding,($c9Padding+$c9Height),$c9Width,$c9Padding,0,($c9Height-1),$c9Width,1),
        @(($c9Padding+$c9Width),($c9Padding+$c9Height),$c9Padding,$c9Padding,($c9Width-1),($c9Height-1),1,1)
    )) {
        $c9Rect = [Drawing.Rectangle]::new($c9Edge[0],$c9Edge[1],$c9Edge[2],$c9Edge[3])
        $c9Graphics.DrawImage($c9Source,$c9Rect,$c9Edge[4],$c9Edge[5],$c9Edge[6],$c9Edge[7],[Drawing.GraphicsUnit]::Pixel)
    }
    $c9Graphics.DrawImageUnscaled($c9Source,$c9Padding,$c9Padding)
    $c9Icon.Save((Join-Path $PSScriptRoot 'res\drawable-nodpi\launcher_artwork.png'),[Drawing.Imaging.ImageFormat]::Png)
    # Compare the unmasked viewport pixel by pixel with the original cover.
    for ($c9Y=0;$c9Y -lt $c9Height;$c9Y++) { for ($c9X=0;$c9X -lt $c9Width;$c9X++) {
        if ($c9Icon.GetPixel($c9X+$c9Padding,$c9Y+$c9Padding).ToArgb() -ne $c9Source.GetPixel($c9X,$c9Y).ToArgb()) { throw '图标中心与原图不一致' }
    } }
    $c9Preview = [Drawing.Bitmap]::new(360,360)
    $c9PreviewGraphics = [Drawing.Graphics]::FromImage($c9Preview)
    $c9Mask = [Drawing.Drawing2D.GraphicsPath]::new()
    try {
        $c9Mask.AddEllipse(0,0,360,360)
        $c9PreviewGraphics.SetClip($c9Mask)
        $c9PreviewGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $c9PreviewGraphics.DrawImage($c9Icon,[Drawing.Rectangle]::new(0,0,360,360),$c9Padding,$c9Padding,$c9Width,$c9Height,[Drawing.GraphicsUnit]::Pixel)
        $c9Preview.Save((Join-Path $PSScriptRoot 'artwork\icon-preview.png'),[Drawing.Imaging.ImageFormat]::Png)
    } finally { $c9PreviewGraphics.Dispose();$c9Mask.Dispose();$c9Preview.Dispose() }
    Write-Output '无深色边框图标已生成，原图中心像素校验通过。'
} finally { $c9Graphics.Dispose();$c9Icon.Dispose();$c9Source.Dispose() }
