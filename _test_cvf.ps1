<#
  Testes do site CVF — READ-ONLY sobre o repositorio clonado.
  1. sintaxe do JS  2. refs locais do HTML existem  3. refs do CSS existem
  4. servidor local sobe e responde 200/404  5. HTML balanceado (tags basicas)
#>
$ErrorActionPreference = 'Stop'
$root = 'c:\Users\CVF\Desktop\GitHub Projects\1\cvf_website'
Set-Location $root
$falhas = 0
function OK($m)   { Write-Output "  OK    $m" }
function Falha($m) { Write-Output "  FALHA $m"; $script:falhas++ }

Write-Output '=== 1. Sintaxe do JS ==='
node --check js/main.js
if ($LASTEXITCODE -eq 0) { OK 'js/main.js compila' } else { Falha 'js/main.js tem erro de sintaxe' }

Write-Output '=== 2. Referencias locais do HTML ==='
$html = Get-Content index.html -Raw
# tirar comentarios HTML primeiro: as fotos de equipa estao comentadas de proposito
$htmlSemComentarios = [regex]::Replace($html, '<!--[\s\S]*?-->', '')
$refs = [regex]::Matches($htmlSemComentarios, '(?:href|src)="(?!https?:|mailto:|tel:|#|data:)([^"]+)"') |
  ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
$faltam = 0
foreach ($r in $refs) {
  $p = Join-Path $root ($r -replace '/', '\')
  if (-not (Test-Path $p)) { Falha "HTML referencia inexistente: $r"; $faltam++ }
}
if (-not $faltam) { OK "todos os $($refs.Count) refs locais do HTML existem" }

Write-Output '=== 3. Referencias url() do CSS ==='
$css = Get-Content css/style.css -Raw
$urls = [regex]::Matches($css, 'url\(([^)]+)\)') |
  ForEach-Object { ($($_.Groups[1].Value) -replace "['`"]", '').Trim() } |
  Where-Object { $_ -notmatch '^https?:' } | Sort-Object -Unique
if (-not $urls) { OK 'CSS nao tem url() locais (so fontes externas)' }
foreach ($u in $urls) {
  $p = Join-Path (Join-Path $root 'css') ($u -replace '/', '\')
  if (Test-Path $p) { OK "css url() existe: $u" } else { Falha "css url() em falta: $u" }
}

Write-Output '=== 4. Servidor local (node) ==='
$srvJs = Join-Path $env:TEMP 'cvf_static_srv.js'
@'
const http = require("http"), fs = require("fs"), path = require("path");
const root = process.argv[2], port = Number(process.argv[3]);
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain" };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = path.join(root, p);
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("404"); return; }
    res.writeHead(200, { "Content-Type": mime[path.extname(f)] || "application/octet-stream" });
    res.end(d);
  });
}).listen(port, "127.0.0.1", () => console.log("ready"));
'@ | Set-Content $srvJs -Encoding UTF8
# ArgumentList nao cita paths com espacos: passar ja com aspas embutidas
$proc = Start-Process -FilePath 'node' -ArgumentList "`"$srvJs`" `"$root`" 8931" -PassThru -WindowStyle Hidden
# espera ativa pelo readiness em vez de sleep fixo
$pronto = $false
for ($i = 0; $i -lt 20 -and -not $pronto; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8931/robots.txt' -TimeoutSec 3 -UseBasicParsing
    if ($r.StatusCode -eq 200) { $pronto = $true }
  } catch { }
}
if (-not $pronto) { Falha 'servidor local nao arrancou em 10s' }
try {
  foreach ($t in @(@('/', 'index'), @('/404.html', '404'), @('/css/style.css', 'css'), @('/js/main.js', 'js'), @('/robots.txt', 'robots'), @('/nope.html', 'inexistente'), @('/assets/cvf-logo.svg', 'logo'), @('/.htaccess', 'oculto'))) {
    try {
      $r = Invoke-WebRequest -Uri ("http://127.0.0.1:8931" + $t[0]) -TimeoutSec 10 -UseBasicParsing
      if ($t[1] -eq 'inexistente') { Falha "$($t[0]) devolveu $($r.StatusCode) (esperado 404)" }
      else { OK "$($t[0]) -> $($r.StatusCode) ($($t[1]))" }
    } catch {
      $code = 0
      if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
      if ($t[1] -eq 'inexistente' -and $code -eq 404) { OK "$($t[0]) -> 404 como esperado" }
      elseif ($t[1] -eq 'oculto' -and $code -eq 404) { OK "$($t[0]) -> 404 (o servidor local nao serve ficheiros ocultos; no Apache o Options -Indexes do .htaccess trata-o)" }
      elseif ($code) { Falha "$($t[0]) -> $code" }
      else { Falha "$($t[0]) sem resposta: $($_.Exception.Message)" }
    }
  }
} finally {
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
}

Write-Output '=== 5. HTML: tags basicas balanceadas ==='
foreach ($t in @('section', 'div', 'a', 'ul', 'li', 'nav', 'header', 'footer', 'h1', 'h2', 'h3')) {
  $abertas = ([regex]::Matches($html, "<$t(\s|>)")).Count
  $fechadas = ([regex]::Matches($html, "</$t>")).Count
  if ($abertas -eq $fechadas) { OK "<$t> balanceado ($abertas)" }
  else { Falha "<$t>: $abertas abertas vs $fechadas fechadas" }
}

Write-Output '=== 6. Assets referenciados vs lista do build ==='
# Regressao: cvf-mark.svg faltava na lista do build e chegava ao servidor
# como 404. O proprio build agora lanca excecao, mas este teste apanha o
# mesmo problema sem depender do ficheiro de build.
$refs = [regex]::Matches($htmlSemComentarios, '(?:href|src)="((?:assets|css|js)/[^"]+)"') |
  ForEach-Object { $_.Groups[1].Value -replace '/', '\' } | Sort-Object -Unique
$listaBuild = (Get-Content (Join-Path (Split-Path $root -Parent) '_build_cvf_deploy.ps1') -Raw)
foreach ($r in $refs) {
  if ($listaBuild -match [regex]::Escape($r)) { OK "$r referenciado e incluido no build" }
  else { Falha "$r referenciado no HTML mas NAO esta na lista do build (daria 404 no servidor)" }
}

Write-Output '=== 7. Higiene: emojis e classes CSS mortas ==='
# O DESIGN.md manda usar SVGs, nao emojis.
$emojis = [regex]::Matches($html, '[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF\uFE0F]')
if ($emojis.Count -eq 0) { OK 'nenhum emoji no index.html (DESIGN.md cumprido)' }
else { Falha "$($emojis.Count) emoji(s) no index.html: $((($emojis | ForEach-Object Value) | Select-Object -Unique) -join ' ')" }
$classes = [regex]::Matches($css, '\.([a-zA-Z][a-zA-Z0-9_-]*)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
# As classes podem vir de qualquer pagina do site, nao so do index (page-404
# so existe no 404.html), por isso o HTML comparado e a concatenacao das duas.
$jsTxt = Get-Content js/main.js -Raw
$htmlTodo = $html + (Get-Content 404.html -Raw)
$mortas = @($classes | Where-Object { $htmlTodo -notmatch [regex]::Escape($_) -and $jsTxt -notmatch [regex]::Escape($_) })
if ($mortas.Count) { Falha "classes CSS sem uso: $($mortas -join ', ')" }
else { OK "nenhum CSS morto ($($classes.Count) classes, todas em uso)" }

Write-Output ''
Write-Output "FALHAS:$falhas"
exit $(if ($falhas) { 1 } else { 0 })
