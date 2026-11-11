// Verificacao de compatibilidade por dispositivo (uso temporario de revisao)
// Percorre as larguras reais de mercado e confirma que:
//  - nenhum bloco da grid fica orfao (so 1 coluna com N-1 cards)
//  - as propriedades criticas iOS/Android existem
//  - nao ha 100vh cru (bug da barra de URL do Safari iOS)
//  - as fontes carregam com display=swap
//  - o nav muda para hamburger antes de faltar espaco
const fs = require('fs');
const root = 'c:/Users/CVF/Desktop/GitHub Projects/1/cvf_website';
const css = fs.readFileSync(root + '/css/style.css', 'utf8');
const html = fs.readFileSync(root + '/index.html', 'utf8');
const h404 = fs.readFileSync(root + '/404.html', 'utf8');

let falhas = 0;
const ok = (m) => console.log('  OK    ' + m);
const ko = (m) => { console.log('  FALHA ' + m); falhas++; };
const info = (m) => console.log('  INFO  ' + m);

// ---------- parser de blocos CSS (com @media aninhados) ----------
function blocos(texto) {
  const out = [];
  let i = 0;
  function parse(media, ate) {
    while (i < ate) {
      const abre = texto.indexOf('{', i);
      if (abre === -1 || abre >= ate) break;
      const sel = texto.slice(i, abre).trim();
      let profundidade = 1, j = abre + 1;
      while (j < texto.length && profundidade > 0) {
        if (texto[j] === '{') profundidade++;
        else if (texto[j] === '}') profundidade--;
        j++;
      }
      const corpo = texto.slice(abre + 1, j - 1);
      if (/^@media/.test(sel) || /^@supports/.test(sel)) {
        // avancar para DENTRO do bloco antes de recursar, senao voltamos
        // a encontrar o mesmo @media e a recursao nao termina
        i = abre + 1;
        const envolve = media ? media + ' dentro de ' + sel : sel;
        parse(envolve, j - 1);
        i = j;
      } else {
        out.push({ media, sel, corpo });
        i = j;
      }
    }
  }
  parse('', texto.length);
  return out;
}
const regras = blocos(css);

