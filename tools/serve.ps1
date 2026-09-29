# Tiny local web server for testing Vorago on this computer (no installs needed).
# Usage: powershell -ExecutionPolicy Bypass -File tools\serve.ps1 [-Port 8124]
param([int]$Port = 8124)

$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json'; '.md' = 'text/markdown; charset=utf-8'
  '.webp' = 'image/webp'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
  '.woff2' = 'font/woff2'
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Vorago dev server running at http://localhost:$Port/"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $res.Headers.Add('Cache-Control', 'no-store')
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    $path = if ($rel) { [IO.Path]::GetFullPath((Join-Path $root $rel)) } else { $root }

    if (-not $path.StartsWith($root)) {
      $res.StatusCode = 403
    }
    else {
      if (Test-Path -LiteralPath $path -PathType Container) {
        $index = Join-Path $path 'index.html'
        if (Test-Path -LiteralPath $index) { $path = $index }
        else {
          # Folder listing (the app uses this to find packs while testing locally)
          $links = Get-ChildItem -LiteralPath $path | ForEach-Object { "<a href=""$([Uri]::EscapeDataString($_.Name))"">$($_.Name)</a><br>" }
          $bytes = [Text.Encoding]::UTF8.GetBytes("<!doctype html><html><body>$($links -join '')</body></html>")
          $res.ContentType = 'text/html; charset=utf-8'
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
          continue
        }
      }
      if (Test-Path -LiteralPath $path -PathType Leaf) {
        $ext = [IO.Path]::GetExtension($path).ToLower()
        $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $bytes = [IO.File]::ReadAllBytes($path)
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      }
      else {
        $res.StatusCode = 404
      }
    }
  }
  catch {
    $res.StatusCode = 500
  }
  finally {
    try { $res.Close() } catch { }
  }
}
