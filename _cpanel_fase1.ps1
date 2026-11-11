<#
  Fase 1 — READ-ONLY: validar que a API cPanel responde e descobrir o
  utilizador cPanel. Nao escreve nada no servidor.
  Saida: username em stdout se tudo OK; exit 2 = Imunify360 bloqueia.
#>
$ErrorActionPreference = 'Stop'
$cred  = 'c:\Users\CVF\Desktop\GitHub Projects\1\.cpanel-access.txt'
$tok   = ((Get-Content $cred | Where-Object { $_ -like 'TOKEN=*' }) -replace '^TOKEN=', '').Trim()
$b     = 'https://webdomain04.dnscpanel.com:2083'
$ua    = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function Pedir($url, $headers) {
  try {
    $r = Invoke-WebRequest -Uri $url -Headers $headers -SkipCertificateCheck -TimeoutSec 20 -UseBasicParsing
    return @{ code = [int]$r.StatusCode; body = [string]$r.Content }
  } catch {
    $code = 0
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    $msg = $_.ErrorDetails.Message; if (-not $msg) { $msg = $_.Exception.Message }
    return @{ code = $code; body = $msg }
  }
}

# --- 1. controlo sem auth: confirma se a Imunify360 ainda bloqueia esta IP ---
$controlo = Pedir "$b/execute/Auth/get_current_user" @{ Accept = 'application/json'; 'User-Agent' = $ua }
if ($controlo.body -match 'Imunify360') {
  Write-Output 'BLOCKED:Imunify360 bloqueia esta IP (mesmo sem credenciais — ver fase 1 corpo)'
  Write-Output $controlo.body
  exit 2
}

# --- 2. com o token (username desconhecido: formato cpanel :TOKEN e depois candidatos) ---
$TENTATIVAS = @('', 'root', 'cvfebres', 'cvf', 'webdomain04', 'admin')
foreach ($u in $TENTATIVAS) {
  $h = @{ Accept = 'application/json'; 'User-Agent' = $ua; Authorization = "cpanel ${u}:$tok" }
  $r = Pedir "$b/execute/Auth/get_current_user" $h
  if ($r.body -match 'Imunify360') {
    Write-Output 'BLOCKED:Imunify360 (com auth)'; Write-Output $r.body; exit 2
  }
  $json = $null
  try { $json = $r.body | ConvertFrom-Json } catch { }
  if ($r.code -eq 200 -and $json -and $json.metarecords -and $json.metarecords.result -eq 1) {
    $who = $json.data
    if (-not $who) { $who = $json.data.user }
    Write-Output "USER:$who"
    Write-Output "RAW:$($r.body)"
    exit 0
  }
  $det = ''
  if ($json -and $json.errors) { $det = ($json.errors | ForEach-Object { $_.message }) -join '; ' }
  if (-not $det) { $det = "HTTP $($r.code): $($r.body.Substring(0, [Math]::Min(200, $r.body.Length)))" }
  Write-Output "tentativa user='$u' -> $det"
}
exit 1
