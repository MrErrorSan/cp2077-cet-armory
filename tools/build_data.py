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
                item = {
                    "id": f"{tab}-{row['_row']:04d}" + (f"-{v['suffix']}" if v["suffix"] else ""),
                    "tab": tab, "name": name, "tier": tier, "rarity": rarity_of(tier),
                    "iconic": "iconic" in flags, "pl": "pl" in flags, "crafted": "crafted" in flags,
                    "tags": plain, "group": group,
                    "desc": row.get(cfg["desc"], "").strip(), "notes": row.get(cfg["notes"], "").strip(),
                    "cmd": template, "code": code, "input": inp,
                    "qty": qty if inp and inp["kind"] == "qty" else None,
                    "icon": _icon(tab, plain), "imageKey": _image_key(name),
                }
                tab_items.append(item)
        present = {f for i in tab_items for f in ("iconic", "pl", "crafted") if i[f]}
        tab_entry = {"id": tab, "label": cfg["label"], "layout": cfg["layout"], "groups": groups,
                     "toggles": [f for f in ("iconic", "pl", "crafted") if f in present]}
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
