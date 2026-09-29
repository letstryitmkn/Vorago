# (Earlier version, kept in case: draws the icon and words onto the plain art. The loading screen now uses my own finished art, see make-splash.ps1)
# Builds the loading screen: assets/splash-source.webp (moonlit garden) + the icon + VORAGO + the Phaethon epitaph
# -> assets/splash.jpg. Text is drawn with the app's own fonts (assets/fonts), so it is sharp and spelled right;
# change the words below and rerun to update it.
# (PowerShell names ignore case, so sizes are $leadSize/$mottoSize, not $lead/$motto, to keep them apart from the text lines)
# Usage: powershell -ExecutionPolicy Bypass -File tools\make-splash.ps1
Add-Type -AssemblyName PresentationCore, WindowsBase

$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'assets'
$SCALE = 2                          # render at 2x the artwork's size so the text stays crisp
$NAME = 'VORAGO'
$LEAD_LINES = @('Here Phaeton lies, who in the', "sun-god$([char]0x2019)s chariot fared.")
$MOTTO_LINES = @('AND THOUGH GREATLY HE FAILED,', 'MORE GREATLY HE DARED.')
$INK = [System.Windows.Media.Color]::FromRgb(0x1F, 0x3A, 0x4D)

function Load([string]$path) {
  $fs = [IO.File]::OpenRead($path)
  $f = [System.Windows.Media.Imaging.BitmapDecoder]::Create($fs, 'PreservePixelFormat', 'OnLoad').Frames[0]
  $fs.Close()
  [System.Windows.Media.Imaging.FormatConvertedBitmap]::new($f, [System.Windows.Media.PixelFormats]::Bgra32, $null, 0)
}
$art = Load (Join-Path $assets 'splash-source.webp')
$W = $art.PixelWidth * $SCALE; $H = $art.PixelHeight * $SCALE

# Sky colour behind the icon, so the icon's paper can be re-tinted to match it
$aw = $art.PixelWidth; $apx = New-Object byte[] ($aw * $art.PixelHeight * 4); $art.CopyPixels($apx, $aw * 4, 0)
$sky = @(0, 0, 0); $n = 0
for ($y = [int]($art.PixelHeight * 0.08); $y -lt [int]($art.PixelHeight * 0.18); $y += 3) {
  for ($x = [int]($aw * 0.42); $x -lt [int]($aw * 0.58); $x += 3) { $i = ($y * $aw + $x) * 4; for ($c = 0; $c -lt 3; $c++) { $sky[$c] += $apx[$i + $c] }; $n++ }
}
$sky = $sky | ForEach-Object { $_ / $n }

# Icon: map its paper colour to the sky (ink stays dark, lilies stay white)
$icon = Load (Join-Path $assets 'icon-512.png')
$iw = $icon.PixelWidth; $ipx = New-Object byte[] ($iw * $iw * 4); $icon.CopyPixels($ipx, $iw * 4, 0)
$paper = @(0xBE, 0xB4, 0xA3)   # BGR of #A3B4BE
for ($i = 0; $i -lt $ipx.Length; $i += 4) {
  for ($c = 0; $c -lt 3; $c++) {
    $v = $ipx[$i + $c]; $p = $paper[$c]; $s = $sky[$c]
    $ipx[$i + $c] = [byte][Math]::Round($(if ($v -le $p) { $v * $s / $p } else { $s + ($v - $p) * (255 - $s) / (255 - $p) }))
  }
}
$icon = [System.Windows.Media.Imaging.BitmapSource]::Create($iw, $iw, 96, 96, [System.Windows.Media.PixelFormats]::Bgra32, $null, $ipx, $iw * 4)

