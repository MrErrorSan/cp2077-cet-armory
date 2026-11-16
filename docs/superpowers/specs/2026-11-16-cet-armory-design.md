# CET Armory: design spec

**Date:** 2026-11-16 · **Status:** approved to proceed (user: "spec → plan → implementation → verification → publish")
**Repo (planned):** `MrErrorSan/cp2077-cet-armory` → GitHub Pages

## 1. Intent and why

Cyberpunk 2077 players with Cyber Engine Tweaks (CET) can spawn any item with a console command, but only
if they know its exact code. Existing lists (spreadsheets, text builders) assume you already know the
item's *name*. New players know what an item **looks like** and what **tier** they want, not what it is
called (example: the user spent 2–3 days hunting for a legendary scope; the sheet lists 8 Tier 5 scopes).

CET Armory is a static website that looks like the in-game inventory. Players browse items visually, filter
by category / tier / iconic, put what they want in a **command queue**, and copy the commands into the CET
console in one go.

## 2. Data given (single source of truth)

`data/source/ConsoleCommandList_2.0.xlsx` is the live CET team list (OneDrive, from the redmodding Discord
#cet-support, linked from the CET wiki). File modified 2026-11-16; patch notes inside reach 2.3. **Nothing
else is a data source.** The other files in `data/source/` are reference only and are not read by the build.

| Tab | Rows with a command | Columns | Notes |
|---|---|---|---|
| WEAPONS | 544 | Tags, Command, Title, Description, Source | Tags mix type (Pistol…), class (Power/Tech/Smart), Iconic, PL, Crafted, Prime Gaming. 107 titles carry `(Tier N)`; tier is otherwise encoded in the code (`Common_`/`Legendary_`…) or absent (level-scaled) |
| CLOTHING | 1538 | same | Tags = slot (Head, Face, Outer/Inner Torso, Legs, Feet), Set, Outfit, PL, Iconic |
| CYBERWARE | 1004 | same | Tags = body slot + element; Iconic; PL. 1000 titles carry `(Tier N[+|++])` |
| QUICKHACKS | 74 | same | Covert/Combat/Control/Ultimate, Iconic |
| MODIFICATIONS | 89 | Tags, `Command (Replace X with Quality)`, Title, Description, Source | 35 rows use `_X`; Description gives the range, e.g. `Common - Legendary` → expand one item per quality |
| CRAFTING | 137 | same | Components + weapon recipes |
| SHARDS | 1502 | Tags, Command, Title, Location, Teleport | Lore shards; Tags = shard category, Phantom Liberty, Cut Content |
| CONSUMABLES | 218 | same | Food, Drink, Alcohol, Inhaler, Progression Shard, Ammo |
| VEHICLES | 89 | Tags, Command, Title | Lua unlock snippets, not AddToInventory |
| TELEPORT | 185 | Type, Command, Location | Lua snippets; Type = Ripperdoc, Weapon Shop, Tarot Card… |
| PROGRESS | 8 | Type, Command, Effect, Notes | All use an `XYZ` placeholder (money, level, street cred…) |
| CHEATS | 91 | Type, Command, Notes | Sheet warns some are broken on current patch; 4 use `XYZ` |
| TAGS | n/a | Weapons, Fashion, Cyberware, Rarity, Shard Categories | Official tag vocabulary; used to build filter groups, not shown as a tab |

Tier vocabulary (game, 2.x): Tier 1 Common · 2 Uncommon · 3 Rare · 4 Epic · 5 Legendary, with `+` steps
(`UncommonPlus` = 2+ … `LegendaryPlusPlus` = 5++). Iconic is a separate flag, not a rarity.

## 3. Requirements

### Must
- **R1 Game-faithful look**, modelled on the user's 2.x screenshots: maroon→navy background with red frame
  lines; header with cyan counters (left), red tabs + cyan active tab between `[Q]`/`[E]` keycaps (centre),
  red queue counter (right); red uppercase section headings; tiles with a left rarity stripe, cut
  bottom-right corner with cyan notch, gold circuit texture on Legendary; tooltip-style detail card (cyan
  border, `SELECTED` strip, cyan name, orange `TIER x / ICONIC`, red type line, orange lore); bottom-right
  keycap hints (`[C] Copy all`, `[X] Clear queue`, `[ESC] Back`). Rajdhani font, bundled locally.
- **R2 Every tab of the sheet** (12 content tabs). Item tabs use the tile grid; TELEPORT, PROGRESS and CHEATS
  use a list screen in the same style. *(Assistant's call; user did not answer this one.)*
- **R3 One tile per tier** (user choice 1B). A Breakthrough T1…T5 is five tiles. `_X` mods expand to one
  tile per quality in their range.
- **R4 Cyberware uses the same grid** (user choice 2B); body slot is a filter group.
- **R5 Filters per tab**: tag groups derived from the sheet (type/class/slot/category), tier chips
  (1, 1+ … 5, 5+, 5++, plus "Level-scaled" for items with no tier), toggles Iconic / Phantom Liberty /
  Crafted where the tab has them, free-text search (name, code, tags), sort (Sheet order, Name, Tier).
  Result count shown in the header.
- **R6 Detail card**: name, tier/rarity, iconic, tags, description/notes, exact command, quantity (for
  AddToInventory) or value input (for `XYZ`), Add to queue.
- **R7 Command queue** (right column, under the card): list with qty, remove per row, `[C]` Copy all,
  `[X]` Clear. Copy all joins commands with a single space so the result is **one line of valid Lua**
  (CET's console input is single-line). Queue survives reloads (localStorage, try/catch).
- **R8 Pictures**: real item image when the fan wiki has one, else a drawn SVG placeholder for the item
  category (pistol, katana, scope, jacket, quickhack, car…). No tile is ever blank.
- **R9 Fully static and local**: opens by double-clicking `site/index.html` (no server; data loaded as
  `.js`, not fetched JSON) and the same files deploy to GitHub Pages. No runtime network calls.
  *Revised:* the wiki CDN refuses scripted downloads, so pictures are hotlinked (400px wiki thumbnails
  loaded by the visitor's browser). Over http(s) they load; from `file://` the CDN's CORP header blocks
  them and tiles fall back to the SVG icons. Everything else stays local.
- **R10 Credits** screen: CET team spreadsheet, CET wiki, Cyberpunk Wiki (images), Rajdhani (OFL), CD
  PROJEKT RED fan-content notice ("not affiliated"). **How to use** screen: install CET, open console
  (`~`), paste.
- **R11 Keyboard**: `Q`/`E` tabs, `C` copy, `X` clear, `Esc` closes card/clears search, `/` focuses search.
- **R12 Usable at 1280–2560 px wide**; stacks to one column below ~900 px (phone is "works", not "polished").

### Non-goals
Modded items (Preem Team), the 2.2 workbook, the 2.4 CSV, stats/damage numbers (not in the sheet), any
backend, accounts, analytics, the cyberware body-slot screen, patch-diff history.

### Anti-goals (would be a failure even if it "works")
- A command that differs from the sheet's (wrong code, lost quotes, broken Lua).
- Mixing in data from anywhere but the xlsx.
- A generic dark "admin panel" look instead of the game UI.
- Blank tiles / broken image icons.

## 4. Approaches considered (pictures)

| | Approach | Trade-off | Decision |
|---|---|---|---|
| A | Extract real icons with WolvenKit from a game install | Exact art, full coverage; big manual export + mapping job | Later, optional |
| B | Fan-wiki images by item name | Easy, good for weapons/cyberware/iconics; spotty for clothing variants | **Used** |
| C | Drawn category placeholders | Always works, not item-specific | **Used as fallback** |

Chosen: **C + B**. Images are downloaded once at build time into the site (`site/img/items/`) and committed;
the live site never calls the wiki. Wiki API verified: `cyberpunk.fandom.com/api.php?action=query&prop=pageimages&pithumbsize=…`
(50 titles per request); some files are named after item codes (`W_att_scope_sniper_02.png`).

## 5. Architecture

```
data/source/ConsoleCommandList_2.0.xlsx
   └─ tools/build_data.py  (Python stdlib only) ──► site/data/items.js   window.CET_DATA
                                                    data/build/items.json (same, for tools)
   └─ tools/fetch_images.py (stdlib urllib)   ──► site/img/items/*.{png,jpg}
                                                    site/data/images.js   window.CET_IMAGES
site/index.html + css/app.css + js/*.js  (vanilla JS, no framework, no bundler)
.github/workflows/pages.yml  → deploys ./site to GitHub Pages
```

Data is generated, committed, and re-generated only when the xlsx changes.

## 6. Contracts (pinned)

`window.CET_DATA` (in `site/data/items.js`):
```js
{
  meta: { source: "ConsoleCommandList_2.0.xlsx", sourceModified: "2026-11-16", generated: "<ISO>", counts: { weapons: 544, ... } },
  tabs: [ { id: "weapons", label: "Weapons", layout: "grid" | "list",
            groups: [ { id: "type", label: "Weapon", values: ["Pistol", ...] }, ... ],   // tag filter groups
            toggles: ["iconic","pl","crafted"] } ],                                    // only those present
  items: [ {
    id: "weapons-0042",            // stable: tab + sheet row (+ "-q3" for expanded _X variants)
    tab: "weapons",
    name: "Breakthrough",          // title with "(Tier N)" stripped
    tier: "5" | "5+" | "5++" | "1" ... | null,     // null = not tiered / level-scaled
    rarity: "common"|"uncommon"|"rare"|"epic"|"legendary"|null,
    iconic: true, pl: false, crafted: false,
    tags: ["Tech","Sniper Rifle"],  // all tags except Iconic/PL/Crafted
    group: { type: "Sniper Rifle", class: "Tech" },  // tag → group id lookup
    desc: "", notes: "",
    cmd: "Game.AddToInventory(\"Items.Legendary_Nekomata_Breakthrough\", {qty})",
    code: "Items.Legendary_Nekomata_Breakthrough" | null,
    input: null | { kind: "qty" } | { kind: "value", label: "Amount" },   // {qty} or {value} token in cmd
    icon: "sniper-rifle",          // placeholder SVG id
    imageKey: "breakthrough"       // lookup into CET_IMAGES
  } ]
}
```
`window.CET_IMAGES = { "<imageKey>": "img/items/<file>" }`. Missing key → placeholder.

Command rules: copy the sheet's command verbatim except (a) normalise `AddToInventory("X")` and
`AddToInventory("X", n)` to `AddToInventory("X", {qty})`; (b) `XYZ` → `{value}`; (c) `_X` → quality name.
Default qty 1; crafting components keep the sheet's amount as default qty.

## 7. To-dos (what we have, what we pick up online)

Have: xlsx, game screenshots, mockup v2 (`.superpowers/brainstorm/…/layout-v2.html`), `gh` logged in as MrErrorSan.

| # | To-do | Source |
|---|---|---|
| 1 | xlsx → `items.js` builder + unit tests | local |
| 2 | Wiki image fetcher with match report | cyberpunk.fandom.com API (online, build-time only) |
| 3 | Category placeholder SVG set (~30) | drawn by us |
| 4 | Rajdhani woff2 (500/600/700) + OFL licence | Google Fonts / github.com/google/fonts (online) |
| 5 | Page shell + game-UI CSS | screenshots, mockup v2 |
| 6 | App logic: state, filters, search, sort, grid/list render, card, queue, keyboard | local |
| 7 | Credits + How-to screens, README, LICENSE (MIT code; game assets © CDPR) | local |
| 8 | Pages workflow, public repo, topics, deploy | GitHub |

## 8. Left to the builder
Exact placeholder art, tile sizes per tab (wide tiles for weapons/vehicles, square for the rest), list-screen
row design, wording of help text, the matching heuristics for wiki titles.

## 9. Risks
- **Image rights:** wiki images are CDPR art; acceptable under CDPR's fan-content guidelines for a free,
  credited, non-commercial site. README states it. Easy to remove (`site/img/items/`) if asked.
- **Wiki coverage** for clothing will be low → placeholders (accepted).
- **CET console single-line assumption** for Copy all; joined with spaces, which is valid Lua either way.
