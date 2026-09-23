/* TibiaHunts — fan-made hunting spot finder for Tibia.
   Express server: SSR pages (SEO) + JSON API + admin CRUD + map data. */
const express = require('express');
const fs = require('fs');
const path = require('path');
const Scoring = require('./public/js/scoring.js');

const app = express();
app.use(express.json({ limit: '12mb' }));

const DATA_FILE = path.join(__dirname, 'data', 'spots.json');
const CATALOG_FILE = path.join(__dirname, 'data', 'catalog_hunts.json');
const CITIES_FILE = path.join(__dirname, 'data', 'cities.json');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'tibia-admin-2026';
const PORT = process.env.PORT || 3000;

let SPOTS = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const CATALOG_SPOTS = fs.existsSync(CATALOG_FILE) ? JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8')) : [];
// Merge curated catalog entries while keeping the original measured database intact.
const existingNames = new Set(SPOTS.map(s => s.name.toLowerCase()));
SPOTS = SPOTS.concat(CATALOG_SPOTS.filter(s => !existingNames.has(String(s.name).toLowerCase())));
const CITIES = JSON.parse(fs.readFileSync(CITIES_FILE, 'utf8'));
const MAP_MARKERS = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'map-data', 'markers.json'), 'utf8'));


function saveSpots() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(SPOTS, null, 1));
}
const bySlug = s => SPOTS.find(x => x.slug === s || x.id === s);

/* ------------------------------------------------------------------ */
/* Filtering helpers (used by API and SSR)                             */
/* ------------------------------------------------------------------ */
function applyFilters(spots, q) {
  let out = spots.slice();
  const num = v => (v === undefined || v === '' ? null : +v);
  const voc = q.vocation || q.voc;
  if (voc) out = out.filter(s => s.vocations.includes(voc) || (s.stats || []).some(st => st.vocation === voc));
  if (num(q.level) != null) out = out.filter(s => +q.level >= s.levelMin * 0.85 && (s.levelMax == null || +q.level <= s.levelMax * 1.5));
  if (num(q.min) != null) out = out.filter(s => s.levelMax >= +q.min);
  if (num(q.max) != null) out = out.filter(s => s.levelMin <= +q.max);
  if (q.mode) out = out.filter(s => (s.modes || []).includes(q.mode));
  if (q.pacc === 'free') out = out.filter(s => !s.pacc);
  if (num(q.risk) != null) out = out.filter(s => s.risk <= +q.risk);
  if (num(q.minExp) != null) out = out.filter(s => s.expPerHour && s.expPerHour.avg >= +q.minExp);
  if (num(q.minProfit) != null) out = out.filter(s => s.profitPerHour && s.profitPerHour.avg >= +q.minProfit);
  if (num(q.maxWaste) != null) out = out.filter(s => (s.wastePerHour ? s.wastePerHour.max : 0) <= +q.maxWaste);
  if (num(q.minSkill) != null) out = out.filter(s => Scoring.requiredSkill(s) <= +q.minSkill);
  if (num(q.minML) != null) out = out.filter(s => Scoring.requiredML(s) <= +q.minML);
  if (q.damage) out = out.filter(s => (s.damageTypes || []).map(d => d.toLowerCase()).includes(q.damage.toLowerCase()));
  if (q.region) out = out.filter(s => ((s.region || '') + ' ' + (s.continent || '')).toLowerCase().includes(q.region.toLowerCase()));
  if (q.city) out = out.filter(s => (s.city || '').toLowerCase().includes(q.city.toLowerCase()));
  if (q.monster) out = out.filter(s => (s.monsters || []).some(m => m.name.toLowerCase().includes(q.monster.toLowerCase())));
  if (q.q) {
    const t = q.q.toLowerCase();
    out = out.filter(s =>
      s.name.toLowerCase().includes(t) || (s.region || '').toLowerCase().includes(t) ||
      (s.city || '').toLowerCase().includes(t) || (s.monsters || []).some(m => m.name.toLowerCase().includes(t)));
  }
  const sort = q.sort || 'level';
  const asc = q.dir === 'asc';
  const S = {
    exp: (s) => (s.expPerHour ? s.expPerHour.avg : 0),          // sort desc => biggest exp first
    profit: (s) => (s.profitPerHour ? s.profitPerHour.avg : -9e9), // desc => biggest profit first
    waste: (s) => -(s.wastePerHour ? s.wastePerHour.max : 0),   // desc on negated => smallest waste first
    risk: (s) => -s.risk,                                       // desc on negated => smallest risk first
    level: (s) => s.levelMin,
    updated: (s) => s.lastUpdated || ''
  };
  if (S[sort]) out.sort((a, b) => {
    const va = S[sort](a), vb = S[sort](b);
    const cmp = va < vb ? -1 : va > vb ? 1 : a.levelMin - b.levelMin;
    return asc ? cmp : -cmp;
  });
  return out;
}

function globalSearch(q) {
  const t = (q || '').toLowerCase().trim();
  if (!t) return { spots: [], monsters: [], cities: [] };
  // smart parse: "level 100 ms", "solo ek", "profit hunt"
  let voc = null, level = null, mode = null, pref = null;
  const m1 = t.match(/\b(\d{2,4})\b/); if (m1) level = +m1[1];
  const vmap = { ek: 'EK', knight: 'EK', paladyn: 'RP', paladin: 'RP', rp: 'RP', sorc: 'MS', sorcerer: 'MS', ms: 'MS', druid: 'ED', ed: 'ED', monk: 'MNK', mnk: 'MNK' };
  for (const k of Object.keys(vmap)) if (t.includes(k)) { voc = vmap[k]; break; }
  if (/\bsolo\b/.test(t)) mode = 'solo'; else if (/\bduo\b/.test(t)) mode = 'duo'; else if (/\bparty\b/.test(t)) mode = 'party';
  if (/profit|kasa|złoto|gold/.test(t)) pref = 'profit'; else if (/\bexp\b|xp/.test(t)) pref = 'exp';
  const smart = (level || voc || mode || pref);
  let spots;
  if (smart) {
    spots = Scoring.recommend({
      vocation: voc || 'EK', level: level || 100, mode: mode || 'solo', pacc: true,
      preference: pref || 'balanced', equipTier: 2
    }, SPOTS, 8).map(r => r.spot);
  } else {
    spots = applyFilters(SPOTS, { q: t }).slice(0, 8);
  }
  const monsters = [];
  const seen = new Set();
  for (const s of SPOTS) for (const m of s.monsters || []) {
    if (m.name.toLowerCase().includes(t) && !seen.has(m.name)) { seen.add(m.name); monsters.push({ name: m.name, img: m.img, spot: s.slug, spotName: s.name }); }
  }
  const cities = CITIES.cities.filter(c => c.name.toLowerCase().includes(t)).map(c => ({ name: c.name, continent: c.continent }));
  return { spots: spots.map(s => ({ slug: s.slug, name: s.name, recLevel: s.recLevel, vocations: s.vocations, city: s.city })), monsters: monsters.slice(0, 8), cities };
}

