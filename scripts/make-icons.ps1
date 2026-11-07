# Regenerates the app icons in /icons from one design (Windows PowerShell 5.1 / 7, uses System.Drawing).
#   powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1
# The matching vector version is favicon.svg - keep the geometry in sync if you change the design.
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force $out | Out-Null

function New-Icon([int]$Size, [bool]$Rounded, [string]$Path) {
  $bmp = New-Object Drawing.Bitmap $Size, $Size, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'; $g.Clear([Drawing.Color]::Transparent)
  $k = $Size / 512.0
  $pt = { param($x, $y) New-Object Drawing.PointF ([single]($x * $k)), ([single]($y * $k)) }

  # background: blue gradient, rounded square (any-purpose) or full-bleed square (maskable / iOS)
  $rect = New-Object Drawing.RectangleF 0, 0, $Size, $Size
  $bg = New-Object Drawing.Drawing2D.LinearGradientBrush $rect, ([Drawing.Color]::FromArgb(255, 70, 150, 245)), ([Drawing.Color]::FromArgb(255, 24, 72, 160)), 55.0
  if ($Rounded) {
    $r = 112 * $k; $d = $r * 2
    $p = New-Object Drawing.Drawing2D.GraphicsPath
    $p.AddArc(0, 0, $d, $d, 180, 90); $p.AddArc($Size - $d, 0, $d, $d, 270, 90)
    $p.AddArc($Size - $d, $Size - $d, $d, $d, 0, 90); $p.AddArc(0, $Size - $d, $d, $d, 90, 90); $p.CloseFigure()
    $g.FillPath($bg, $p)
  } else { $g.FillRectangle($bg, $rect) }

  # trend: soft area under a rising line, with a dot at the latest point (kept inside the maskable safe zone)
  $line = @((& $pt 112 350), (& $pt 198 272), (& $pt 266 318), (& $pt 400 166))
  $area = $line + @((& $pt 400 400), (& $pt 112 400))
  $g.FillPolygon((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(46, 255, 255, 255))), [Drawing.PointF[]]$area)
  $pen = New-Object Drawing.Pen ([Drawing.Color]::White), ([single](36 * $k))
  $pen.LineJoin = 'Round'; $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  $g.DrawLines($pen, [Drawing.PointF[]]$line)
  $c = $line[3]; $rad = 30 * $k
  $g.FillEllipse([Drawing.Brushes]::White, $c.X - $rad, $c.Y - $rad, 2 * $rad, 2 * $rad)

  $bmp.Save($Path, [Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

New-Icon 512 $true  (Join-Path $out 'icon-512.png')
New-Icon 192 $true  (Join-Path $out 'icon-192.png')
New-Icon 512 $false (Join-Path $out 'maskable-512.png')
New-Icon 180 $false (Join-Path $out 'apple-touch-icon.png')
New-Icon 32  $true  (Join-Path $out 'favicon-32.png')
Get-ChildItem $out | Select-Object Name, Length
