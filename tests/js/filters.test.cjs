const test = require('node:test');
const assert = require('node:assert');
const F = require('../../site/js/filters.js');

const item = (o) => ({ tab: 'weapons', tier: null, rarity: null, iconic: false, pl: false, crafted: false,
  tags: [], group: {}, code: null, cmd: '', ...o });

const ITEMS = [
  item({ id: 'w1', name: 'Breakthrough', tier: '5', rarity: 'legendary', iconic: true,
    tags: ['Tech', 'Sniper Rifle'], group: { type: 'Sniper Rifle', class: 'Tech' },
    code: 'Items.Legendary_Nekomata_Breakthrough',
    cmd: 'Game.AddToInventory("Items.Legendary_Nekomata_Breakthrough", {qty})' }),
  item({ id: 'w2', name: 'Lexington', tier: '1', rarity: 'common', tags: ['Power', 'Pistol'],
    group: { type: 'Pistol', class: 'Power' }, code: 'Items.Common_Lexington' }),
  item({ id: 'w3', name: 'Unity', tier: '5+', rarity: 'legendary', tags: ['Power', 'Pistol'],
    group: { type: 'Pistol', class: 'Power' }, code: 'Items.Unity' }),
  item({ id: 'w4', name: 'A-22B Chao', tags: ['Tech', 'Pistol'], group: { type: 'Pistol', class: 'Tech' },
    code: 'Items.Preset_Chao_Default' }),
  item({ id: 'c1', tab: 'clothing', name: 'Jacket', tags: ['Outer Torso'], group: { slot: 'Outer Torso' } }),
];

const ids = (list) => list.map((i) => i.id);

test('OR within a group, AND across groups', () => {
  const or = F.filterItems(ITEMS, { tab: 'weapons', groups: { type: new Set(['Pistol', 'Sniper Rifle']) } });
  assert.deepStrictEqual(ids(or), ['w1', 'w2', 'w3', 'w4']);
  const and = F.filterItems(ITEMS, { tab: 'weapons', groups: { type: new Set(['Pistol']), class: new Set(['Tech']) } });
  assert.deepStrictEqual(ids(and), ['w4']);
});

test('tier "none" selects null-tier items, combined with other tiers', () => {
  assert.deepStrictEqual(ids(F.filterItems(ITEMS, { tab: 'weapons', tiers: new Set(['none']) })), ['w4']);
  assert.deepStrictEqual(ids(F.filterItems(ITEMS, { tab: 'weapons', tiers: new Set(['none', '5']) })), ['w1', 'w4']);
});

test('flags require every selected flag', () => {
  assert.deepStrictEqual(ids(F.filterItems(ITEMS, { tab: 'weapons', flags: new Set(['iconic']) })), ['w1']);
});

test('query matches code, name and tags case-insensitively', () => {
  assert.deepStrictEqual(ids(F.filterItems(ITEMS, { tab: 'weapons', query: 'nekomata' })), ['w1']);
  assert.deepStrictEqual(ids(F.filterItems(ITEMS, { tab: 'weapons', query: 'LEXING' })), ['w2']);
  assert.deepStrictEqual(ids(F.filterItems(ITEMS, { tab: 'clothing', query: 'outer' })), ['c1']);
});

test('query with regex characters does not throw and can match nothing', () => {
  assert.doesNotThrow(() => F.filterItems(ITEMS, { tab: 'weapons', query: '(tier' }));
  assert.deepStrictEqual(F.filterItems(ITEMS, { tab: 'weapons', query: '(tier[*' }), []);
});

test('sortItems: sheet keeps order, name alphabetical, tier desc with null last', () => {
  const w = ITEMS.filter((i) => i.tab === 'weapons');
  assert.deepStrictEqual(ids(F.sortItems(w, 'sheet')), ['w1', 'w2', 'w3', 'w4']);
  assert.deepStrictEqual(ids(F.sortItems(w, 'name')), ['w4', 'w1', 'w2', 'w3']);
  assert.deepStrictEqual(ids(F.sortItems(w, 'tier')), ['w3', 'w1', 'w2', 'w4']);
});

test('renderCommand substitutes qty (clamped) and value', () => {
  assert.strictEqual(F.renderCommand(ITEMS[0], { qty: 3 }),
    'Game.AddToInventory("Items.Legendary_Nekomata_Breakthrough", 3)');
  assert.match(F.renderCommand(ITEMS[0], { qty: 0 }), /", 1\)$/);
  assert.match(F.renderCommand(ITEMS[0], { qty: 5e9 }), /", 999999\)$/);
  const money = item({ cmd: 'Game.AddToInventory("Items.money", {value})' });
  assert.strictEqual(F.renderCommand(money, { value: '5000' }), 'Game.AddToInventory("Items.money", 5000)');
});

test('joinQueue produces one line joined by single spaces', () => {
  const out = F.joinQueue(['Game.AddToInventory("Items.A", 1)', 'Game.AddToInventory("Items.B", 2)']);
  assert.strictEqual(out, 'Game.AddToInventory("Items.A", 1) Game.AddToInventory("Items.B", 2)');
  assert.ok(!F.joinQueue(['a()\nb()', 'c()']).includes('\n'));
});

test('tierLabel and rarityVar', () => {
  assert.strictEqual(F.tierLabel('5'), 'T5');
  assert.strictEqual(F.tierLabel('5++'), 'T5++');
  assert.strictEqual(F.tierLabel(null), '');
  assert.strictEqual(F.rarityVar('legendary'), 'var(--r-legendary)');
  assert.strictEqual(F.rarityVar(null), 'var(--r-common)');
});
