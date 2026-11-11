# Auditoria do site CVF — 10 passagens (10/10/2026)

Metodo: leitura integral de `index.html` (565 L), `css/style.css` (1473 L),
`js/main.js` (229 L), `404.html`, `.cpanel.yml`, `.htaccess`, `DESIGN.md`,
mais `_audit_site.js` (estrutura) e `_audit_contrast.js` (WCAG 2.1 calculado).

| # | Passagem | Resultado |
|---|---|---|
| 1 | Build / deploy | **FALHA** — `$incluir` nao tem `assets/cvf-mark.svg` |
| 2 | HTML semantica | 4 `style=` inline; `height` atributo mente vs CSS |
| 3 | CSS | **12 classes mortas** (~230 linhas) + `.hero-card h3` |
| 4 | Acessibilidade / contraste | **2 FALHAS AA** (3.11 e 3.63) |
| 5 | SEO / metadata | `og:image` em SVG (nao renderiza); dimensoes falsas; sem sitemap |
| 6 | JavaScript | bloco `loadFrame` **morto** (0 `data-src`); ignora `prefers-reduced-motion` |
| 7 | Marca (DESIGN.md) | **13 emojis** violam "usar SVGs, nao emojis" |
| 8 | Assets | `apple-touch-icon` em SVG (iOS ignora); `favicon.svg` sem newline |
| 9 | Visual / render | `alt` redundante no hero; mapa depende de `height` inline |
| 10 | Git / higiene | 6 ficheiros por commitar; `_preparar_logo.js` sem ignore |

## Contraste WCAG 2.1 calculado

```
branco           s/ turquesa   (btn-primary, hero-badge)   3.11  FALHA AA
turquesa         s/ teal-card-2                            3.63  FALHA AA (par latente, sem uso)
texto            s/ fundo                                 13.07  PASSA
cinza            s/ fundo                                  8.94  PASSA
cinza            s/ teal-card                              8.40  PASSA
cinza            s/ teal-card-2                            6.60  PASSA
turquesa         s/ fundo                                  4.92  PASSA
turquesa         s/ teal-card                              4.62  PASSA
turquesa-claro   s/ fundo                                  9.73  PASSA
complementar     s/ fundo                                  9.75  PASSA
teal-escuro      s/ complementar (btn-accent)             10.79  PASSA
teal-escuro      s/ turquesa                              5.44  PASSA  <- solucao do 3.11
```

## Correcoes aplicadas

1. `_build_cvf_deploy.ps1` — `assets/cvf-mark.svg`, `sitemap.xml`,
   `site.webmanifest` em `$incluir`, **mais uma guarda** que compara os
   `assets|css|js/...` referenciados no `index.html` com a lista do zip e
   lanca `BUILD INCOMPLETO` se faltar algo. Provado nos dois sentidos:
   remove-se `cvf-mark.svg` da lista -> lanca; lista correta -> passa.
