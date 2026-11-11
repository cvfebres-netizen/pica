# Deploy do site CVF para cPanel — Guia rápido

Pacote: **`CVF_Website_deploy.zip`** (24 KB, 29 ficheiros)
Testado localmente: sintaxe JS OK · todas as referências existem · servidor
local responde 200 para `/`, `index.html`, CSS, JS, SVG, robots · 404 devolve
404 · HTML balanceado.

## Opcao C — Git Version Control (RECOMENDADA — sem whitelist, sem API)

O ficheiro **`.cpanel.yml` está no topo do repo**
(`cvfebres-netizen/cvf_website`, commit `ef77c6a`, verificado via raw):

- YAML validado (`js-yaml`): estrutura `deployment.tasks`, 9 comandos bash
- Lógica validada num sandbox bash: overwrite de versão antiga, `.htaccess`
  copiado sem wildcards, sem `.git`/docs/screenshots no docroot, verificação
  pós-deploy — 13/13 OK
- Funciona porque **o cPanel puxa do GitHub no próprio servidor** — nem a
  Imunify360 local nem nenhum token entram no caminho.

### Como fazer deploy (5–10 min, no browser do cPanel)

1. cPanel → **Files → Git Version Control**.
2. Se `cvf_website` **ainda não** está lá: **Create** →
   *Clone a Repository*, URL
   `https://github.com/cvfebres-netizen/cvf_website.git`, branch `main`,
   **Repository Path: `~/cvf_website`** (uma pasta FORA de `public_html` —
   **nunca** clonar dentro do docroot, senão o `.git` e o TODO ficariam
   públicos).
3. Abrir **Manage** do repo → separador **Pull or Deploy** →
   **Update from Remote** → **Deploy HEAD Commit**.
4. O painel mostra o log: `DEPLOY -> /home/…/public_html` + listagem.
5. Verificar: `https://cvfebres.pt/` (200) e `/nao-existe` (404 com a pata).

Cada `git push` futuro para o GitHub é deployável pelo mesmo botão
(**Update from Remote** → **Deploy HEAD Commit**) — publicar sem tocar na
Imunify360.

## Opção A — Automatizado via API cPanel ( GUARDÃO PRONTO )

> Redundante agora que a Opção C existe: a Opção C faz o mesmo sem precisar
> da whitelist. Mantida como fallback caso a GIT Version Control indisponível.

O token está em `.cpanel-access.txt` (gitignored, **nunca** versionar).
Os scripts também não versionam o token — leem-no desse ficheiro.

**Estado: BLOQUEADO pela Imunify360 (confirmado 2×).** Todas as chamadas
desta máquina recebem `403 Access denied by Imunify360 bot-protection` —
até pedidos sem credenciais. O bloqueio acontece **antes** de o token ser
avaliado; não há bypass legítimo além do whitelisting.

### Passo 1 — pedir whitelisting (fazer já)

Enviar ao admin/hosting (ex.: suporte da dnscpanel):

> Please whitelist IP **144.64.61.137** in Imunify360 bot-protection for
> cPanel on **webdomain04.dnscpanel.com:2083**. We are calling the cPanel
> UAPI (Fileman upload/extract) from this IP to deploy a static site.
> Without whitelisting, every request — including unauthenticated ones —
> returns `403 Access denied by Imunify360 bot-protection`.

### Passo 2 — depois de whitelizar, CORRER (2 comandos)

```powershell
# pré-voo (read-only: descobre username + docroot, não escreve)
pwsh -File _cpanel_fase2.ps1

# deploy (upload → extract → verifica ficheiros → testa HTTP → limpa zip)
pwsh -File _cpanel_fase2.ps1 -Apply
```

O script `_cpanel_fase2.ps1` faz tudo:

1. `Auth/get_current_user` — descobre o utilizador cPanel (testa candidatos)
2. Localiza o docroot certo (`/home/<user>/public_html` ou
   `/home/<user>/domains/cvfebres.pt/public_html`)
3. Inventaria o que já existe **antes** de escrever (log em `EXISTIA_ANTES`)
4. `Fileman/upload_files` → `Fileman/extract_archive` (overwrite)
5. Verifica `index.html`, `.htaccess`, `404.html`, `css/`, `js/`, `assets/`,
   `robots.txt` no servidor
6. Remove o zip do servidor
7. Testa `https://cvfebres.pt/` (esperado 200) e `/nao-existe` (esperado 404)

**Nota:** se a autenticação falhar depois do whitelisting, o username está
errado — verificá-lo em cPanel → *Manage API Tokens* (o token foi criado
para que utilizador?) e acrescentá-lo à lista `@(...)` no início do script.

### Enquanto não houver whitelisting — Opção B

## Opção B — Manual pelo Gestor de Ficheiros (5 minutos, funciona já)

1. Abrir `https://webdomain04.dnscpanel.com:2083` (a sessão `cpsess…` da URL
   que tens é temporária — se expirar, entrar com utilizador/password).
2. **File Manager** → `public_html` (ou a pasta do domínio `cvfebres.pt`).
3. **Upload** → escolher `CVF_Website_deploy.zip` → **Extract** (extrai na
   raiz; o zip já tem `index.html` no topo, não cria pasta extra).
4. Confirmar que `.htaccess` foi extraído (ativar *Show Hidden Files* em
   *Settings* do File Manager — sem ele não há compressão, cache nem 404).
5. **SSL:** cPanel → SSL/TLS Status → **Run AutoSSL** para `cvfebres.pt`.
6. Testar: `https://cvfebres.pt/` · `https://cvfebres.pt/qualquer-coisa`
   (deve mostrar a 404 com o pata 🐾) · devtools → Network deve mostrar
   `content-encoding: gzip` nos CSS/JS (compressão ativa).

## Não enviar para o servidor

`.git`, `.gitignore`, `README.md`, `DESIGN.md`, `TODO.md`,
`screen_capture.png`, `screen_top.png` — documentação interna (o `TODO.md`
contém paths da máquina). O zip já os exclui de forma verificada.

## Âncoras do site (conteúdo — não é deploy)

- `index.html` usa o calendário `55Sj79jdXTr2XAPs8`; o `README.md` documenta
  `Uaw77m7sHrMKP4NZ9`. **Ambos funcionam** (testados — dois calendários
  distintos). Confirmar com o cliente qual é o oficial e alinhar o outro.
- O formulário de contacto é um embed demonstrativo (nota no README:
  backend/email por configurar).
- Canonical/OG apontam para `https://cvfebres.pt/` — o domínio tem de apontar
  para este hosting (DNS A record) antes do AutoSSL poder emitir o certificado.
