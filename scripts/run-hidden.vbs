' Runs its arguments as one command with no window. Task Scheduler + Windows Terminal (the default console host) still show a
' console for powershell.exe/node.exe even with -WindowStyle Hidden; wscript itself has no console.
' Usage: wscript.exe //B run-hidden.vbs <program> [args...]
Dim command, i
command = ""
For i = 0 To WScript.Arguments.Count - 1
  command = command & " """ & WScript.Arguments(i) & """"
Next
CreateObject("WScript.Shell").Run Trim(command), 0, False
