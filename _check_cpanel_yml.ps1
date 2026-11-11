<#
  Verifica .cpanel.yml contra as regras oficiais do cPanel
  (Guide to Git - Deployment) + coerencia com este repo.
  Sai com FALHAS:N (0 = ok).
#>
$ErrorActionPreference = 'Stop'
$root = 'c:\Users\CVF\Desktop\GitHub Projects\1\cvf_website'
$f = Join-Path $root '.cpanel.yml'
$falhas = 0
function OK($m)    { Write-Output "  OK    $m" }
function Falha($m) { Write-Output "  FALHA $m"; $script:falhas++ }

Write-Output '=== A. Regras oficiais do cPanel ==='
if (-not (Test-Path $f)) { Falha '.cpanel.yml nao existe'; exit 1 }
$t = Get-Content $f -Raw -Encoding UTF8

if ($t -match '(?m)^---\s*$') { OK 'comeca com --- (documento YAML)' }
else { Falha 'falta o --- inicial' }

# tasks: extrair as linhas de comando (itens - '...')
$cmds = [regex]::Matches($t, "(?m)^\s*-\s*'(.*)'\s*$") | ForEach-Object { $_.Groups[1].Value }
if ($t -match '(?m)^deployment:\s*$' -and $t -match '(?m)^\s+tasks:\s*$' -and $cmds.Count -ge 1) {
  OK "estrutura deployment.tasks com $($cmds.Count) comandos"
} else { Falha 'estrutura deployment/tasks invalida ou vazia' }

# SEM wildcards (aviso oficial: copiaria o .git para o docroot)
$textoCmds = ($cmds -join "`n")
# um * fora de quotes/comentarios seria deploy de tudo
$linhasRisco = @()
foreach ($c in $cmds) {
  $despido = $c -replace '"[^"]*"', ''
  if ($despido -match '\*') { $linhasRisco += $c }
}
if (-not $linhasRisco) { OK 'nenhum wildcard * nos comandos' }
else { $linhasRisco | ForEach-Object { Falha "wildcard *: $_" } }

# caracteres problematicos em YAML plain scalar: ': ' (colon-espaco), tab
$maus = @()
foreach ($c in $cmds) {
  if ($c -match "`t") { $maus += "TAB em: $c" }
  if ($c -match ': ') { $maus += "': ' em: $c" }
}
if (-not $maus) { OK 'sem tabs nem ": " nos comandos' }
else { $maus | ForEach-Object { Falha $_ } }

# single quotes internos quebrariam o scalar '...': nenhum pode ter '
$asp = $cmds | Where-Object { $_ -match "'" }
if (-not $asp) { OK 'sem aspas simples internas' }
else { $asp | ForEach-Object { Falha "aspa simples: $_" } }

Write-Output '=== B. Coerencia com este repo ==='
Push-Location $root
try {
  # todas as fontes copiadas existem no repo
  $fontes = @()
  foreach ($c in $cmds) {
    if ($c -match '^/bin/cp -fR? (.+?) "\$DEPLOYPATH"') {
      $fontes += ($Matches[1] -split '\s+')
    }
  }
  $faltam = 0
  foreach ($s in $fontes) {
    if (Test-Path (Join-Path $root ($s -replace '/', '\'))) { OK "fonte existe no repo: $s" }
    else { Falha "fonte em FALTA no repo: $s"; $faltam++ }
  }
  if (-not $fontes) { Falha 'nenhuma fonte detetada nos comandos cp' }

  # .git NUNCA pode ser fonte
  if ($textoCmds -match '(?i)\.git') { Falha '.git referenciado nos comandos!' }
  else { OK '.git nunca e fonte de copia' }

  # README/DESIGN/TODO e PNGs nao vao para o servidor
  $docOK = $true
  foreach ($d in @('README.md', 'DESIGN.md', 'TODO.md', 'screen_capture.png', 'screen_top.png')) {
    if ($textoCmds -match [regex]::Escape($d)) { Falha "documentacao interna no deploy: $d"; $docOK = $false }
  }
  if ($docOK) { OK 'docs internas e screenshots ficam no repo' }

  # working tree limpo (exigencia oficial)
  $suja = git status --porcelain 2>$null | Where-Object { $_ -notmatch '^\?\?' }
  if (-not $suja) { OK 'working tree de ficheiros versionados limpo' }
  else { Falha "working tree sujo: $($suja -join ' | ')" }

  # .cpanel.yml esta commitado e no topo (raiz do repo)
  $topo = git ls-tree --name-only HEAD 2>$null
  if ($topo -contains '.cpanel.yml') { OK '.cpanel.yml commitado no topo do repo' }
  else { Falha '.cpanel.yml NAO esta commitado no topo' }

  # ficheiros de origem sao os tracked (cPanel corre sobre o clone: so tracked chegam la)
  $tr = git ls-files; $naoTr = 0
  foreach ($s in ($fontes | Where-Object { $_ -notmatch '^\.' })) {
    # diretorios: pelo menos um ficheiro tracked la dentro
    $dentro = $tr | Where-Object { $_ -eq $s -or $_ -like "$s/*" }
    if ($dentro) { OK "tracked: $s ($($dentro.Count) entradas)" }
    else { Falha "NAO tracked (o clone do cPanel nao teria): $s"; $naoTr++ }
  }
  # o .htaccess tambem tem de ser tracked
  if ($tr -contains '.htaccess') { OK 'tracked: .htaccess' } else { Falha '.htaccess NAO tracked' }
} finally { Pop-Location }

Write-Output ''
Write-Output "FALHAS:$falhas"
exit $(if ($falhas) { 1 } else { 0 })
