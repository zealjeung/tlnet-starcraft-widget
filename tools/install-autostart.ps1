#Requires -Version 5.1
<#
  Registers the TL.net widget to start at every Windows logon.

  Why a Scheduled Task instead of the Startup folder:
    * Startup-folder shortcuts fire before the network stack is reliably up,
      so the first fetch fails and the widget sits empty.
    * They can be silently disabled from Task Manager > Startup.
    * They have no retry if the launch fails.
  A task gives us: 45s delay, RunOnlyIfNetworkAvailable, restart-on-failure,
  and a 15-minute watchdog that relaunches the widget if it ever dies.
#>

$ErrorActionPreference = 'Stop'

$app      = "$env:LOCALAPPDATA\hermes\tlnet-widget"
$electron = Join-Path $app 'node_modules\electron\dist\electron.exe'
$vbs      = Join-Path $app 'launch-widget.vbs'
$guard    = Join-Path $app 'watchdog.vbs'

if (-not (Test-Path $electron)) { throw "electron.exe not found at $electron" }

# --- launcher (no console flash) ---
@"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$app"
sh.Run """$electron"" .", 0, False
"@ | Set-Content -Path $vbs -Encoding ASCII

# --- watchdog: relaunch only if not already running ---
@"
Set svc = GetObject("winmgmts:\\.\root\cimv2")
Set procs = svc.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='electron.exe'")
found = False
For Each p In procs
  If Not IsNull(p.CommandLine) Then
    If InStr(LCase(p.CommandLine), LCase("tlnet-widget")) > 0 Then found = True
  End If
Next
If Not found Then
  Set sh = CreateObject("WScript.Shell")
  sh.CurrentDirectory = "$app"
  sh.Run """$electron"" .", 0, False
End If
"@ | Set-Content -Path $guard -Encoding ASCII

$taskName  = 'TLnet StarCraft Widget'
$guardName = 'TLnet StarCraft Widget Watchdog'

foreach ($n in @($taskName, $guardName)) {
  if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $n -Confirm:$false
  }
}

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

# 45s delay: lets Windows finish bringing up the network before first fetch.
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = 'PT45S'

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`"" -WorkingDirectory $app

Register-ScheduledTask -TaskName $taskName -Trigger $trigger -Action $action `
  -Settings $settings -Description 'TL.net StarCraft / Brood War desktop widget' `
  -RunLevel Limited | Out-Null

# --- watchdog task: every 15 min, relaunch if dead ---
# Repetition duration must be an indefinite ("") duration, NOT TimeSpan::MaxValue
# — that serialises to P99999999DT23H59M59S which the task scheduler rejects.
$gTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$gTrigger.Delay = 'PT5M'
$gRepeat = (New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 15)).Repetition
$gRepeat.Duration = ''
$gTrigger.Repetition = $gRepeat

$gAction = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$guard`"" -WorkingDirectory $app

Register-ScheduledTask -TaskName $guardName -Trigger $gTrigger -Action $gAction `
  -Settings $settings -Description 'Relaunches the TL.net widget if it stops running' `
  -RunLevel Limited | Out-Null

# --- remove the old Startup-folder shortcut it replaces ---
$oldLnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'TLnet StarCraft Widget.lnk'
if (Test-Path $oldLnk) { Remove-Item $oldLnk -Force; Write-Output "removed old startup shortcut" }

Write-Output "--- registered ---"
Get-ScheduledTask -TaskName $taskName, $guardName |
  Select-Object TaskName, State |
  Format-Table -AutoSize | Out-String -Width 200
