# Turns assets/icon-source.webp into the square PNG icons phones need.
# The artwork has its own double rounded frame on a blue paper background:
# - Normal icons keep the frame with a thin margin of paper, so the iPhone's rounded corners never cut into it
# - The Android "maskable" icon drops the frame (Android may crop to a circle) and keeps the art in the safe zone
# - The 32px browser-tab icon drops the frame too (it would be a blur at that size)
# Exports 512, 192, 180 (iPhone), 32 (browser tab) and a 512 maskable version
# Usage: powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
Add-Type -AssemblyName PresentationCore, WindowsBase

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'assets\icon-source.webp'
$out = Join-Path $root 'assets'

$MARGIN = 0.045        # paper left around the frame, as a share of the frame's width
$MASKABLE_ART = 0.94   # size of the frameless art inside the maskable icon (its edges fade out)

$fs = [IO.File]::OpenRead($src)
$frame = [System.Windows.Media.Imaging.BitmapDecoder]::Create($fs, 'PreservePixelFormat', 'OnLoad').Frames[0]
$fs.Close()
$bmp = [System.Windows.Media.Imaging.FormatConvertedBitmap]::new($frame, [System.Windows.Media.PixelFormats]::Bgra32, $null, 0)
$w = $bmp.PixelWidth; $h = $bmp.PixelHeight; $stride = $w * 4
$px = New-Object byte[] ($stride * $h)
$bmp.CopyPixels($px, $stride, 0)

function Lum([int]$x, [int]$y) { $i = $y * $stride + $x * 4; [int](($px[$i] + $px[$i + 1] + $px[$i + 2]) / 3) }

# Walks in from an edge and returns [outer edge of the frame, inner edge of the double frame]
function Find-Frame([scriptblock]$at, [int]$max) {
  $p = 0
  while ((& $at $p) -ge 100) { $p++ }          # paper
  $outer = $p
  while ((& $at $p) -lt 100) { $p++ }          # first line
  while ((& $at $p) -ge 100) { $p++ }          # gap
  while ((& $at $p) -lt 100) { $p++ }          # second line
  return @($outer, $p)
}
$mx = [int]($w / 2); $my = [int]($h / 2)
$L = Find-Frame { param($p) Lum $p $my } $w
$R = Find-Frame { param($p) Lum ($w - 1 - $p) $my } $w
$T = Find-Frame { param($p) Lum $mx $p } $h
$B = Find-Frame { param($p) Lum $mx ($h - 1 - $p) } $h
$fl = $L[0]; $fr = $w - 1 - $R[0]; $ft = $T[0]; $fb = $h - 1 - $B[0]
Write-Host "Frame: x $fl-$fr, y $ft-$fb"

# Paper colour: average of the top-left corner, outside the frame
$sr = 0; $sg = 0; $sb = 0; $n = 0
for ($y = 4; $y -lt 40; $y++) { for ($x = 4; $x -lt 40; $x++) { $i = $y * $stride + $x * 4; $sb += $px[$i]; $sg += $px[$i + 1]; $sr += $px[$i + 2]; $n++ } }
$sr = [byte]($sr / $n); $sg = [byte]($sg / $n); $sb = [byte]($sb / $n)
Write-Host "Paper: #$('{0:X2}{1:X2}{2:X2}' -f $sr, $sg, $sb)"
$paper = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb($sr, $sg, $sb))

function Crop-Square([double]$cx, [double]$cy, [double]$size) {
  $size = [Math]::Min($size, [Math]::Min([Math]::Min(2 * $cx, 2 * ($w - $cx)), [Math]::Min(2 * $cy, 2 * ($h - $cy))))
  $rect = [System.Windows.Int32Rect]::new([int]($cx - $size / 2), [int]($cy - $size / 2), [int]$size, [int]$size)
  return [System.Windows.Media.Imaging.CroppedBitmap]::new($bmp, $rect)
}
$cx = ($fl + $fr) / 2; $cy = ($ft + $fb) / 2
$framed = Crop-Square $cx $cy ((($fr - $fl) + ($fb - $ft)) / 2 * (1 + 2 * $MARGIN))
$inner = [Math]::Min(($w - 1 - $R[1]) - $L[1], ($h - 1 - $B[1]) - $T[1]) - 16
$bare = Crop-Square $cx $cy $inner

function Save-Icon($img, [int]$dim, [string]$name, [double]$artScale = 1.0, [switch]$Fade) {
  $visual = [System.Windows.Media.DrawingVisual]::new()
  [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($visual, 'HighQuality')
  $dc = $visual.RenderOpen()
  $dc.DrawRectangle($paper, $null, [System.Windows.Rect]::new(0, 0, $dim, $dim))
  if ($Fade) {
    # Soft round edge: art fully visible inside Android's safe circle, fading into plain paper beyond it,
    # so neither the frame's corners nor the crop's square edge show
    $mask = [System.Windows.Media.RadialGradientBrush]::new()
    $mask.MappingMode = 'Absolute'
    $mask.Center = [System.Windows.Point]::new($dim / 2, $dim / 2)
    $mask.GradientOrigin = $mask.Center
    $mask.RadiusX = $dim / 2; $mask.RadiusY = $dim / 2
    $mask.GradientStops.Add([System.Windows.Media.GradientStop]::new([System.Windows.Media.Colors]::Black, 0.80))
    $mask.GradientStops.Add([System.Windows.Media.GradientStop]::new([System.Windows.Media.Colors]::Transparent, 0.98))
    $dc.PushOpacityMask($mask)
  }
  $art = $dim * $artScale
  $off = ($dim - $art) / 2
  $dc.DrawImage($img, [System.Windows.Rect]::new($off, $off, $art, $art))
  if ($Fade) { $dc.Pop() }
  $dc.Close()
  $rtb = [System.Windows.Media.Imaging.RenderTargetBitmap]::new($dim, $dim, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
  $rtb.Render($visual)
  $enc = [System.Windows.Media.Imaging.PngBitmapEncoder]::new()
  $enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($rtb))
  $file = [IO.File]::Create((Join-Path $out $name))
  $enc.Save($file); $file.Close()
  Write-Host "Saved assets\$name"
}

Save-Icon $framed 512 'icon-512.png'
Save-Icon $framed 192 'icon-192.png'
Save-Icon $framed 180 'apple-touch-icon.png'
Save-Icon $bare 32 'icon-32.png' 1.0 -Fade
Save-Icon $bare 512 'icon-maskable-512.png' $MASKABLE_ART -Fade
