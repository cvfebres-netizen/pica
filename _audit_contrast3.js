// Contraste real do CVF — le as variaveis do CSS em vez de repetir hex.
// Distingue TEXTO (WCAG AA exige 4.5:1) de ICONE/GRAFICO (exige 3:1).
const fs = require('fs');
const css = fs.readFileSync('c:/Users/CVF/Desktop/GitHub Projects/1/cvf_website/css/style.css', 'utf8');

const vars = {};
for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})/g)) {
  vars[m[1]] = m[2].toLowerCase();
}
const v = (x) => {
  const k = String(x || '').replace(/^var\(|\)$/g, '').replace(/^--/, '').trim();
  return vars[k] || String(x || '').trim();
};
function lum(hex) {
  const h = v(hex).replace('#', '');
  const c = [0, 1, 2].map((i) => {
    let x = parseInt(h.substr(i * 2, 2), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const cr = (a, b) => {
  const la = lum(a), lb = lum(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
};

// [fundo, texto/tipo, onde, exigeTexto?]
const pares = [
  ['--teal', '--turquesa-claro', '.btn-primary (repouso) e .hero-badge — TEXTO', true],
  ['--teal-escuro', '--branco', '.btn-primary:hover — TEXTO', true],
  ['--complementar', '--teal-escuro', '.btn-accent — TEXTO', true],
  ['--teal', '--branco', '.cta-band — TEXTO', true],
  ['--turquesa-aa', '--branco', '.btn-outline:hover — TEXTO', true],
  ['--fundo', '--texto', 'texto principal', true],
  ['--fundo', '--cinza', 'texto secundario', true],
  ['--teal-card', '--cinza', 'texto em cartao', true],
  ['--teal-card-2', '--cinza', 'texto em cartao servico', true],
  ['--teal', '--cinza', 'texto no booking-wrap', true],
  ['--fundo', '--turquesa', 'eyebrow / nav link', true],
  ['--teal-card', '--turquesa', '.team-card .role', true],
  ['--teal-card-2', '--turquesa-claro', 'titulos em servico', true],
  ['--teal-escuro', '--turquesa-claro', 'titulos no footer', true],
  ['--teal-escuro', '--complementar', 'link footer', true],
  ['--turquesa', '--branco', '.social-link / .value-icon / .ci-icon — so SVG', false],
  ['--turquesa-claro', '--teal-escuro', '.team-photo .placeholder — iniciais', true],
];

let falhas = 0;
console.log('PAR'.padEnd(44) + 'RATIO'.padStart(7) + '  MIN  ESTADO');
console.log('-'.repeat(78));
for (const [bg, fg, uso, exigeTexto] of pares) {
  const val = cr(bg, fg);
  const min = exigeTexto ? 4.5 : 3.0;
  const passa = val >= min;
  if (!passa) falhas++;
  console.log(
    `${bg} s/ ${fg}`.padEnd(44) +
    val.toFixed(2).padStart(7) + '  ' +
    min.toFixed(1).padStart(4) + '  ' +
    (passa ? 'PASSA' : 'FALHA') +
    (passa ? '' : '  <-- ' + uso)
  );
}
console.log('\nNOTA: .social-link/.value-icon/.ci-icon tem apenas <svg fill=currentColor>,');
console.log('      logo aplica-se 1.4.11 Non-text Contrast (3:1), nao 1.4.3 (4.5:1).');
console.log('FALHAS DE CONTRASTE: ' + falhas);
