# Turns my finished loading-screen art (assets/splash-final-source.webp, icon + VORAGO + quote already in it)
# into assets/splash.jpg:
# - The art is a rounded card on a dark grey background: the grey corners (and the thin dark outer edge)
#   are filled with the card's own border blue, so no dark corners show on any phone
# - Prints that blue: the app uses it behind the art, so screens of any shape (iPhone SE, Galaxy Fold cover,
#   unfolded Fold, tablets) show the whole picture with matching blue around it instead of cropping the text
# Usage: powershell -ExecutionPolicy Bypass -File tools\make-splash.ps1
Add-Type -AssemblyName PresentationCore, WindowsBase
Add-Type -TypeDefinition @"
using System.Collections.Generic;
public static class SplashFill {
    // Flood-fills dark pixels connected to the image border with the given colour (BGRA bytes).
    public static void FillOutside(byte[] px, int w, int h, int threshold, byte b, byte g, byte r) {
        var seen = new bool[w * h];
        var q = new Queue<int>();
        for (int x = 0; x < w; x++) { q.Enqueue(x); q.Enqueue((h - 1) * w + x); }
        for (int y = 0; y < h; y++) { q.Enqueue(y * w); q.Enqueue(y * w + w - 1); }
        while (q.Count > 0) {
            int p = q.Dequeue();
            if (seen[p]) continue;
            seen[p] = true;
            int i = p * 4;
            if ((px[i] + px[i + 1] + px[i + 2]) / 3 >= threshold) continue;
            px[i] = b; px[i + 1] = g; px[i + 2] = r; px[i + 3] = 255;
            int x = p % w, y = p / w;
            if (x > 0) q.Enqueue(p - 1);
            if (x < w - 1) q.Enqueue(p + 1);
            if (y > 0) q.Enqueue(p - w);
            if (y < h - 1) q.Enqueue(p + w);
        }
    }
}
"@

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'assets\splash-final-source.webp'
$fs = [IO.File]::OpenRead($src)
$frame = [System.Windows.Media.Imaging.BitmapDecoder]::Create($fs, 'PreservePixelFormat', 'OnLoad').Frames[0]
$fs.Close()
$bmp = [System.Windows.Media.Imaging.FormatConvertedBitmap]::new($frame, [System.Windows.Media.PixelFormats]::Bgra32, $null, 0)
$w = $bmp.PixelWidth; $h = $bmp.PixelHeight; $stride = $w * 4
$px = New-Object byte[] ($stride * $h)
$bmp.CopyPixels($px, $stride, 0)

# Border blue: average of the strip between the outer edge and the drawn frame, halfway down the left side
$b = 0; $g = 0; $r = 0; $n = 0
for ($y = [int]($h * 0.4); $y -lt [int]($h * 0.6); $y++) { for ($x = 2; $x -lt 6; $x++) { $i = $y * $stride + $x * 4; $b += $px[$i]; $g += $px[$i + 1]; $r += $px[$i + 2]; $n++ } }
$b = [byte]($b / $n); $g = [byte]($g / $n); $r = [byte]($r / $n)
Write-Host "Border blue: #$('{0:X2}{1:X2}{2:X2}' -f $r, $g, $b)  (use as the splash background colour)"

[SplashFill]::FillOutside($px, $w, $h, 110, $b, $g, $r)

$out = [System.Windows.Media.Imaging.BitmapSource]::Create($w, $h, 96, 96, [System.Windows.Media.PixelFormats]::Bgra32, $null, $px, $stride)
$enc = [System.Windows.Media.Imaging.JpegBitmapEncoder]::new(); $enc.QualityLevel = 90
$enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($out))
$file = [IO.File]::Create((Join-Path $root 'assets\splash.jpg')); $enc.Save($file); $file.Close()
Write-Host "Saved assets\splash.jpg ($w x $h)"
