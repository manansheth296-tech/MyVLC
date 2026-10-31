Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "M:\MyVLC\app"
WshShell.Run """M:\MyVLC\app\node_modules\electron\dist\electron.exe"" ""M:\MyVLC\app""", 0, False
