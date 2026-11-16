"""Build site/data/items.js (window.CET_DATA) from the CET console command spreadsheet."""
import argparse
import json
import re
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "data/source/ConsoleCommandList_2.0.xlsx"
OUT_JS = ROOT / "site/data/items.js"
OUT_JSON = ROOT / "data/build/items.json"
# Researched (not in the sheet): clothing that still gives Armor in 2.x, with wiki sources.
ARMOR_JSON = ROOT / "data/research/clothing-armor.json"
FLAGS = ("iconic", "pl", "crafted", "armor")

M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

RARITIES = ["common", "uncommon", "rare", "epic", "legendary"]
RARITY_WORDS = "Common|Uncommon|Rare|Epic|Legendary"
FLAG_TAGS = {"iconic": "iconic", "pl": "pl", "phantom liberty": "pl", "crafted": "crafted"}
DROP_TAGS = {"none"}

WEAPON_CLASS = ["Power", "Tech", "Smart", "Blade", "Blunt", "Thrown"]

# Group sources: ("vocab", TAGS column, extra values, excluded values) | ("fixed", values) | "auto"
TABS = {
    "weapons": dict(label="Weapons", layout="grid", name="Title", desc="Description", notes="Source", groups=[
        ("type", "Weapon", ("vocab", "Weapons", ["Grenade", "Chainsword"], WEAPON_CLASS)),
        ("class", "Class", ("fixed", WEAPON_CLASS)),
        ("source", "Source", ("fixed", ["Cyberpsycho", "BARGHEST", "Prime Gaming"])),
    ]),
    "clothing": dict(label="Clothing", layout="grid", name="Title", desc="Description", notes="Source", groups=[
        ("slot", "Slot", ("vocab", "Fashion", ["Outfit"], [])),
        ("collection", "Collection", ("fixed", ["Set"])),
    ]),
    "cyberware": dict(label="Cyberware", layout="grid", name="Title", desc="Description", notes="Source", groups=[
        ("slot", "Body slot", ("vocab", "Cyberware", ["Frontal Cortex"], [])),
        ("element", "Element", ("fixed", ["Physical", "Chemical", "Electrical", "Thermal"])),
    ]),
    "quickhacks": dict(label="Quickhacks", layout="grid", name="Title", desc="Description", notes="Source", groups=[
        ("type", "Type", ("fixed", ["Covert", "Combat", "Control", "Ultimate"])),
    ]),
    "modifications": dict(label="Modifications", layout="grid", name="Title", desc="Description", notes="Source", groups=[
        ("kind", "Type", ("fixed", ["Weapon", "Scope", "Muzzle"])),
        ("range", "Range", ("fixed", ["Ranged", "Melee"])),
        ("fits", "Fits", ("fixed", ["Universal", "Power", "Tech", "Smart", "ARSMGLMG", "Handguns", "PRSR",
                                    "Shotgun", "Generic", "Blade", "Blunt", "Throwable"])),
        ("variant", "Variant", ("fixed", ["Short", "Long", "Sniper", "Silencer", "Assault Rifle / SMG Muzzle",
                                          "Handgun Muzzle"])),
    ]),
    "crafting": dict(label="Crafting", layout="grid", name="Title", desc="Description", notes="Source",
                     groups=[("type", "Type", "auto")]),
    "shards": dict(label="Shards", layout="grid", name="Title", desc="Location", notes="Teleport", groups=[
        ("category", "Category", ("vocab", "Shard Categories", [], ["Cut Content", "Encrypted"])),
        ("special", "Special", ("fixed", ["Airdrops", "Cut Content"])),
    ]),
    "consumables": dict(label="Consumables", layout="grid", name="Title", desc="Description", notes="Source",
                        groups=[("type", "Type", "auto")]),
    "vehicles": dict(label="Vehicles", layout="grid", name="Title", desc="Description", notes="Source", groups=[
        ("class", "Class", ("fixed", ["Economy", "Sport", "Hypercar", "Executive", "Heavy Duty", "Motorcycle"])),
        ("faction", "Faction", ("fixed", ["Nomad", "BARGHEST"])),
        ("armed", "Armed", ("fixed", ["Combat"])),
    ]),
    "teleport": dict(label="Teleport", layout="list", name="Location", desc="Description", notes="Notes",
                     groups=[("type", "Type", "auto")]),
    "progress": dict(label="Progress", layout="list", name="Effect", desc="Description", notes="Notes",
                     groups=[("type", "Type", "auto")]),
    "cheats": dict(label="Cheats", layout="list", name="Notes", desc="Description", notes="", groups=[
        ("type", "Type", "auto")]),
}