// colunas reais de um seletor, por condicao de media
function colunas(sel) {
  const res = [];
  for (const r of regras) {
    if (!r.sel.split(',').map((s) => s.trim()).includes(sel)) continue;
    const m = r.corpo.match(/grid-template-columns:\s*([^;]+)/);
    if (!m) continue;
    const n = (m[1].match(/\d+fr|repeat\(\s*\d+/g) || [])
      .reduce((t, s) => { const v = s.match(/\d+/); return t + (v ? +v[1] : 1); }, 0);
    res.push({ media: r.media || '(sem media)', n: n || 1 });
  }
  return res;
}

// conta filhos diretos (divs) de um contentor no HTML
function filhos(htmltxt, classe) {
  const alvo = '<div class="' + classe + '"';
  const p = htmltxt.indexOf(alvo);
  if (p === -1) return null;
  let i = htmltxt.indexOf('>', p) + 1, profundidade = 0, n = 0;
  while (i < htmltxt.length) {
    if (htmltxt.startsWith('<!--', i)) { i = htmltxt.indexOf('-->', i) + 3; continue; }
    if (htmltxt[i] !== '<') { i++; continue; }
    if (htmltxt.startsWith('</', i)) {
      profundidade--;
      if (profundidade < 0) break;
      i = htmltxt.indexOf('>', i) + 1;
      continue;
    }
    const tag = htmltxt.slice(i + 1).match(/^\/?([a-zA-Z0-9-]+)/);
    const nome = tag ? tag[1].toLowerCase() : '';
    const fecha = /\/>$/.test(htmltxt.slice(i, htmltxt.indexOf('>', i) + 1));
    if (!fecha && !['br', 'img', 'input', 'hr', 'meta', 'link', 'path'].includes(nome)) profundidade++;
    if (profundidade === 0 && nome === 'div') n++;
    i = htmltxt.indexOf('>', i) + 1;
  }
  return n;
}

console.log('=== A. Propriedades criticas iOS / Android / WebView ===');
const criticas = {
  'text-size-adjust (padrao)': /text-size-adjust\s*:/,
  '-webkit-text-size-adjust (iOS)': /-webkit-text-size-adjust\s*:/,
  'tap-highlight transparente': /-webkit-tap-highlight-color\s*:/,
  'overscroll-behavior (sem rubber-band)': /overscroll-behavior/,
  'touch-action manipulation': /touch-action\s*:\s*manipulation/,
  'appearance none (botao nativo)': /-webkit-appearance\s*:\s*none/,
  'font-family inherit em controlos': /button,\s*\n?\s*input/,
  'safe-area-inset (notch)': /env\(safe-area-inset-bottom\)/,
  'viewport-fit=cover (index)': /viewport-fit=cover/.test(html) || /viewport-fit=cover/.test(h404),
  'font-display swap (webfonts)': /display=swap/.test(html),
  'preconnect do CDN de fontes': /preconnect[^>]*fontshare/.test(html),
};
for (const [k, v] of Object.entries(criticas)) (v ? ok : ko)(k);

console.log('\n=== B. Unidades de viewport: cada 100vh tem de ter 100dvh a seguir ===');
// Padrao CORRETO e progressivo: declarar 100vh (fallback universal) e logo
// depois 100dvh (browsers modernos sobrescrevem). Por isso o que se exige
// nao e "nao haver 100vh" mas sim "haver 100dvh na linha imediatamente a seguir".
const linhas = css.split('\n');
const vhSemDvh = [];
linhas.forEach((l, idx) => {
  if (!/(^|[^-a-z])height:\s*100vh;/.test(l) && !/min-height:\s*100vh;/.test(l)) return;
  const prox = linhas.slice(idx + 1, idx + 3).join(' ');
  if (!/100dvh/.test(prox)) vhSemDvh.push('L' + (idx + 1) + ': ' + l.trim());
});
vhSemDvh.length === 0
  ? ok('todos os 100vh tem fallback 100dvh a seguir (' + (css.match(/100vh/g) || []).length + ' ocorrencias)')
  : ko('100vh sem fallback dvh imediato: ' + vhSemDvh.join(' | '));
info('100dvh presente: ' + (css.match(/100dvh/g) || []).length + ' vez(es)');

console.log('\n=== C. Fontes: pesos usados no CSS tem de existir na fonte servida ===');
// Satoshi no Fontshare e VARIABLE FONT: o @font-face declara
// `font-weight: 300 900`, ou seja, TODOS os pesos nesse intervalo
// existem num unico ficheiro. A lista na URL (400,500,700,900) e apenas
// o que foi pedido; nao limita nada. Por isso o teste correto e confirmar
// que cada peso usado cai dentro do intervalo servido, nao se esta na lista.
const servidos = [...html.matchAll(/f\[\]=([a-z]+)@([0-9,;]+)/g)]
  .flatMap(([, fam, pesos]) => pesos.split(/[,;]/).map((w) => fam + ':' + w.trim()));
const usados = [...new Set([...css.matchAll(/font-weight:\s*(\d+)/g)].map((m) => m[1]))].sort();
// intervalo da @font-face servida (se variable) ou lista de pesos (se estatica)
const intervalos = [...html.matchAll(/font-weight:\s*(\d+)\s+(\d+)\s*;/g)];
let falta = [];
if (intervalos.length) {
  const min = Math.min(...intervalos.map((m) => +m[1]));
  const max = Math.max(...intervalos.map((m) => +m[2]));
  falta = usados.filter((w) => +w < min || +w > max);
  info('fonte variable: intervalos ' + intervalos.map((m) => m[1] + '-' + m[2]).join(', '));
} else {
  falta = usados.filter((w) => !servidos.includes('satoshi:' + w));
}
console.log('  pesos usados no CSS : ' + usados.join(', '));
falta.length === 0
  ? ok('todos os pesos usados existem na fonte servida')
  : ko('pesos fora do intervalo servido: ' + falta.join(', '));

console.log('\n=== D. Breakpoints: nenhuma grelha deve deixar card orfao ===');
// cards por seccao
const contagem = {
  'services-grid': (html.match(/class="service-card/g) || []).length,
  'why-grid': (html.match(/class="why-card/g) || []).length,
  'team-grid': (html.match(/class="team-card/g) || []).length,
  'contact-grid': (html.match(/class="contact-item/g) || []).length,
};
const bp = {
  '360px (Android pequeno)': 1,
  '480px (Android medio)': 1,
  '600px': 1,
  '601px': 2,
  '768px (tablet retrato)': 2,
  '900px': 2,
  '901px': 2,
  '1000px': 2,
  '1200px (desktop)': 3,
};
console.log('  grelha        cards | 360 600 768 900 1200');
for (const [g, n] of Object.entries(contagem)) {
  const cols = [1, 1, 2, 2, 3].map((c) => (n % c === 0 ? n / c : Math.ceil(n / c)));
  const orfaos = [1, 1, 2, 2, 3].map((c, i) => (cols[i] > 1 && n % c === 1 ? 'ORFAO' : ''));
  console.log('  ' + g.padEnd(14) + String(n).padStart(4) + ' | ' + cols.join('  ') +
    (orfaos.some((x) => x) ? '   <-- ' + orfaos.filter(Boolean).join(',') : ''));
}

console.log('\n=== E. Nav: hamburger antes de haver falta de espaco ===');
// largura aproximada da nav: 6 links * ~72px + gaps
const links = (html.match(/class="nav-links"[\s\S]*?<\/ul>/) || [''])[0];
const nLinks = (links.match(/<li>/g) || []).length;
const estimada = nLinks * 74 + 5 * 28 + 190; // links + gaps + brand + botao
console.log('  links na nav:', nLinks, '| largura estimada da nav:', estimada + 'px');
console.log('  hamburger aparece abaixo de: 901px (max-width: 900px)');
estimada > 880 ? ko('nav poderia nao caber entre 901 e ' + estimada + 'px -> verificar') : ok('nav cabe acima de 901px');

console.log('\n=== F. Contraste (WCAG AA) — valores lidos do CSS ===');
function lum(hex) {
  const h = hex.replace('#', '');
  const c = [0, 1, 2].map((i) => {
    let x = parseInt(h.substr(i * 2, 2), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function cr(a, b) {
  const hi = Math.max(lum(a), lum(b)), lo = Math.min(lum(a), lum(b));
  return (hi + 0.05) / (lo + 0.05);
}
// pares declarados por nome de variavel -> resolvidos contra o :root real
const cssVars = {};
for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})/g)) cssVars[m[1]] = m[2].toLowerCase();
const resolve = (n) => {
  const k = String(n).replace(/^var\(|\)$/g, '').replace(/^--/, '').trim();
  return cssVars[k] || n;
};
// exigeTexto: false -> 1.4.11 Non-text Contrast (3:1), so para icones
const pares = [
  ['--teal', '--turquesa-claro', '.btn-primary repouso + .hero-badge (texto)', true],
  ['--teal-escuro', '--branco', '.btn-primary:hover (texto)', true],
  ['--complementar', '--teal-escuro', '.btn-accent (texto)', true],
  ['--teal', '--branco', '.cta-band (texto)', true],
  ['--turquesa-aa', '--branco', '.btn-outline:hover (texto)', true],
  ['--fundo', '--texto', 'texto principal', true],
  ['--fundo', '--cinza', 'texto secundario', true],
  ['--teal-card', '--cinza', 'texto em cartao', true],
  ['--teal-card-2', '--cinza', 'texto em cartao servico', true],
  ['--teal', '--cinza', 'texto no booking-wrap', true],
  ['--fundo', '--turquesa', 'eyebrow / link nav', true],
  ['--teal-card', '--turquesa', '.team-card .role', true],
  ['--teal-escuro', '--turquesa-claro', 'titulos no footer', true],
  ['--teal-escuro', '--complementar', 'link footer', true],
  ['--turquesa', '--branco', '.social-link/.value-icon/.ci-icon (so SVG)', false],
];
for (const [bg, fg, uso, exigeTexto] of pares) {
  const val = cr(resolve(bg), resolve(fg));
  const min = exigeTexto ? 4.5 : 3.0;
  const s = val.toFixed(2);
  val >= min ? ok(s + '  ' + uso) : ko(s + '  ' + uso + '  (min ' + min + ')');
}


console.log('\n=== G. Sem CSS morto ===');
const classes = [...new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]))];
const js = fs.readFileSync(root + '/js/main.js', 'utf8');
const mortas = classes.filter((n) => !(html + h404).includes(n) && !js.includes(n));
mortas.length ? ko('classes mortas: ' + mortas.join(', ')) : ok(classes.length + ' classes, todas em uso');

console.log('\nRESULTADO: ' + (falhas ? falhas + ' falha(s)' : 'tudo OK'));
process.exit(falhas ? 1 : 0);
