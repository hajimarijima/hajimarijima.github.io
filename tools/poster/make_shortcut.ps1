# Creates a desktop shortcut for the Hajimarijima poster app.
# Usage (from anywhere):  powershell -ExecutionPolicy Bypass -File D:\VoiceStudio\town\tools\poster\make_shortcut.ps1
# Japanese names are built from code points so this file stays ASCII (PowerShell 5.1 reads BOM-less files as ANSI).
$ErrorActionPreference = 'Stop'

function Get-JpText([int[]]$codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$town = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
# "hajimari-jima toukou" : はじまり島投稿.bat
$batName = (Get-JpText 0x306F,0x3058,0x307E,0x308A,0x5CF6,0x6295,0x7A3F) + '.bat'
# shortcut name : はじまり島 投稿
$linkName = (Get-JpText 0x306F,0x3058,0x307E,0x308A,0x5CF6,0x20,0x6295,0x7A3F) + '.lnk'
$bat = Join-Path $town $batName
if (-not (Test-Path -LiteralPath $bat)) { throw "bat file not found: $bat" }

# Icon: build a .ico from the site's own icon (icons/icon-192.png), 256/48/32/16 px PNG entries.
$icoPath = Join-Path $PSScriptRoot 'app\poster.ico'
$src = Join-Path $town 'icons\icon-192.png'
$iconLocation = "$env:SystemRoot\System32\shell32.dll,13"
try {
  Add-Type -AssemblyName System.Drawing
  $img = [System.Drawing.Image]::FromFile($src)
  $entries = @()
  foreach ($size in 256, 48, 32, 16) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($img, 0, 0, $size, $size)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $entries += ,@($size, $ms.ToArray())
  }
  $img.Dispose()
  $out = New-Object System.IO.MemoryStream
  $w = New-Object System.IO.BinaryWriter $out
  $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$entries.Count)
  $offset = 6 + 16 * $entries.Count
  foreach ($e in $entries) {
    $s = $e[0]; $data = $e[1]
    $dim = if ($s -ge 256) { 0 } else { $s }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$data.Length); $w.Write([uint32]$offset)
    $offset += $data.Length
  }
  foreach ($e in $entries) { $w.Write([byte[]]$e[1]) }
  $w.Flush()
  [System.IO.File]::WriteAllBytes($icoPath, $out.ToArray())
  $iconLocation = "$icoPath,0"
} catch {
  Write-Warning "Could not make the icon, using the default one: $($_.Exception.Message)"
}

$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop $linkName
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($link)
$sc.TargetPath = $bat
$sc.WorkingDirectory = $town
$sc.WindowStyle = 7
$sc.IconLocation = $iconLocation
$sc.Description = 'Hajimarijima poster'
$sc.Save()
Write-Output "Shortcut created: $link"