ICONS = {
    "pistol": "pistol", "revolver": "revolver", "smg": "smg", "assault rifle": "assault-rifle",
    "shotgun": "shotgun", "double-barrel shotgun": "shotgun", "sniper rifle": "sniper-rifle",
    "precision rifle": "precision-rifle", "lmg": "lmg", "hmg": "lmg", "katana": "katana", "sword": "katana",
    "knife": "knife", "machete": "knife", "one-handed club": "blunt", "two-handed club": "blunt",
    "hammer": "blunt", "axe": "axe", "chainsword": "chainsword", "grenade": "grenade",
    "scope": "scope", "muzzle": "muzzle", "weapon": "weapon-mod",
    "head": "head", "face": "face", "outer torso": "torso", "inner torso": "torso", "legs": "legs",
    "feet": "feet", "outfit": "outfit",
    "drink": "drink", "alcohol": "drink", "progression shard": "shard", "components": "component",
}
TAB_ICONS = {"cyberware": "cyberware", "quickhacks": "quickhack", "shards": "shard", "consumables": "consumable",
             "crafting": "recipe", "vehicles": "car", "teleport": "teleport", "progress": "progress",
             "cheats": "cheat", "modifications": "weapon-mod"}

CODE_RE = re.compile(r"""["']((?:Items|Vehicle|Ammo)\.[^"']*)["']""")
ADD_RE = re.compile(r'AddToInventory\(\s*"([^"]+)"\s*(?:,\s*(\d*)\s*)?\)')
TITLE_TIER_RE = re.compile(r"\bTier (\d)(\+{0,2})")
# Typos in the sheet that make a command invalid Lua (one broken command breaks a whole "Copy all").
SHEET_FIXES = {
    "cheats": {"gamedataStatType.Stamina gameStatModifierType": "gamedataStatType.Stamina, gameStatModifierType"},
}
# Garment type from the clothing code prefix (Items.Balaclava_01_... -> Balaclavas); the sheet only has the slot.
CLOTHING_KINDS = {
    "Helmet": "Helmets", "Hat": "Hats", "Cap": "Caps", "Balaclava": "Balaclavas",
    "Mask": "Masks", "Glasses": "Glasses", "Visor": "Visors", "Scarf": "Scarves", "Tech": "Tech gear",
    "Jacket": "Jackets", "FormalJacket": "Formal jackets", "Coat": "Coats", "Vest": "Vests", "Dress": "Dresses",
    "Jumpsuit": "Jumpsuits", "TightJumpsuit": "Jumpsuits", "LooseShirt": "Shirts", "Shirt": "Shirts",
    "FormalShirt": "Formal shirts", "TShirt": "T-shirts", "Tshirt": "T-shirts", "Undershirt": "Undershirts",
    "Pants": "Pants", "FormalPants": "Formal pants", "Shorts": "Shorts", "FormalSkirt": "Skirts",
    "Boots": "Boots", "CasualShoes": "Shoes", "FormalShoes": "Formal shoes",
}
CLOTHING_OTHER = "Quest & special"
# Placeholders the sheet leaves in a command for the player to replace by hand: turn them into a picker / text box.
# Options show the in-game name and put the game's own value in the command
# (gamedataStatType for attributes, gamedataProficiencyType for skills; see data/research/extra-commands.json sources).
ATTRIBUTES = [{"label": "Body", "value": "Strength"}, {"label": "Reflexes", "value": "Reflexes"},
              {"label": "Technical Ability", "value": "TechnicalAbility"}, {"label": "Intelligence", "value": "Intelligence"},
              {"label": "Cool", "value": "Cool"}]
