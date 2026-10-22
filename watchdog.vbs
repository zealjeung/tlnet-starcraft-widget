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
  sh.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
  sh.Run """" & sh.CurrentDirectory & "\node_modules\electron\dist\electron.exe"" .", 0, False
End If