# Bodoni at its 18pt optical size, medium weight: sturdy enough to read at phone size (the thin 96pt display cut vanished).
# Static files because this renderer can't use the app's variable font
$fonts = [Uri]((Join-Path $PSScriptRoot 'fonts') + '\')
$bodoni = [System.Windows.Media.Typeface]::new([System.Windows.Media.FontFamily]::new($fonts, './#Bodoni Moda 18pt'), 'Normal', 'Normal', 'Normal')
$bodoniI = [System.Windows.Media.Typeface]::new([System.Windows.Media.FontFamily]::new($fonts, './#Bodoni Moda 18pt'), 'Italic', 'Normal', 'Normal')
$gt = $null; if (-not $bodoni.TryGetGlyphTypeface([ref]$gt)) { throw 'Bodoni font not found in assets\fonts\splash' }
$brush = [System.Windows.Media.SolidColorBrush]::new($INK)
$culture = [Globalization.CultureInfo]::InvariantCulture
function Text([string]$s, $tf, [double]$size) { [System.Windows.Media.FormattedText]::new($s, $culture, 'LeftToRight', $tf, $size, $brush, 1.0) }

# Draws letter-spaced text centred on the page, with its baseline at $base. $sizes gives each letter's size (small caps).
function Spaced($dc, [string]$s, $tf, [double[]]$sizes, [double]$spacing, [double]$base) {
  $parts = for ($k = 0; $k -lt $s.Length; $k++) { Text $s[$k] $tf $sizes[[Math]::Min($k, $sizes.Length - 1)] }
  $total = ($parts | ForEach-Object { $_.WidthIncludingTrailingWhitespace } | Measure-Object -Sum).Sum + $spacing * ($s.Length - 1)
  $x = ($W - $total) / 2
  foreach ($p in $parts) { $dc.DrawText($p, [System.Windows.Point]::new($x, $base - $p.Baseline)); $x += $p.WidthIncludingTrailingWhitespace + $spacing }
}
function Centered($dc, [string]$s, $tf, [double]$size, [double]$base) {
  $t = Text $s $tf $size
  $dc.DrawText($t, [System.Windows.Point]::new(($W - $t.WidthIncludingTrailingWhitespace) / 2, $base - $t.Baseline))
}

$v = [System.Windows.Media.DrawingVisual]::new()
[System.Windows.Media.RenderOptions]::SetBitmapScalingMode($v, 'HighQuality')
$dc = $v.RenderOpen()
$dc.DrawImage($art, [System.Windows.Rect]::new(0, 0, $W, $H))

$iconSize = $W * 0.24
$iconTop = $H * 0.075
$dc.DrawImage($icon, [System.Windows.Rect]::new(($W - $iconSize) / 2, $iconTop, $iconSize, $iconSize))

# VORAGO in small capitals, like RETIA
$cap = $W * 0.085
Spaced $dc $NAME $bodoni @($cap, ($cap * 0.8)) ($cap * 0.3) ($iconTop + $iconSize + $H * 0.05)

# The epitaph: italic lead-in, ornament, small-caps motto
$leadSize = $W * 0.056
$y = $H * 0.292
foreach ($line in $LEAD_LINES) { Centered $dc $line $bodoniI $leadSize $y; $y += $leadSize * 1.35 }
$oy = $y - $leadSize * 0.35
$pen = [System.Windows.Media.Pen]::new($brush, $SCALE * 1.1)
$dc.DrawLine($pen, [System.Windows.Point]::new($W / 2 - $W * 0.16, $oy), [System.Windows.Point]::new($W / 2 - $W * 0.035, $oy))
$dc.DrawLine($pen, [System.Windows.Point]::new($W / 2 + $W * 0.035, $oy), [System.Windows.Point]::new($W / 2 + $W * 0.16, $oy))
$r = $W * 0.016
$star = [System.Windows.Media.StreamGeometry]::new(); $g = $star.Open()
$g.BeginFigure([System.Windows.Point]::new($W / 2, $oy - $r), $true, $true)
foreach ($pt in @(@(0.22, -0.22), @(1, 0), @(0.22, 0.22), @(0, 1), @(-0.22, 0.22), @(-1, 0), @(-0.22, -0.22))) { $g.LineTo([System.Windows.Point]::new($W / 2 + $pt[0] * $r, $oy + $pt[1] * $r), $true, $false) }
$g.Close(); $dc.DrawGeometry($brush, $null, $star)
$mottoSize = $W * 0.033
$y = $oy + $leadSize * 1.05
foreach ($line in $MOTTO_LINES) { Spaced $dc $line $bodoni @($mottoSize) ($mottoSize * 0.14) $y; $y += $mottoSize * 1.7 }
$dc.Close()

$rtb = [System.Windows.Media.Imaging.RenderTargetBitmap]::new($W, $H, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
$rtb.Render($v)
$enc = [System.Windows.Media.Imaging.JpegBitmapEncoder]::new(); $enc.QualityLevel = 88
$enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($rtb))
$file = [IO.File]::Create((Join-Path $assets 'splash-text-version.jpg')); $enc.Save($file); $file.Close()
Write-Host "Saved assets\splash-text-version.jpg ($W x $H)"
