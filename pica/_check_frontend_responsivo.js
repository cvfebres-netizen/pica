/* ============================================================
   VERIFICAÇÃO DO FRONTEND — RESPONSIVIDADE / ECRÃS DE TOQUE
   A UI é usada em iPhone e Android; este checker garante que as
   regras que sustentam isso não desaparecem numa edição futura.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

const registo = [];
function assinalar(ok, texto) {
  registo.push((ok ? '  OK   ' : '  FALHA ') + texto);
  if (!ok) process.exitCode = 1;
}
function titulo(t) { registo.push('\n--- ' + t + ' ---'); }

/* extrai um bloco { ... } a partir de um selector ou condição */
function bloco(inicio, txt) {
  const j = txt.indexOf('{', inicio);
  if (j < 0) return '';
  let nivel = 0;
  for (let k = j; k < txt.length; k++) {
    if (txt[k] === '{') nivel++;
    else if (txt[k] === '}') { nivel--; if (!nivel) return txt.slice(inicio, k + 1); }
  }
  return '';
}
function blocoCSS(sel) {
  const i = html.indexOf(sel);
  return i < 0 ? '' : bloco(i, html);
}
function blocoMedia(cond) {
  const re = new RegExp('@media[^{]*' + cond + '[^{]*\\{', 'g');
  let m, saida = '';
  while ((m = re.exec(html))) saida += bloco(m.index, html);
  return saida;
}

titulo('PASSO 1: viewport e meta de toque (iOS/Android)');

/* Zoom bloqueado é uma falha de acessibilidade e a causa clássica de
   "a página fica grande" no telemóvel. */
const vp = (html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/i) || [])[1] || '';
assinalar(/width=device-width/.test(vp), 'viewport com width=device-width :: ' + (vp || 'AUSENTE'));
assinalar(/initial-scale=1/.test(vp), 'viewport com initial-scale=1');
assinalar(/viewport-fit=cover/.test(vp), 'viewport-fit=cover (notch / barra de gestos)');
assinalar(!/user-scalable\s*=\s*no/.test(vp), 'zoom do utilizador NAO esta bloqueado');
assinalar(!/maximum-scale\s*=\s*1(\.0)?\b/.test(vp), 'maximum-scale NAO esta fixado em 1');

/* doGet injetava um viewport antigo que sobrepunha o do Index.html */

/* Só o CÓDIGO conta: um comentário que descreve o valor antigo
   (`user-scalable=no`) não deve ser acusado de o reintroduzir. Remove
   apenas comentários de bloco e linhas que começam por // — não toca
   em "//" dentro de cadeias (URLs). */
