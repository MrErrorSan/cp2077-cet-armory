# Game UI metrics (reference for CET Armory)

Measured from the user's Cyberpunk 2077 (2.x) screenshots: 3840×2160 captures viewed at 2000×1125,
converted to a **1920×1080 viewport** (×0.96). These are the targets the UI audit checks against.

## Screen frame
| Element | Game | Target @1920 |
|---|---|---|
| Header height (to red rule) | ~80 px | 72–80 px |
| Left counters ("36 LEVEL") | number ~30 px cyan, label ~20 px | number 28–30 px |
| Tabs | ~20 px uppercase, red; active cyan + 3 px cyan underline; `[1]`/`[3]` keycaps 30 px | 18–20 px |
| Section heading ("WEAPONS", "CYBERWARE") | ~22 px red uppercase, 12 px above its tiles | 20–22 px |
| Bottom-right hints | keycap 28 px + label ~24 px red | 20–24 px |
| Background | radial maroon (#3a1216) top centre → navy-black (#0b0e17) | as is |
| Empty space | content occupies ~60% of width; generous margins | grid never stretches tiles to fill |

## Item tiles
| Kind | Game size | Ratio | Target @1920 |
|---|---|---|---|
| Weapon / vehicle (wide) | ~337×102 @2000 | 3.3 : 1 | **324×98 px** (±8%) |
| Cyberware / quickhack / mods / clothing (square) | ~112×103 @2000 | 1.1 : 1 | **108×99 px** (±8%) |
| Gap between tiles | 3–10 px | – | 6 px |
| Rarity stripe (left edge) | ~10 px @2000 | – | 8–9 px |
| Picture | ~70% of tile height, centred, real render | – | 64–72% of height |
| Corner cut | bottom-right 45°, ~14 px | – | 14 px |
| Cyan corner notch | **equipped/selected item only** | – | selected only |
| Gold PCB texture | **Iconic items only, any tier** | – | `.is-iconic` only |
| Non-iconic background | plain dark navy #141821, no pattern | – | plain |
| Text on wide tile | type label bottom-centre-right, small caps ~13 px letter-spaced; ammo/qty bottom-left cyan | – | name bottom-left 14–15 px, type 12 px |
| Mod-slot dots | top-left, 9 px rings | – | n/a (no data) |

## Tooltip / detail card
| Element | Game |
|---|---|
| Width | ~395 px @2000 → ~380 px |
| Header strip | cyan bg (#145a63) "EQUIPPED", 16 px |
| Name | cyan 24 px uppercase |
| Tier line | orange "TIER 5++ / ICONIC" 19 px |
| Type | red 19 px with icon |
| Lore | orange 15 px, gold circuit band at bottom **for Iconic** |

## Navigation (game behaviour the user wants)
- **Left-click goes into** something (slot → list of items → item).
- **Right-click goes back** to the parent level. `[ESC] Back` does the same.
- Levels on the site: **category overview → items in category → item selected**.

## Rarity colours
Common #9aa0a6 · Uncommon #3fd16a · Rare #2f86f0 · Epic #a64cf0 · Legendary #ff9e2c · Iconic marker ◆ orange.
