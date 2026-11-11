#!/bin/bash
# Sandbox: simula o .cpanel.yml exatamente como o cPanel o correria.
# Cria um $HOME falso, corre os tasks da YAML e verifica o resultado.
set -u
REPO="$(cd "$(dirname "$0")/cvf_website" && pwd)"
export HOME_FAKE="$(mktemp -d)"
mkdir -p "$HOME_FAKE/public_html"
# docroot fake pre-existente com um ficheiro antigo (prova de overwrite)
echo "<html>versao antiga</html>" > "$HOME_FAKE/public_html/index.html"
echo "lixo-de-antes" > "$HOME_FAKE/public_html/antigo.html"

cd "$REPO"
# ---- BEGIN tasks (copiados da YAML, com $HOME substituido pelo sandbox) ----
export HOME="$HOME_FAKE"
if [ -d "$HOME/domains/cvfebres.pt/public_html" ]; then export DEPLOYPATH="$HOME/domains/cvfebres.pt/public_html"; else export DEPLOYPATH="$HOME/public_html"; fi
echo "DEPLOY -> $DEPLOYPATH"
test -d "$DEPLOYPATH" || { echo "FALHA: docroot nao existe"; exit 1; }
/bin/cp -f index.html 404.html robots.txt .htaccess "$DEPLOYPATH" || exit 1
/bin/cp -fR css "$DEPLOYPATH" || exit 1
/bin/cp -fR js "$DEPLOYPATH" || exit 1
/bin/cp -fR assets "$DEPLOYPATH" || exit 1
test -f "$DEPLOYPATH/index.html" && test -f "$DEPLOYPATH/.htaccess" || { echo "FALHA: verificacao pos-deploy"; exit 1; }
# ---- END tasks ----

echo "=== CONTEUDO DO DOCROOT ==="
ls -la "$DEPLOYPATH"
falhas=0
verificar() { if eval "$2"; then echo "  OK   $1"; else echo "  FALHA $1"; falhas=$((falhas+1)); fi; }
verificar "index.html substituiu a versao antiga (nao contem 'versao antiga')" "! grep -q 'versao antiga' '$DEPLOYPATH/index.html'"
verificar ".htaccess copiado (hidden file, sem wildcard)" "[ -f '$DEPLOYPATH/.htaccess' ]"
verificar "404.html copiado" "[ -f '$DEPLOYPATH/404.html' ]"
verificar "robots.txt copiado" "[ -f '$DEPLOYPATH/robots.txt' ]"
verificar "css/style.css copiado" "[ -f '$DEPLOYPATH/css/style.css' ]"
verificar "js/main.js copiado" "[ -f '$DEPLOYPATH/js/main.js' ]"
verificar "assets/cvf-logo.svg copiado" "[ -f '$DEPLOYPATH/assets/cvf-logo.svg' ]"
icons_n=$(ls "$DEPLOYPATH/assets/icons/" | wc -l)
verificar "assets/icons/ tem 20 SVGs ($icons_n)" "[ $icons_n -eq 20 ]"
verificar "SEM .git no docroot (wildcard proibido)" "[ ! -d '$DEPLOYPATH/.git' ]"
verificar "SEM README.md (doc interna nao sobe)" "[ ! -f '$DEPLOYPATH/README.md' ]"
verificar "SEM TODO.md (paths da maquina nao vazam)" "[ ! -f '$DEPLOYPATH/TODO.md' ]"
verificar "SEM screenshots" "[ ! -f '$DEPLOYPATH/screen_capture.png' ]"
verificar "ficheiro extra antigo preservado (cp nao apaga)" "[ -f '$DEPLOYPATH/antigo.html' ]"
echo "FALHAS_SANDBOX:$falhas"
rm -rf "$HOME_FAKE"
exit $((falhas > 0 ? 1 : 0))
