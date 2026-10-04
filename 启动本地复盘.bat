<# :
@echo off
title CS.124568 本地复盘系统
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression ([System.IO.File]::ReadAllText('%~f0', [System.Text.Encoding]::UTF8))"
pause
exit /b
#>

$root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$port = 8088

while ($port -lt 8100) {
    try {
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add("http://localhost:$port/")
        $listener.Start()
        break
    } catch {
        $port++
    }
}

if (-not $listener.IsListening) {
    Write-Error "端口已被占用，启动失败"
    exit 1
}

$url = "http://localhost:$port/cs.html"
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host " 标普500 ES 5m 自选日期复盘训练系统已就绪: $url" -ForegroundColor Green
Write-Host " 数据源: 桌面 ES_5m_continuous.csv (191个交易日)" -ForegroundColor Yellow
Write-Host " 线上域名: https://cs.124568.xyz" -ForegroundColor Magenta
Write-Host "=================================================" -ForegroundColor Cyan

try {
    Start-Process "chrome.exe" -ArgumentList $url -ErrorAction Stop
} catch {
    Start-Process $url
}

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".csv"  = "text/csv; charset=utf-8"
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        $rawPath = $request.Url.LocalPath.TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($rawPath)) { $rawPath = "cs.html" }

        $fullPath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $rawPath))
        if (Test-Path $fullPath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($fullPath).ToLower()
            $mime = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
            $response.ContentType = $mime
            $response.AddHeader("Cache-Control", "no-store, no-cache, must-revalidate")
            $bytes = [System.IO.File]::ReadAllBytes($fullPath)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
        }
        $response.Close()
    }
} finally {
    if ($listener.IsListening) { $listener.Stop() }
    $listener.Close()
}