SKILLS = [{"label": "Headhunter", "value": "CoolSkill"}, {"label": "Netrunner", "value": "IntelligenceSkill"},
          {"label": "Shinobi", "value": "ReflexesSkill"}, {"label": "Solo", "value": "StrengthSkill"},
          {"label": "Engineer", "value": "TechnicalAbilitySkill"}]
PLACEHOLDERS = [
    ('"Attribute Category"', '"{choice}"', "Attribute", ATTRIBUTES,
     "Sets the attribute directly (1-20); it does not give or take attribute points."),
    ("gamedataProficiencyType.SKILLSkill", "gamedataProficiencyType.{choice}", "Skill", SKILLS,
     "Skill level 1-60. Lowering a skill and raising it again can give its perk points a second time."),
]
EXTRA_JSON = ROOT / "data/research/extra-commands.json"
# Weapons with nudity: the site hides their pictures by default. The game censors them in place since patch 1.5;
# Items.Preset_Stout_Censored is an old stand-in that is just a plain Electric Baton Alpha.
NUDITY_CODES = {"Items.Preset_Dildo_Stout", "Items.Preset_Dildo_SexShop"}
SITE_INFO = {
    "Items.Preset_Dildo_Stout": "Nudity: when the game's censorship is on, it shows this weapon as a plain cylinder. "
                                "There is no separate censored weapon in 2.x.",
    "Items.Preset_Dildo_SexShop": "Nudity: the game censors it in place, like Sir John Phallustiff. No censored code exists.",
    "Items.Preset_Stout_Censored": "Old censored stand-in for Sir John Phallustiff: in 2.x it is a plain Electric Baton Alpha "
                                   "without the iconic stats.",
}
FACT_PLACEHOLDER = ('GetFactStr("factName")', 'GetFactStr("{value}")')


# Starting value for each fill-in command, so it can be added as-is and edited when needed.
VALUE_DEFAULTS = [
    ('"Items.money"', "10000"), ('SetLevel("Level"', "60"), ('SetLevel("StreetCred"', "50"),
    ("DevelopmentPointType.Attribute", "1"), ("DevelopmentPointType.Primary", "1"), ("DevelopmentPointType.Espionage", "1"),
    ("SetAttribute(", "20"), ("ProficiencyType", "60"), ("gamedataStatType.Humanity", "50"),
    ("gamedataStatType.", "100"),
]
# Cheats with a fixed number ("+100 Max Health"): the number becomes the editable default.
STAT_NUMBER_RE = re.compile(r'(ModStatPlayer\("\w+",\s*"?)(-?\d+(?:\.\d+)?)(?="?\))')
HOUR_RE = re.compile(r"(SetGameTimeByHMS\()(\d+)(, 0, 0\))")
POINT_HINT = "A negative number removes points, e.g. -15"


def value_default(template):
    return next((v for key, v in VALUE_DEFAULTS if key in template), "1")


def fixed_value(template, name):
    """Turn a cheat's hard-coded number into {value}; returns (template, input, name) or None.
    Flags (value 1, e.g. CanBreatheUnderwater) stay fixed; only the first number is editable, and
    a repeat of that same number (regen in and out of combat) follows it."""
    m = HOUR_RE.search(template)
    if m:
        return (HOUR_RE.sub(r"\g<1>{value}\g<3>", template, 1),
                {"kind": "value", "label": "Hour (0-23)", "default": m.group(2), "min": 0, "max": 23},
                f"Set Time (hour, starts at {m.group(2)}:00)")
    m = STAT_NUMBER_RE.search(template)
    if not m or m.group(2) == "1":
        return None
    n = m.group(2)
    out = STAT_NUMBER_RE.sub(lambda x: x.group(1) + ("{value}" if x.group(2) == n else x.group(2)), template)
    name = re.sub(r"^\+\d+ ", "Add ", name)
    name = re.sub(r"^100% (.+)$", r"Add \1 %", name)
    return out, {"kind": "value", "label": "Amount", "default": n}, name


