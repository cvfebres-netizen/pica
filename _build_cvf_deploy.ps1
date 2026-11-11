<#
  Constroi o pacote de deploy para cPanel: CVF_Website_deploy.zip
  - raiz do zip = ficheiros do site (extrai direto em public_html)
  - INCLUI .htaccess (critico: compressao, cache, 404, Options -Indexes)
  - EXCLUI .git, .gitignore, README/DESIGN/TODO e screenshots (documentacao
    interna — o TODO.md tem paths da maquina que nao devem ser publicos)
#>
$ErrorActionPreference = 'Stop'
$root = 'c:\Users\CVF\Desktop\GitHub Projects\1\cvf_website'
$out  = 'c:\Users\CVF\Desktop\GitHub Projects\1\CVF_Website_deploy.zip'

$incluir = @(
  'index.html', '404.html', 'robots.txt', 'sitemap.xml', 'site.webmanifest',
  '.htaccess', '.nojekyll',
  'css\style.css', 'js\main.js',
  'assets\cvf-logo.svg', 'assets\cvf-mark.svg', 'assets\favicon.svg'
)
$incluir += Get-ChildItem (Join-Path $root 'assets\icons') -File | ForEach-Object { 'assets\icons\' + $_.Name }

# O zip tem de conter TODOS os assets referenciados no HTML.
# Bug anterior: cvf-mark.svg faltava aqui e o logotipo da nav chegava
# ao servidor como 404. Esta verificacao impede a repeticao.
# NOTA: os comentarios HTML sao removidos antes de procurar — as fotos de
# assets/team/*.jpg estao referenciadas dentro de <!-- --> (bloqueadas de
# proposito) e nao devem obrigar a entrar no zip.
$htmlCru = Get-Content (Join-Path $root 'index.html') -Raw
$htmlSemComentarios = [regex]::Replace($htmlCru, '(?s)<!--.*?-->', '')
$htmlRefs = [regex]::Matches($htmlSemComentarios, '(?:href|src)="((?:assets|css|js)/[^"]+)"') |
  ForEach-Object { $_.Groups[1].Value -replace '/', '\' } | Sort-Object -Unique
foreach ($r in $htmlRefs) {
  if ($incluir -notcontains $r) {
    throw "BUILD INCOMPLETO: '$r' e referenciado no index.html mas nao vai no zip"
  }
}
Write-Output "refs do HTML verificados contra a lista do zip: $($htmlRefs.Count) OK"

$existe = 0; $falta = 0
foreach ($f in $incluir) {
  if (Test-Path (Join-Path $root $f)) { $existe++ } else { Write-Output "FALTA: $f"; $falta++ }
}
if ($falta) { throw "$falta ficheiros em falta" }

if (Test-Path $out) { Remove-Item $out -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
try {
  foreach ($f in $incluir) {
    $src = Join-Path $root $f
    # extensao zip: separador normalizado para /
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, $src, ($f -replace '\\', '/'),
      [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $zip.Dispose() }

# verificacao: listar o que o zip contem e confirmar o .htaccess
$zip2 = [System.IO.Compression.ZipFile]::OpenRead($out)
try {
  Write-Output "=== CONTEUDO DO ZIP ($($zip2.Entries.Count) entradas, $([math]::Round((Get-Item $out).Length/1KB,1)) KB) ==="
  $zip2.Entries | Sort-Object FullName | ForEach-Object { Write-Output ('  ' + $_.FullName + '  [' + [math]::Round($_.Length/1KB,1) + ' KB]') }
  $temHt = $zip2.Entries | Where-Object { $_.FullName -eq '.htaccess' }
  $temIdx = $zip2.Entries | Where-Object { $_.FullName -eq 'index.html' }
  if (-not $temHt)  { throw 'ZIP SEM .htaccess' }
  if (-not $temIdx) { throw 'ZIP SEM index.html' }
  $temDocs = $zip2.Entries | Where-Object { $_.FullName -match 'TODO|README|DESIGN|screen_|\.git' }
  if ($temDocs)     { throw 'ZIP CONTEM documentacao interna: ' + ($temDocs.FullName -join ', ') }
  Write-Output 'VERIFICACAO: OK (.htaccess e index.html presentes, documentacao interna ausente)'
} finally { $zip2.Dispose() }
Write-Output "OUT=$out"
