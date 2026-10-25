# Serves this folder at http://localhost:<Port>/ using .NET's HttpListener.
# No Node or Python needed. Stop with Ctrl+C.
#
#   powershell -ExecutionPolicy Bypass -File serve.ps1              # port 5173, opens your browser
#   powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8080
#   powershell -ExecutionPolicy Bypass -File serve.ps1 -NoBrowser

param(
  [int]$Port = 5173,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
$prefix = "http://localhost:$Port/"

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.ico'  = 'image/x-icon'
  '.woff2' = 'font/woff2'
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Write-Host "Could not listen on $prefix. Is something else using port $Port? Try: -Port 8080" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "  Glyphtide is running at $prefix" -ForegroundColor Cyan
Write-Host "  Press Ctrl+C to stop."
Write-Host ""
if (-not $NoBrowser) { Start-Process $prefix }

try {
  while ($listener.IsListening) {
    # poll so Ctrl+C can interrupt between requests
    $pending = $listener.GetContextAsync()
    while (-not $pending.AsyncWaitHandle.WaitOne(250)) { }
    $context = $pending.GetAwaiter().GetResult()
    $request = $context.Request
    $response = $context.Response

    try {
      $rel = [Uri]::UnescapeDataString($request.Url.AbsolutePath).TrimStart('/')
      if ($rel -eq '' -or $rel.EndsWith('/')) { $rel += 'index.html' }
      $full = [IO.Path]::GetFullPath((Join-Path $root $rel))

      if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($full)
        $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
        $response.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
        $response.Headers['Cache-Control'] = 'no-store'
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        $status = 200
      } else {
        $response.StatusCode = 404
        $bytes = [Text.Encoding]::UTF8.GetBytes('Not found')
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        $status = 404
      }
      Write-Host ("  {0} {1} {2}" -f $status, $request.HttpMethod, $request.Url.AbsolutePath)
    } catch {
      $response.StatusCode = 500
      Write-Host "  500 $($request.Url.AbsolutePath): $_" -ForegroundColor Red
    } finally {
      $response.Close()
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
  Write-Host "Stopped."
}
