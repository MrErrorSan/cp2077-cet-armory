(function (root) {
  const TIER_ORDER = ['1', '1+', '2', '2+', '3', '3+', '4', '4+', '5', '5+', '5++'];
  const QTY_MAX = 999999;

  function matchesGroups(item, groups) {
    for (const id in groups) {
      const wanted = groups[id];
      if (wanted && wanted.size && !wanted.has(item.group && item.group[id])) return false;
    }
    return true;
  }

  const hayCache = new WeakMap();
  function haystack(item) {
    let h = hayCache.get(item);
    if (h === undefined) {
      const parts = [item.name, item.code && item.code.replace(/^Items\./, ''), item.rarity, tierLabel(item.tier), variantLabel(item)].concat(item.tags);
      if (item.group) for (const k in item.group) parts.push(item.group[k]);
      if (item.iconic) parts.push('iconic');
      h = parts.filter(Boolean).join(' | ').toLowerCase();
      hayCache.set(item, h);
    }
    return h;
  }

  // every word of the query must appear somewhere in the item's name, code, tags, rarity, tier or groups
  function matchesQuery(item, q) {
    if (!q) return true;
    const hay = haystack(item);
    return q.split(/\s+/).every((w) => hay.includes(w));
  }

  const VARIANT_SKIP = /^(items|preset|default|common|uncommon|rare|epic|legendary|plus|plusplus|lvl\d*|recipe)$/i;
  // short label that tells same-name variants apart, from the item code: Items.Preset_Ashura_Neon -> "Neon"
  function variantLabel(item) {
    if (!item.code) return '';
    const base = item.code.replace(/^Items\./, '');
    if (/^Preset_Psycho_/.test(base)) return 'Cyberpsycho';
    const nameWords = new Set(item.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    // split snake_case and CamelCase: AdvancedMantisBladesChemical -> Advanced Mantis Blades Chemical
    const words = base.split(/[_.]+/).flatMap((w) => w.split(/(?<=[a-z0-9])(?=[A-Z])/))
      .filter((w) => w && !VARIANT_SKIP.test(w) && !nameWords.has(w.toLowerCase()));
    return words.join(' ');
  }

  function filterItems(items, { tab, groups = {}, tiers, flags, query = '' } = {}) {
    const q = query.trim().toLowerCase();
    return items.filter((item) =>
      (!tab || item.tab === tab) &&
      matchesGroups(item, groups) &&
      (!tiers || !tiers.size || tiers.has(item.tier === null ? 'none' : item.tier)) &&
      (!flags || [...flags].every((f) => item[f])) &&
      matchesQuery(item, q));
  }

  function tierRank(tier) {
    return tier === null ? -1 : TIER_ORDER.indexOf(tier);
  }

  function sortItems(items, mode) {
    const out = items.slice();
    if (mode === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
    else if (mode === 'tier') out.sort((a, b) => tierRank(b.tier) - tierRank(a.tier));
    return out;
  }

  function clampQty(qty) {
    const n = Math.floor(Number(qty));
    return Number.isFinite(n) ? Math.min(QTY_MAX, Math.max(1, n)) : 1;
  }

  // a picker option is either a plain string or { label, value } (label for people, value for the command)
  function optionValue(o) {
    return o && typeof o === 'object' ? o.value : o;
  }

  function optionLabel(item, value) {
    const o = item.input && item.input.choice && item.input.choice.options.find((x) => optionValue(x) === value);
    return o && typeof o === 'object' ? o.label : value;
  }

  function renderCommand(item, { qty = 1, value = '', choice = '' } = {}) {
    let cmd = item.cmd.split('{qty}').join(String(clampQty(qty)));
    const v = String(value).trim();
    if (v) cmd = cmd.split('{value}').join(v);
    const c = String(choice || (item.input && item.input.choice ? optionValue(item.input.choice.options[0]) : '')).trim();
    if (c) cmd = cmd.split('{choice}').join(c);
    return cmd;
  }

  function joinQueue(entries) {
    return entries.map((c) => c.trim().replace(/\s*[\r\n]+\s*/g, ' ')).filter(Boolean).join(' ');
  }

  function tierLabel(tier) {
    return tier === null || tier === undefined ? '' : 'T' + tier;
  }

  function rarityVar(rarity) {
    return 'var(--r-' + (rarity || 'common') + ')';
  }

  const api = { TIER_ORDER, filterItems, variantLabel, sortItems, renderCommand, optionValue, optionLabel, joinQueue, tierLabel, rarityVar, clampQty };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CETFilters = api;
})(typeof self !== 'undefined' ? self : this);
