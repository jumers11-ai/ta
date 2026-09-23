/* TibiaHunts — client-side app logic */
(function () {
  'use strict';
  const S = window.TibiaScoring;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const gold = (n) => S.fmtGold(n);
  const riskWord = ['—', 'minimalne', 'niskie', 'średnie', 'wysokie', 'ekstremalne'];

  /* ------------------------------------------------ nav toggle */
  const navToggle = $('#navToggle');
  if (navToggle) navToggle.addEventListener('click', () => $('#navLinks').classList.toggle('open'));

  /* ------------------------------------------------ global search */
  const gs = $('#globalSearch'), sr = $('#searchResults');
  let searchTimer = null;
  if (gs) {
    gs.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = gs.value.trim();
      if (q.length < 2) { sr.hidden = true; return; }
      searchTimer = setTimeout(async () => {
        try {
          const r = await (await fetch('/api/search?q=' + encodeURIComponent(q))).json();
          let html = '';
          if (r.spots.length) {
            html += '<div class="sr-group">Hunting spoty</div>';
            html += r.spots.map(s => `<a class="sr-item" href="/hunt/${esc(s.slug)}">🗺 <span><b>${esc(s.name)}</b> <small class="muted">lv ${esc(s.recLevel)} · ${esc(s.city)}</small></span></a>`).join('');
          }
          if (r.monsters.length) {
            html += '<div class="sr-group">Potwory</div>';
            html += r.monsters.map(m => `<a class="sr-item" href="/hunt/${esc(m.spot)}">${m.img ? `<img src="${esc(m.img)}" alt="">` : '👾'}<span>${esc(m.name)} <small class="muted">→ ${esc(m.spotName)}</small></span></a>`).join('');
          }
          if (r.cities.length) {
            html += '<div class="sr-group">Miasta</div>';
            html += r.cities.map(c => `<a class="sr-item" href="/map?city=${encodeURIComponent(c.name)}">📍 <span>${esc(c.name)} <small class="muted">${esc(c.continent)}</small></span></a>`).join('');
          }
          sr.innerHTML = html || '<div class="sr-item">Brak wyników</div>';
          sr.hidden = false;
        } catch (e) { /* ignore */ }
      }, 220);
    });
    document.addEventListener('click', (e) => { if (!sr.contains(e.target) && e.target !== gs) sr.hidden = true; });
    gs.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); location.href = '/hunting-spots?q=' + encodeURIComponent(gs.value); } });
  }

  /* ------------------------------------------------ compare */
  function cmpList() { try { return JSON.parse(localStorage.getItem('tibiaHuntsCompare') || '[]'); } catch (e) { return []; } }
  function cmpSave(l) { localStorage.setItem('tibiaHuntsCompare', JSON.stringify(l.slice(0, 5))); document.dispatchEvent(new CustomEvent('cmp-changed')); }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('.btn-compare');
    if (!b) return;
    const id = b.dataset.id;
    let l = cmpList();
    if (l.includes(id)) { l = l.filter(x => x !== id); b.textContent = '⇄ Porównaj'; }
    else { l.push(id); b.textContent = '✓ Na liście'; }
    cmpSave(l);
  });
  function markCompareButtons() {
    const l = cmpList();
    $$('.btn-compare').forEach(b => { if (l.includes(b.dataset.id)) b.textContent = '✓ Na liście'; });
  }
  markCompareButtons();

  /* ------------------------------------------------ compare page */
  const cmpOut = $('#compareOut');
  if (cmpOut) {
    async function renderCompare() {
      const ids = cmpList();
      if (!ids.length) { cmpOut.innerHTML = '<p class="muted">Brak wybranych spotów. Dodaj je przyciskiem „⇄ Porównaj”.</p>'; return; }
      const spots = [];
      for (const id of ids) {
        try { spots.push(await (await fetch('/api/spots/' + id)).json()); } catch (e) { }
      }
      if (!spots.length) { cmpOut.innerHTML = '<p class="muted">Nie znaleziono spotów.</p>'; return; }
      const maxExp = Math.max(...spots.map(s => s.expPerHour ? s.expPerHour.max : 0));
      const maxAbsProfit = Math.max(...spots.map(s => s.profitPerHour ? Math.max(Math.abs(s.profitPerHour.min), Math.abs(s.profitPerHour.max)) : 0), 1);
      const rows = spots.map(s => `<tr>
        <td><a href="/hunt/${esc(s.slug)}"><b>${esc(s.name)}</b></a><br><small class="muted">${esc(s.region)}</small></td>
        <td>${esc(s.recLevel)}</td>
        <td class="exp">${s.expPerHour ? gold(s.expPerHour.min) + '–' + gold(s.expPerHour.max) : '—'}</td>
        <td class="${s.profitPerHour && s.profitPerHour.avg >= 0 ? 'pos' : 'neg'}">${s.profitPerHour ? (s.profitPerHour.min >= 0 ? '+' : '') + gold(s.profitPerHour.min) + ' … ' + (s.profitPerHour.max >= 0 ? '+' : '') + gold(s.profitPerHour.max) : '—'}</td>
        <td>${s.wastePerHour && s.wastePerHour.max ? gold(s.wastePerHour.max) : '0'}</td>
        <td class="risk-${s.risk}">${riskWord[s.risk]}</td>
        <td>${s.vocations.join(', ')}</td>
        <td><button class="btn btn-sm btn-ghost cmp-del" data-id="${esc(s.id)}">✕</button></td></tr>`).join('');
      const bars = (key, cls) => spots.map(s => {
        const v = key === 'exp' ? (s.expPerHour ? s.expPerHour.avg : 0) : (s.profitPerHour ? s.profitPerHour.avg : 0);
        const w = key === 'exp' ? Math.max(2, Math.round(v / maxExp * 100)) : Math.max(2, Math.round(Math.abs(v) / maxAbsProfit * 100));
        const c = key === 'exp' ? 'exp' : (v >= 0 ? 'profit-pos' : 'profit-neg');
        return `<div class="bar-row"><span>${esc(s.name)}</span><div class="bar-track"><div class="bar-fill ${c}" style="width:${w}%"></div></div><span class="${v >= 0 ? 'pos' : 'neg'}">${gold(v)}</span></div>`;
      }).join('');
      cmpOut.innerHTML = `<div class="compare-wrap"><table class="table">
        <thead><tr><th>Hunting Spot</th><th>Level</th><th>EXP/h</th><th>Profit/h</th><th>Waste/h</th><th>Ryzyko</th><th>Voc</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        <div class="chart-row">
          <div class="chart-box"><h3 class="gold">⚡ Średni EXP/h</h3>${bars('exp')}</div>
          <div class="chart-box"><h3 class="gold">💰 Średni Profit/h</h3>${bars('profit')}</div>
        </div>
        <p class="muted small">Wartości szacunkowe na podstawie pomiarów społeczności (patrz sekcja Źródła na kartach spotów).</p>`;
      $$('.cmp-del').forEach(b => b.addEventListener('click', () => { cmpSave(cmpList().filter(x => x !== b.dataset.id)); renderCompare(); }));
    }
    renderCompare();
    document.addEventListener('cmp-changed', renderCompare);
    const addBtn = $('#cmpAddBtn'), addIn = $('#cmpAdd');
    if (addBtn) addBtn.addEventListener('click', async () => {
      const q = (addIn.value || '').trim();
      if (!q) return;
      const r = await (await fetch('/api/search?q=' + encodeURIComponent(q))).json();
      if (r.spots.length) { cmpSave([...new Set([...cmpList(), r.spots[0].slug])]); addIn.value = ''; renderCompare(); }
      else alert('Nie znaleziono spotu.');
    });
  }

  /* ------------------------------------------------ map page */
  const mapEl = $('#tibiaMap');
  if (mapEl && window.TibiaMap) {
    const qs = new URLSearchParams(location.search);
    const spotSlug = mapEl.dataset.spot || qs.get('spot');
    const cityParam = qs.get('city');
    Promise.all([
      fetch('/api/spots-map-markers').then(r => r.json()),
      fetch('/api/cities').then(r => r.json())
    ]).then(([markers, citiesData]) => {
      const cityMarkers = [];
      for (const c of citiesData.cities) {
        cityMarkers.push({ name: c.name, x: c.x, y: c.y, z: c.z, type: 'city' });
        const icons = { depot: '📦 depot', bank: '🏦 bank', temple: '⛪ temple', bless: '✨ bless' };
        for (const [type, p] of Object.entries(c.poi || {})) {
          if (p && p.x) cityMarkers.push({ name: c.name + ' — ' + (p.label || icons[type] || type), x: p.x, y: p.y, z: p.z, type: type });
        }
      }
      let sx = 32369, sy = 32241, sz = 7, zoom = 2;
      if (spotSlug) { const m = markers.find(x => x.slug === spotSlug); if (m) { sx = m.x; sy = m.y; sz = m.z; zoom = 4; } }
      if (cityParam) { const c = citiesData.cities.find(x => x.name.toLowerCase() === cityParam.toLowerCase()); if (c) { sx = c.x; sy = c.y; sz = c.z; zoom = 4; } }
      const map = window.TibiaMap(mapEl, {
        x: sx, y: sy, z: sz, zoom: zoom,
        onCoords: (x, y, f) => {
          const el = $('#mapCoords'); if (el) el.textContent = `X: ${x}  Y: ${y}`;
          const fl = $('#mapFloorLabel'); if (fl) fl.textContent = 'piętro: ' + (f === 7 ? '0' : (f < 7 ? '+' + (7 - f) : '-' + (f - 7)));
        },
        onSelect: (m) => {
          const pop = $('#mapPopup');
          if (m.kind === 'spot') {
            pop.innerHTML = `<h3>🗺 ${esc(m.name)}</h3>
              <p class="small">Rekomendowany level: <b>${esc(m.recLevel)}</b> · Profesje: ${(m.vocations || []).map(v => `<span class="voc-badge voc-${esc(v)}">${esc(v)}</span>`).join(' ')} ·
              Ryzyko: <span class="risk-${m.risk}">${riskWord[m.risk]}</span>${m.approx ? ' · <span class="tag warn">współrzędne przybliżone</span>' : ''}</p>
              ${m.exp ? `<p class="small">Śr. EXP: <b class="exp">${esc(m.exp)}</b></p>` : ''}
              <div class="inline-form"><a class="btn btn-gold btn-sm" href="/hunt/${esc(m.slug)}">Otwórz kartę spotu</a>
              <button class="btn btn-sm" id="popCenter">Wyśrodkuj</button></div>`;
            $('#popCenter').addEventListener('click', () => map.centerOn(m.x, m.y, m.z, 5));
          } else {
            pop.innerHTML = `<h3>📍 ${esc(m.name)}</h3><p class="small muted">Znacznik POI miasta (depot/bank/temple/bless) — dane tibiamaps.io.</p>`;
          }
          pop.hidden = false;
        }
      });
      map.setMarkers(markers);
      map.setCities(citiesData.cities);
      $('#mapZoomIn').addEventListener('click', () => map.zoom(1));
      $('#mapZoomOut').addEventListener('click', () => map.zoom(-1));
      $('#mapFloorUp').addEventListener('click', () => map.floorUp());
      $('#mapFloorDown').addEventListener('click', () => map.floorDown());
      $('#showSpots').addEventListener('change', e => map.setShowSpots(e.target.checked));
      $('#showCities').addEventListener('change', e => map.setShowCities(e.target.checked));
      if (spotSlug) setTimeout(() => { const m = markers.find(x => x.slug === spotSlug); if (m) $('#mapPopup').hidden = false; }, 300);
    });
  }

  /* ------------------------------------------------ party page */
  const partyBox = $('#partyPlayers');
  if (partyBox) {
    const VOCS = [['EK', 'Elite Knight'], ['RP', 'Royal Paladin'], ['MS', 'Master Sorcerer'], ['ED', 'Elder Druid'], ['MNK', 'Monk']];
    function playerRow(voc, lvl) {
      const div = document.createElement('div');
      div.className = 'party-player';
      div.innerHTML = `<span class="voc-badge voc-${voc}">P</span>
        <select class="p-voc">${VOCS.map(([v, n]) => `<option value="${v}" ${v === voc ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <input class="p-lvl" type="number" min="8" max="1500" placeholder="Level" value="${lvl || ''}">
        <button class="btn btn-sm btn-ghost p-del">✕</button>`;
      div.querySelector('.p-del').addEventListener('click', () => div.remove());
      return div;
    }
    partyBox.appendChild(playerRow('MS', 150));
    partyBox.appendChild(playerRow('ED', 150));
    $('#partyAdd').addEventListener('click', () => { if ($$('.party-player', partyBox).length < 8) partyBox.appendChild(playerRow('EK', 150)); });
    $('#partyGo').addEventListener('click', async () => {
      const players = $$('.party-player', partyBox).map(r => ({ vocation: r.querySelector('.p-voc').value, level: +r.querySelector('.p-lvl').value || 0 })).filter(p => p.level > 0);
      const out = $('#partyOut');
      if (!players.length) { out.innerHTML = '<p class="neg">Podaj levele graczy.</p>'; return; }
      out.innerHTML = '<p class="muted">Analizuję skład…</p>';
      const r = await (await fetch('/api/party', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ players, preference: $('#partyPref').value, pacc: true, equipTier: 2 })
      })).json();
      if (r.error) { out.innerHTML = `<p class="neg">${esc(r.error)}</p>`; return; }
      const rolesHtml = r.results[0] ? r.results[0].roles.map(x => `<div class="role-card"><b class="voc-badge voc-${esc(x.player.vocation)}">${esc(x.player.vocation)}</b> <b>Lv ${esc(x.player.level)}</b><br>${esc(x.role)}</div>`).join('') : '';
      const huntsHtml = r.results.slice(0, 6).map(x => `<div class="plan-step">
        <div class="lv">Lv ${esc(x.spot.recLevel)}<br><span class="muted small">match ${x.fit}%</span></div>
        <div><a href="/hunt/${esc(x.spot.slug)}"><b>${esc(x.spot.name)}</b></a>
        <div class="muted small">Est. EXP/h party: <b class="exp">${gold(x.estPartyExp)}</b> · Est. profit/h: <b class="${x.estPartyProfit >= 0 ? 'pos' : 'neg'}">${gold(x.estPartyProfit)}</b> · ryzyko: <span class="risk-${x.spot.risk}">${riskWord[x.spot.risk]}</span></div>
        ${x.spot.partyRec ? `<div class="small">🛡 Rotacja: ${esc(x.spot.partyRec)}</div>` : ''}
        ${x.spot.runes && x.spot.runes.length ? `<div class="small">Runy: ${x.spot.runes.map(esc).join(', ')}</div>` : ''}
        ${x.spot.potions && x.spot.potions.length ? `<div class="small">Potiony: ${x.spot.potions.map(esc).join(', ')}</div>` : ''}
        ${x.warnings.length ? `<div class="small neg">⚠ ${x.warnings.slice(0, 2).join(' · ')}</div>` : ''}
        </div></div>`).join('');
      out.innerHTML = `<h2>Drużyna: ${r.party.vocations.join(' · ')}</h2>
        <p class="muted">Średni level: <b>${r.party.avgLevel}</b> · najsłabszy: <b>${r.party.minLevel}</b> · rozmiar: <b>${r.party.size}</b></p>
        <h2>Role w drużynie</h2>${rolesHtml}
        <h2>Rekomendowane hunty dla ekipy</h2>${huntsHtml || '<p class="muted">Brak dopasowań.</p>'}
        <p class="muted small">Estymacje exp/profit dla party są przybliżone (założenie pełnego składu i wspólnej walki).</p>`;
    });
  }

  /* ------------------------------------------------ planner page */
  const planForm = $('#planForm');
  if (planForm) planForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(planForm);
    const out = $('#planOut');
    out.innerHTML = '<p class="muted">Generuję plan…</p>';
    const r = await (await fetch('/api/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(f.entries()))
    })).json();
    if (!r.steps.length) { out.innerHTML = '<p class="neg">Nie udało się zbudować planu — sprawdź level docelowy.</p>'; return; }
    const total = r.steps.reduce((a, s) => a + s.hours, 0);
    out.innerHTML = `<p class="muted">Plan dla <b>${S.VOC_LABEL[r.profile.vocation]}</b>, preferencja: <b>${r.profile.preference}</b>. Szacowany łączny czas: <b>${Math.round(total)}h</b> expienia (bez stamin/boostów).</p>` +
      r.steps.map(st => `<div class="plan-step"><div class="lv">LEVEL ${st.from} → ${st.to}</div>
      <div><a href="/hunt/${esc(st.slug)}"><b>${esc(st.name)}</b></a> <span class="muted small">(rek. lv ${esc(st.recLevel)})</span>
      <div class="small muted">Potrzebny EXP: ${gold(st.expNeed)} · ok. <b>${st.hours}h</b></div></div></div>`).join('');
  });

  /* ------------------------------------------------ next level (spot page) */
  const nlForm = $('#nextLevelForm');
  if (nlForm) nlForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const voc = $('#nlVoc').value, lvl = +$('#nlLevel').value || 100;
    const out = $('#nextLevelOut');
    out.innerHTML = '<p class="muted">…</p>';
    const r = await (await fetch(`/api/next-steps?voc=${voc}&level=${lvl}`)).json();
    out.innerHTML = r.length ? `<div class="next-steps">` + r.map(st => `<div class="next-step"><div class="from">Lv ${st.from} → ${st.to}</div><a href="/hunt/${esc(st.slug)}"><b>${esc(st.name)}</b></a><div class="muted small">rek. lv ${esc(st.recLevel)}</div></div>`).join('') + `</div>` : '<p class="muted">Brak dalszych rekomendacji.</p>';
  });

  /* ------------------------------------------------ admin */
  const adminLoginBtn = $('#adminLoginBtn');
  let adminToken = sessionStorage.getItem('tibiaHuntsAdmin') || '';
  const adminPanel = $('#adminPanel'), adminLogin = $('#adminLogin');
  function showAdminIfOk() { if (adminToken) { adminLogin.hidden = true; adminPanel.hidden = false; loadAdminList(); } }
  if (adminLoginBtn) adminLoginBtn.addEventListener('click', async () => {
    const t = $('#adminToken').value;
    const r = await (await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) })).json();
    if (r.ok) { adminToken = t; sessionStorage.setItem('tibiaHuntsAdmin', t); showAdminIfOk(); }
    else alert('Błędny token.');
  });
  showAdminIfOk();

  async function adminApi(path, method, body) {
    const r = await fetch('/api/spots' + path, {
      method: method || 'GET', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }
  async function loadAdminList(filter) {
    const list = await (await fetch('/api/spots?sort=level&dir=asc')).json();
    const rows = list.filter(s => !filter || (s.name + ' ' + (s.region || '')).toLowerCase().includes(filter)).map(s =>
      `<div class="admin-row"><span><b>${esc(s.name)}</b> <small class="muted">lv ${esc(s.recLevel)}</small></span><span class="muted">${esc(s.region)}</span><span class="muted small">upd: ${esc(s.lastUpdated)}</span>
      <span><button class="btn btn-sm" data-edit="${esc(s.id)}">Edytuj</button> <button class="btn btn-sm btn-ghost" data-del="${esc(s.id)}">Usuń</button></span></div>`).join('');
    $('#adminList').innerHTML = rows || '<p class="muted">Brak.</p>';
    $('#adminInfo').textContent = `Spotów w bazie: ${list.length}`;
    $$('[data-edit]').forEach(b => b.addEventListener('click', () => editSpot(b.dataset.edit)));
    $$('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Usunąć tę miejscówkę?')) return;
      await adminApi('/' + b.dataset.del, 'DELETE');
      loadAdminList();
    }));
  }
  const asInput = $('#adminSearch');
  if (asInput) asInput.addEventListener('input', () => loadAdminList(asInput.value.toLowerCase()));

  async function editSpot(id) {
    let s = null;
    if (id) {
      try { s = await (await fetch('/api/spots/' + id)).json(); } catch (e) { alert('Nie znaleziono'); return; }
    } else {
      s = { id: '', name: '', region: '', continent: '', city: '', levelMin: 8, levelMax: 100, recLevel: '8–100', vocations: ['EK'], modes: ['solo'], pacc: true, difficulty: 3, risk: 3, damageTypes: ['physical'], resistances: [], description: '', monsters: [], quests: [], access: [], gear: [], spells: [], runes: [], potions: [], stats: [], coords: { x: 32369, y: 32241, z: 7, approx: true }, alternatives: [], sources: [], expByLevel: [], lastUpdated: new Date().toLocaleDateString('pl-PL') };
    }
    const ed = $('#adminEditor');
    ed.hidden = false;
    ed.innerHTML = `<h2>${id ? 'Edytuj' : 'Nowy'}: ${esc(s.name || '(bez nazwy)')}</h2>
      <div class="editor-grid">
        <div class="f"><label>Nazwa</label><input id="e_name" value="${esc(s.name)}"></div>
        <div class="f"><label>Region</label><input id="e_region" value="${esc(s.region || '')}"></div>
        <div class="f"><label>Kontynent</label><input id="e_continent" value="${esc(s.continent || '')}"></div>
        <div class="f"><label>Miasto</label><input id="e_city" value="${esc(s.city || '')}"></div>
        <div class="f"><label>Level min</label><input id="e_levelMin" type="number" value="${s.levelMin}"></div>
        <div class="f"><label>Level max</label><input id="e_levelMax" type="number" value="${s.levelMax}"></div>
        <div class="f"><label>Rek. level (tekst)</label><input id="e_recLevel" value="${esc(s.recLevel)}"></div>
        <div class="f"><label>Profesje (EK,RP,MS,ED,MNK)</label><input id="e_voc" value="${esc((s.vocations || []).join(','))}"></div>
        <div class="f"><label>Tryby (solo,duo,party)</label><input id="e_modes" value="${esc((s.modes || []).join(','))}"></div>
        <div class="f"><label>EXP/h min</label><input id="e_expMin" type="number" value="${s.expPerHour ? s.expPerHour.min : 0}"></div>
        <div class="f"><label>EXP/h max</label><input id="e_expMax" type="number" value="${s.expPerHour ? s.expPerHour.max : 0}"></div>
        <div class="f"><label>Profit/h min</label><input id="e_profitMin" type="number" value="${s.profitPerHour ? s.profitPerHour.min : 0}"></div>
        <div class="f"><label>Profit/h max</label><input id="e_profitMax" type="number" value="${s.profitPerHour ? s.profitPerHour.max : 0}"></div>
        <div class="f"><label>Trudność 1–5</label><input id="e_difficulty" type="number" min="1" max="5" value="${s.difficulty}"></div>
        <div class="f"><label>Ryzyko 1–5</label><input id="e_risk" type="number" min="1" max="5" value="${s.risk}"></div>
        <div class="f"><label>Damage types (csv)</label><input id="e_damage" value="${esc((s.damageTypes || []).join(','))}"></div>
        <div class="f"><label>Questy (|)</label><input id="e_quests" value="${esc((s.quests || []).join('|'))}"></div>
        <div class="f"><label>Dostępy (|)</label><input id="e_access" value="${esc((s.access || []).join('|'))}"></div>
        <div class="f"><label>Gear (|)</label><input id="e_gear" value="${esc((s.gear || []).join('|'))}"></div>
        <div class="f"><label>Runy (|)</label><input id="e_runes" value="${esc((s.runes || []).join('|'))}"></div>
        <div class="f"><label>Potiony (|)</label><input id="e_potions" value="${esc((s.potions || []).join('|'))}"></div>
        <div class="f"><label>Czary (|)</label><input id="e_spells" value="${esc((s.spells || []).join('|'))}"></div>
        <div class="f"><label>Coords X</label><input id="e_x" type="number" value="${s.coords ? s.coords.x : 32369}"></div>
        <div class="f"><label>Coords Y</label><input id="e_y" type="number" value="${s.coords ? s.coords.y : 32241}"></div>
        <div class="f"><label>Coords Z (piętro 0–15)</label><input id="e_z" type="number" value="${s.coords ? s.coords.z : 7}"></div>
        <div class="f"><label>Przybliżone współrzędne</label><select id="e_approx"><option value="1" ${!s.coords || s.coords.approx ? 'selected' : ''}>tak</option><option value="0" ${s.coords && !s.coords.approx ? 'selected' : ''}>nie (dokładne)</option></select></div>
        <div class="f"><label>Hero (plik screena lub /ścieżka)</label><input id="e_hero" value="${esc(s.hero || '')}">
          <input type="file" id="e_heroFile" accept="image/*" class="small"></div>
        <div class="f" style="grid-column:1/-1"><label>Opis</label><textarea id="e_desc">${esc(s.description || '')}</textarea></div>
        <div class="f" style="grid-column:1/-1"><label>Statystyki per profesja (JSON: [{vocation,minLevel,xph,profit}])</label><textarea id="e_stats">${esc(JSON.stringify(s.stats || []))}</textarea></div>
      </div>
      <div class="inline-form" style="margin-top:12px">
        <button class="btn btn-gold" id="e_save">💾 Zapisz</button>
        <button class="btn btn-ghost" id="e_cancel">Anuluj</button>
        <span id="e_msg" class="muted small"></span>
      </div>`;
    ed.scrollIntoView({ behavior: 'smooth' });
    $('#e_cancel').addEventListener('click', () => { ed.hidden = true; });
    const heroFile = $('#e_heroFile');
    heroFile.addEventListener('change', async () => {
      const file = heroFile.files[0];
      if (!file) return;
      const rd = new FileReader();
      rd.onload = async () => {
        try {
          const r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken }, body: JSON.stringify({ filename: file.name, dataUrl: rd.result }) });
          const j = await r.json();
          if (j.ok) { $('#e_hero').value = j.url; $('#e_msg').textContent = 'Obraz zapisany: ' + j.url; }
        } catch (err) { $('#e_msg').textContent = 'Błąd uploadu: ' + err; }
      };
      rd.readAsDataURL(file);
    });
    $('#e_save').addEventListener('click', async () => {
      const csv = (id) => $(id).value.split(',').map(x => x.trim()).filter(Boolean);
      const pipe = (id) => $(id).value.split('|').map(x => x.trim()).filter(Boolean);
      const num = (id, d) => { const v = +$(id).value; return isNaN(v) ? d : v; };
      let stats;
      try { stats = JSON.parse($('#e_stats').value || '[]'); } catch (err) { $('#e_msg').textContent = 'Błąd JSON w stats'; return; }
      const expMin = num('#e_expMin', 0), expMax = num('#e_expMax', 0), prMin = num('#e_profitMin', 0), prMax = num('#e_profitMax', 0);
      const patch = {
        name: $('#e_name').value, region: $('#e_region').value, continent: $('#e_continent').value, city: $('#e_city').value,
        levelMin: num('#e_levelMin', 8), levelMax: num('#e_levelMax', 100), recLevel: $('#e_recLevel').value,
        vocations: csv('#e_voc'), modes: csv('#e_modes'),
        difficulty: num('#e_difficulty', 3), risk: num('#e_risk', 3),
        damageTypes: csv('#e_damage'), quests: pipe('#e_quests'), access: pipe('#e_access'),
        gear: pipe('#e_gear'), runes: pipe('#e_runes'), potions: pipe('#e_potions'), spells: pipe('#e_spells'),
        coords: { x: num('#e_x', 32369), y: num('#e_y', 32241), z: num('#e_z', 7), approx: $('#e_approx').value === '1' },
        hero: $('#e_hero').value || null, description: $('#e_desc').value, stats
      };
      if (expMin || expMax) patch.expPerHour = { min: expMin, max: expMax, avg: Math.round((expMin + expMax) / 2) };
      if (prMin || prMax) patch.profitPerHour = { min: prMin, max: prMax, avg: Math.round((prMin + prMax) / 2) };
      patch.wastePerHour = { max: Math.max(0, -Math.min(prMin, prMax)) };
      patch.expByLevel = stats.filter(x => x.xph).map(x => ({ range: x.minLevel + '+', vocation: x.vocation, xph: x.xph, profit: x.profit }));
      try {
        if (id) await adminApi('/' + id, 'PUT', patch);
        else await adminApi('', 'POST', Object.assign(patch, { id: String(patch.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') }));
        $('#e_msg').textContent = '✓ Zapisano. LAST UPDATED ustawiony na dziś.';
        loadAdminList();
      } catch (err) { $('#e_msg').textContent = 'Błąd: ' + err.message; }
    });
  }
  const newSpotBtn = $('#newSpotBtn');
  if (newSpotBtn) newSpotBtn.addEventListener('click', () => editSpot(null));
  const exportBtn = $('#exportBtn');
  if (exportBtn) exportBtn.addEventListener('click', async () => {
    const data = await (await fetch('/api/spots/export')).json();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tibia-spots-export.json';
    a.click();
  });
  const importFile = $('#importFile');
  if (importFile) importFile.addEventListener('change', async () => {
    const f = importFile.files[0];
    if (!f) return;
    try {
      const arr = JSON.parse(await f.text());
      const r = await fetch('/api/spots/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken }, body: JSON.stringify(arr) });
      const j = await r.json();
      alert(`Import: dodano ${j.added}, zaktualizowano ${j.updated}. Razem: ${j.total}`);
      loadAdminList();
    } catch (err) { alert('Błąd importu: ' + err.message); }
  });
})();