# Cheats tab sections: (section, test on name / command / sheet type), first match wins.
CHEAT_SECTIONS = [
    ("Upgrade to Legendary", lambda n, c, t: "Conversion to Legendary" in n),
    ("Vehicles", lambda n, c, t: "GetVehicleSystem" in c),
    ("Quests & story", lambda n, c, t: t == "Facts" or "Quest" in n or "SetFactStr" in c),
    ("Equipment", lambda n, c, t: t == "Unequip Slot" or "Equip" in c or "RemoveAllItems" in c or "ClearEquipment" in c),
    ("World & time", lambda n, c, t: t == "Time" or "Poi" in c or "PrevSys" in c or "ZoneIndicator" in c),
    ("Health & stats", lambda n, c, t: t in ("Player", "Stats")),
    ("Combat & abilities", lambda n, c, t: t == "Gameplay"),
    ("Game & logs", lambda n, c, t: True),
]


CHEAT_SECTION_ORDER = ["Health & stats", "Combat & abilities", "Equipment", "Upgrade to Legendary",
                       "Quests & story", "World & time", "Vehicles", "Game & logs"]
NAME_TYPOS = {"Healt ": "Health ", "Infinte Oxigen": "Infinite Oxygen", "Friedly": "Friendly", "Equiped": "Equipped"}


def tidy_name(name):
    """Every fill-in field now starts with a value, so the sheet's "XYZ" placeholder is dropped from names."""
    name = re.sub(r"\s+to XYZ\.?$|\s*\bXYZ\b", "", name).strip()
    for old, new in NAME_TYPOS.items():
        name = name.replace(old, new)
    return name


def cheat_section(name, cmd, sheet_type):
    return next(sec for sec, test in CHEAT_SECTIONS if test(name, cmd, sheet_type))


def armor_rule():
    d = json.loads(ARMOR_JSON.read_text(encoding="utf-8"))
    text = f"+{d['armor_min']} to +{d['armor_max']}"
    return lambda code: text if code in d["codes"] or any((code or "").startswith(p) for p in d["code_prefixes"]) else None


def clothing_kind(code):
    base = (code or "").split(".", 1)[-1]
    return CLOTHING_KINDS.get(re.split(r"[_0-9]", base)[0], CLOTHING_OTHER)


def apply_placeholders(template, inp, notes):
    """Return (template, input) with the sheet's hand-edit placeholders made fillable."""
    for old, new, label, options, _ in PLACEHOLDERS:
        if old in template:
            inp = dict(inp or {"kind": "value"}, label="Level", choice={"label": label, "options": options})
            template = template.replace(old, new)
    if FACT_PLACEHOLDER[0] in template:
        template = template.replace(*FACT_PLACEHOLDER)
        inp = {"kind": "value", "label": "Fact name", "text": True}
    return template, inp


NAME_STRIP_RE = re.compile(r"\s*\((?:Tier \d\+{0,2}|Iconic)\)")
TAG_TIER_RE = re.compile(r"^Tier (\d)$")
CODE_TIER_RES = [
    re.compile(rf"^(?:Items\.)?({RARITY_WORDS})(PlusPlus|Plus)?(?=_|[A-Z])"),
    re.compile(rf"_({RARITY_WORDS})(PlusPlus|Plus)?_"),
    re.compile(rf"({RARITY_WORDS})(PlusPlus|Plus)?$"),
    re.compile(rf"_({RARITY_WORDS.lower()})$"),
]


