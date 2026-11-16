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

test('search: every word must match name, code, tags, rarity, tier or group', () => {
  const w = ITEMS.filter((i) => i.tab === 'weapons');
  assert.deepStrictEqual(ids(F.filterItems(w, { query: 'legendary sniper' })), ['w1']);
  assert.deepStrictEqual(ids(F.filterItems(w, { query: 'T5++ pistol' })), []);
  assert.deepStrictEqual(ids(F.filterItems(w, { query: 'T5+ pistol' })), ['w3']);
  assert.deepStrictEqual(ids(F.filterItems(w, { query: '  power   PISTOL ' })).sort(), ['w2', 'w3']);
  assert.deepStrictEqual(ids(F.filterItems(w, { query: 'iconic' })), ['w1']);
});

test('variantLabel tells same-name presets apart', () => {
  const v = (name, code) => F.variantLabel(item({ name, code }));
  assert.strictEqual(v('Ashura', 'Items.Preset_Ashura_Neon'), 'Neon');
  assert.strictEqual(v('Ashura', 'Items.Preset_Ashura_Default'), '');
  assert.strictEqual(v('D5 Copperhead', 'Items.Preset_Copperhead_Military_Crowd'), 'Military Crowd');
  assert.strictEqual(v('Katana', 'Items.Preset_Katana_Arasaka_2077'), 'Arasaka 2077');
  assert.strictEqual(v('Overture', 'Items.Preset_Psycho_ma_hey_spr_04'), 'Cyberpsycho');
  assert.strictEqual(v('Overture', 'Items.Preset_Overture_Legendary'), '');
  assert.strictEqual(F.variantLabel(item({ name: 'Money', code: null })), '');
});

test('variantLabel splits CamelCase and drops rarity/Lvl/Plus words', () => {
  const v = (name, code) => F.variantLabel(item({ name, code }));
  assert.strictEqual(v('Mantis Blades', 'Items.AdvancedMantisBladesChemicalUncommonPlus'), 'Advanced Chemical');
  assert.strictEqual(v('Ba Xing Chong', 'Items.Recipe_Preset_Zhuo_Eight_Star'), 'Zhuo Eight Star');
});

test('search for "item" does not match every item through the Items. code prefix', () => {
  assert.deepStrictEqual(ids(F.filterItems(ITEMS, { query: 'items' })), []);
});

test('renderCommand fills {choice}, defaulting to the first option', () => {
  const attr = item({ cmd: 'X:SetAttribute("{choice}", {value})', input: { kind: 'value', choice: { label: 'Attribute', options: ['Strength', 'Cool'] } } });
  assert.strictEqual(F.renderCommand(attr, { value: '20', choice: 'Cool' }), 'X:SetAttribute("Cool", 20)');
  assert.strictEqual(F.renderCommand(attr, { value: '20' }), 'X:SetAttribute("Strength", 20)');
});

test('optionValue returns a string as-is and an object option\'s value', () => {
  assert.strictEqual(F.optionValue('Strength'), 'Strength');
  assert.strictEqual(F.optionValue({ label: 'Body', value: 'Strength' }), 'Strength');
});

test('optionLabel maps a value to its label and falls back to the value', () => {
  const skill = item({ cmd: 'X.{choice}', input: { kind: 'value', choice: { label: 'Skill', options: [
    { label: 'Headhunter', value: 'CoolSkill' }, { label: 'Netrunner', value: 'IntelligenceSkill' }] } } });
  assert.strictEqual(F.optionLabel(skill, 'IntelligenceSkill'), 'Netrunner');
  assert.strictEqual(F.optionLabel(skill, 'UnknownSkill'), 'UnknownSkill');
  const plain = item({ input: { kind: 'value', choice: { label: 'A', options: ['Strength', 'Cool'] } } });
  assert.strictEqual(F.optionLabel(plain, 'Cool'), 'Cool');
});

test('renderCommand with object options and no choice uses the first option\'s value', () => {
  const skill = item({ cmd: 'SetLevel(gamedataProficiencyType.{choice}, {value})', input: { kind: 'value', choice: {
    label: 'Skill', options: [{ label: 'Headhunter', value: 'CoolSkill' }, { label: 'Solo', value: 'StrengthSkill' }] } } });
  assert.strictEqual(F.renderCommand(skill, { value: '60' }), 'SetLevel(gamedataProficiencyType.CoolSkill, 60)');
  assert.strictEqual(F.renderCommand(skill, { value: '60', choice: 'StrengthSkill' }),
    'SetLevel(gamedataProficiencyType.StrengthSkill, 60)');
});