/* ------------------------------------------------------------------ */
/* SSR layout                                                          */
/* ------------------------------------------------------------------ */
const SITE = {
  name: 'TibiaHunts',
  url: '',
  tagline: 'Wyszukiwarka hunting spotów w Tibii — fan-made',
  desc: 'Znajdź najlepsze miejscówki do expienia w Tibii: filtry, rekomendacje, mapa świata, porównywarka, plan expienia i system party. Fan-made narzędzie — nie jest powiązane z CipSoft.'
};

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function layout({ title, desc, url, type = 'website', jsonld, content, active = '' }) {
  const navL = [['/', 'Start'], ['/hunting-spots', 'Hunting Spoty'], ['/map', 'Mapa'], ['/party', 'Party'], ['/planner', 'Plan Expienia'], ['/compare', 'Porównywarka'], ['/about', 'Źródła']];
  const nav = navL.map(([href, label]) => `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`).join('');
  const jl = jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : '';
  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc || SITE.desc)}">
<link rel="canonical" href="${url || ''}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc || SITE.desc)}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="TibiaHunts">
${url ? `<meta property="og:url" content="${url}">` : ''}
<meta name="theme-color" content="#0b0b12">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='%230b0b12'/><text x='16' y='22' font-size='16' text-anchor='middle' fill='%23d4a941'>⚔</text></svg>">
<link rel="stylesheet" href="/css/style.css?v=3">
${jl}
</head>
<body>
<header class="site-header">
  <div class="wrap header-inner">
    <a href="/" class="logo">⚔ <span>Tibia<b>Hunts</b></span></a>
    <div class="search-global">
      <input id="globalSearch" type="search" placeholder="Search hunting spots, monsters, cities… (np. Hydra, Level 100 MS, Profit hunt)" autocomplete="off">
      <div id="searchResults" class="search-results" hidden></div>
    </div>
    <nav class="main-nav"><button id="navToggle" class="nav-toggle" aria-label="menu">☰</button><div class="nav-links" id="navLinks">${nav}</div></nav>
  </div>
</header>
<main class="wrap">${content}</main>
<footer class="site-footer">
  <div class="wrap">
    <p><b>TibiaHunts</b> — fan-made narzędzie dla graczy Tibii. <u>Nie jest oficjalnym produktem ani nie jest powiązane z CipSoft GmbH.</u></p>
    <p>Images / game assets: Tibia / CipSoft and respective sources. Sprite'y stworzeń: zasoby gry Tibia (za Intibia.com). Screeny gameplayu: miniatury poradników wideo (TibiaPal / Intibia). Mapa świata: kafelki automapy <a href="https://tibiamaps.io" rel="noopener">tibiamaps.io</a>.</p>
    <p>Dane EXP/h i profit/h pochodzą z pomiarów społeczności (TibiaPal.com, Intibia.com, TibiaRoute.com) i mają charakter <b>szacunkowy</b> — mogą się różnić po rebalance'ach i zależą od serwera. Każda miejscówka pokazuje datę ostatniej aktualizacji.</p>
    <p class="footer-links"><a href="/about">Źródła i metodologia</a> · <a href="/admin">Panel admina</a> · <a href="/api/spots">API (JSON)</a></p>
  </div>