def _cell_text(cell, shared):
    kind = cell.get("t")
    if kind == "inlineStr":
        return "".join(t.text or "" for t in cell.iter(M + "t"))
    v = cell.find(M + "v")
    if v is None or v.text is None:
        return ""
    return shared[int(v.text)] if kind == "s" else v.text


def read_xlsx(path):
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(M + "si"):
                runs = si.findall(M + "t") + [t for r in si.findall(M + "r") for t in r.findall(M + "t")]
                shared.append("".join(t.text or "" for t in runs))
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
        sheets = {}
        for sheet in ET.fromstring(z.read("xl/workbook.xml")).iter(M + "sheet"):
            target = rels[sheet.get(R_ID)].lstrip("/")
            target = target if target.startswith("xl/") else "xl/" + target
            grid = []
            for row in ET.fromstring(z.read(target)).iter(M + "row"):
                cells = {re.match(r"[A-Z]+", c.get("r")).group(): _cell_text(c, shared) for c in row.findall(M + "c")}
                grid.append((int(row.get("r")), cells))
            header = {col: text.strip() for col, text in grid[0][1].items() if text.strip()} if grid else {}
            rows = []
            for num, cells in grid[1:]:
                rec = {header[c]: v for c, v in cells.items() if c in header and v.strip()}
                if rec:
                    rec["_row"] = num
                    rows.append(rec)
            sheets[sheet.get("name")] = rows
        return sheets


def _tier_str(word, plus):
    return str(RARITIES.index(word.lower()) + 1) + "+" * {None: 0, "Plus": 1, "PlusPlus": 2}[plus]


def parse_tier(title, code, tags):
    m = TITLE_TIER_RE.search(title or "")
    if m:
        return m.group(1) + m.group(2)
    if code:
        for rx in CODE_TIER_RES:
            m = rx.search(code)
            if m:
                return _tier_str(m.group(1), m.group(2) if rx.groups > 1 else None)
    for tag in tags:
        m = TAG_TIER_RE.match(tag)
        if m:
            return m.group(1)
    return None


def rarity_of(tier):
    return RARITIES[int(tier[0]) - 1] if tier else None


def normalise_command(cmd):
    cmd = cmd.strip()
    if "XYZ" in cmd:
        return cmd.replace("XYZ", "{value}"), {"kind": "value", "label": "Amount"}, 1
    qtys = []

    def repl(m):
        qtys.append(int(m.group(2)) if m.group(2) else 1)
        return f'AddToInventory("{m.group(1)}", {{qty}})'

    out = ADD_RE.sub(repl, cmd)
    if not qtys:
        return cmd, None, 1
    return out, {"kind": "qty"}, qtys[0]


def _command_key(row):
    return next(k for k in row if k.startswith("Command"))


def code_of(cmd):
    m = CODE_RE.search(cmd)
    return m.group(1) if m else None


def expand_mod(row):
    cmd = row[_command_key(row)].strip()
    if '_X"' not in cmd:
        return []
    lo, _, hi = (row.get("Description") or "Common - Legendary").partition("-")
    lo, hi = lo.strip().lower(), (hi or lo).strip().lower()
    out = []
    for i in range(RARITIES.index(lo), RARITIES.index(hi) + 1):
        quality = RARITIES[i].capitalize()
        variant = cmd.replace('_X"', f'_{quality}"')
        out.append({"suffix": RARITIES[i][0], "cmd": variant, "code": code_of(variant), "tier": str(i + 1)})
    return out


def _split_tags(text):
    return [t.strip() for t in (text or "").split(",") if t.strip()]


def _vocab(sheets):
    vocab = {}
    for row in sheets.get("TAGS", []):
        for col, val in row.items():
            if col != "_row":
                vocab.setdefault(col, []).append(val.strip())
    return vocab