function semComentarios(txt) {
  return txt
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter(function (l) { return !/^\s*\/\//.test(l); })
    .join('\n');
}

const gs = semComentarios(fs.readdirSync(dir).filter(function (f) { return /\.gs$/.test(f); })
  .map(function (f) { return fs.readFileSync(path.join(dir, f), 'utf8'); }).join('\n'));
assinalar(!/addMetaTag\(\s*['"]viewport['"]/.test(gs),
  'o backend nao injeta um viewport que sobreponha o do Index.html');
assinalar(!/user-scalable\s*=\s*no/.test(gs), 'nenhum user-scalable=no no backend');

titulo('PASSO 2: zonas seguras (notch / barra de gestos)');

['--safe-t', '--safe-b', '--safe-l', '--safe-r'].forEach(function (v) {
  assinalar(new RegExp(v + '\\s*:\\s*env\\(safe-area-inset').test(html),
    v + ' definido com env(safe-area-inset)');
});
['.header{', '#login{', '.toast-wrap{', '.content{'].forEach(function (sel) {
  const b = blocoCSS(sel);
  assinalar(!!b && /var\(--safe-/.test(b),
    sel + ' aplica --safe-* :: ' + (b ? 'sim' : 'NAO ENCONTRADO'));
});
/* env() precisa de reserva: sem ela o padding fica inválido e a página
   desloca-se. */
assinalar((html.match(/env\(safe-area-inset-[a-z]+,?\s*0px\)/g) || []).length >= 4,
  'env() com reserva 0px nas quatro zonas');


titulo('PASSO 3: alvos de toque e zoom automático do iOS');

assinalar(/--tap\s*:\s*44px/.test(html), 'variavel --tap:44px (WCAG 2.5.5)');
const coarse = blocoMedia('pointer:coarse');
assinalar(!!coarse, 'existe bloco @media pointer:coarse (ecra real de toque)');
assinalar(/font-size\s*:\s*16px/.test(coarse),
  'inputs/selects a 16px em toque (senao o iOS enlarge ao focar)');
assinalar(/var\(--tap\)/.test(coarse), 'botoes com min-height:var(--tap) em toque');
assinalar(/autocapitalize="none"/.test(html) && /autocorrect="off"/.test(html),
  'login sem autocapitalize/autocorrect (evita Caps Lock e correcoes)');
assinalar(/autocomplete="current-password"/.test(html) && /autocomplete="username"/.test(html),
  'autocomplete correto (gestor de palavras-passe do iOS)');

titulo('PASSO 4: alturas de janela (100vh no iPhone mede a janela cheia)');

const vh = (html.match(/min-height:100vh/g) || []).length;
const svh = (html.match(/min-height:100svh/g) || []).length;
const dvh = (html.match(/min-height:100dvh/g) || []).length;
assinalar(vh > 0 && svh >= vh, 'todas as 100vh tem fallback 100svh (' + svh + '/' + vh + ')');
assinalar(dvh >= 1, 'login usa 100dvh (acompanha o teclado ao abrir)');
assinalar(/@media[^{]*max-height:560px/.test(html),
  'paisagem/teclado aberto: login deixa de estar centrado');


titulo('PASSO 5: tabelas legiveis no telemóvel');

/* A regra que transforma <table> em lista e o data-label que a alimenta. */
const movel = blocoMedia('max-width:700px');
assinalar(!!movel, 'existe camada de telemóvel (max-width:700px)');
assinalar(/\.table-wrap\s+thead\s*\{\s*display:none/.test(movel),
  'no telemóvel o cabecalho da tabela e ocultado');
assinalar(/content\s*:\s*attr\(data-label\)/.test(movel),
  'cada celula mostra o rotulo da coluna (content:attr(data-label))');
assinalar(/\.table-wrap\s+td\s*\{[^}]*display:flex/.test(movel),
  'celulas em linha rotulo/valor (display:flex)');
assinalar(/data-label="'\s*\+\s*esc\(view\.headers\[i\]/.test(html),
  'o JS escreve data-label em todas as celulas');
assinalar(/@media screen and \(max-width:700px\)/.test(html),
  'camada de ecã e `screen and` (a impressao mantem a tabela)');
assinalar(/@media print\{/.test(html), 'existe folha de impressao');

titulo('PASSO 6: conteudo largo, texto e scroll');

assinalar(/overflow-x:clip/.test(html), 'overflow-x:clip no body (nomes/emails nao arrastam a pagina)');
assinalar(/-webkit-text-size-adjust:100%/.test(html), 'text-size-adjust:100% (iOS nao infla ao rodar)');
assinalar(/overflow-wrap:anywhere/.test(html), 'textos longos quebram a linha');
assinalar(/\.title\s*\{[^}]*text-overflow:ellipsis/.test(html), 'titulo do cabecalho com elipse');
assinalar(/min-width:0/.test(html), 'itens flex com min-width:0 (elipse funciona)');
assinalar(/overscroll-behavior-x:contain/.test(html), 'faixa de separadores nao arrasta a pagina');
assinalar(/scroll-snap-type/.test(html), 'separadores com scroll-snap');
assinalar(/-webkit-overflow-scrolling:touch/.test(html), 'scroll de toque com inercia no iOS');
assinalar(/touch-action:manipulation/.test(html), 'touch-action:manipulation (sem atraso de 300ms)');

titulo('PASSO 7: coerencia entre JS e CSS');

/* classes criticas: se o JS para de as gerar, o CSS fica morto e o
   telemóvel volta a esconder o cabecalho sem mostrar os rotulos */
const definidas = new Set((html.match(/^\s*\.[a-zA-Z][\w-]*/gm) || [])
  .map(function (c) { return c.trim().slice(1); }));
['table-wrap', 'cell-actions', 'tabs', 'tab', 'filters', 'fitem', 'kpis', 'kpi',
 'mini', 'detail-kv', 'toast-wrap', 'form-grid', 'punch-grid', 'info-grid']
  .forEach(function (c) { assinalar(definidas.has(c), 'classe .' + c + ' definida no CSS'); });

/* o cabecalho da tabela so pode desaparecer se cada celha tiver rotulo */
assinalar(/function buildPanelTable\(view\)/.test(html), 'buildPanelTable existe (fonte das tabelas)');

/* Nenhuma media query de ecã pode ficar sem tipo de medium: em impressao
   `max-width` mede o papel e as regras de ecã disparavam. */
const medias = html.match(/@media[^{]*\{/g) || [];
const semScreen = medias.filter(function (m) {
  const t = m.replace('@media', '').trim();
  return !/^(print|prefers-|screen)/.test(t) && /max-width|min-width|pointer|height/.test(t);
});
assinalar(semScreen.length === 0,
  'todas as media queries de ecã especificam o medium :: ' + (semScreen.join(' ') || 'nenhuma sem screen'));

/* O JS inline tem de continuar a compilar depois das edições de CSS/JS */
const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
try {
  new Function(script);
  assinalar(true, 'o <script> inline continua a compilar');
} catch (e) {
  assinalar(false, 'o <script> inline nao compila :: ' + e.message);
}

titulo('PASSO 8: acessibilidade e texto longo');

/* Estas duas têm de ficar ANTES do resumo: antigamente estavam depois
   do cálculo de falhas, ou seja, impressas mas sem qualquer efeito
   no exit code (verificações decorativas que nunca podiam falhar). */
assinalar(/@media\(prefers-reduced-motion:reduce\)/.test(html), 'respeita prefers-reduced-motion');
assinalar(/:focus-visible/.test(html), 'foco visivel para quem navega de teclado');
const kv = blocoCSS('.detail-kv>div{');
assinalar(!!kv && /min-width:0/.test(kv) && /overflow-wrap:anywhere/.test(kv),
  '.detail-kv: valores longos nao esticam a pagina (min-width:0 + overflow-wrap)');

console.log(registo.join('\n'));
const falhas = registo.filter(function (l) { return l.indexOf('FALHA') >= 0; }).length;
console.log('\n============================================');
if (falhas) {
  console.log('RESULTADO: ' + falhas + ' verificacao(oes) de responsividade FALHARAM');
  process.exitCode = 1;
} else {
  console.log('RESULTADO: interface responsiva coerente (' + (registo.length - 1) + ' verificacoes)');
}
console.log('============================================');