2. `index.html` — 13 emojis -> SVGs inline (padrao ja usado no topbar);
   4 `style=` inline removidos; `width`/`height` dos 3 iframes removidos
   (a altura passa a ser responsiva no CSS); falsas `og:image:width/height`
   removidas; `alt=""` no logo do hero (o texto "CVF / Centro Veterinario
   de Febres" ja esta visivel ao lado, o `alt` era redundante).
3. `css/style.css` — 12 classes mortas + `.hero-card h3` removidas;
   `html{}` duplicado unificado; bloco `.map-embed` duplicado fundido;
   contraste do `btn-primary`/`hero-badge` corrigido; altura responsiva do
   mapa; classes novas dos icones.
4. `js/main.js` — bloco `loadFrame` morto removido (havia 0 `data-src` no
   HTML); bloco `.placeholder-link` morto removido; `prefers-reduced-motion`
   respeitado no `scrollTo` feito por JS.
5. `404.html` — mantido como estava (ja nao tinha emoji); ganhou o bloco
   `.page-404` no CSS.
6. `robots.txt` — `Sitemap:` adicionado. `sitemap.xml` e
   `site.webmanifest` criados (item 27 do TODO.md).
7. `.cpanel.yml` — copia os dois ficheiros novos.
8. `.gitignore` — ignora `_preparar_logo.js`.
9. `favicon.svg` — newline final.
10. `_test_cvf.ps1` — duas passagens novas (7 no total):
    - **6**: falha se um asset do HTML nao estiver na lista do build
      (apanha a regressao do bug 1 sem depender do ficheiro de build);
    - **7**: falha com emoji no HTML ou com classe CSS sem uso em
      `index.html` **ou** `404.html`.

## Verificacao

```
$env:REPETICOES='1'; pwsh -NoProfile -File .\_test_cvf.ps1
...
  OK    nenhum emoji no index.html (DESIGN.md cumprido)
  OK    nenhum CSS morto (84 classes, todas em uso)
FALHAS:0
```

7 suites, FALHAS:0. O zip foi reconstruido (30.3 KB, 32 entradas) e
conferido entrada a entrada contra o disco: `index.html` 40322 B,
`style.css` 25684 B, `main.js` 7249 B e `cvf-mark.svg` **presente**.

Contraste WCAG recalculado depois da correcao:

```
turquesa-claro s/ teal  (btn-primary, hero-badge)  6.78  PASSA AA  (era 3.11 FALHA)
```

## Assunto em aberto (nao resolvivel sem binario)

`og:image` / `twitter:image` / `apple-touch-icon` precisam de **PNG**
(1200x630 e 180x180). SVG nao e renderizado por Facebook, Twitter,
WhatsApp, LinkedIn nem iOS. Enquanto nao houver PNG, as tags ficaram de
fora e `twitter:card` baixou para `summary` — e melhor nao anunciar
`summary_large_image` sem haver imagem que o suporte.

## Assunto em aberto (nao resolvivel sem binario)

`og:image` / `twitter:image` / `apple-touch-icon` precisam de **PNG**
(1200x630 e 180x180). SVG nao e renderizado por Facebook, Twitter,
WhatsApp, LinkedIn nem iOS. E preciso exportar do material de marca.

---

# Verificacao de dispositivos + 2.a ronda de revisao (10/10/2026)

Metodo: `_audit_dispositivos.js` (iOS/Android/WebView, viewport, grelhas,
contraste lido do CSS vivo) + `_audit_contrast3.js` (WCAG calculado) +
`_verificar_zip.js` (zip vs disco byte a byte).

## Bugs reais encontrados e corrigidos nesta ronda

### 1. font-weight 600 e 800 nao existiam na fonte servida (o mais grave)

`index.html` pedia `satoshi@400,500,700,900`, mas o CSS usava **600** e
**800**. Verificado contra a API da Fontshare: a Satoshi so tem as
instancias estaticas **300/400/500/700/900** — a Fontshare **ignora
silenciosamente** pesos inexistentes no URL.

Consequencia: `font-weight: 600`/`800` nao encontrava nenhum `@font-face`
e o browser **sintetizava um falso-negrito**, que renderiza de forma
diferente em iOS, Android e desktop. Afetava `.btn`, `.hero-badge`,
`.team-card .role` (600) e `.hero h1` (800).

Correcao: 600 -> **700** (3 sitios) e 800 -> **900** (1 sitio). Pesos
agora em uso: **500, 700, 900** — exatamente os pedidos. Zero downloads
extra, zero dependencia de variable font.

### 2. `.btn-outline:hover` reprovava WCAG AA

`background: var(--turquesa)` + `color: var(--branco)` = **3.11:1**
(minimo 4.5). Correcao: nova variavel `--turquesa-aa: #008190`
(o mesmo turquesa 20% mais escuro) que da **4.62:1**. O turquesa oficial
continua em bordas, icones e destaques sem texto por cima.

### 3. `.btn-primary` (repouso) e `.hero-badge` tambem reprovavam

`--teal` sobre `--turquesa-claro`... corrigido para o tom que da 6.78:1.

### 4. Falso positivo do proprio auditor (corrigido)

`_audit_contrast3.js` tinha `--turquesa` hardcoded onde o CSS passou a
usar `--turquesa-aa`. Corrigido para ler o par real.

## Estado final (tudo verificado a correr)

| Verificacao | Resultado |
|---|---|
| `_test_cvf.ps1` (7 suites) | **FALHAS:0**, exit 0 |
| `_audit_dispositivos.js` | **tudo OK** |
| `_audit_contrast3.js` | **0 falhas** |
| `_verificar_zip.js` | **32/32 ficheiros iguais ao disco** |
| pesos de fonte | 500, 700, 900 (todos servidos) |
| classes CSS | 85, todas em uso |

## Compatibilidade por dispositivo (o que esta garantido)

- **iOS**: `viewport-fit=cover`, safe-area insets, `-webkit-text-size-adjust`,
  `tap-highlight` transparente, `-webkit-appearance` nos controlos
- **Android**: `overscroll-behavior`, `touch-action`, `text-size-adjust`
- **Tablets**: breakpoints 600/768/900/1000px, grelhas refluem sem card orfao
- **Viewport**: `100vh` sempre seguido de `100dvh` (4 ocorrencias)
- **Foco**: `:focus-visible` em todo o lado; `prefers-reduced-motion`
  respeitado no CSS **e** no JS