def _is_note(row, cfg, cmd):
    return "(" not in cmd or not (row.get(cfg["name"], "").strip() or row.get("Tags") or row.get("Type") or code_of(cmd))


def _image_key(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _icon(tab, tags):
    for t in tags:
        if t.lower() in ICONS and (tab != "crafting" or t == "Components"):
            return ICONS[t.lower()]
    if tab == "cyberware" and "Cyberdeck" in tags:
        return "cyberdeck"
    if tab == "vehicles" and "Motorcycle" in tags:
        return "motorcycle"
    return TAB_ICONS.get(tab, "generic")


def _build_groups(spec, vocab, canon, counts):
    groups = []
    for gid, label, src in spec:
        if src == "auto":
            values = [v for v, n in counts.items() if n >= 2 and len(v) <= 30]
            if len(values) < 2:
                continue
        elif src[0] == "vocab":
            values = [canon.get(v.lower(), v) for v in vocab.get(src[1], []) + src[2] if v not in src[3]]
        else:
            values = [canon.get(v.lower(), v) for v in src[1]]
        taken = {v for g in groups for v in g["values"]}
        values = [v for v in dict.fromkeys(values)
                  if v in counts and v.lower() not in FLAG_TAGS and v not in taken]
        groups.append({"id": gid, "label": label, "values": values})
    return groups


def build(xlsx_path=XLSX):
    sheets = read_xlsx(xlsx_path)
    vocab = _vocab(sheets)
    with zipfile.ZipFile(xlsx_path) as z:
        modified = re.search(r"<dcterms:modified[^>]*>([\d-]{10})", z.read("docProps/core.xml").decode()).group(1)
    tabs, items, counts_out = [], [], {}
    armor_of = armor_rule()
    for tab, cfg in TABS.items():
        rows, notes = [], []
        for row in sheets[tab.upper()]:
            cmd = next((v for k, v in row.items() if k.startswith("Command")), "").strip()
            if not cmd:
                continue
            for old, new in SHEET_FIXES.get(tab, {}).items():
                cmd = cmd.replace(old, new)
            if _is_note(row, cfg, cmd):
                notes.append(cmd)
                continue
            if code_of(cmd) in ("Items.", "Vehicle."):
                continue
            rows.append((row, cmd))

        raw_tags = [t for row, _ in rows for t in _split_tags(row.get("Tags") or row.get("Type"))]
        canon = {}
        for t, _ in Counter(raw_tags).most_common():
            canon.setdefault(t.lower(), t)
        counts = Counter(canon[t.lower()] for t in raw_tags)
        groups = _build_groups(cfg["groups"], vocab, canon, counts)
        lookup = {v: g["id"] for g in groups for v in g["values"]}

        tab_items = []
        for row, cmd in rows:
            tags = list(dict.fromkeys(canon[t.lower()] for t in _split_tags(row.get("Tags") or row.get("Type"))))
            flags = {FLAG_TAGS[t.lower()] for t in tags if t.lower() in FLAG_TAGS}
            tier_tags = [t for t in tags if TAG_TIER_RE.match(t)]
            plain = [t for t in tags if t.lower() not in FLAG_TAGS and t.lower() not in DROP_TAGS and t not in tier_tags]
            group = {}
            for t in plain:
                if t in lookup:
                    assert lookup[t] not in group, f"{tab} row {row['_row']}: two values for group {lookup[t]}"
                    group[lookup[t]] = t
            title = row.get(cfg["name"], "").strip()
            variants = expand_mod(row) or [{"suffix": "", "cmd": cmd, "code": code_of(cmd), "tier": None}]
            for v in variants:
                code = v["code"]
                name = NAME_STRIP_RE.sub("", title).strip() or (code or "").split(".", 1)[-1]
                tier = v["tier"] or parse_tier(title, code, tier_tags)
                template, inp, qty = normalise_command(v["cmd"])
                template, inp = apply_placeholders(template, inp, row.get(cfg["notes"], "") if cfg["notes"] else "")
                if tab in ("cheats", "progress"):
                    name = tidy_name(name)
                if tab == "cheats" and not inp:
                    fixed = fixed_value(template, name)
                    if fixed:
                        template, inp, name = fixed
                if inp and inp["kind"] == "value" and not inp.get("text"):
                    inp = dict(inp, default=inp.get("default") or value_default(template))
                    if "AddDevelopmentPoints" in template:
                        inp["hint"] = POINT_HINT
                if tab == "clothing":
                    group = dict(group, kind=clothing_kind(code))
                sheet_notes = row.get(cfg["notes"], "").strip() if cfg["notes"] else ""
                for old, _, _, _, note in PLACEHOLDERS:
                    if old in v["cmd"]:
                        sheet_notes = note
                if tab == "cheats":
                    group = {"section": cheat_section(name, template, group.get("type"))}
                item = {
                    "id": f"{tab}-{row['_row']:04d}" + (f"-{v['suffix']}" if v["suffix"] else ""),
                    "tab": tab, "name": name, "tier": tier, "rarity": rarity_of(tier),
                    "iconic": "iconic" in flags, "pl": "pl" in flags, "crafted": "crafted" in flags,
                    "armor": armor_of(code) if tab == "clothing" else None,
                    "tags": plain, "group": group,
                    "desc": row.get(cfg["desc"], "").strip(), "notes": sheet_notes,
                    "nudity": code in NUDITY_CODES, "info": SITE_INFO.get(code, ""),
                    "cmd": template, "code": code, "input": inp,
                    "qty": qty if inp and inp["kind"] == "qty" else None,
                    "icon": _icon(tab, plain), "imageKey": _image_key(name),
                }
                tab_items.append(item)
        if tab == "progress":
            extra = json.loads(EXTRA_JSON.read_text(encoding="utf-8"))
            for n, x in enumerate(extra["progress"], 1):
                tab_items.append({
                    "id": f"progress-x{n:02d}", "tab": tab, "name": x["name"], "tier": None, "rarity": None,
                    "iconic": False, "pl": False, "crafted": False, "armor": None, "tags": [], "group": {},
                    "desc": "", "notes": x["notes"], "nudity": False,
                    "info": "Added by CET Armory (not in the sheet): the game's own call, from its script source.",
                    "cmd": x["cmd"], "code": None, "input": None, "qty": None,
                    "icon": _icon(tab, []), "imageKey": _image_key(x["name"])})
        if tab == "cheats":
            groups = [{"id": "section", "label": "Section", "values": CHEAT_SECTION_ORDER}]
        if tab == "clothing":
            kinds = Counter(i["group"]["kind"] for i in tab_items)
            values = [k for k, _ in kinds.most_common() if k != CLOTHING_OTHER] + [CLOTHING_OTHER]
            groups.insert(1, {"id": "kind", "label": "Type", "values": values})
        present = {f for i in tab_items for f in FLAGS if i[f]}
        tab_entry = {"id": tab, "label": cfg["label"], "layout": cfg["layout"], "groups": groups,
                     "toggles": [f for f in FLAGS if f in present]}
        if notes:
            tab_entry["notes"] = notes
        tabs.append(tab_entry)
        items.extend(tab_items)
        counts_out[tab] = len(tab_items)
    meta = {"source": Path(xlsx_path).name, "sourceModified": modified,
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "counts": counts_out}
    return {"meta": meta, "tabs": tabs, "items": items}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("xlsx", nargs="?", default=XLSX)
    ap.add_argument("--out", default=OUT_JS)
    ap.add_argument("--json", default=OUT_JSON)
    args = ap.parse_args()
    data = build(args.xlsx)
    for path in (args.out, args.json):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text("window.CET_DATA = " + json.dumps(data, separators=(",", ":")) + ";\n", encoding="utf-8")
    Path(args.json).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(data["meta"]["counts"]))


if __name__ == "__main__":
    main()
