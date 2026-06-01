Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path "icons"

$bmp = New-Object System.Drawing.Bitmap 192, 192
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(59, 130, 246))
$font = New-Object System.Drawing.Font("Arial", 100)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.DrawString("¥", $font, $brush, 20, 20)
$bmp.Save("$PSScriptRoot\icons\icon-192.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()

$bmp2 = New-Object System.Drawing.Bitmap 512, 512
$g2 = [System.Drawing.Graphics]::FromImage($bmp2)
$g2.Clear([System.Drawing.Color]::FromArgb(59, 130, 246))
$font2 = New-Object System.Drawing.Font("Arial", 250)
$brush2 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g2.DrawString("¥", $font2, $brush2, 100, 70)
$bmp2.Save("$PSScriptRoot\icons\icon-512.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g2.Dispose()
$bmp2.Dispose()
