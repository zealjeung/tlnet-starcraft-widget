$ErrorActionPreference = 'Stop'
$app = "$env:LOCALAPPDATA\hermes\tlnet-widget"
$vbs = Join-Path $app 'launch-widget.vbs'
$icon = Join-Path $app 'assets\icon.png'
$ws = New-Object -ComObject WScript.Shell

function MakeLnk([string]$dir, [string]$name) {
  $target = Join-Path $dir ($name + '.lnk')
  $lnk = $ws.CreateShortcut($target)
  $lnk.TargetPath = 'wscript.exe'
  $lnk.Arguments = "`"$vbs`""
  $lnk.WorkingDirectory = $app
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = 'TL.net StarCraft / Brood War desktop widget'
  $lnk.WindowStyle = 7
  $lnk.Save()
  Write-Output "created: $target"
}

MakeLnk ([Environment]::GetFolderPath('Desktop')) 'TLnet StarCraft Widget'
MakeLnk ([Environment]::GetFolderPath('StartMenu')) 'TLnet StarCraft Widget'
