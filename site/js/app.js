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
  const TOGGLE_LABELS = { iconic: 'Iconic ◆', pl: 'Phantom Liberty', crafted: 'Crafted' };

  const $ = (id) => document.getElementById(id);
  const els = {
    count: $('count'), tabs: $('tabs'), filters: $('filters'), search: $('search'), sort: $('sort'),
    results: $('results'), empty: $('empty'), card: $('card'), queueList: $('queue-list'),
    queueCount: $('queue-count'), copy: $('btn-copy'), clear: $('btn-clear'),
    credits: $('btn-credits'), help: $('btn-help'), toast: $('toast'),
    notes: $('tab-notes'), rail: $('rail'), filtersBtn: $('btn-filters'), nav: document.querySelector('.hdr__nav'),
  };
  const NUMBER_RE = /^-?\d+(\.\d+)?$/;
  const byId = new Map(DATA.items.map((it) => [it.id, it]));
  const tabItems = new Map(DATA.tabs.map((t) => [t.id, []]));
  DATA.items.forEach((it) => tabItems.get(it.tab) && tabItems.get(it.tab).push(it));
  const tabById = new Map(DATA.tabs.map((t) => [t.id, t]));

  const state = {
    tab: tabById.has('weapons') ? 'weapons' : DATA.tabs[0].id,
    groups: {}, tiers: new Set(), flags: new Set(), query: '', sort: 'sheet',
    selectedId: null, queue: loadQueue(),
  };
  let draft = { qty: 1, value: '' };
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
    const src = IMAGES[item.imageKey];
    if (src) {
      const img = el('img');
      img.loading = 'lazy';
      img.alt = '';
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
    wrap.replaceChildren(iconNode(wrap.dataset.icon));
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

  function needsValue(item, value) {
    return !!item.input && item.input.kind === 'value' && !NUMBER_RE.test(String(value || '').trim());
  }

  function isTyping(target) {
    return target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  let toastTimer = 0;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    els.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.remove('is-on');
      toastTimer = setTimeout(() => { els.toast.hidden = true; }, 300);
    }, 2200);
  }

  // ---------- persistence ----------

  function loadQueue() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(raw)
        ? raw.filter((q) => q && byId.has(q.id) && byId.get(q.id).cmd === q.cmd && !needsValue(byId.get(q.id), q.value))
          .map((q) => ({ id: q.id, cmd: q.cmd, qty: F.clampQty(q.qty), value: String(q.value || '') }))
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
    state.query = '';
    els.search.value = '';
    state.selectedId = null;
    els.tabs.querySelectorAll('button.tab').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === id));
    renderFilters();
    renderNotes();
    renderResults();
    renderCard();
  }

  function renderNotes() {
    const notes = tabById.get(state.tab).notes || [];
    els.notes.hidden = !notes.length;
    els.notes.replaceChildren(...notes.map((t) => el('p', null, t)));
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
    if (item.rarity === 'legendary') cls += ' r-legendary';
    const b = el('button', cls);
    b.type = 'button';
    b.dataset.id = item.id;
    b.style.setProperty('--rc', F.rarityVar(item.rarity));
    b.appendChild(picture(item, 'tile__pic'));
    const tier = F.tierLabel(item.tier);
    if (tier) b.appendChild(el('span', 'tile__tier', tier));
    if (item.iconic) b.appendChild(el('span', 'tile__iconic', '◆'));
    b.appendChild(el('span', 'tile__name', item.name));
    b.appendChild(el('span', 'tile__type', typeOf(item)));
    if (queued) b.appendChild(el('span', 'tile__queued', 'IN QUEUE'));
    return b;
  }

  function row(item) {
    const entry = queueEntry(item.id);
    const r = el('div', 'row' + (entry ? ' is-queued' : '') + (item.id === state.selectedId ? ' is-selected' : ''));
    r.dataset.id = item.id;
    r.appendChild(el('span', 'row__name', item.name));
    r.appendChild(el('span', 'row__notes', item.notes || item.desc || ''));
    let value = '';
    if (item.input && item.input.kind === 'value') {
      const input = el('input', 'row__value');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.placeholder = item.input.label || 'Value';
      input.setAttribute('aria-label', (item.input.label || 'Value') + ' for ' + item.name);
      value = entry ? entry.value : '';
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
    const tab = tabById.get(state.tab);
    const list = F.sortItems(F.filterItems(tabItems.get(tab.id), {
      groups: state.groups, tiers: state.tiers, flags: state.flags, query: state.query,
    }), state.sort);
    const isList = tab.layout === 'list';
    const wide = WIDE_TABS.has(tab.id);
    const make = isList ? row : (it) => tile(it, wide);

    els.count.textContent = String(list.length);
    els.empty.hidden = list.length > 0;
    els.results.classList.toggle('results--grid', !isList);
    els.results.classList.toggle('results--list', isList);
    tileEls = new Map();

    const token = ++renderToken;
    const paint = (from, to) => {
      const frag = document.createDocumentFragment();
      for (let i = from; i < to; i++) {
        const node = make(list[i]);
        tileEls.set(list[i].id, node);
        frag.appendChild(node);
      }
      return frag;
    };
    els.results.replaceChildren(paint(0, Math.min(FIRST_PAINT, list.length)));
    els.results.scrollTop = 0;

    let next = FIRST_PAINT;
    const step = () => {
      if (token !== renderToken || next >= list.length) return;
      els.results.appendChild(paint(next, Math.min(next + CHUNK, list.length)));
      next += CHUNK;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function refreshNode(id) {
    const node = tileEls.get(id);
    const item = byId.get(id);
    if (!node || !item) return;
    const fresh = node.classList.contains('row') ? row(item) : tile(item, node.classList.contains('tile--wide'));
    node.replaceWith(fresh);
    tileEls.set(id, fresh);
  }

  function onResultsClick(e) {
    const node = e.target.closest('[data-id]');
    if (!node || !els.results.contains(node)) return;
    const item = byId.get(node.dataset.id);
    if (e.target.closest('.row__add')) {
      const input = node.querySelector('.row__value');
      addToQueue(item, defaultQty(item), input ? input.value : '');
    } else if (!e.target.closest('.row__value')) {
      select(item.id);
    }
  }

  function onResultsDblClick(e) {
    const node = e.target.closest('.tile');
    if (!node) return;
    const item = byId.get(node.dataset.id);
    if (needsValue(item, draft.value)) {
      const input = els.card.querySelector('.value-input');
      if (input) input.focus();
      return;
    }
    addToQueue(item, draft.qty, draft.value);
  }

  function onResultsInput(e) {
    if (!e.target.classList.contains('row__value')) return;
    const node = e.target.closest('.row');
    node.querySelector('.row__add').disabled = needsValue(byId.get(node.dataset.id), e.target.value);
  }

  function onResultsKeydown(e) {
    if (e.key !== 'Enter' || !e.target.classList.contains('row__value')) return;
    const btn = e.target.closest('.row').querySelector('.row__add');
    if (!btn.disabled) btn.click();
  }

  // ---------- card ----------

  function select(id) {
    const prev = state.selectedId;
    state.selectedId = id;
    const entry = id && queueEntry(id);
    const item = id && byId.get(id);
    draft = entry ? { qty: entry.qty, value: entry.value } : { qty: item ? defaultQty(item) : 1, value: '' };
    [prev, id].forEach((x) => { const n = x && tileEls.get(x); if (n) n.classList.toggle('is-selected', x === id); });
    renderCard();
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
      input.inputMode = 'decimal';
      input.placeholder = item.input.label || 'Value';
      input.setAttribute('aria-label', item.input.label || 'Value');
      input.value = draft.value;
      return input;
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
    if (!item) {
      els.card.replaceChildren(el('div', 'card__strip', 'SELECTED'), el('p', 'card__lore', 'Select an item to see its command.'));
      return;
    }
    els.card.style.setProperty('--rc', F.rarityVar(item.rarity));
    const close = el('button', 'card__close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    const nodes = [el('div', 'card__strip', 'SELECTED'), close, el('div', 'card__name', item.name)];
    const tierText = cardTierText(item);
    if (tierText) nodes.push(el('div', 'card__tier', tierText));
    const type = typeLine(item);
    if (type) nodes.push(el('div', 'card__type', type));
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
    add.textContent = queueEntry(item.id) ? 'Update queue' : '+ Add to queue';
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
    else if (e.target.closest('.card__add')) addToQueue(item, draft.qty, draft.value);
    else if (e.target.closest('.card__close')) select(null);
  }

  function onCardInput(e) {
    const item = byId.get(state.selectedId);
    if (!item) return;
    if (e.target.classList.contains('qty-val')) {
      if (e.target.value.trim() !== '') draft.qty = F.clampQty(e.target.value);
    } else if (e.target.classList.contains('value-input')) {
      draft.value = e.target.value;
    } else {
      return;
    }
    updateCardAction(item);
  }

  function onCardChange(e) {
    const item = byId.get(state.selectedId);
    if (item && e.target.classList.contains('qty-val')) setDraftQty(item, e.target.value);
  }

  function onCardKeydown(e) {
    if (e.key !== 'Enter' || !e.target.matches('.qty-val, .value-input')) return;
    const add = els.card.querySelector('.card__add');
    if (!add.disabled) add.click();
  }

  // ---------- queue ----------

  function addToQueue(item, qty, value) {
    if (needsValue(item, value)) return;
    const entry = queueEntry(item.id);
    const next = { id: item.id, cmd: item.cmd, qty: F.clampQty(qty), value: String(value || '').trim() };
    if (entry) Object.assign(entry, next); else state.queue.push(next);
    saveQueue();
    renderQueue();
    refreshNode(item.id);
    if (state.selectedId === item.id) {
      draft = { qty: next.qty, value: next.value };
      updateCardAction(item);
    }
    toast(entry ? 'Queue updated' : 'Added to queue');
  }

  function removeFromQueue(id) {
    state.queue = state.queue.filter((q) => q.id !== id);
    saveQueue();
    renderQueue();
    refreshNode(id);
    const item = byId.get(id);
    if (item && state.selectedId === id) updateCardAction(item);
  }

  function clearQueue() {
    const ids = state.queue.map((q) => q.id);
    state.queue = [];
    saveQueue();
    renderQueue();
    ids.forEach(refreshNode);
    const item = byId.get(state.selectedId);
    if (item) updateCardAction(item);
    toast('Queue cleared');
  }

  function queueRow(entry) {
    const item = byId.get(entry.id);
    const r = el('div', 'q-row');
    r.dataset.id = entry.id;
    const stripe = el('i', 'q-row__stripe');
    stripe.style.setProperty('--rc', F.rarityVar(item.rarity));
    stripe.style.background = F.rarityVar(item.rarity);
    const tier = F.tierLabel(item.tier);
    const name = el('span', 'q-row__name', tier ? item.name + ' · ' + tier : item.name);
    name.title = item.code || item.name;
    let qty = '';
    if (item.input && item.input.kind === 'value') qty = '= ' + entry.value;
    else if (item.input) qty = '×' + entry.qty;
    const rm = el('button', 'q-row__rm', '✕');
    rm.type = 'button';
    rm.setAttribute('aria-label', 'Remove ' + item.name);
    r.append(stripe, name, el('span', 'q-row__qty', qty), rm);
    return r;
  }

  function renderQueue() {
    const frag = document.createDocumentFragment();
    state.queue.forEach((q) => frag.appendChild(queueRow(q)));
    els.queueList.replaceChildren(frag);
    els.queueCount.textContent = String(state.queue.length);
  }

  function onQueueClick(e) {
    const r = e.target.closest('.q-row');
    if (!r) return;
    if (e.target.closest('.q-row__rm')) removeFromQueue(r.dataset.id);
    else select(r.dataset.id);
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
    const text = F.joinQueue(state.queue.map((q) => F.renderCommand(byId.get(q.id), q)));
    const done = (ok) => toast(ok ? n + (n === 1 ? ' command copied' : ' commands copied') : 'Copy failed');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done(true), () => done(fallbackCopy(text)));
    } else {
      done(fallbackCopy(text));
    }
  }

  // ---------- search / sort / keys / dialogs ----------

  let searchTimer = 0;
  function onSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = els.search.value;
      renderResults();
    }, 120);
  }

  function clearSearch() {
    clearTimeout(searchTimer);
    els.search.value = '';
    if (state.query) {
      state.query = '';
      renderResults();
    }
  }

  function onKeydown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') {
      if (e.target === els.search) { clearSearch(); els.search.blur(); }
      else if (isTyping(e.target)) e.target.blur();
      else if (state.selectedId) select(null);
      else clearSearch();
      return;
    }
    if (isTyping(e.target)) return;
    const k = e.key.toLowerCase();
    if (k === 'q') cycleTab(-1);
    else if (k === 'e') cycleTab(1);
    else if (k === 'c') copyAll();
    else if (k === 'x') clearQueue();
    else if (e.key === '/') { e.preventDefault(); els.search.focus(); }
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
    document.addEventListener('error', onImageError, true);
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
    bindDialog(els.credits, 'modal-credits');
    bindDialog(els.help, 'modal-help');
    document.addEventListener('keydown', onKeydown);

    state.sort = els.sort.value || 'sheet';
    renderTabs();
    renderFilters();
    renderNotes();
    renderResults();
    renderCard();
    renderQueue();
  }

  init();
})();
