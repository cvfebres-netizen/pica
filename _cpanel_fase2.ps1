<#
  FASE 2 — deploy do site CVF via API cPanel (Opção A).
  PRÉ-REQUISITO: a IP desta máquina (144.64.61.137) whitelizada na Imunify360.

    Pré-voo (não escreve):  pwsh -File _cpanel_fase2.ps1
    Deploy (escreve):       pwsh -File _cpanel_fase2.ps1 -Apply
#>
param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$root  = 'c:\Users\CVF\Desktop\GitHub Projects\1'
$cred  = Join-Path $root '.cpanel-access.txt'
$zip   = Join-Path $root 'CVF_Website_deploy.zip'
$tok   = ((Get-Content $cred | Where-Object { $_ -like 'TOKEN=*' }) -replace '^TOKEN=', '').Trim()
if (-not $tok) { throw 'TOKEN nao encontrado em .cpanel-access.txt' }
if (-not (Test-Path $zip)) { throw 'Zip de deploy nao encontrado' }
$b = 'https://webdomain04.dnscpanel.com:2083'
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function Api($caminho, $qs) {
  $h = @{ Accept = 'application/json'; 'User-Agent' = $ua; Authorization = $script:auth }
  $url = "$b/execute/$caminho"
  if ($qs) { $url += '?' + $qs }
  try {
    $r = Invoke-WebRequest -Uri $url -Headers $h -SkipCertificateCheck -TimeoutSec 30 -UseBasicParsing
    return @{ code = [int]$r.StatusCode; body = [string]$r.Content }
  } catch {
    $code = 0
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    $msg = $_.ErrorDetails.Message; if (-not $msg) { $msg = $_.Exception.Message }
    return @{ code = $code; body = $msg }
  }
}
function Json($r) { try { return ($r.body | ConvertFrom-Json) } catch { return $null } }
function Parar($msg) { Write-Output "ERRO: $msg"; exit 1 }

# ---------- 0. utilizador cPanel ----------
$quem = $null
foreach ($u in @('', 'root', 'cvfebres', 'cvf', 'webdomain04', 'admin')) {
  $script:auth = "cpanel ${u}:$tok"
  $r = Api 'Auth/get_current_user'
  if ($r.body -match 'Imunify360') { Parar "Imunify360 ainda bloqueia esta IP — whitelizar e voltar a correr. $($r.body)" }
  $j = Json $r
  if ($r.code -eq 200 -and $j -and $j.metarecords -and $j.metarecords.result -eq 1) {
    $quem = $j.data
    if ($quem -is [array]) { $quem = $quem[0] }
    break
  }
}
if (-not $quem) { Parar 'nenhum username candidato autenticou — descobrir o username certo (nota no fim)' }
Write-Output "UTILIZADOR_CPanel=$quem"
$script:auth = "cpanel ${quem}:$tok"

# ---------- 1. docroot do dominio ----------
$docroots = @("/home/$quem/public_html")
$casa = Json (Api 'Fileman/list_files' "dir=$([uri]::EscapeDataString('/home/' + $quem))&omitempty=1")
if ($casa -and $casa.data -and (($casa.data | ForEach-Object { $_.name }) -contains 'domains')) {
  $d = Json (Api 'Fileman/list_files' "dir=$([uri]::EscapeDataString('/home/' + $quem + '/domains'))&omitempty=1")
  if ($d -and $d.data) {
    foreach ($x in $d.data) {
      if ($x.name -match 'cvfebres') { $docroots = @("/home/$quem/domains/$($x.name)/public_html", "/home/$quem/public_html") }
    }
  }
}
$docroot = $null
foreach ($cand in $docroots) {
  $l = Json (Api 'Fileman/list_files' "dir=$([uri]::EscapeDataString($cand))&omitempty=1")
  if ($l -and $l.metarecords -and $l.metarecords.result -eq 1) { $docroot = $cand; break }
}
if (-not $docroot) { Parar "docroot nao listavel: $($docroots -join ', ')" }
Write-Output "DOCROOT=$docroot"