</footer>
<script src="/js/scoring.js?v=3"></script>
<script src="/js/tibiamap.js?v=3"></script>
<script src="/js/app.js?v=3"></script>
</body>
</html>`;
}

/* ------------------------------------------------ spot card (SSR) --- */
function stars(n, max = 5) { return '★'.repeat(n) + '☆'.repeat(max - n); }
function vocBadges(vs) { return vs.map(v => `<span class="voc-badge voc-${v}">${v}</span>`).join(' '); }
function moneyCls(v) { return v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero'; }

function heroUrl(s) {
  if (!s.hero) return '';
  return s.hero.startsWith('/') || s.hero.startsWith('http') ? s.hero : `/images/screens/${s.hero}`;
}
function spotCard(s, opts = {}) {
  const exp = s.expPerHour ? `${Scoring.fmtGold(s.expPerHour.min)}–${Scoring.fmtGold(s.expPerHour.max)}` : '—';
  const prof = s.profitPerHour ? `${s.profitPerHour.min < 0 ? '-' : '+'}${Scoring.fmtGold(Math.abs(s.profitPerHour.min))}–${s.profitPerHour.max < 0 ? '-' : '+'}${Scoring.fmtGold(Math.abs(s.profitPerHour.max))}` : '—';
  const hero = heroUrl(s);
  return `<article class="spot-card" data-id="${s.id}">
    <a class="card-media" href="/hunt/${s.slug}">
      ${hero ? `<img loading="lazy" src="${hero}" alt="${esc(s.name)} — screen gameplayu">` : `<div class="media-fallback">🗺</div>`}
      <span class="card-level">Lv ${esc(s.recLevel)}</span>
      ${opts.match ? `<span class="card-match">${opts.match}% match</span>` : ''}
    </a>
    <div class="card-body">
      <h3><a href="/hunt/${s.slug}">${esc(s.name)}</a></h3>
      <p class="card-meta">${esc(s.region)} · ${esc(s.city)} · ${vocBadges(s.vocations)}${s.dataQuality === 'catalog' ? ' · <span class="tag warn">katalog</span>' : ''} </p>
      <div class="card-stats">
        <span class="stat exp" title="EXP/h">⚡ ${exp}</span>
        <span class="stat ${moneyCls(s.profitPerHour ? s.profitPerHour.avg : 0)}" title="Profit/h">💰 ${prof}</span>
        <span class="stat risk-${s.risk}" title="Ryzyko">☠ ${stars(s.risk, 5)}</span>
      </div>
      <div class="card-actions">
        <a class="btn btn-sm" href="/hunt/${s.slug}">Karta spotu</a>
        <button class="btn btn-sm btn-ghost btn-compare" data-id="${s.id}">⇄ Porównaj</button>
      </div>
    </div>
  </article>`;
}

/* ----------------------------------------------------------- HOME --- */
function renderHome() {
  const popular = SPOTS.filter(s => ['asura-palace', 'deeper-banuta', 'edron-heroes', 'yalahar-grim-reapers', 'cobra-bastion', 'wyrms-liberty-bay'].includes(s.id));
  const bestExp = SPOTS.slice().sort((a, b) => (b.expPerHour ? b.expPerHour.max : 0) - (a.expPerHour ? a.expPerHour.max : 0)).slice(0, 6);
  const bestProfit = SPOTS.slice().filter(s => s.profitPerHour).sort((a, b) => b.profitPerHour.avg - a.profitPerHour.avg).slice(0, 6);
  const newest = SPOTS.slice().sort((a, b) => (b.lastUpdated || '').localeCompare(a.lastUpdated || '')).slice(0, 6);
  const row = (s) => `<tr><td><a href="/hunt/${s.slug}">${esc(s.name)}</a></td><td>${esc(s.recLevel)}</td><td>${s.expPerHour ? Scoring.fmtGold(s.expPerHour.avg) : '—'}</td><td class="${moneyCls(s.profitPerHour ? s.profitPerHour.avg : 0)}">${s.profitPerHour ? Scoring.fmtGold(s.profitPerHour.avg) : '—'}</td><td class="risk-${s.risk}">${stars(s.risk, 5)}</td></tr>`;
  const content = `
  <section class="hero panel-dark">
    <h1>FIND YOUR NEXT HUNT</h1>
    <p class="hero-sub">Dopasuj hunting spoty do profesji, levelu, skilli, ekipy i stylu gry. ${SPOTS.length} miejscówek w bazie.</p>
    <form id="mainSearch" class="hero-form" action="/hunting-spots" method="get">
      <div class="field"><label>Profesja</label><select name="vocation">
        <option value="">— dowolna —</option><option value="EK">Elite Knight</option><option value="RP">Royal Paladin</option><option value="MS">Master Sorcerer</option><option value="ED">Elder Druid</option><option value="MNK">Monk</option></select></div>
      <div class="field"><label>Level</label><input name="level" type="number" min="8" max="1500" placeholder="np. 50"></div>
      <div class="field"><label>Skill / ML</label><div class="two"><input name="skill" type="number" placeholder="Skill"><input name="ml" type="number" placeholder="ML"></div></div>
      <div class="field"><label>Tryb</label><select name="mode"><option value="">dowolny</option><option value="solo">SOLO</option><option value="duo">DUO</option><option value="party">PARTY</option></select></div>
      <div class="field"><label>Preferencja</label><select name="preference"><option value="balanced">BALANS</option><option value="exp">EXP</option><option value="profit">PROFIT</option></select></div>
      <div class="field field-wide"><label>Ryzyko max</label><select name="risk"><option value="">bez limitu</option><option value="2">niskie (≤2)</option><option value="3">średnie (≤3)</option><option value="4">wysokie (≤4)</option></select></div>
      <div class="field field-wide"><label>Konto</label><select name="pacc"><option value="">dowolne</option><option value="pacc">PACC</option><option value="free">FREE ACCOUNT</option></select></div>
      <button class="btn btn-gold btn-big" type="submit">🔎 SEARCH HUNTS</button>
    </form>
    <p class="hero-note">System rekomendacji: LEVEL + PROFESJA + SKILL + ML + PARTY + EQUIPMENT + QUESTY + RYZYKO → ranking z match%.</p>
  </section>
  <div class="home-grid">
    <section class="panel"><h2>🔥 Popular Hunts</h2><div class="card-grid">${popular.map(s => spotCard(s)).join('')}</div></section>
    <section class="panel">
      <h2>⚡ Best EXP/h</h2>
      <table class="table"><thead><tr><th>Spot</th><th>Level</th><th>EXP/h</th><th>Profit/h</th><th>Ryzyko</th></tr></thead><tbody>${bestExp.map(row).join('')}</tbody></table>
    </section>
    <section class="panel">
      <h2>💰 Best Profit</h2>
      <table class="table"><thead><tr><th>Spot</th><th>Level</th><th>EXP/h</th><th>Profit/h</th><th>Ryzyko</th></tr></thead><tbody>${bestProfit.map(row).join('')}</tbody></table>
    </section>
    <section class="panel"><h2>🆕 Ostatnio aktualizowane</h2><div class="card-grid">${newest.map(s => spotCard(s)).join('')}</div></section>
  </div>`;
  return layout({
    title: 'TibiaHunts — znajdź najlepszy hunting spot w Tibii',
    desc: SITE.desc, url: SITE.url + '/', active: '/',
    jsonld: { '@context': 'https://schema.org', '@type': 'WebSite', name: 'TibiaHunts', description: SITE.desc, potentialAction: { '@type': 'SearchAction', target: '/hunting-spots?q={search_term_string}', 'query-input': 'required name=search_term_string' } },
    content
  });
}

/* --------------------------------------------------- SPOT LIST SSR --- */
function renderList({ title, desc, spots, extra = '', heading }) {
  const content = `
  <section class="panel">
    <h1>${esc(heading || title)}</h1>
    <p class="muted">${esc(desc)}</p>
    ${extra}
    <div class="filter-bar" id="filterBar">
      <form id="filterForm" action="/hunting-spots" method="get" class="filters">
        <select name="vocation"><option value="">Profesja: wszystkie</option><option value="EK">EK</option><option value="RP">RP</option><option value="MS">MS</option><option value="ED">ED</option><option value="MNK">Monk</option></select>
        <input name="min" type="number" placeholder="Level od">
        <input name="max" type="number" placeholder="Level do">
        <select name="mode"><option value="">Tryb: każdy</option><option value="solo">Solo</option><option value="duo">Duo</option><option value="party">Party</option></select>
        <select name="pacc"><option value="">PACC/FREE: bez znaczenia</option><option value="pacc">PACC</option><option value="free">Free</option></select>
        <select name="risk"><option value="">Ryzyko: każde</option><option value="2">≤ niskie</option><option value="3">≤ średnie</option><option value="4">≤ wysokie</option></select>
        <input name="minExp" placeholder="Min EXP/h (np. 1000000)">
        <input name="minProfit" placeholder="Min Profit/h">
        <input name="maxWaste" placeholder="Max Waste/h">
        <input name="minSkill" type="number" placeholder="Min. skill">
        <input name="minML" type="number" placeholder="Min. ML">
        <input name="damage" placeholder="Damage type (fire/ice/…)">
        <input name="region" placeholder="Region / kontynent">
        <input name="monster" placeholder="Potwór (np. Hydra)">
        <select name="preference"><option value="balanced">Styl: BALANS</option><option value="exp">Styl: EXP</option><option value="profit">Styl: PROFIT</option></select>
        <select name="sort"><option value="level">Sort: level</option><option value="exp">Największy EXP/h</option><option value="profit">Największy Profit/h</option><option value="waste">Najmniejszy waste</option><option value="risk">Najmniejsze ryzyko</option></select>
        <button class="btn btn-gold" type="submit">Filtruj</button>
        <a class="btn btn-ghost" href="/hunting-spots">Wyczyść</a>
      </form>
    </div>
    <p class="muted" id="resultCount">${spots.length} wyników</p>
    <div class="card-grid" id="spotGrid">${spots.map(s => spotCard(s)).join('') || '<p class="muted">Brak wyników — poluzuj filtry.</p>'}</div>
  </section>`;
  return layout({
    title, desc, url: SITE.url + '/hunting-spots', active: '/hunting-spots',
    jsonld: { '@context': 'https://schema.org', '@type': 'ItemList', name: title, itemListElement: spots.slice(0, 30).map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: '/hunt/' + s.slug, name: s.name })) },
    content
  });
}

/* ---------------------------------------------------- SPOT DETAIL --- */
function renderSpot(s) {
  const exp = s.expPerHour ? `${Scoring.fmtGold(s.expPerHour.min)}–${Scoring.fmtGold(s.expPerHour.max)}` : '—';
  const prof = s.profitPerHour ? `${s.profitPerHour.min >= 0 ? '+' : ''}${Scoring.fmtGold(s.profitPerHour.min)} do ${s.profitPerHour.max >= 0 ? '+' : ''}${Scoring.fmtGold(s.profitPerHour.max)}` : '—';
  const waste = s.wastePerHour && s.wastePerHour.max ? Scoring.fmtGold(s.wastePerHour.max) : '0 (bez waste)';
  const list = a => a && a.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">—</p>';
  const monsters = (s.monsters || []).map(m => `<div class="monster-chip">${m.img ? `<img src="${m.img}" alt="${esc(m.name)}">` : '👾'}<span>${esc(m.name)}</span></div>`).join('');
  const statsRows = (s.expByLevel || []).map(e => `<tr><td>${e.range}</td><td><span class="voc-badge voc-${e.vocation}">${e.vocation}</span></td><td>${Scoring.fmtGold(e.xph)}/h</td><td class="${moneyCls(e.profit || 0)}">${e.profit != null ? (e.profit >= 0 ? '+' : '') + Scoring.fmtGold(e.profit) + '/h' : '—'}</td></tr>`).join('');
  const alts = (s.alternatives || []).map(a => bySlug(a)).filter(Boolean);
  const content = `
  <nav class="breadcrumbs"><a href="/">Start</a> › <a href="/hunting-spots">Hunting Spoty</a> › <b>${esc(s.name)}</b></nav>
  <article class="spot-detail">
    <div class="spot-hero">
      ${s.hero ? `<img src="${heroUrl(s)}" alt="Screenshot gameplayu: ${esc(s.name)}"><p class="img-src">Screen gameplayu: klatka z poradnika wideo — źródło w sekcji Źródła.</p>` : '<div class="media-fallback big">🗺</div>'}
    </div>
    <header class="spot-head">
      <div>
        <h1>${esc(s.name)}</h1>
        <p class="muted">${esc(s.region)} · miasto: ${esc(s.city)} · kontynent: ${esc(s.continent)}</p>
        <p class="muted small">LAST UPDATED: ${esc(s.lastUpdated)} ${s.dataQuality === 'catalog' ? '· <span class="tag warn">katalog / poziom przybliżony</span>' : s.dataQuality === 'estimate' ? '· <span class="tag warn">dane szacunkowe</span>' : '· <span class="tag ok">dane społeczności</span>'}</p>
      </div>
      <div class="spot-head-actions">
        <button class="btn btn-ghost btn-compare" data-id="${s.id}">⇄ Dodaj do porównania</button>
        <a class="btn btn-gold" href="/map?spot=${s.slug}">📍 Pokaż na mapie</a>
      </div>
    </header>
    <section class="stat-grid">
      <div class="stat-box"><span class="k">Recommended Level</span><b>${esc(s.recLevel)}</b></div>
      <div class="stat-box"><span class="k">Vocations</span><b>${vocBadges(s.vocations)}</b></div>
      <div class="stat-box"><span class="k">Mode</span><b>${(s.modes || []).map(m => m.toUpperCase()).join(' / ')}</b>${s.partyRec ? `<small>${esc(s.partyRec)}</small>` : ''}</div>
      <div class="stat-box exp-b"><span class="k">EXP/h</span><b>${exp}</b></div>
      <div class="stat-box ${moneyCls(s.profitPerHour ? s.profitPerHour.avg : 0)}"><span class="k">PROFIT/h</span><b>${prof}</b></div>
      <div class="stat-box"><span class="k">WASTE/h</span><b>${waste}</b></div>
      <div class="stat-box"><span class="k">DIFFICULTY</span><b class="gold">${stars(s.difficulty)}</b></div>
      <div class="stat-box"><span class="k">RISK</span><b class="risk-${s.risk}">${stars(s.risk)}</b></div>
    </section>
    <p class="lead">${esc(s.description)}</p>
    <div class="detail-grid">
      <section class="dsec"><h2>MONSTERS</h2><div class="monster-list">${monsters}</div><p class="muted small">Dominujące obrażenia: ${(s.damageTypes || []).join(', ')}. Zalecane resisty: ${(s.resistances || []).join(', ') || '—'}.</p></section>
      <section class="dsec"><h2>EXP / PROFIT wg levelu</h2>
        <table class="table"><thead><tr><th>Level</th><th>Voc</th><th>EXP/h</th><th>Profit/h</th></tr></thead><tbody>${statsRows || '<tr><td colspan=4 class="muted">brak pomiarów</td></tr>'}</tbody></table>
        <p class="muted small">Wartości z pomiarów społeczności — patrz sekcja Źródła. Po rebalance'ach mogą się różnić.</p>
      </section>
      <section class="dsec"><h2>REQUIREMENTS</h2>${list([...(s.gear || []).slice(0, 3), ...(s.access || [])])}
        <p class="muted small">Min. skill ~${Scoring.requiredSkill(s)} · Min. ML ~${Scoring.requiredML(s)} (heurystyka) · ${s.pacc ? 'wymagany PACC' : 'dostępny dla Free Account'}</p></section>
      <section class="dsec"><h2>QUESTS</h2>${list(s.quests.length ? s.quests : ['Brak wymaganych questów'])}</section>
      <section class="dsec"><h2>ACCESS</h2>${list(s.access.length ? s.access : [s.city ? 'Start z miasta: ' + s.city : '—'])}</section>
      <section class="dsec"><h2>RECOMMENDED GEAR</h2>${list(s.gear)}</section>
      <section class="dsec"><h2>RECOMMENDED SPELLS</h2>${list(s.spells)}</section>
      <section class="dsec"><h2>RECOMMENDED RUNES</h2>${list(s.runes)}</section>
      <section class="dsec"><h2>POTIONS</h2>${list(s.potions)}</section>
      <section class="dsec"><h2>HUNTING ROUTE</h2><p>${esc(s.rotation || '—')}</p>${s.bestTime ? `<p><b>Najlepsza pora/warunki:</b> ${esc(s.bestTime)}</p>` : ''}</section>
      <section class="dsec"><h2>TIPS & TRICKS</h2><p><b>Pullowanie:</b> ${esc(s.pulling || '—')}</p></section>
      <section class="dsec"><h2>ALTERNATIVE HUNTS</h2>${alts.length ? `<div class="alt-list">${alts.map(a => `<a class="chip" href="/hunt/${a.slug}">${esc(a.name)} (lv ${esc(a.recLevel)})</a>`).join('')}</div>` : '<p class="muted">—</p>'}</section>
      <section class="dsec" id="nextLevelSec"><h2>WHERE TO HUNT NEXT?</h2>
        <form id="nextLevelForm" class="inline-form">
          <select id="nlVoc"><option value="EK">EK</option><option value="RP">RP</option><option value="MS">MS</option><option value="ED">ED</option><option value="MNK">Monk</option></select>
          <input id="nlLevel" type="number" placeholder="Twój level" min="8" max="1500">
          <button class="btn btn-sm btn-gold" type="submit">Pokaż progresję</button>
        </form>
        <div id="nextLevelOut"></div>
      </section>
    </div>
    <section class="dsec">
      <h2>ŹRÓDŁA DANYCH</h2>
      <ul class="src-list">${(s.sources || []).map(src => `<li><a href="${esc(src.url)}" rel="noopener">${esc(src.label)}</a></li>`).join('')}</ul>
      ${s.video ? `<p>🎬 Poradnik wideo: <a href="${esc(s.video.url)}" rel="noopener">${esc(s.video.title)}</a></p>` : ''}
      <p class="muted small">Dane EXP/profit są szacunkami społeczności (nie oficjalnymi danymi CipSoft) i mogły się zmienić po aktualizacjach gry.</p>
    </section>
  </article>`;
  return layout({
    title: `${s.name} — hunting spot lv ${s.recLevel} | TibiaHunts`,
    desc: `${s.name} (${s.region}): level ${s.recLevel}, EXP/h ${exp}, profit ${prof}. Wymagania, potwory, trasa i porady.`,
    url: SITE.url + '/hunt/' + s.slug, type: 'article', active: '/hunting-spots',
    jsonld: { '@context': 'https://schema.org', '@type': 'CreativeWork', name: s.name, description: s.description, genre: 'Tibia hunting guide', about: { '@type': 'Thing', name: 'Tibia hunting spot' } },
    content
  });
}

/* -------------------------------------------------------- ROUTES --- */
app.get('/', (req, res) => res.send(renderHome()));

const VOC_PAGES = {
  'master-sorcerer': ['MS', 'Master Sorcerer'], 'elite-knight': ['EK', 'Elite Knight'],
  'royal-paladin': ['RP', 'Royal Paladin'], 'elder-druid': ['ED', 'Elder Druid'], 'monk': ['MNK', 'Monk']
};

app.get('/hunting-spots', (req, res) => {
  const q = req.query;
  const spots = applyFilters(SPOTS, q);
  // professional profile recommendation when vocation+level given
  let extra = '';
  if (q.vocation && q.level) {
    const recs = Scoring.recommend({
      vocation: q.vocation, level: +q.level, mode: q.mode || 'solo', pacc: q.pacc === 'free' ? false : true,
      preference: q.preference || 'balanced', maxRisk: q.risk ? +q.risk : null,
      skill: q.skill, ml: q.ml, equipTier: q.equipTier !== undefined ? +q.equipTier : 2,
      partyVocations: q.partyVocs ? q.partyVocs.split(',') : []
    }, SPOTS, 12);
    extra = `<section class="rec-panel"><h2>TOP REKOMENDACJE — ${Scoring.VOC_LABEL[q.vocation] || q.vocation}, level ${esc(q.level)}</h2><ol class="rec-list">${recs.slice(0, 5).map(r => `<li><a href="/hunt/${r.spot.slug}"><b>${esc(r.spot.name)}</b></a> — EXP: ${r.spot.expPerHour ? Scoring.fmtGold(r.spot.expPerHour.min) + '–' + Scoring.fmtGold(r.spot.expPerHour.max) + '/h' : '—'} · PROFIT: ${r.spot.profitPerHour ? (r.spot.profitPerHour.avg >= 0 ? '+' : '') + Scoring.fmtGold(r.spot.profitPerHour.avg) + '/h' : '—'} · RYZYKO: ${['', 'minimalne', 'niskie', 'średnie', 'wysokie', 'ekstremalne'][r.spot.risk]} · match ${r.fit}%${r.warnings.length ? `<br><small class="muted">${r.warnings.slice(0, 2).join(' · ')}</small>` : ''}</li>`).join('')}</ol></section>`;
  }
  const active = Object.keys(VOC_PAGES).find(k => q.page === k);
  res.send(renderList({
    title: 'Hunting Spoty Tibia — pełna lista z filtrami | TibiaHunts',
    desc: 'Przeglądaj i filtruj miejscówki do expienia w Tibii: level, profesja, tryb, ryzyko, EXP/h, profit, region i potwory.',
    spots, extra, heading: `Hunting Spoty (${spots.length})`
  }));
});

app.get('/hunting-spots/:slug', (req, res) => {
  const slug = req.params.slug;
  if (VOC_PAGES[slug]) {
    const [voc, label] = VOC_PAGES[slug];
    const spots = applyFilters(SPOTS, { vocation: voc, sort: 'level', dir: 'asc' });
    return res.send(renderList({
      title: `Hunting spoty dla ${label} | TibiaHunts`,
      desc: `Najlepsze miejscówki do expienia w Tibii dla profesji ${label} — posortowane od niskich leveli.`,
      spots, heading: `${label} — hunting spoty`
    }));
  }
  const lm = slug.match(/^level-(\d+)$/);
  if (lm) {
    const lvl = +lm[1];
    const spots = applyFilters(SPOTS, { level: lvl });
    return res.send(renderList({
      title: `Hunting spoty na level ${lvl} | TibiaHunts`,
      desc: `Miejscówki do expienia w Tibii dopasowane do levelu ${lvl}.`,
      spots, heading: `Hunting spoty około levelu ${lvl}`
    }));
  }
  const s = bySlug(slug);
  if (!s) return res.status(404).send(renderList({ title: 'Nie znaleziono | TibiaHunts', desc: 'Nie znaleziono strony.', spots: [], heading: '404 — brak takiej miejscówki' }));
  res.send(renderSpot(s));
});
app.get('/hunt/:slug', (req, res) => {
  const s = bySlug(req.params.slug);
  if (!s) return res.status(404).send('Not found');
  res.send(renderSpot(s));
});

app.get('/map', (req, res) => res.send(layout({
  title: 'Interaktywna mapa Tibii — hunting spoty | TibiaHunts',
  desc: 'Mapa świata Tibii (automapa tibiamaps.io) z zaznaczonymi hunting spotami, miastami, depotami, bankami i świątyniami.',
  active: '/map',
  content: `<section class="panel map-panel">
    <h1>Mapa Tibii</h1>
    <p class="muted">Prawdziwa automapa świata (kafelki tibiamaps.io). Znaczniki spotów pochodzą z bazy (realne współrzędne tibiamaps.io lub przybliżone — oznaczone ⚠). Kliknij znacznik, aby otworzyć kartę spotu.</p>
    <div class="map-toolbar">
      <div class="map-search-row">
        <input id="mapMarkerSearch" type="search" placeholder="Szukaj znacznika: boss, quest, exit, spawn, teleport...">
        <select id="mapMarkerType">
          <option value="">Wszystkie typy</option><option value="hunt">⚔ Hunt / boss</option><option value="danger">☠ Danger / spawn</option><option value="location">⚑ Lokacje / wejścia</option><option value="stairs">↕ Schody / przejścia</option><option value="poi">★ POI</option><option value="quest">? Quest</option>
        </select>
        <label class="chk"><input type="checkbox" id="showFloorOnly"> Tylko bieżące piętro</label>
        <span class="muted small" id="mapMarkerCount">0 znaczników</span>
      </div>
      <div class="map-controls-row">
        <button id="mapZoomIn" class="btn btn-sm">＋</button><button id="mapZoomOut" class="btn btn-sm">－</button>
        <button id="mapFloorUp" class="btn btn-sm">▲ piętro</button><button id="mapFloorDown" class="btn btn-sm">▼ piętro</button>
        <span class="muted small" id="mapFloorLabel">piętro: 0</span>
        <label class="chk"><input type="checkbox" id="showSpots" checked> Hunting spoty</label>
        <label class="chk"><input type="checkbox" id="showCities" checked> Miasta/POI</label>
        <span class="muted small" id="mapCoords"></span>
      </div>
    </div>
    <div id="tibiaMap" class="tibia-map" data-spot="${esc(req.query.spot || '')}"></div>
    <div id="mapPopup" class="map-popup" hidden></div>
    <p class="muted small">Uwaga: kafelki mapy ładowane są z tibiamaps.github.io (GitHub Pages). Bez internetu zobaczysz siatkę zastępczą.</p>
  </section>`,
  jsonld: { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Mapa Tibii z hunting spotami' }
})));

app.get('/compare', (req, res) => res.send(layout({
  title: 'Porównywarka hunting spotów | TibiaHunts',
  desc: 'Porównaj hunting spoty: EXP/h, profit/h, waste, ryzyko i level. Wykresy EXP i profitu.',
  active: '/compare',
  content: `<section class="panel"><h1>Porównywarka</h1>
    <p class="muted">Zaznacz spoty na listach lub kartach przyciskiem „⇄ Porównaj” (do 5). Możesz też dodać po ID poniżej.</p>
    <div class="inline-form"><input id="cmpAdd" placeholder="ID lub nazwa spotu…"><button class="btn btn-sm btn-gold" id="cmpAddBtn">Dodaj</button></div>
    <div id="compareOut"><p class="muted">Brak wybranych spotów.</p></div>
  </section>`
})));

app.get('/party', (req, res) => res.send(layout({
  title: 'System Party — hunt dla drużyny | TibiaHunts',
  desc: 'Zdefiniuj skład party (profesje i levele graczy) i znajdź hunting spoty dla całej drużyny wraz z rolami.',
  active: '/party',
  content: `<section class="panel"><h1>System dla Party</h1>
    <p class="muted">Dodaj członków drużyny (do 8). System przeanalizuje skład: level, pokrycie ról (tank/heal/dps) i dobierze hunt dla całej ekipy.</p>
    <div id="partyPlayers"></div>
    <div class="inline-form">
      <button class="btn btn-sm" id="partyAdd">+ Dodaj gracza</button>
      <select id="partyPref"><option value="balanced">BALANS</option><option value="exp">EXP</option><option value="profit">PROFIT</option></select>
      <button class="btn btn-gold" id="partyGo">Analizuj drużynę</button>
    </div>
    <div id="partyOut"></div>
  </section>`
})));

app.get('/planner', (req, res) => res.send(layout({
  title: 'Personalny plan expienia | TibiaHunts',
  desc: 'Generator trasy expienia: podaj profesję, level i cel, a dostaniesz plan „LEVEL X → Y: hunt” z szacowanym czasem.',
  active: '/planner',
  content: `<section class="panel"><h1>CREATE MY HUNTING ROUTE</h1>
    <form id="planForm" class="filters">
      <select name="vocation"><option value="EK">Elite Knight</option><option value="RP">Royal Paladin</option><option value="MS">Master Sorcerer</option><option value="ED">Elder Druid</option><option value="MNK">Monk</option></select>
      <input name="level" type="number" placeholder="Aktualny level" required min="8" max="1500">
      <input name="target" type="number" placeholder="Level docelowy" required min="9" max="1500">
      <select name="mode"><option value="solo">SOLO</option><option value="duo">DUO</option><option value="party">PARTY</option></select>
      <select name="preference"><option value="balanced">BALANS</option><option value="exp">EXP</option><option value="profit">PROFIT</option></select>
      <select name="equipTier"><option value="1">Sprzęt: podstawowy</option><option value="2" selected>Sprzęt: standardowy</option><option value="3">Sprzęt: top</option></select>
      <button class="btn btn-gold" type="submit">Generuj plan</button>
    </form>
    <div id="planOut"></div>
  </section>`
})));

app.get('/about', (req, res) => res.send(layout({
  title: 'Źródła danych i metodologia | TibiaHunts',
  desc: 'Skąd pochodzą dane o hunting spotach, obrazach i mapie. Metodologia szacunków.',
  active: '/about',
  content: `<section class="panel prose">
  <h1>Źródła danych i metodologia</h1>
  <h2>Dane liczbowe (EXP/h, profit/h)</h2>
  <p>Wartości pochodzą z publicznych, społecznościowych baz huntów: <a href="https://tibiapal.com/hunting" rel="noopener">TibiaPal.com</a> (tabele raw exp i loot per profesja/level), <a href="https://intibia.com/hunts" rel="noopener">Intibia.com</a> (zakresy EXP/profit i wymagania) oraz <a href="https://tibiaroute.com" rel="noopener">TibiaRoute.com</a>. TibiaPal zaznacza, że część danych pochodzi sprzed „Vocation Rebalance 2026” — traktuj liczby jako <b>szacunki</b>, które zależą też od świata gry, cen rynkowych i stylu gry. Miejsca bez pomiarów oznaczamy jako „dane szacunkowe”.</p>
  <h2>Współrzędne i mapa</h2>
  <p>Mapa świata ładowana jest z kafelków projektu <a href="https://tibiamaps.io" rel="noopener">tibiamaps.io</a> (tibiamaps.github.io/tibia-map-data). Znaczniki miast, depotów, banków i wejść do dungeonów pochodzą z pliku markers.json tego projektu (realne współrzędne w grze). Znaczniki oznaczone „przybliżone” można poprawić w panelu administratora.</p>
  <h2>Grafiki</h2>
  <p>Sprite'y stworzeń to zasoby gry Tibia (dystrybuowane przez Intibia.com). Screeny na kartach to klatki z poradników wideo (YouTube) zlinkowanych przy każdej miejscówce. Wszystkie materiały przedstawiają rzeczywisty wygląd gry — nic nie jest imitowane. Prawa: Tibia © CipSoft GmbH.</p>
  <h2>Zastrzeżenie</h2>
  <p>TibiaHunts to narzędzie fanowskie, stworzone przez graczy dla graczy. Nie jest oficjalną stroną CipSoft i nie jest przez CipSoft zatwierdzone ani sponsorowane.</p>
  <h2>Aktualizacja danych</h2>
  <p>Panel administratora (<a href="/admin">/admin</a>) pozwala edytować wartości EXP/profit, zakresy leveli, wymagania i screeny oraz importować/eksportować całą bazę (JSON). Każda miejscówka pokazuje pole „LAST UPDATED”.</p>
  </section>`
})));

/* ---------------------------------------------------------- ADMIN --- */
app.get('/admin', (req, res) => res.send(layout({
  title: 'Panel administratora | TibiaHunts',
  desc: 'Dodawanie, edycja i usuwanie hunting spotów, import/eksport danych.',
  content: `<section class="panel"><h1>Panel administratora</h1>
  <div id="adminLogin">
    <p class="muted">Podaj token administratora (domyślnie: <code>tibia-admin-2026</code>, zmień przez zmienną środowiskową ADMIN_TOKEN).</p>
    <div class="inline-form"><input id="adminToken" type="password" placeholder="Token admina"><button class="btn btn-gold" id="adminLoginBtn">Zaloguj</button></div>
  </div>
  <div id="adminPanel" hidden>
    <div class="admin-toolbar">
      <button class="btn btn-gold" id="newSpotBtn">＋ Nowy hunting spot</button>
      <button class="btn" id="exportBtn">⬇ Eksport JSON</button>
      <label class="btn btn-ghost">⬆ Import JSON<input type="file" id="importFile" accept=".json" hidden></label>
      <span class="muted small" id="adminInfo"></span>
    </div>
    <input id="adminSearch" placeholder="Filtruj listę (nazwa/region)…">
    <div id="adminList"></div>
    <div id="adminEditor" hidden></div>
  </div>
  </section>`
})));

function requireAdmin(req, res, next) {
  if (req.headers['x-admin-token'] === ADMIN_TOKEN) return next();
  res.status(401).json({ error: 'Invalid admin token' });
}
app.post('/api/admin/login', (req, res) => {
  res.json({ ok: req.body.token === ADMIN_TOKEN });
});
app.get('/api/spots/export', (req, res) => res.json(SPOTS));
app.post('/api/spots/import', requireAdmin, (req, res) => {
  const arr = req.body;
  if (!Array.isArray(arr)) return res.status(400).json({ error: 'Expected array' });
  let added = 0, updated = 0;
  for (const s of arr) {
    if (!s.id || !s.name) continue;
    const i = SPOTS.findIndex(x => x.id === s.id);
    if (i >= 0) { SPOTS[i] = Object.assign(SPOTS[i], s); updated++; } else { SPOTS.push(s); added++; }
  }
  saveSpots();
  res.json({ ok: true, added, updated, total: SPOTS.length });
});
app.get('/api/spots', (req, res) => res.json(applyFilters(SPOTS, req.query)));
app.get('/api/spots/:id', (req, res) => {
  const s = bySlug(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json(s);
});
app.post('/api/spots', requireAdmin, (req, res) => {
  const s = req.body;
  if (!s.name) return res.status(400).json({ error: 'name required' });
  if (!s.id) s.id = String(s.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  s.slug = s.id;
  s.lastUpdated = new Date().toLocaleDateString('pl-PL');
  if (bySlug(s.id)) return res.status(409).json({ error: 'id exists' });
  SPOTS.push(s); saveSpots();
  res.json({ ok: true, id: s.id });
});
app.put('/api/spots/:id', requireAdmin, (req, res) => {
  const i = SPOTS.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'not found' });
  SPOTS[i] = Object.assign(SPOTS[i], req.body, { id: SPOTS[i].id, slug: SPOTS[i].slug, lastUpdated: new Date().toLocaleDateString('pl-PL') });
  saveSpots();
  res.json({ ok: true });
});
app.delete('/api/spots/:id', requireAdmin, (req, res) => {
  const i = SPOTS.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'not found' });
  SPOTS.splice(i, 1); saveSpots();
  res.json({ ok: true });
});
app.post('/api/upload', requireAdmin, (req, res) => {
  const { filename, dataUrl } = req.body || {};
  const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return res.status(400).json({ error: 'invalid image data' });
  const ext = m[1] === 'png' ? 'png' : 'jpg';
  const safe = Date.now() + '-' + String(filename || 'img').replace(/[^a-z0-9.-]/gi, '_');
  const dir = path.join(__dirname, 'public', 'images', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, safe + '.' + ext), Buffer.from(m[2], 'base64'));
  res.json({ ok: true, url: `/images/uploads/${safe}.${ext}` });
});

/* ------------------------------------------------- RECOMMEND API --- */
app.post('/api/recommend', (req, res) => {
  const p = req.body || {};
  const profile = {
    vocation: p.vocation || 'EK', level: +p.level || 100, mode: p.mode || 'solo',
    pacc: p.pacc !== false, preference: p.preference || 'balanced',
    maxRisk: p.maxRisk || null, skill: p.skill, ml: p.ml,
    equipTier: p.equipTier === undefined ? 2 : +p.equipTier,
    partyVocations: p.partyVocations || [], doneQuests: p.doneQuests || []
  };
  res.json(recommendOut(profile));
});
function recommendOut(profile) {
  const recs = Scoring.recommend(profile, SPOTS, 15);
  return {
    profile,
    results: recs.map(r => ({
      id: r.spot.id, slug: r.spot.slug, name: r.spot.name, recLevel: r.spot.recLevel,
      fit: r.fit, reasons: r.reasons, warnings: r.warnings,
      exp: r.spot.expPerHour, profit: r.spot.profitPerHour, risk: r.spot.risk,
      vocations: r.spot.vocations, city: r.spot.city, region: r.spot.region
    }))
  };
}
app.post('/api/party', (req, res) => {
  const { players, preference, pacc, maxRisk, equipTier } = req.body || {};
  res.json(Scoring.partyAnalysis(players || [], SPOTS, { preference, pacc, maxRisk, equipTier }));
});
app.post('/api/plan', (req, res) => {
  const p = req.body || {};
  const profile = {
    vocation: p.vocation || 'EK', level: +p.level || 8, mode: p.mode || 'solo', pacc: true,
    preference: p.preference || 'balanced', equipTier: p.equipTier === undefined ? 2 : +p.equipTier
  };
  const steps = Scoring.buildPlan(profile, SPOTS, +p.target || profile.level + 100);
  res.json({ profile, target: +p.target, steps: steps.map(st => ({ from: st.from, to: st.to, name: st.spot.name, slug: st.spot.slug, recLevel: st.spot.recLevel, hours: st.hours, expNeed: st.expNeed })) });
});
app.get('/api/search', (req, res) => res.json(globalSearch(req.query.q)));
app.get('/api/next-steps', (req, res) => {
  const profile = { vocation: req.query.voc || 'EK', level: +req.query.level || 100, pacc: true, preference: 'balanced', equipTier: 2, mode: 'solo' };
  const steps = Scoring.nextSteps(profile, SPOTS, 3);
  res.json(steps.map(st => ({ from: st.from, to: st.to, name: st.spot.name, slug: st.spot.slug, recLevel: st.spot.recLevel })));
});
app.get('/api/cities', (req, res) => res.json(CITIES));

app.get('/api/map-markers', (req, res) => {
  const floor = req.query.z === undefined || req.query.z === '' ? null : +req.query.z;
  const type = String(req.query.type || '').toLowerCase();
  const q = String(req.query.q || '').toLowerCase().trim();
  const all = floor === null ? MAP_MARKERS : MAP_MARKERS.filter(m => m.z === floor);
  const out = q ? all.filter(m => (m.description || '').toLowerCase().includes(q) || (m.icon || '').toLowerCase().includes(q)) : all;
  const typed = type ? out.filter(m => markerType(m.icon) === type) : out;
  res.json({ total: typed.length, markers: typed });
});

function markerType(icon) {
  const i = String(icon || '').toLowerCase();
  if (i.includes('sword')) return 'hunt';
  if (i.includes('skull') || i === 'crossmark') return 'danger';
  if (i.includes('flag')) return 'location';
  if (i === 'up' || i === 'down' || i.startsWith('red ')) return 'stairs';
  if (i === 'star') return 'poi';
  if (i === '?' || i === '!') return 'quest';
  return 'other';
}
app.get('/api/spots-map-markers', (req, res) => res.json(SPOTS.map(s => ({
  id: s.id, slug: s.slug, name: s.name, recLevel: s.recLevel, vocations: s.vocations,
  x: s.coords.x, y: s.coords.y, z: s.coords.z, approx: !!s.coords.approx, risk: s.risk,
  exp: s.expPerHour ? Scoring.fmtGold(s.expPerHour.avg) + '/h' : null,
  dataQuality: s.dataQuality || 'measured', source: s.source || null
}))));

/* ------------------------------------------------------- SEO misc --- */
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: /sitemap.xml\n`);
});
app.get('/sitemap.xml', (req, res) => {
  const urls = ['/', '/hunting-spots', '/map', '/party', '/planner', '/compare', '/about',
    ...Object.keys(VOC_PAGES).map(k => '/hunting-spots/' + k),
    '/hunting-spots/level-50', '/hunting-spots/level-100', '/hunting-spots/level-200',
    ...SPOTS.map(s => '/hunt/' + s.slug)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${u}</loc><changefreq>weekly</changefreq></url>`).join('\n')}\n</urlset>`);
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => res.status(404).send(renderList({ title: '404 | TibiaHunts', desc: 'Nie znaleziono strony.', spots: [], heading: '404' })));

app.listen(PORT, '0.0.0.0', () => console.log(`TibiaHunts running on http://0.0.0.0:${PORT}`));
