(function () {
  'use strict';

  const F = window.CETFilters;
  const DATA = window.CET_DATA;
  const IMAGES = window.CET_IMAGES || {};
  const ICONS = window.CET_ICONS || {};

  const STORE_KEY = 'cet-armory-queue';
  const FIRST_PAINT = 300;
  const CHUNK = 300;
  const WIDE_TABS = new Set(['weapons', 'vehicles']);
  const TOGGLE_LABELS = { iconic: 'Iconic ◆', pl: 'Phantom Liberty', crafted: 'Crafted', armor: 'Gives armor' };

  const $ = (id) => document.getElementById(id);
  const els = {
    count: $('count'), tabs: $('tabs'), filters: $('filters'), search: $('search'), sort: $('sort'),
    results: $('results'), empty: $('empty'), card: $('card'), queueList: $('queue-list'),
    queueCount: $('queue-count'), copy: $('btn-copy'), clear: $('btn-clear'),
    credits: $('btn-credits'), help: $('btn-help'), toast: $('toast'),
    notes: $('tab-notes'), rail: $('rail'), filtersBtn: $('btn-filters'), nav: document.querySelector('.hdr__nav'),
    crumb: $('crumb'), back: $('btn-back'), groupBtn: $('btn-group'), censorBtn: $('btn-censor'), countLabel: document.querySelector('.hdr__stat span'),
    queueBtn: $('btn-queue'), queueBtnFoot: $('btn-queue-foot'), queuePanel: $('queue'),
    queueTotal: $('queue-total'), queueCmds: $('queue-cmds'), queueDetails: $('queue-details'),
    queueCopy: $('queue-copy'), queueClear: $('queue-clear'),
  };
  const NUMBER_RE = /^-?\d+(\.\d+)?$/;
  const byId = new Map(DATA.items.map((it) => [it.id, it]));
  const tabItems = new Map(DATA.tabs.map((t) => [t.id, []]));
  DATA.items.forEach((it) => tabItems.get(it.tab) && tabItems.get(it.tab).push(it));
  const tabById = new Map(DATA.tabs.map((t) => [t.id, t]));
  const nameCount = new Map();
  // a variant label is only needed when the tier doesn't already tell same-name items apart
  const twinKey = (it) => it.tab + '|' + it.name + '|' + it.tier;
  DATA.items.forEach((it) => nameCount.set(twinKey(it), (nameCount.get(twinKey(it)) || 0) + 1));
  const variantOf = (item) => (nameCount.get(twinKey(item)) > 1 ? F.variantLabel(item) || 'Default' : '');

  // "Group versions": every tier and variant of an item shares one tile; the card picks the version
  const GROUP_KEY = 'cet-armory-group';
  const groupKey = (it) => it.tab + '|' + it.name;
  const groupAll = new Map();
  DATA.items.forEach((it) => { const k = groupKey(it); if (!groupAll.has(k)) groupAll.set(k, []); groupAll.get(k).push(it); });
  const tierRank = (it) => (it.tier === null ? -1 : F.TIER_ORDER.indexOf(it.tier));
  const isPlain = (it) => (variantOf(it) === '' || variantOf(it) === 'Default' ? 1 : 0);
  // highest tier first; among equals the default version, then sheet order
  const byBest = (a, b) => tierRank(b) - tierRank(a) || isPlain(b) - isPlain(a);
  const CENSOR_KEY = 'cet-armory-censor';
  // pictures of weapons with nudity are hidden unless the player turns this off
  function loadCensorPref() {
    try { return localStorage.getItem(CENSOR_KEY) !== '0'; } catch (_) { return true; }
  }

  function loadGroupPref() {
    try { return localStorage.getItem(GROUP_KEY) !== '0'; } catch (_) { return true; }
  }

  const state = {
    tab: tabById.has('weapons') ? 'weapons' : DATA.tabs[0].id,
    groups: {}, tiers: new Set(), flags: new Set(), query: '', sort: 'sheet',
    selectedId: null, queue: loadQueue(), level: 'items', grouped: loadGroupPref(), star: new Set(), censor: loadCensorPref(),
  };
  let draft = { qty: 1, value: '', choice: '' };
  let renderToken = 0;
  let tileEls = new Map();

  // ---------- helpers ----------

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  const iconCache = new Map();
  function iconNode(id) {
    const key = ICONS[id] ? id : 'generic';
    if (!iconCache.has(key)) {
      const t = document.createElement('template');
      t.innerHTML = ICONS[key] || '';
      iconCache.set(key, t.content);
    }
    return iconCache.get(key).cloneNode(true);
  }

  function picture(item, cls) {
    const wrap = el('span', cls);
    wrap.dataset.icon = item.icon || 'generic';
    if (item.nudity && state.censor) {
      wrap.classList.add('is-censored');
      wrap.append(iconNode(item.icon), el('span', 'censor__label', 'Censored'));
      return wrap;
    }
    const src = IMAGES[item.imageKey];
    if (src) {
      // the drawn icon stays underneath until the picture has loaded
      wrap.classList.add('is-loading');
      wrap.appendChild(iconNode(item.icon));
      const img = el('img');
      img.loading = 'lazy';
      img.alt = '';
      // CORS lets us read the pixels to trim the empty margins (see trimArt); from file:// it falls back to icons anyway
      if (/^https?:/.test(src) && /^https?:/.test(location.protocol)) img.crossOrigin = 'anonymous';
      if (artBox.has(src)) img.style.objectViewBox = artBox.get(src);
      img.src = src;
      wrap.appendChild(img);
    } else {
      wrap.appendChild(iconNode(item.icon));
    }
    return wrap;
  }

  function onImageError(e) {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.parentElement || !img.parentElement.dataset.icon) return;
    const wrap = img.parentElement;
    wrap.classList.remove('is-loading');
    wrap.replaceChildren(iconNode(wrap.dataset.icon));
  }

  // wiki renders sit in a 2:1 canvas with wide transparent margins; measure the opaque art once per picture
  // and crop to it, so every item is scaled by its real size instead of by its canvas
  const artBox = new Map();
  const trimCanvas = document.createElement('canvas');
  function trimArt(img) {
    if (!img.crossOrigin || artBox.has(img.src) || !img.naturalWidth) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const k = Math.min(1, 160 / nw);
    const w = Math.max(1, Math.round(nw * k));
    const h = Math.max(1, Math.round(nh * k));
    let box = 'none';
    try {
      trimCanvas.width = w;
      trimCanvas.height = h;
      const ctx = trimCanvas.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const a = ctx.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (a[(y * w + x) * 4 + 3] > 24) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 >= x0 && y1 >= y0) {
        const px = (v) => Math.max(0, Math.round(v / k)) + 'px';
        const pad = 1;
        box = 'inset(' + px(y0 - pad) + ' ' + px(w - 1 - x1 - pad) + ' ' + px(h - 1 - y1 - pad) + ' ' + px(x0 - pad) + ')';
      }
    } catch (_) { /* tainted canvas: keep the full picture */ }
    artBox.set(img.src, box);
    if (box !== 'none') document.querySelectorAll('img[src="' + CSS.escape(img.src) + '"]').forEach((i) => { i.style.objectViewBox = box; });
  }

  function onImageLoad(e) {
    const img = e.target;
    if (img.tagName === 'IMG') trimArt(img);
    if (img.tagName !== 'IMG' || !img.parentElement || !img.parentElement.classList.contains('is-loading')) return;
    const wrap = img.parentElement;
    wrap.classList.remove('is-loading');
    wrap.querySelectorAll('svg').forEach((s) => s.remove());
  }

  function typeOf(item) {
    const tab = tabById.get(item.tab);
    const g = tab && tab.groups.find((grp) => item.group && item.group[grp.id]);
    return g ? item.group[g.id] : (item.tags[0] || '');
  }

  function typeLine(item) {
    const tab = tabById.get(item.tab);
    const vals = (tab ? tab.groups : []).map((g) => item.group && item.group[g.id]).filter(Boolean);
    return vals.length ? vals.join(' ') : (item.tags[0] || '');
  }

  function defaultQty(item) {
    return F.clampQty(item.qty || 1);
  }

  function queueEntry(id) {
    return state.queue.find((q) => q.id === id);
  }

  // for attribute / skill pickers the picked option is part of the entry: Body = 20 and Cool = 20 are two commands
  function choiceOf(item, choice) {
    return item && item.input && item.input.choice ? choice || F.optionValue(item.input.choice.options[0]) : '';
  }

  function findEntry(id, choice) {
    const item = byId.get(id);
    if (!item || !item.input || !item.input.choice) return queueEntry(id);
    const c = choiceOf(item, choice);
    return state.queue.find((q) => q.id === id && q.choice === c);
  }

  // fill-in commands start with a usable value (the sheet's number, or a sensible one); the player can change it
  function defaultValue(item) {
    return (item && item.input && item.input.default) || '';
  }

  function needsValue(item, value) {
    if (!item.input || item.input.kind !== 'value') return false;
    const v = String(value || '').trim();
    if (item.input.text) return !/^[\w.#-]+$/.test(v);
    if (!NUMBER_RE.test(v)) return true;
    const n = Number(v);
    return item.input.max !== undefined && (!Number.isInteger(n) || n < item.input.min || n > item.input.max);
  }

  function choiceSelect(item, cls, current) {
    const sel = el('select', cls);
    sel.setAttribute('aria-label', item.input.choice.label);
    item.input.choice.options.forEach((o) => {
      const opt = el('option', null, typeof o === 'object' ? o.label : o);
      opt.value = F.optionValue(o);
      sel.appendChild(opt);
    });
    sel.value = current || F.optionValue(item.input.choice.options[0]);
    return sel;
  }

  function isTyping(target) {
    return target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  let toastTimer = 0;
  function toast(msg, actionLabel, action) {
    els.toast.textContent = msg;
    if (actionLabel) {
      const b = el('button', 'toast__action', actionLabel);
      b.type = 'button';
      b.addEventListener('click', () => { hideToast(); action(); }, { once: true });
      els.toast.appendChild(b);
    }
    els.toast.hidden = false;
    els.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, actionLabel ? 6000 : 2200);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    els.toast.classList.remove('is-on');
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 300);
  }

  // ---------- persistence ----------

  function validChoice(item, choice) {
    return !choice || !item.input || !item.input.choice || item.input.choice.options.some((o) => F.optionValue(o) === choice);
  }

  function loadQueue() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(raw)
        ? raw.filter((q) => q && byId.has(q.id) && byId.get(q.id).cmd === q.cmd && !needsValue(byId.get(q.id), q.value) && validChoice(byId.get(q.id), q.choice))
          .map((q) => ({ id: q.id, cmd: q.cmd, qty: F.clampQty(q.qty), value: String(q.value || ''), choice: String(q.choice || '') }))
        : [];
    } catch (_) {
      return [];
    }
  }

  function saveQueue() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.queue)); } catch (_) { /* storage unavailable */ }
  }

  // ---------- tabs ----------

  function renderTabs() {
    els.tabs.querySelectorAll('button.tab').forEach((b) => b.remove());
    const frag = document.createDocumentFragment();
    DATA.tabs.forEach((t) => {
      const b = el('button', 'tab' + (t.id === state.tab ? ' is-on' : ''), t.label);
      b.type = 'button';
      b.dataset.tab = t.id;
      frag.appendChild(b);
    });
    els.tabs.appendChild(frag);
  }

  function setTab(id) {
    if (!tabById.has(id)) return;
    state.tab = id;
    state.groups = {};
    state.tiers = new Set();
    state.flags = new Set();
    state.star = new Set();
    navStack = [];
    state.selectedId = null;
    // the search query is kept across tabs so a search can be followed from tab to tab
    settleLevel();
    els.tabs.querySelectorAll('button.tab').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === id));
    renderFilters();
    renderNotes();
    syncCensorBtn();
    renderResults();
    renderCard();
  }

  // ---------- drill-down navigation (left-click goes in, right-click / Esc goes back) ----------
  // Each tab drills through up to two groups, e.g. Weapons: Pistol -> Tech -> items, Clothing: Head -> Caps -> items.
  // Tier/rarity/iconic filters stay on while drilling, so "Legendary only" still walks the same categories.

  const SUB_GROUP = { weapons: 'class', clothing: 'kind' };
  const SUB_LABEL = { weapons: (v, parent) => v + ' ' + parent };
  let navStack = [];   // [{ gid, value }] pushed by clicking category tiles, popped by Back
  let enteredAt = 0;

  function drillGroups(tab) {
    if (tab.layout === 'list' || !tab.groups.length || tab.groups[0].values.length < 2) return [];
    const sub = SUB_GROUP[tab.id] && tab.groups.find((g) => g.id === SUB_GROUP[tab.id]);
    return sub ? [tab.groups[0], sub] : [tab.groups[0]];
  }

  function pickedIn(gid) {
    return !!(state.groups[gid] && state.groups[gid].size);
  }

  // items in the open tab under every filter except the search query
  function filteredTabItems() {
    return F.filterItems(tabItems.get(state.tab), { groups: state.groups, tiers: state.tiers, flags: state.flags });
  }

  // the next group to choose from, or null when it is time to show items
  function nextStep() {
    const steps = drillGroups(tabById.get(state.tab));
    for (let i = 0; i < steps.length; i++) {
      const g = steps[i];
      if (pickedIn(g.id)) continue;
      if (state.star.has(g.id)) return null;
      const items = filteredTabItems();
      const values = g.values.filter((v) => items.some((it) => it.group && it.group[g.id] === v));
      if (i === 0 ? values.length > 0 : values.length > 1) return { g, values, items, depth: i };
      return null;
    }
    return null;
  }

  function settleLevel() {
    state.level = !state.query.trim() && nextStep() ? 'overview' : 'items';
  }

  function enterCategory(value) {
    const step = nextStep();
    if (!step) return;
    enteredAt = Date.now();
    const kb = focusInResults();
    if (value.startsWith('flag:')) {
      navStack.push({ flag: value.slice(5), value });
      state.flags.add(value.slice(5));
    } else navStack.push({ gid: step.g.id, value });
    if (value.startsWith('flag:')) { /* stays on this level, now filtered */ } else if (value === '*') state.star.add(step.g.id);
    else state.groups[step.g.id] = new Set([value]);
    settleLevel();
    syncFilterUI();
    renderResults();
    afterNav(kb, firstControl());
  }

  function focusInResults() {
    return els.results.contains(document.activeElement) || document.activeElement === document.body;
  }

  // after a re-render: put focus back in the grid if it was there, and on phones bring the crumb into view
  function firstControl() {
    return els.results.querySelector('button, input, select');
  }

  function afterNav(kb, target) {
    if (kb && target) target.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 900px)').matches) document.querySelector('.crumbbar').scrollIntoView({ block: 'start' });
  }

  function canGoBack() {
    if (state.selectedId || state.query.trim() || navStack.length || state.star.size) return true;
    return drillGroups(tabById.get(state.tab)).some((g) => pickedIn(g.id));
  }

  function goBack() {
    if (state.selectedId) { select(null); return; }
    if (!canGoBack()) return;
    const kb = focusInResults();
    let from = null;
    if (state.query.trim()) {
      state.query = '';
      els.search.value = '';
    } else if (navStack.length) {
      const last = navStack.pop();
      if (last.flag) state.flags.delete(last.flag);
      else if (last.value === '*') state.star.delete(last.gid); else delete state.groups[last.gid];
      from = last.value;
    } else {
      // drilled in from the filter chips: go back to the top of the tab, keeping tier/rarity filters
      drillGroups(tabById.get(state.tab)).forEach((g) => delete state.groups[g.id]);
      state.star = new Set();
    }
    settleLevel();
    syncFilterUI();
    renderResults();
    const tile = from && els.results.querySelector('[data-cat="' + CSS.escape(from) + '"]');
    afterNav(kb, tile || firstControl());
  }

  function renderCrumb() {
    const tab = tabById.get(state.tab);
    const parts = [tab.label];
    if (state.flags.has('armor')) parts.push('Armor pieces');
    drillGroups(tab).forEach((g) => {
      if (pickedIn(g.id)) parts.push([...state.groups[g.id]].join(', '));
      else if (state.star.has(g.id)) parts.push('All');
    });
    let text = parts.join(' › ');
    if (state.level === 'overview') { const st = nextStep(); text += st && st.depth > 0 ? ' // select a type' : ' // select a category'; }
    els.crumb.textContent = text;
    els.back.disabled = !canGoBack();
  }

  // how many tiles a set of items becomes (grouped versions share one tile)
  function tileCount(items) {
    return state.grouped ? new Set(items.map(groupKey)).size : items.length;
  }

  function hasImage(it) {
    return !!IMAGES[it.imageKey];
  }

  // a fan of 3-4 different items, so an "All" tile reads as "everything in here"
  function collage(samples) {
    const box = el('span', 'tile__pic tile__collage');
    samples.forEach((it, i) => {
      const pic = picture(it, 'collage__pic');
      pic.style.setProperty('--i', String(i));
      pic.style.setProperty('--n', String(samples.length));
      box.appendChild(pic);
    });
    return box;
  }

  function categoryTile(value, label, items, samples) {
    const b = el('button', 'tile tile--wide tile--cat' + (samples ? ' tile--all' : ''));
    b.type = 'button';
    b.dataset.cat = value;
    const best = items.slice().sort(byBest);
    b.appendChild(samples ? collage(samples) : picture(best.find(hasImage) || best[0], 'tile__pic'));
    b.appendChild(el('span', 'tile__name', label));
    const n = tileCount(items);
    b.appendChild(el('span', 'tile__type', n + (n === 1 ? ' item' : ' items')));
    return b;
  }

  function renderOverview(tab) {
    const step = nextStep();
    const { g, values, items } = step;
    const parent = step.depth > 0 ? [...state.groups[drillGroups(tab)[0].id]].join(', ') : '';
    const byValue = values.map((v) => [v, items.filter((it) => it.group && it.group[g.id] === v)]);
    // one picture from each of the biggest categories
    const samples = byValue.slice().sort((a, b) => b[1].length - a[1].length)
      .map(([, list]) => list.slice().sort(byBest).find(hasImage)).filter(Boolean).slice(0, 4);
    const frag = document.createDocumentFragment();
    const allLabel = parent ? 'All ' + parent : state.flags.has('armor') ? 'All armor pieces' : 'All items';
    frag.appendChild(categoryTile('*', allLabel, items, samples.length >= 2 ? samples : null));
    if (step.depth === 0 && tab.toggles.includes('armor') && !state.flags.has('armor')) {
      const armored = items.filter((it) => it.armor);
      const picks = [...new Set(armored.map((it) => it.group && it.group[g.id]))]
        .map((v) => armored.filter((it) => it.group && it.group[g.id] === v).find(hasImage)).filter(Boolean)
        .concat(armored.filter(hasImage)).filter((it, i, a) => a.indexOf(it) === i).slice(0, 3);
      if (armored.length) frag.appendChild(categoryTile('flag:armor', 'Armor pieces', armored, picks.length >= 2 ? picks : null));
    }
    const label = (v) => (parent && SUB_LABEL[tab.id] ? SUB_LABEL[tab.id](v, parent) : v);
    byValue.forEach(([v, list]) => frag.appendChild(categoryTile(v, label(v), list)));
    renderToken++;
    tileEls = new Map();
    els.count.textContent = String(tileCount(items));
    els.countLabel.textContent = 'Items';
    els.empty.hidden = true;
    updateTabHits();
    els.results.classList.add('results--grid', 'results--overview');
    els.results.classList.remove('results--list');
    els.results.replaceChildren(frag);
    els.results.scrollTop = 0;
    renderCrumb();
  }

  function syncFilterUI() {
    els.filters.querySelectorAll('button').forEach((b) => {
      let on = false;
      if (b.dataset.tier) on = state.tiers.has(b.dataset.tier);
      else if (b.dataset.group) on = !!(state.groups[b.dataset.group] && state.groups[b.dataset.group].has(b.dataset.value));
      else if (b.dataset.flag) {
        on = state.flags.has(b.dataset.flag);
        b.querySelector('.toggle__state').textContent = on ? 'ON' : 'OFF';
      } else return;
      setOn(b, on);
    });
  }

  // notes written for the site (the sheet's own notes come from the data)
  const SITE_NOTES = {
    clothing: {
      summary: 'Armor: since update 2.0 most clothing is cosmetic. Only tactical helmets and vests still give Armor (marked ARMOR).',
      lines: ['77 pieces: Arasaka and Militech combat helmets, aramid and ballistic vests, Dogtown tac vests, the badge coat, the MaxTac jacket and the Predator armor. Armor scales with tier: +5 at Tier 1 up to +25 at Tier 5. It only counts when worn, not through the Wardrobe.',
        'Open "Armor pieces" or turn on "Gives armor" to see them. Source: the Cyberpunk Wiki item pages and the 2.0 patch notes https://www.cyberpunk.net/en/news/49060/update-2-0'],
    },
  };
  // the sheet's bare "FOR OTHER FACTS SEE <url>" points at a raw list of quest fact names
  const NOTE_REWRITES = [
    [/^FOR OTHER FACTS SEE\s+(\S+)/i, 'Quest fact names for the fact commands (Print / Set a fact): full list, raw text, very long: $1'],
  ];

  function renderNotes() {
    const site = SITE_NOTES[state.tab];
    const notes = (tabById.get(state.tab).notes || []).map((t) => NOTE_REWRITES.reduce((acc, [re, to]) => acc.replace(re, to), t));
    const summary = site ? site.summary : notes[0];
    const lines = site ? site.lines.concat(notes) : notes.slice(1);
    els.notes.hidden = !summary;
    if (!summary) { els.notes.replaceChildren(); return; }
    const box = el('details', 'notice__box');
    const sum = el('summary', 'notice__sum');
    linkify(sum, summary);
    box.appendChild(sum);
    lines.forEach((t) => box.appendChild(linkify(el('p'), t)));
    if (site && site.action) {
      const b = el('button', 'notice__action', site.action.label);
      b.type = 'button';
      b.addEventListener('click', () => {
        els.search.value = site.action.query;
        state.query = site.action.query;
        setTab(site.action.tab);
      });
      box.appendChild(b);
      box.open = true;
    }
    els.notes.replaceChildren(box);
  }

  // sheet notes contain bare URLs; show them as links, with their original case
  function linkify(node, text) {
    String(text).split(/(https?:\/\/\S+)/).forEach((part, i) => {
      if (i % 2) {
        const a = el('a', 'notice__link', part);
        a.href = part;
        a.target = '_blank';
        a.rel = 'noopener';
        node.appendChild(a);
      } else if (part) {
        node.appendChild(document.createTextNode(part));
      }
    });
    return node;
  }

  function setCensor(on) {
    state.censor = on;
    try { localStorage.setItem(CENSOR_KEY, on ? '1' : '0'); } catch (_) { /* storage unavailable */ }
    syncCensorBtn();
    renderResults();
    renderCard();
  }

  function syncCensorBtn() {
    els.censorBtn.hidden = !tabItems.get(state.tab).some((it) => it.nudity);
    els.censorBtn.setAttribute('aria-pressed', String(state.censor));
    els.censorBtn.querySelector('.toggle__state').textContent = state.censor ? 'ON' : 'OFF';
  }

  function setGrouped(on) {
    state.grouped = on;
    try { localStorage.setItem(GROUP_KEY, on ? '1' : '0'); } catch (_) { /* storage unavailable */ }
    els.groupBtn.setAttribute('aria-pressed', String(on));
    els.groupBtn.querySelector('.toggle__state').textContent = on ? 'ON' : 'OFF';
    renderResults();
    toast(on ? 'One tile per item: pick tier/version on the card' : 'Showing every tier and version');
  }

  function toggleFilters() {
    const open = els.rail.classList.toggle('is-open');
    els.filtersBtn.setAttribute('aria-expanded', String(open));
  }

  function cycleTab(step) {
    const i = DATA.tabs.findIndex((t) => t.id === state.tab);
    setTab(DATA.tabs[(i + step + DATA.tabs.length) % DATA.tabs.length].id);
  }

  // ---------- filters ----------

  function chipSection(label, chips) {
    const sec = el('section', 'f-group');
    sec.appendChild(el('h3', 'f-head', label));
    const box = el('div', 'f-chips');
    chips.forEach((c) => box.appendChild(c));
    sec.appendChild(box);
    return sec;
  }

  function groupChip(groupId, value) {
    const b = el('button', 'chip', value);
    b.type = 'button';
    b.dataset.group = groupId;
    b.dataset.value = value;
    return b;
  }

  function tierChip(tier, label, rarity) {
    const b = el('button', 'chip chip--tier', label);
    b.type = 'button';
    b.dataset.tier = tier;
    b.style.setProperty('--rc', F.rarityVar(rarity));
    return b;
  }

  function toggleBtn(flag) {
    const b = el('button', 'toggle', TOGGLE_LABELS[flag] || flag);
    b.type = 'button';
    b.dataset.flag = flag;
    b.setAttribute('aria-pressed', 'false');
    b.appendChild(el('span', 'toggle__state', 'OFF'));
    return b;
  }

  function tierChips(items) {
    const present = new Map();
    items.forEach((it) => { if (!present.has(it.tier)) present.set(it.tier, it.rarity); });
    const chips = F.TIER_ORDER.filter((t) => present.has(t)).map((t) => tierChip(t, t, present.get(t)));
    if (present.has(null)) chips.push(tierChip('none', 'Level-scaled', null));
    return chips;
  }

  function renderFilters() {
    const tab = tabById.get(state.tab);
    const frag = document.createDocumentFragment();
    tab.groups.forEach((g) => {
      if (g.values.length) frag.appendChild(chipSection(g.label, g.values.map((v) => groupChip(g.id, v))));
    });
    const tiers = tierChips(tabItems.get(tab.id));
    if (tiers.length > 1 || (tiers.length === 1 && tiers[0].dataset.tier !== 'none')) {
      frag.appendChild(chipSection('Tier', tiers));
    }
    if (tab.toggles && tab.toggles.length) frag.appendChild(chipSection('Show only', tab.toggles.map(toggleBtn)));
    els.filters.replaceChildren(frag);
  }

  function setOn(btn, on) {
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
  }

  function toggleIn(set, key) {
    if (set.has(key)) set.delete(key); else set.add(key);
    return set.has(key);
  }

  function onFilterClick(e) {
    const btn = e.target.closest('button');
    if (!btn || !els.filters.contains(btn)) return;
    if (btn.dataset.tier) {
      setOn(btn, toggleIn(state.tiers, btn.dataset.tier));
    } else if (btn.dataset.group) {
      const set = state.groups[btn.dataset.group] || (state.groups[btn.dataset.group] = new Set());
      setOn(btn, toggleIn(set, btn.dataset.value));
    } else if (btn.dataset.flag) {
      const on = toggleIn(state.flags, btn.dataset.flag);
      setOn(btn, on);
      btn.querySelector('.toggle__state').textContent = on ? 'ON' : 'OFF';
    } else {
      return;
    }
    // drop Back steps the rail just undid, so Back never re-applies or removes the wrong filter
    navStack = navStack.filter((n) => (n.flag ? state.flags.has(n.flag) : n.value === '*' ? state.star.has(n.gid) : pickedIn(n.gid)));
    settleLevel();
    renderResults();
  }

  // ---------- results ----------

  function tile(item, wide) {
    const queued = !!queueEntry(item.id);
    let cls = 'tile';
    if (wide) cls += ' tile--wide';
    if (item.iconic) cls += ' is-iconic';
    if (queued) cls += ' is-queued';
    if (item.id === state.selectedId) cls += ' is-selected';
    const b = el('button', cls);
    b.type = 'button';
    b.dataset.id = item.id;
    const tier = F.tierLabel(item.tier);
    const variant = variantOf(item);
    b.style.setProperty('--rc', F.rarityVar(item.rarity));
    b.appendChild(picture(item, 'tile__pic'));
    if (tier) b.appendChild(el('span', 'tile__tier', tier));
    if (item.iconic) b.appendChild(el('span', 'tile__iconic', '◆'));
    if (item.armor) b.appendChild(el('span', 'tile__armor', 'Armor'));
    const name = el('span', 'tile__name', item.name);
    if (variant) name.append(' ', el('span', 'tile__variant', variant));
    b.appendChild(name);
    b.appendChild(el('span', 'tile__type', typeOf(item)));
    if (queued) b.appendChild(el('span', 'tile__queued', 'IN QUEUE'));
    return b;
  }

  function row(item) {
    const entry = queueEntry(item.id);
    const r = el('div', 'row' + (entry ? ' is-queued' : '') + (item.id === state.selectedId ? ' is-selected' : ''));
    r.dataset.id = item.id;
    r.appendChild(el('span', 'row__name', item.name));
    const notes = el('span', 'row__notes', item.notes || item.desc || '');
    if (item.input && item.input.hint) notes.appendChild(el('span', 'row__hint', item.input.hint));
    r.appendChild(notes);
    let value = '';
    if (item.input && item.input.choice) r.appendChild(choiceSelect(item, 'row__choice', entry && entry.choice));
    if (item.input && item.input.kind === 'value') {
      const input = el('input', 'row__value');
      input.type = 'text';
      input.inputMode = item.input.text ? 'text' : 'decimal';
      input.placeholder = item.input.label || 'Value';
      input.setAttribute('aria-label', (item.input.label || 'Value') + ' for ' + item.name);
      value = entry ? entry.value : defaultValue(item);
      input.value = value;
      r.appendChild(input);
    }
    const add = el('button', 'row__add', entry ? 'Update' : '+ Add');
    add.type = 'button';
    add.disabled = needsValue(item, value);
    r.appendChild(add);
    return r;
  }

  function renderResults() {
    hideTip();
    const tab = tabById.get(state.tab);
    if (state.level === 'overview') { renderOverview(tab); return; }
    els.results.classList.remove('results--overview');
    renderCrumb();
    const list = F.sortItems(F.filterItems(tabItems.get(tab.id), {
      groups: state.groups, tiers: state.tiers, flags: state.flags, query: state.query,
    }), state.sort);
    const isList = tab.layout === 'list';
    const wide = WIDE_TABS.has(tab.id);
    const units = isList ? withSections(list, tab) : state.grouped ? groupUnits(list) : list;
    const make = isList ? row : (u) => (u.members ? groupTile(u, wide) : tile(u, wide));

    els.count.textContent = String(isList ? list.length : units.length);
    els.countLabel.textContent = 'Showing';
    const hits = updateTabHits();
    renderEmpty(list.length, tab, hits);
    els.results.classList.toggle('results--grid', !isList);
    els.results.classList.toggle('results--list', isList);
    tileEls = new Map();

    const token = ++renderToken;
    const paint = (from, to) => {
      const frag = document.createDocumentFragment();
      for (let i = from; i < to; i++) {
        if (units[i].section) { frag.appendChild(sectionHead(units[i])); continue; }
        const node = make(units[i]);
        (units[i].members || [units[i]]).forEach((m) => tileEls.set(m.id, node));
        frag.appendChild(node);
      }
      return frag;
    };
    els.results.replaceChildren(paint(0, Math.min(FIRST_PAINT, units.length)));
    els.results.scrollTop = 0;

    let next = FIRST_PAINT;
    const step = () => {
      if (token !== renderToken || next >= units.length) return;
      els.results.appendChild(paint(next, Math.min(next + CHUNK, units.length)));
      next += CHUNK;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // list tabs (Cheats, Teleport): split into sections by the tab's first group, in the group's order
  function withSections(list, tab) {
    const g = tab.groups[0];
    if (!g || state.sort !== 'sheet') return list;
    const by = new Map(g.values.map((v) => [v, []]));
    const rest = [];
    list.forEach((it) => ((it.group && by.get(it.group[g.id])) || rest).push(it));
    const out = [];
    by.forEach((items, v) => { if (items.length) out.push({ section: v, n: items.length }, ...items); });
    if (rest.length) out.push({ section: 'Other', n: rest.length }, ...rest);
    return out;
  }

  function sectionHead(u) {
    const h = el('h3', 'list__section', u.section);
    h.appendChild(el('span', 'list__count', String(u.n)));
    return h;
  }

  // collapse the filtered list to one unit per item name, in first-seen order
  function groupUnits(list) {
    const order = [];
    const byKey = new Map();
    list.forEach((it) => {
      const k = groupKey(it);
      if (!byKey.has(k)) { byKey.set(k, []); order.push(k); }
      byKey.get(k).push(it);
    });
    return order.map((k) => {
      const members = byKey.get(k);
      if (members.length === 1) return members[0];
      const sorted = members.slice().sort(byBest);
      return { key: k, members: sorted, rep: sorted[0] };
    });
  }

  function tierRange(members) {
    const ranks = [...new Set(members.filter((m) => m.tier !== null).map((m) => m.tier))]
      .sort((a, b) => F.TIER_ORDER.indexOf(a) - F.TIER_ORDER.indexOf(b));
    if (!ranks.length) return '';
    return ranks.length === 1 ? 'T' + ranks[0] : 'T' + ranks[0] + '–T' + ranks[ranks.length - 1];
  }

  // one tile for all versions: shows the picked version if one is selected, else the best one
  function groupTile(u, wide) {
    const shown = u.members.find((m) => m.id === state.selectedId) || u.rep;
    const b = tile(shown, wide);
    b.dataset.group = u.key;
    b._unit = u;
    const range = tierRange(u.members);
    let tierEl = b.querySelector('.tile__tier');
    if (range) {
      if (!tierEl) { tierEl = el('span', 'tile__tier'); b.appendChild(tierEl); }
      tierEl.textContent = range;
    }
    b.appendChild(el('span', 'tile__count', wide ? u.members.length + ' versions' : '×' + u.members.length));
    b.setAttribute('aria-label', shown.name + ', ' + u.members.length + ' versions' + (range ? ', ' + range : ''));
    // the variant label only matters once a specific version is picked
    if (shown === u.rep) b.querySelectorAll('.tile__variant').forEach((v) => v.remove());
    if (!b.classList.contains('is-queued') && u.members.some((m) => queueEntry(m.id))) {
      b.classList.add('is-queued');
      b.appendChild(el('span', 'tile__queued', 'IN QUEUE'));
    }
    return b;
  }

  // while searching, every tab shows how many items match, so a search isn't limited to the open tab
  function updateTabHits() {
    const q = state.query.trim();
    const hits = new Map();
    els.tabs.querySelectorAll('button.tab').forEach((b) => {
      if (!q) { delete b.dataset.hits; return; }
      const n = F.filterItems(tabItems.get(b.dataset.tab), { query: q }).length;
      hits.set(b.dataset.tab, n);
      b.dataset.hits = String(n);
    });
    return hits;
  }

  function renderEmpty(n, tab, hits) {
    els.empty.hidden = n > 0;
    if (n) return;
    const q = state.query.trim();
    const nodes = [el('span', null, q ? 'Nothing matches "' + q + '" in ' + tab.label + (state.tiers.size || state.flags.size || Object.values(state.groups).some((g) => g.size) ? ' with these filters' : '') : 'No items match these filters')];
    const elsewhere = DATA.tabs.filter((t) => t.id !== tab.id && hits.get(t.id)).sort((a, b) => hits.get(b.id) - hits.get(a.id));
    if (elsewhere.length) {
      const box = el('span', 'empty__tabs');
      box.appendChild(el('span', null, 'Found in: '));
      elsewhere.forEach((t) => {
        const b = el('button', 'empty__tab', hits.get(t.id) + ' in ' + t.label);
        b.type = 'button';
        b.dataset.tab = t.id;
        box.appendChild(b);
      });
      nodes.push(box);
    }
    if (state.tiers.size || state.flags.size || Object.values(state.groups).some((g) => g.size)) {
      const clear = el('button', 'empty__tab empty__clear', 'Clear filters');
      clear.type = 'button';
      const wrap = el('span', 'empty__tabs');
      wrap.appendChild(clear);
      nodes.push(wrap);
    }
    els.empty.replaceChildren(...nodes);
  }

  function refreshNode(id) {
    const node = tileEls.get(id);
    const item = byId.get(id);
    if (!node || !item || !node.isConnected) return;
    const wide = node.classList.contains('tile--wide');
    const fresh = node._unit ? groupTile(node._unit, wide) : node.classList.contains('row') ? row(item) : tile(item, wide);
    const hadFocus = node.contains(document.activeElement);
    node.replaceWith(fresh);
    (node._unit ? node._unit.members : [item]).forEach((m) => tileEls.set(m.id, fresh));
    if (hadFocus) fresh.focus();
  }

  function onResultsClick(e) {
    const cat = e.target.closest('[data-cat]');
    if (cat) { enterCategory(cat.dataset.cat); return; }
    const node = e.target.closest('[data-id]');
    if (!node || !els.results.contains(node)) return;
    if (e.detail > 1 && Date.now() - enteredAt < 600) return;
    const item = byId.get(node.dataset.id);
    if (e.target.closest('.row__add')) {
      const input = node.querySelector('.row__value');
      const pick = node.querySelector('.row__choice');
      addToQueue(item, defaultQty(item), input ? input.value : '', pick ? pick.value : '');
    } else if (!e.target.closest('.row__value, .row__choice')) {
      select(item.id);
    }
  }

  function onResultsDblClick(e) {
    // a double-click on a category tile must not also queue the item that appears under the pointer
    const node = e.target.closest('.tile[data-id]');
    if (!node || Date.now() - enteredAt < 600) return;
    const item = byId.get(node.dataset.id);
    if (needsValue(item, draft.value)) {
      const input = els.card.querySelector('.value-input');
      if (input) input.focus();
      return;
    }
    addToQueue(item, draft.qty, draft.value, draft.choice);
  }

  function onResultsInput(e) {
    if (!e.target.classList.contains('row__value')) return;
    const node = e.target.closest('.row');
    node.querySelector('.row__add').disabled = needsValue(byId.get(node.dataset.id), e.target.value);
  }

  function gridColumns() {
    const cols = getComputedStyle(els.results).gridTemplateColumns;
    return cols && cols !== 'none' ? cols.split(' ').length : 1;
  }

  // arrow keys move between tiles; Enter on the selected tile adds it to the queue
  function onTileKeydown(e) {
    const node = e.target.closest('.tile');
    if (!node || e.altKey || e.ctrlKey || e.metaKey) return false;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -gridColumns(), ArrowDown: gridColumns() }[e.key];
    if (step) {
      const tiles = [...els.results.children];
      const next = tiles[Math.max(0, Math.min(tiles.length - 1, tiles.indexOf(node) + step))];
      if (next) { next.focus(); next.scrollIntoView({ block: 'nearest' }); }
      e.preventDefault();
      return true;
    }
    if (e.key === 'Enter' && node.dataset.id && node.dataset.id === state.selectedId) {
      e.preventDefault();
      addSelected();
      return true;
    }
    return false;
  }

  function addSelected() {
    const item = state.selectedId && byId.get(state.selectedId);
    if (!item) return;
    if (needsValue(item, draft.value)) {
      const input = els.card.querySelector('.value-input');
      if (input) input.focus();
      return;
    }
    addToQueue(item, draft.qty, draft.value, draft.choice);
  }

  function onResultsKeydown(e) {
    if (onTileKeydown(e)) return;
    if (e.key !== 'Enter' || !e.target.classList.contains('row__value')) return;
    const btn = e.target.closest('.row').querySelector('.row__add');
    if (!btn.disabled) btn.click();
  }

  // ---------- hover tooltip (game-style item info box) ----------

  const tip = el('div', 'tip');
  tip.id = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  let tipTimer = 0;
  let tipFor = null;

  function tipRow(label, value) {
    const r = el('div', 'tip__row');
    r.append(el('span', null, label), el('span', null, value));
    return r;
  }

  function fillTip(item) {
    const tab = tabById.get(item.tab);
    const strip = item.iconic ? 'Iconic' : item.rarity || (item.tab === 'weapons' && item.tier === null ? 'Level-scaled' : typeLine(item) || tab.label);
    const nodes = [el('div', 'tip__strip', strip)];
    const name = el('div', 'tip__name', item.name);
    const variant = variantOf(item);
    if (variant) name.appendChild(el('span', 'tip__variant', variant));
    nodes.push(name);
    const tierText = cardTierText(item);
    if (tierText) nodes.push(el('div', 'tip__tier', tierText));
    nodes.push(el('div', 'tip__type', typeLine(item) || tab.label));
    const groupVals = Object.values(item.group || {});
    tab.groups.forEach((g) => { if (item.group && item.group[g.id]) nodes.push(tipRow(g.label, item.group[g.id])); });
    const extra = item.tags.filter((t) => !groupVals.includes(t));
    if (extra.length) nodes.push(tipRow('Tags', extra.join(', ')));
    if (item.armor) nodes.push(tipRow('Armor', item.armor + ' (by tier)'));
    if (item.info) nodes.push(el('div', 'tip__info', item.info));
    if (item.pl) nodes.push(tipRow('Expansion', 'Phantom Liberty'));
    if (item.crafted) nodes.push(tipRow('Source', 'Crafted'));
    if (item.input && item.input.kind !== 'value' && defaultQty(item) > 1) nodes.push(tipRow('Default amount', String(defaultQty(item))));
    if (item.desc || item.notes) nodes.push(el('div', 'tip__lore', [item.desc, item.notes].filter(Boolean).join('\n')));
    const group = state.grouped && groupAll.get(groupKey(item));
    if (group && group.length > 1) nodes.push(tipRow('Versions', group.length + ' (' + (tierRange(group) || 'variants') + ') — pick on the card'));
    if (item.code) nodes.push(el('div', 'tip__code', item.code));
    const entry = queueEntry(item.id);
    if (entry) nodes.push(el('div', 'tip__queued', 'In queue' + (item.input && item.input.kind !== 'value' ? ' ×' + entry.qty : '')));
    nodes.push(el('div', 'tip__hint', 'Click to inspect · Double-click or Enter to add · Right-click to go back'));
    tip.replaceChildren(...nodes);
    tip.style.setProperty('--rc', F.rarityVar(item.rarity));
    tip.classList.toggle('is-iconic', !!item.iconic);
  }

  // next to the tile: on the right when there is room, else on the left; always inside the viewport
  function placeTip(node) {
    const r = node.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = r.right + 10;
    if (x + w > innerWidth - 8) x = r.left - w - 10;
    if (x < 8) x = Math.min(innerWidth - w - 8, Math.max(8, r.left));
    const y = Math.min(Math.max(8, r.top), innerHeight - h - 8);
    tip.style.left = x + 'px';
    tip.style.top = Math.max(8, y) + 'px';
  }

  function showTip(node) {
    const item = byId.get(node.dataset.id);
    if (!item || !node.isConnected) return;
    tipFor = node;
    fillTip(item);
    tip.hidden = false;
    placeTip(node);
    tip.classList.add('is-on');
    node.setAttribute('aria-describedby', 'tip');
  }

  function hideTip() {
    clearTimeout(tipTimer);
    if (tipFor) tipFor.removeAttribute('aria-describedby');
    tipFor = null;
    tip.classList.remove('is-on');
    tip.hidden = true;
  }

  function onTipOver(e) {
    const node = e.target.closest('.tile[data-id]');
    if (!node || node === tipFor) return;
    hideTip();
    tipTimer = setTimeout(() => showTip(node), e.type === 'focusin' ? 0 : 220);
  }

  function onTipOut(e) {
    const node = e.target.closest('.tile[data-id]');
    if (node && !node.contains(e.relatedTarget)) hideTip();
  }

  // ---------- card ----------

  function select(id) {
    const prev = state.selectedId;
    state.selectedId = id;
    const entry = id && queueEntry(id);
    const item = id && byId.get(id);
    draft = entry ? { qty: entry.qty, value: entry.value, choice: entry.choice } : { qty: item ? defaultQty(item) : 1, value: defaultValue(item), choice: '' };
    [prev, id].forEach((x) => {
      const n = x && tileEls.get(x);
      if (!n) return;
      if (!n._unit) { n.classList.toggle('is-selected', x === id); return; }
      // only re-draw a group tile when it has to show a different version (re-drawing mid double-click loses the target)
      const shown = n._unit.members.find((m) => m.id === id) || n._unit.rep;
      if (shown.id === n.dataset.id) n.classList.toggle('is-selected', n._unit.members.some((m) => m.id === id));
      else refreshNode(x);
    });
    renderCard();
  }

  function versionPicker(item) {
    const members = (groupAll.get(groupKey(item)) || []).slice().sort(byBest);
    if (members.length < 2) return null;
    const box = el('div', 'card__versions');
    box.appendChild(el('div', 'card__versions-head', 'Pick a version (' + members.length + ')'));
    const list = el('div', 'card__versions-list');
    members.forEach((m, i) => {
      const label = [F.tierLabel(m.tier), variantOf(m)].filter(Boolean).join(' ') || 'Version ' + (i + 1);
      const b = el('button', 'vchip' + (m.id === item.id ? ' is-on' : ''), label);
      b.type = 'button';
      b.dataset.pick = m.id;
      b.title = m.code || m.name;
      b.setAttribute('aria-pressed', String(m.id === item.id));
      b.style.setProperty('--rc', F.rarityVar(m.rarity));
      list.appendChild(b);
    });
    box.appendChild(list);
    return box;
  }

  function cardTierText(item) {
    const parts = [];
    if (item.tier !== null) parts.push('Tier ' + item.tier);
    else if (item.tab === 'weapons') parts.push('Tier scales with your level');
    if (item.iconic) parts.push('Iconic');
    return parts.join(' / ');
  }

  function cardTags(item) {
    const box = el('div', 'card__tags');
    const tags = item.tags.slice();
    if (item.pl) tags.push('Phantom Liberty');
    if (item.crafted) tags.push('Crafted');
    tags.forEach((t) => box.appendChild(el('span', null, t)));
    return box;
  }

  function cardControls(item) {
    if (!item.input) return null;
    if (item.input.kind === 'value') {
      const input = el('input', 'value-input');
      input.type = 'text';
      input.inputMode = item.input.text ? 'text' : 'decimal';
      input.placeholder = item.input.label || 'Value';
      input.setAttribute('aria-label', item.input.label || 'Value');
      input.value = draft.value;
      const box = el('div', 'card__inputs');
      if (item.input.choice) box.appendChild(choiceSelect(item, 'choice-input', draft.choice));
      box.appendChild(input);
      if (!item.input.hint) return box;
      const wrap = el('div');
      wrap.append(box, el('p', 'card__hint', item.input.hint));
      return wrap;
    }
    const box = el('div', 'card__qty');
    const dec = el('button', 'qty-dec', '‹');
    dec.type = 'button';
    dec.setAttribute('aria-label', 'Decrease quantity');
    const val = el('input', 'qty-val');
    val.type = 'text';
    val.inputMode = 'numeric';
    val.setAttribute('aria-label', 'Quantity');
    val.value = String(draft.qty);
    const inc = el('button', 'qty-inc', '›');
    inc.type = 'button';
    inc.setAttribute('aria-label', 'Increase quantity');
    box.append(dec, val, inc);
    return box;
  }

  function renderCard() {
    const item = state.selectedId && byId.get(state.selectedId);
    els.card.classList.toggle('card--empty', !item);
    els.card.classList.toggle('is-iconic', !!(item && item.iconic));
    if (!item) {
      els.card.replaceChildren(el('div', 'card__strip', 'SELECTED'), el('p', 'card__lore', 'Select an item to see its command.'), el('p', 'card__how', 'Click an item → Add to queue → press C to copy → paste into the CET console in game.'));
      return;
    }
    els.card.style.setProperty('--rc', F.rarityVar(item.rarity));
    const close = el('button', 'card__close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    const nodes = [el('div', 'card__strip', 'SELECTED'), close, el('div', 'card__name', item.name)];
    const tierText = cardTierText(item);
    if (tierText) nodes.push(el('div', 'card__tier', tierText));
    const versions = versionPicker(item);
    if (versions) nodes.push(versions);
    const type = typeLine(item);
    if (type) nodes.push(el('div', 'card__type', type));
    if (item.armor) nodes.push(el('div', 'card__armor', 'Armor ' + item.armor + ' · scales with tier: T1 +5 … T5 +25'));
    if (item.info) nodes.push(el('div', 'card__info', item.info));
    nodes.push(picture(item, 'card__pic'));
    if (item.tags.length || item.pl || item.crafted) nodes.push(cardTags(item));
    if (item.desc || item.notes) {
      const lore = el('div', 'card__lore');
      [item.desc, item.notes].filter(Boolean).forEach((t) => lore.appendChild(el('p', null, t)));
      nodes.push(lore);
    }
    nodes.push(el('pre', 'card__cmd', F.renderCommand(item, draft)));
    const controls = cardControls(item);
    if (controls) nodes.push(controls);
    const add = el('button', 'card__add');
    add.type = 'button';
    nodes.push(add);
    els.card.replaceChildren(...nodes);
    updateCardAction(item);
  }

  function updateCardAction(item) {
    els.card.querySelector('.card__cmd').textContent = F.renderCommand(item, draft);
    const add = els.card.querySelector('.card__add');
    add.textContent = findEntry(item.id, draft.choice) ? 'Update queue' : '+ Add to queue';
    add.disabled = needsValue(item, draft.value);
  }

  function setDraftQty(item, qty) {
    draft.qty = F.clampQty(qty);
    els.card.querySelector('.qty-val').value = String(draft.qty);
    updateCardAction(item);
  }

  function onCardClick(e) {
    const item = byId.get(state.selectedId);
    if (!item) return;
    if (e.target.closest('.qty-dec')) setDraftQty(item, draft.qty - 1);
    else if (e.target.closest('.qty-inc')) setDraftQty(item, draft.qty + 1);
    else if (e.target.closest('.card__add')) addToQueue(item, draft.qty, draft.value, draft.choice);
    else if (e.target.closest('.card__close')) select(null);
    else if (e.target.closest('[data-pick]')) {
      const id = e.target.closest('[data-pick]').dataset.pick;
      select(id);
      const pick = els.card.querySelector('[data-pick="' + id + '"]');
      if (pick) pick.focus();
    }
  }

  function onCardInput(e) {
    const item = byId.get(state.selectedId);
    if (!item) return;
    if (e.target.classList.contains('qty-val')) {
      if (e.target.value.trim() !== '') draft.qty = F.clampQty(e.target.value);
    } else if (e.target.classList.contains('value-input')) {
      draft.value = e.target.value;
    } else if (e.target.classList.contains('choice-input')) {
      draft.choice = e.target.value;
    } else {
      return;
    }
    updateCardAction(item);
  }

  function onCardChange(e) {
    const item = byId.get(state.selectedId);
    if (item && e.target.classList.contains('choice-input')) { draft.choice = e.target.value; updateCardAction(item); return; }
    if (!item || !e.target.classList.contains('qty-val')) return;
    const n = Number(e.target.value);
    setDraftQty(item, Number.isFinite(n) && e.target.value.trim() !== '' ? n : defaultQty(item));
  }

  function onCardKeydown(e) {
    if (e.key !== 'Enter' || !e.target.matches('.qty-val, .value-input')) return;
    const add = els.card.querySelector('.card__add');
    if (!add.disabled) add.click();
  }

  // ---------- queue ----------

  function addToQueue(item, qty, value, choice) {
    if (needsValue(item, value)) return;
    choice = choiceOf(item, choice);
    const entry = findEntry(item.id, choice);
    const next = { id: item.id, cmd: item.cmd, qty: F.clampQty(qty), value: String(value || '').trim(), choice: String(choice || '') };
    if (entry) Object.assign(entry, next); else state.queue.push(next);
    saveQueue();
    renderQueue();
    refreshNode(item.id);
    if (state.selectedId === item.id) {
      draft = { qty: next.qty, value: next.value, choice: next.choice };
      updateCardAction(item);
    }
    toast(entry ? 'Queue updated' : 'Added to queue');
  }

  function removeFromQueue(id, choice) {
    state.queue = state.queue.filter((q) => !(q.id === id && (choice === undefined || q.choice === choice)));
    saveQueue();
    renderQueue();
    refreshNode(id);
    const item = byId.get(id);
    if (item && state.selectedId === id) updateCardAction(item);
  }

  function setQueue(next) {
    const ids = new Set(state.queue.map((q) => q.id).concat(next.map((q) => q.id)));
    state.queue = next;
    saveQueue();
    renderQueue();
    ids.forEach(refreshNode);
    const item = byId.get(state.selectedId);
    if (item) updateCardAction(item);
  }

  function clearQueue() {
    if (!state.queue.length) { toast('Queue is already empty'); return; }
    const before = state.queue.slice();
    setQueue([]);
    toast('Queue cleared', 'Undo', () => { setQueue(before); toast('Queue restored'); });
  }

  function queueRow(entry) {
    const item = byId.get(entry.id);
    const r = el('div', 'q-row');
    r.dataset.id = entry.id;
    r.dataset.choice = entry.choice || '';
    r.tabIndex = 0;
    r.title = 'Show this item';
    const stripe = el('i', 'q-row__stripe');
    stripe.style.setProperty('--rc', F.rarityVar(item.rarity));
    stripe.style.background = F.rarityVar(item.rarity);
    const tier = F.tierLabel(item.tier);
    const variant = variantOf(item);
    const name = el('span', 'q-row__name', item.name + (variant ? ' (' + variant + ')' : '') + (tier ? ' · ' + tier : ''));
    name.title = item.code || item.name;
    if (item.code) name.appendChild(el('small', 'q-row__code', item.code.replace(/^Items\./, '')));
    let qty = '';
    if (item.input && item.input.kind === 'value') qty = (item.input.choice ? F.optionLabel(item, choiceOf(item, entry.choice)) + ' ' : '') + '= ' + entry.value;
    else if (item.input) qty = '×' + entry.qty;
    const rm = el('button', 'q-row__rm', '✕');
    rm.type = 'button';
    rm.setAttribute('aria-label', 'Remove ' + item.name);
    const cp = el('button', 'q-row__copy', '⧉');
    cp.type = 'button';
    cp.title = 'Copy this command';
    cp.setAttribute('aria-label', 'Copy command for ' + item.name);
    r.append(stripe, name, el('span', 'q-row__qty', qty), cp, rm);
    return r;
  }

  function queueText() {
    return F.joinQueue(state.queue.map((q) => F.renderCommand(byId.get(q.id), q)));
  }

  function renderQueue() {
    const frag = document.createDocumentFragment();
    state.queue.forEach((q) => frag.appendChild(queueRow(q)));
    els.queueList.replaceChildren(frag);
    const n = state.queue.length;
    els.queueCount.textContent = String(n);
    if (els.queueBtnFoot) els.queueBtnFoot.lastChild.textContent = 'Queue (' + n + ')';
    els.queueTotal.textContent = n ? n + (n === 1 ? ' command' : ' commands') : 'Empty';
    els.queueCmds.textContent = n ? queueText() : '';
    els.queueDetails.hidden = !n;
    els.queueCopy.disabled = !n;
    els.queueClear.disabled = !n;
  }

  function onQueueClick(e) {
    const r = e.target.closest('.q-row');
    if (!r) return;
    const entry = findEntry(r.dataset.id, r.dataset.choice);
    if (e.target.closest('.q-row__rm')) removeFromQueue(r.dataset.id, entry ? entry.choice : undefined);
    else if (e.target.closest('.q-row__copy')) copyText(F.renderCommand(byId.get(entry.id), entry), 'Command copied');
    else revealItem(r.dataset.id);
  }

  function onQueueKeydown(e) {
    if (e.key === 'Enter' && e.target.classList.contains('q-row')) { e.preventDefault(); revealItem(e.target.dataset.id); }
  }

  function revealItem(id) {
    const item = byId.get(id);
    closeQueueSheet();
    if (item.tab !== state.tab) setTab(item.tab);
    if (!tileEls.has(id)) {
      // open the item's own category path, without search or filters that would hide it
      state.query = ''; els.search.value = ''; state.groups = {}; state.tiers = new Set(); state.flags = new Set();
      state.star = new Set();
      navStack = [];
      drillGroups(tabById.get(item.tab)).forEach((g) => {
        const v = item.group && item.group[g.id];
        if (v) { state.groups[g.id] = new Set([v]); navStack.push({ gid: g.id, value: v }); }
      });
      settleLevel();
      if (state.level === 'overview') state.level = 'items';
      syncFilterUI();
      renderResults();
    }
    select(id);
    const node = tileEls.get(id);
    if (node) node.scrollIntoView({ block: 'nearest' });
  }

  function copyText(text, msg) {
    const done = (ok) => toast(ok ? msg : 'Copy failed');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done(true), () => done(fallbackCopy(text)));
    } else {
      done(fallbackCopy(text));
    }
  }

  function fallbackCopy(text) {
    const ta = el('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    ta.remove();
    return ok;
  }

  function copyAll() {
    const n = state.queue.length;
    if (!n) { toast('Queue is empty'); return; }
    copyText(queueText(), n + (n === 1 ? ' command copied, paste it into the CET console' : ' commands copied, paste them into the CET console'));
  }

  // ---------- search / sort / keys / dialogs ----------

  let searchTimer = 0;
  function onSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = els.search.value;
      settleLevel();
      renderResults();
    }, 120);
  }

  function clearSearch() {
    clearTimeout(searchTimer);
    els.search.value = '';
    if (state.query) {
      state.query = '';
      // clearing the search returns to where the category path was
      settleLevel();
      renderResults();
    }
  }

  function onSearchKeydown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(searchTimer);
    state.query = els.search.value;
    settleLevel();
    renderResults();
    let first = els.results.querySelector('.tile, .row__value, .row__add');
    if (!first && state.query.trim()) {
      const best = DATA.tabs.map((t) => [t.id, F.filterItems(tabItems.get(t.id), { query: state.query }).length])
        .sort((a, b) => b[1] - a[1])[0];
      if (best && best[1]) {
        setTab(best[0]);
        first = els.results.querySelector('.tile, .row__value, .row__add');
      }
    }
    if (first) first.focus();
  }

  // the queue as a sheet on phones, where the side panel sits far below the grid
  function toggleQueueSheet() {
    if (!window.matchMedia('(max-width: 900px)').matches) {
      els.queuePanel.scrollIntoView({ block: 'nearest' });
      els.queuePanel.classList.remove('is-flash'); void els.queuePanel.offsetWidth; els.queuePanel.classList.add('is-flash');
      return;
    }
    const open = document.body.classList.toggle('queue-open');
    [els.queueBtn, els.queueBtnFoot].forEach((b) => b && b.setAttribute('aria-expanded', String(open)));
  }

  function closeQueueSheet() {
    document.body.classList.remove('queue-open');
    [els.queueBtn, els.queueBtnFoot].forEach((b) => b && b.setAttribute('aria-expanded', 'false'));
  }

  function onKeydown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') {
      if (document.body.classList.contains('queue-open')) closeQueueSheet();
      else if (e.target === els.search) { clearSearch(); els.search.blur(); }
      else if (isTyping(e.target)) e.target.blur();
      else goBack();
      return;
    }
    if (isTyping(e.target)) return;
    const k = e.key.toLowerCase();
    if (k === 'q') cycleTab(-1);
    else if (k === 'e') cycleTab(1);
    else if (k === 'c') copyAll();
    else if (k === 'x') clearQueue();
    else if (k === 'a') addSelected();
    else if (k === 'g') setGrouped(!state.grouped);
    else if (e.key === '/') { e.preventDefault(); els.search.focus(); els.search.select(); }
  }

  function bindDialog(btn, dialogId) {
    const dialog = $(dialogId);
    if (!btn || !dialog) return;
    btn.addEventListener('click', () => dialog.showModal());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  }

  function onTabsClick(e) {
    const b = e.target.closest('button.tab');
    if (b) { setTab(b.dataset.tab); return; }
    const key = e.target.closest('.key');
    if (key) cycleTab(key === els.nav.querySelector('.key') ? -1 : 1);
  }

  function init() {
    document.body.appendChild(tip);
    els.results.addEventListener('mouseover', onTipOver);
    els.results.addEventListener('mouseout', onTipOut);
    els.results.addEventListener('focusin', onTipOver);
    els.results.addEventListener('focusout', onTipOut);
    els.results.addEventListener('scroll', hideTip, { passive: true });
    window.addEventListener('resize', hideTip);
    document.addEventListener('error', onImageError, true);
    document.addEventListener('load', onImageLoad, true);
    els.search.addEventListener('keydown', onSearchKeydown);
    els.queueList.addEventListener('keydown', onQueueKeydown);
    [els.queueBtn, els.queueBtnFoot].forEach((b) => b && b.addEventListener('click', toggleQueueSheet));
    $('queue-close').addEventListener('click', closeQueueSheet);
    els.empty.addEventListener('click', (e) => {
      if (e.target.closest('.empty__clear')) {
        state.groups = {}; state.tiers = new Set(); state.flags = new Set(); state.star = new Set();
        navStack = [];
        settleLevel(); syncFilterUI(); renderResults(); return;
      }
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      setTab(b.dataset.tab);
      const first = els.results.querySelector('.tile, .row__value, .row__add');
      if (first) first.focus();
    });
    els.nav.addEventListener('click', onTabsClick);
    els.filters.addEventListener('click', onFilterClick);
    els.results.addEventListener('click', onResultsClick);
    els.results.addEventListener('dblclick', onResultsDblClick);
    els.results.addEventListener('input', onResultsInput);
    els.results.addEventListener('keydown', onResultsKeydown);
    els.card.addEventListener('click', onCardClick);
    els.card.addEventListener('input', onCardInput);
    els.card.addEventListener('change', onCardChange);
    els.card.addEventListener('keydown', onCardKeydown);
    els.queueList.addEventListener('click', onQueueClick);
    els.search.addEventListener('input', onSearch);
    els.sort.addEventListener('change', () => { state.sort = els.sort.value; renderResults(); });
    els.copy.addEventListener('click', copyAll);
    els.clear.addEventListener('click', clearQueue);
    els.filtersBtn.addEventListener('click', toggleFilters);
    els.back.addEventListener('click', () => {
      goBack();
      // the Back button disables itself at the top level; keep keyboard focus in the grid instead of losing it
      if (els.back.disabled && firstControl()) firstControl().focus();
    });
    els.queueCopy.addEventListener('click', copyAll);
    els.groupBtn.addEventListener('click', () => setGrouped(!state.grouped));
    els.censorBtn.addEventListener('click', () => setCensor(!state.censor));
    els.groupBtn.setAttribute('aria-pressed', String(state.grouped));
    els.groupBtn.querySelector('.toggle__state').textContent = state.grouped ? 'ON' : 'OFF';
    els.queueClear.addEventListener('click', clearQueue);
    let pointerType = 'mouse';
    document.addEventListener('pointerdown', (e) => { pointerType = e.pointerType; }, true);
    document.addEventListener('contextmenu', (e) => {
      if (pointerType === 'touch') return;
      if (isTyping(e.target) || document.querySelector('dialog[open]') || !e.target.closest('.layout')) return;
      if (e.target.closest('a, pre') || String(window.getSelection() || '')) return;
      e.preventDefault();
      goBack();
    });
    bindDialog(els.credits, 'modal-credits');
    bindDialog(els.help, 'modal-help');
    document.addEventListener('keydown', onKeydown);

    state.sort = els.sort.value || 'sheet';
    settleLevel();
    renderTabs();
    renderFilters();
    renderNotes();
    syncCensorBtn();
    renderResults();
    renderCard();
    renderQueue();
  }

  init();
})();