# ---------- 2. inventario antes ----------
$antes = Json (Api 'Fileman/list_files' "dir=$([uri]::EscapeDataString($docroot))&omitempty=1")
$antesNomes = @()
if ($antes -and $antes.data) { $antesNomes = @($antes.data | ForEach-Object { $_.name }) }
Write-Output "EXISTIA_ANTES=$($antesNomes.Count): $($antesNomes -join ', ')"

if (-not $Apply) {
  Write-Output 'MODO=leitura (pre-voo OK) — repetir com -Apply para carregar e extrair'
  exit 0
}

# ---------- 3. upload do zip ----------
Write-Output 'A carregar CVF_Website_deploy.zip ...'
try {
  $form = @{ dir = $docroot; file = Get-Item $zip }
  $up = Invoke-WebRequest -Uri "$b/execute/Fileman/upload_files" -Method Post -Form $form `
    -Headers @{ Accept = 'application/json'; 'User-Agent' = $ua; Authorization = $script:auth } `
    -SkipCertificateCheck -TimeoutSec 120 -UseBasicParsing
  $upJ = $null; try { $upJ = ($up.Content | ConvertFrom-Json) } catch { }
  if ($upJ -and $upJ.metarecords -and $upJ.metarecords.result -eq 0) {
    Parar "upload recusado: $((($upJ.errors | ForEach-Object { $_.message }) -join '; '))"
  }
  Write-Output "upload -> HTTP $($up.StatusCode)"
} catch {
  $code = 0; if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
  $msg = $_.ErrorDetails.Message; if (-not $msg) { $msg = $_.Exception.Message }
  Parar "upload falhou (HTTP $code): $msg"
}

# ---------- 4. extrair ----------
Write-Output 'A extrair ...'
$zipServidor = "$docroot/CVF_Website_deploy.zip"
$ex = Api 'Fileman/extract_archive' ("dir=$([uri]::EscapeDataString($docroot))&file=$([uri]::EscapeDataString($zipServidor))&overwrite=1")
$exJ = Json $ex
if ($exJ -and $exJ.metarecords -and $exJ.metarecords.result -eq 0) {
  Parar "extracao recusada: $((($exJ.errors | ForEach-Object { $_.message }) -join '; '))"
}
Write-Output "extracao -> HTTP $($ex.code)"

# ---------- 5. verificar no servidor ----------
$dep = Json (Api 'Fileman/list_files' "dir=$([uri]::EscapeDataString($docroot))&omitempty=1")
$nomes = @(); if ($dep -and $dep.data) { $nomes = @($dep.data | ForEach-Object { $_.name }) }
$falhas = 0
foreach ($f in @('index.html', '.htaccess', '404.html', 'css', 'js', 'assets', 'robots.txt')) {
  if ($nomes -contains $f) { Write-Output "  OK   $f no servidor" }
  else { Write-Output "  FALHA $f AUSENTE"; $falhas++ }
}
# limpar o zip do servidor
Api 'Fileman/delete_files' ("dir=$([uri]::EscapeDataString($docroot))&files=$([uri]::EscapeDataString('CVF_Website_deploy.zip'))") | Out-Null
Write-Output 'zip removido do servidor'

# ---------- 6. resposta HTTP publica ----------
foreach ($u in @('https://cvfebres.pt/', 'https://cvfebres.pt/nao-existe')) {
  try {
    $r = Invoke-WebRequest -Uri $u -TimeoutSec 20 -UseBasicParsing -MaximumRedirection 5
    Write-Output "HTTP $u -> $($r.StatusCode)"
  } catch {
    $code = 0; if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if ($u -like '*nao-existe*' -and $code -eq 404) { Write-Output "HTTP $u -> 404 (esperado)" }
    elseif ($code) { Write-Output "HTTP $u -> $code" }
    else { Write-Output "HTTP $u sem resposta (DNS/SSL?): $($_.Exception.Message)" }
  }
}
Write-Output "FALHAS_VERIFICACAO:$falhas"
exit $(if ($falhas) { 1 } else { 0 })
