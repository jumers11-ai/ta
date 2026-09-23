/* TibiaHunts scoring/recommendation engine — shared between browser and Node (server). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TibiaScoring = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VOC_ROLES = {
    EK: ['tank', 'dps'],
    ED: ['heal', 'support'],
    MS: ['mage', 'dps'],
    RP: ['distance', 'dps'],
    MNK: ['dps', 'support']
  };
  const VOC_LABEL = { EK: 'Elite Knight', RP: 'Royal Paladin', MS: 'Master Sorcerer', ED: 'Elder Druid', MNK: 'Monk' };

  function expForLevel(l) {
    l = Math.max(1, Math.floor(l));
    return Math.round((50 / 3) * (l * l * l - 6 * l * l + 17 * l - 12));
  }
  function expToNext(l) { return expForLevel(l + 1) - expForLevel(l); }
  function fmtGold(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const a = Math.abs(n);
    const s = a >= 1e9 ? (a / 1e9).toFixed(1) + 'kk' : a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'kk' : a >= 1e3 ? Math.round(a / 1e3) + 'k' : String(Math.round(a));
    return (n < 0 ? '-' : '') + s;
  }

  /* Expected equipment tier needed for a spot (0 basic … 3 top). Derived from difficulty. */
  function requiredEquipTier(spot) { return Math.max(0, Math.min(3, spot.difficulty - 2)); }
  /* Heuristic minimum skill/ML for a spot. */
  function requiredSkill(spot) { return Math.round(12 + spot.levelMin * 0.35); }
  function requiredML(spot) { return Math.round(4 + spot.levelMin * 0.22); }

  function levelFit(spot, level) {
    if (level >= spot.levelMin && level <= spot.levelMax) {
      // prefer spots where level sits in the middle of the range
      const mid = (spot.levelMin + spot.levelMax) / 2;
      const span = Math.max(1, (spot.levelMax - spot.levelMin) / 2);
      return 1 - 0.35 * Math.min(1, Math.abs(level - mid) / span);
    }
    if (level < spot.levelMin) {
      const gap = (spot.levelMin - level) / Math.max(1, spot.levelMin);
      return Math.max(0, 0.7 - gap * 2.2);
    }
    const gap = (level - spot.levelMax) / Math.max(1, spot.levelMax);
    return Math.max(0, 0.65 - gap * 1.8);
  }

  function scoreSpot(spot, profile) {
    const reasons = [], warnings = [];
    let fit = 0;

    // hard gates
    if (spot.pacc && profile.pacc === false) return null;
    const mode = profile.mode || 'solo';
    const okModes = spot.modes || ['solo'];
    if (!okModes.includes(mode)) {
      if (mode === 'duo' && okModes.includes('party')) { /* ok-ish */ }
      else return null;
    }

    // level
    const lf = levelFit(spot, profile.level);
    if (profile.level < spot.levelMin * 0.85 || (spot.levelMax > 0 && profile.level > spot.levelMax * 1.5)) return null;
    fit += lf * 30;

    // vocation
    const voc = profile.vocation;
    if (spot.vocations.includes(voc)) { fit += 25; reasons.push('Rekomendowany dla ' + VOC_LABEL[voc]); }
    else { fit += 8; warnings.push('Poza listą głównych rekomendacji dla ' + VOC_LABEL[voc]); }

    // party roles
    if (mode !== 'solo' && profile.partyVocations && profile.partyVocations.length) {
      const roles = new Set();
      profile.partyVocations.forEach(v => (VOC_ROLES[v] || []).forEach(r => roles.add(r)));
      let bonus = 0;
      if (roles.has('tank')) bonus += 8;
      if (roles.has('heal')) bonus += 8;
      if (roles.has('dps')) bonus += 6;
      fit += bonus;
      if (bonus >= 22) reasons.push('Pełne pokrycie ról (tank/heal/dps)');
    } else if (mode !== 'solo') {
      fit += 5;
    }

    // risk tolerance
    if (profile.maxRisk && spot.risk > profile.maxRisk) return null;
    fit += (5 - spot.risk) * 1.5;

    // equipment tier — dynamic matching
    const reqT = requiredEquipTier(spot);
    const tier = profile.equipTier === undefined ? 2 : profile.equipTier;
    if (tier < reqT) {
      const penalty = (reqT - tier) * 9;
      fit -= penalty;
      warnings.push('Wymagany lepszy sprzęt niż deklarowany (tier ' + tier + ' < ' + reqT + ')');
    } else if (tier > reqT) {
      fit += 3;
      reasons.push('Sprzęt powyżej wymagań spotu');
    }

    // skills / ML
    if (profile.skill !== undefined && profile.skill !== null && profile.skill !== '') {
      const rs = requiredSkill(spot);
      if (+profile.skill < rs - 15) { fit -= 10; warnings.push('Skill ' + profile.skill + ' może być za niski (rekomendowane ~' + rs + ')'); }
      else if (+profile.skill >= rs + 20) { fit += 3; reasons.push('Wysoki skill ułatwia ten hunt'); }
    }
    if (['MS', 'ED', 'MNK'].includes(voc) && profile.ml !== undefined && profile.ml !== null && profile.ml !== '') {
      const rm = requiredML(spot);
      if (+profile.ml < rm - 10) { fit -= 8; warnings.push('ML ' + profile.ml + ' może być za niski (rekomendowane ~' + rm + ')'); }
    }

    // quests
    if (profile.doneQuests && spot.quests && spot.quests.length) {
      const done = spot.quests.filter(q => profile.doneQuests.includes(q)).length;
      if (done < spot.quests.length) warnings.push('Wymaga questów: ' + spot.quests.join(', '));
      if (done === 0 && spot.quests.length) fit -= 6;
    }

    // preference metric
    const xp = spot.expPerHour ? spot.expPerHour.avg : 0;
    const pr = spot.profitPerHour ? spot.profitPerHour.avg : 0;
    const pref = profile.preference || 'balanced';
    const wExp = pref === 'exp' ? 0.85 : pref === 'profit' ? 0.3 : 0.55;
    const wProfit = 1 - wExp;
    const nExp = Math.min(1, xp / 2500000);
    const nProfit = Math.min(1, Math.max(0, pr) / 800000);
    const metric = nExp * wExp + nProfit * wProfit;
    fit += metric * 25;

    const fitRounded = Math.max(1, Math.min(100, Math.round(fit)));
    return {
      spot: spot,
      fit: fitRounded,
      reasons: reasons,
      warnings: warnings,
      metricExp: xp,
      metricProfit: pr,
      /* composite: preference metric weighted by overall suitability (vocation, level, gear, risk…) */
      composite: metric * (0.55 + 0.45 * (fitRounded / 100))
    };
  }

  function recommend(profile, spots, limit) {
    const out = [];
    for (const s of spots) {
      const r = scoreSpot(s, profile);
      if (r) out.push(r);
    }
    out.sort((a, b) => b.composite - a.composite);
    return limit ? out.slice(0, limit) : out;
  }

  /* ---------------- party ---------------- */
  function partyAnalysis(players, spots, opts) {
    opts = opts || {};
    if (!players.length) return { error: 'Dodaj przynajmniej jednego gracza.' };
    const levels = players.map(p => +p.level);
    const avgLevel = Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
    const minLevel = Math.min.apply(null, levels);
    const profile = {
      vocation: players[0].vocation,
      level: avgLevel,
      mode: players.length === 2 ? 'duo' : 'party',
      partyVocations: players.map(p => p.vocation),
      pacc: opts.pacc !== false,
      preference: opts.preference || 'balanced',
      maxRisk: opts.maxRisk || null,
      equipTier: opts.equipTier === undefined ? 2 : opts.equipTier
    };
    const candidates = spots.filter(s => {
      const modes = s.modes || ['solo'];
      return players.length <= 2 ? (modes.includes('duo') || modes.includes('party')) : modes.includes('party');
    });
    const recs = recommend(profile, candidates, 10).map(r => {
      const partyMult = 1 + 0.22 * (players.length - 1); // estimate: more players = more total exp
      return {
        spot: r.spot, fit: r.fit, reasons: r.reasons, warnings: r.warnings,
        estPartyExp: Math.round(r.metricExp * partyMult),
        estPartyProfit: Math.round(r.metricProfit * partyMult),
        roles: assignRoles(players)
      };
    });
    return {
      party: { size: players.length, avgLevel: avgLevel, minLevel: minLevel, vocations: players.map(p => VOC_LABEL[p.vocation] + ' ' + p.level) },
      results: recs
    };
  }

  function assignRoles(players) {
    const roleText = {
      EK: 'Blocker / tank — trzyma aggro na sobie, ustawia potwory w wąskich gardłach.',
      ED: 'Heal & support — leczy blockera, exura res/sio, kontroluje pole bitwy (paralyze, roots).',
      MS: 'Main damage — obszarowe zaklęcia (waves, beams) i runy, priorytetowe cele.',
      RP: 'Damage / kiter — dystansowy DPS, ściąga pojedyncze cele, Diamond/Ethereal arrows.',
      MNK: 'Damage / flex — wspiera tanka, wysokie single-target dmg.'
    };
    return players.map(p => ({ player: p, role: roleText[p.vocation] || 'DPS' }));
  }

  /* ---------------- planner ---------------- */
  function buildPlan(profile, spots, targetLevel) {
    const steps = [];
    let lvl = +profile.level;
    targetLevel = Math.min(1500, Math.max(lvl + 1, +targetLevel || lvl + 100));
    let guard = 0;
    while (lvl < targetLevel && guard++ < 60) {
      const p = Object.assign({}, profile, { level: lvl, preference: profile.preference || 'balanced' });
      const recs = recommend(p, spots, 5);
      if (!recs.length) break;
      const best = recs[0].spot;
      let end = Math.min(targetLevel, Math.max(lvl + 8, Math.min(best.levelMax, lvl + 40)));
      // advance to next step when a clearly better spot appears at end level
      const need = expForLevel(end) - expForLevel(lvl);
      const xph = (best.expPerHour ? best.expPerHour.avg : 0) || 1;
      const hours = need / xph;
      steps.push({
        from: lvl, to: end, spot: best,
        expNeed: need, hours: Math.round(hours * 10) / 10,
        expRange: best.expPerHour ? best.expPerHour.min + '–' + best.expPerHour.max : null
      });
      lvl = end;
      if (hours <= 0) lvl++;
    }
    return steps;
  }

  function nextSteps(profile, spots, count) {
    count = count || 3;
    const steps = [];
    let lvl = +profile.level;
    let guard = 0;
    while (steps.length < count && guard++ < 30) {
      const recs = recommend(Object.assign({}, profile, { level: lvl }), spots, 3);
      if (!recs.length) break;
      const best = recs[0].spot;
      const end = Math.max(lvl + 8, Math.min(best.levelMax, lvl + 35));
      steps.push({ from: lvl, to: end, spot: best });
      lvl = end + 5;
    }
    return steps;
  }

  return {
    VOC_ROLES: VOC_ROLES, VOC_LABEL: VOC_LABEL,
    expForLevel: expForLevel, expToNext: expToNext, fmtGold: fmtGold,
    requiredEquipTier: requiredEquipTier, requiredSkill: requiredSkill, requiredML: requiredML,
    levelFit: levelFit, scoreSpot: scoreSpot, recommend: recommend,
    partyAnalysis: partyAnalysis, assignRoles: assignRoles,
    buildPlan: buildPlan, nextSteps: nextSteps
  };
});
