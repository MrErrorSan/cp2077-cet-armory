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

  function matchesQuery(item, q) {
    if (!q) return true;
    if (item.name.toLowerCase().includes(q)) return true;
    if (item.code && item.code.toLowerCase().includes(q)) return true;
    return item.tags.some((t) => t.toLowerCase().includes(q));
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

  function renderCommand(item, { qty = 1, value = '' } = {}) {
    let cmd = item.cmd.split('{qty}').join(String(clampQty(qty)));
    const v = String(value).trim();
    if (v) cmd = cmd.split('{value}').join(v);
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

  const api = { TIER_ORDER, filterItems, sortItems, renderCommand, joinQueue, tierLabel, rarityVar, clampQty };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CETFilters = api;
})(typeof self !== 'undefined' ? self : this);
