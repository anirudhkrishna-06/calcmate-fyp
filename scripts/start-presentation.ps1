param([string]$LanIp,[int]$ApiPort=8000,[int]$ExpoPort=8082,[switch]$CheckOnly)
$ErrorActionPreference='Stop'
$repoRoot=Split-Path -Parent $PSScriptRoot
$pythonPath=Join-Path $repoRoot 'venv\Scripts\python.exe'
$frontendPath=Join-Path $repoRoot 'frontend'
if(!(Test-Path -LiteralPath $pythonPath)){throw 'Create venv and install requirements.txt plus requirements-api.txt first. See docs/team-handover.md.'}
if(!(Test-Path -LiteralPath (Join-Path $frontendPath 'node_modules'))){throw 'Run npm.cmd ci in frontend first.'}
if($ApiPort -lt 1024 -or $ApiPort -gt 65535 -or $ExpoPort -lt 1024 -or $ExpoPort -gt 65535 -or $ApiPort -eq $ExpoPort){throw 'Choose distinct ports between 1024 and 65535.'}
if(!$LanIp){
  $addresses=@(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Loopback' })
  if($addresses.Count -ne 1){throw 'Choose your Wi-Fi IPv4 address using ipconfig, then run with -LanIp 192.168.1.100 (replace the example).'}
  $LanIp=$addresses[0].IPAddress
}
$parsedAddress=$null
if(![System.Net.IPAddress]::TryParse($LanIp,[ref]$parsedAddress) -or $parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or $LanIp -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'){throw 'Use the computer private Wi-Fi IPv4 address.'}
Write-Host "Phone server: http://${LanIp}:${ApiPort}"
Write-Host "Phone browser check: http://${LanIp}:${ApiPort}/health"
Write-Host "Admin inbox: http://localhost:${ApiPort}/admin"
Write-Host 'Admin password: admin123 (unless CALCMATE_ADMIN_PASSWORD is already set).'
Write-Host 'Phone: same Wi-Fi > scan Expo QR > Server connection > save the phone server address above.'
if($CheckOnly){Write-Host 'Setup validated; no processes started.';exit 0}
$env:CALCMATE_ALLOW_INSECURE_AUTH='true'
$env:PYTHONUTF8='1'
$env:PYTHONIOENCODING='utf-8'
if(!$env:CALCMATE_RAG_MODEL){$env:CALCMATE_RAG_MODEL='calcmate:latest'}
if(!$env:CALCMATE_GENERATION_TIMEOUT){$env:CALCMATE_GENERATION_TIMEOUT='180'}
$env:EXPO_PUBLIC_API_BASE_URL="http://${LanIp}:${ApiPort}"
$apiLog=Join-Path $repoRoot 'data\presentation-api.log'
$apiErrorLog=Join-Path $repoRoot 'data\presentation-api-error.log'
$probe=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any,$ApiPort)
try{$probe.Start()}catch{throw "API port $ApiPort is already in use. Stop that server or choose -ApiPort."}finally{$probe.Stop()}
$expoProbe=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any,$ExpoPort)
try{$expoProbe.Start()}catch{throw "Expo port $ExpoPort is already in use. Choose -ExpoPort."}finally{$expoProbe.Stop()}
$apiProcess=Start-Process -FilePath $pythonPath -ArgumentList @('-u','-m','src.api','--host','0.0.0.0','--port',"$ApiPort") -WorkingDirectory $repoRoot -RedirectStandardOutput $apiLog -RedirectStandardError $apiErrorLog -WindowStyle Hidden -PassThru
try{
  $ready=$false
  for($attempt=0;$attempt -lt 30;$attempt++){
    if($apiProcess.HasExited){throw "API stopped. Read $apiErrorLog"}
    try{Invoke-RestMethod "http://127.0.0.1:${ApiPort}/health" -TimeoutSec 5 | Out-Null;$ready=$true;break}catch{Start-Sleep -Milliseconds 500}
  }
  if(!$ready){throw "API did not start. Read $apiErrorLog"}
  Get-Content -LiteralPath $apiErrorLog | Where-Object { $_ -match 'administrator password|approval inbox' } | Write-Host
  Write-Host "API logs: $apiErrorLog"
  Push-Location -LiteralPath $frontendPath
  try{npm.cmd start -- --lan --port $ExpoPort}finally{Pop-Location}
}finally{if(!$apiProcess.HasExited){Stop-Process -Id $apiProcess.Id}}
