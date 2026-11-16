"""Download item thumbnails from the Cyberpunk fan wiki into site/img/items and write site/data/images.js."""
import argparse
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "site/img/items"
OUT_JS = ROOT / "site/data/images.js"
REPORT = ROOT / "data/build/image-report.json"
API = "https://cyberpunk.fandom.com/api.php"
UA = "cp2077-cet-armory-build/1.0 (fan project)"
BATCH = 50

# Category keywords a wiki page must have to count as the item for a tab.
WEAPON_WORDS = ["weapon", "pistol", "revolver", "rifle", "shotgun", "smg", "lmg", "hmg", "melee", "blade",
                "grenade", "throw", "sword", "katana", "knife"]
TAB_CATEGORIES = {
    "weapons": WEAPON_WORDS,
    "clothing": ["clothing"],
    "cyberware": ["cyberware", "cyberdeck", "operating system"],
    "quickhacks": ["quickhack"],
    "modifications": ["attachment", "modification", "scope", "muzzle", "silencer"],
    "crafting": ["crafting", "component", "material"] + WEAPON_WORDS,
    "consumables": ["consumable", "medication", "food", "drink", "alcohol", "ammo", "skill", "shard"],
    "vehicles": ["car", "vehicle", "motorcycle", "bike"],
    "shards": ["shard"],
}
RARITY = "Common|Uncommon|Rare|Epic|Legendary"
BAD_TITLE = re.compile(r"[#<>\[\]{}|]")

_last = 0.0


def get(url, raw=False):
    global _last
    time.sleep(max(0.0, 1.0 - (time.monotonic() - _last)))
    _last = time.monotonic()
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
        return (r.read(), r.headers.get_content_type()) if raw else json.load(r)


def query(titles, **params):
    params.update(action="query", format="json", redirects=1, titles="|".join(titles))
    q = get(API + "?" + urllib.parse.urlencode(params))["query"]
    alias = {t: t for t in titles}
    for step in q.get("normalized", []) + q.get("redirects", []):
        for k, v in alias.items():
            if v == step["from"]:
                alias[k] = step["to"]
    pages = {p["title"]: p for p in q.get("pages", {}).values()}
    return {t: pages.get(alias[t]) for t in titles}


def batches(seq):
    seq = list(dict.fromkeys(seq))
    return [seq[i:i + BATCH] for i in range(0, len(seq), BATCH)]


def title_candidates(name):
    out = [name]
    s = re.sub(r"\s+x-MOD\d*$", "", name)
    s = re.sub(r"\s*[(\[][^)\]]*[)\]]$", "", s).strip()
    out.append(s)
    if ":" in s:
        out.append(s.split(":", 1)[1].strip())
    return [t for t in dict.fromkeys(out) if t and not BAD_TITLE.search(t) and len(t) < 200]


def file_candidates(code, tab):
    base = code.split(".", 1)[1]
    forms = [base]
    s = re.sub(r"^Preset_", "", base)
    s = re.sub(rf"^(?:Recipe_)?(?:{RARITY})_", "", s)
    s = re.sub(rf"_?(?:{RARITY}|{RARITY.lower()})(?:PlusPlus|Plus)?$", "", s)
    s = re.sub(r"Lvl\d(?:PlusPlus|Plus)?", "", s)
    forms.append(s)
    if tab == "clothing":
        forms += [base + "F", base + "M"]
    return [f"File:{f[0].upper()}{f[1:]}.png" for f in dict.fromkeys(forms) if f and not BAD_TITLE.search(f)]


def page_ok(page, tab):
    if not page or "thumbnail" not in page:
        return False
    cats = " ".join(c["title"].lower() for c in page.get("categories", []))
    return any(w in cats for w in TAB_CATEGORIES[tab])


def resolve(keys):
    """keys: imageKey -> {tab, names, codes}. Returns imageKey -> (thumb url, source)."""
    found = {}
    wanted = {}
    for key, k in keys.items():
        for t in (c for n in k["names"] for c in title_candidates(n)):
            wanted.setdefault(t, []).append(key)
    for chunk in batches(wanted):
        pages = query(chunk, prop="pageimages|categories", piprop="thumbnail|name", pithumbsize=256,
                      pilimit=BATCH, cllimit="max")
        for title in chunk:
            for key in wanted[title]:
                if key not in found and page_ok(pages[title], keys[key]["tab"]):
                    found[key] = (pages[title]["thumbnail"]["source"], pages[title]["title"])
        print(f"pages: {len(found)} matched", flush=True)

    wanted = {}
    for key, k in keys.items():
        if key not in found:
            for f in (c for code in k["codes"] for c in file_candidates(code, k["tab"])):
                wanted.setdefault(f, []).append(key)
    for chunk in batches(wanted):
        pages = query(chunk, prop="imageinfo", iiprop="url", iiurlwidth=256)
        for title in chunk:
            info = (pages[title] or {}).get("imageinfo")
            for key in wanted[title]:
                if key not in found and info:
                    found[key] = (info[0].get("thumburl") or info[0]["url"], pages[title]["title"])
        print(f"files: {len(found)} matched", flush=True)
    return found


EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", default=ROOT / "data/build/items.json")
    ap.add_argument("--limit", type=int, help="download at most N new images")
    ap.add_argument("--refresh", action="store_true", help="re-query the wiki instead of reusing the report")
    args = ap.parse_args()
    data = json.loads(Path(args.json).read_text(encoding="utf-8"))
    keys = {}
    for item in data["items"]:
        if item["tab"] not in TAB_CATEGORIES:
            continue
        k = keys.setdefault(item["imageKey"], {"tab": item["tab"], "names": [], "codes": []})
        k["names"] = list(dict.fromkeys(k["names"] + [item["name"]]))
        if item["code"]:
            k["codes"] = list(dict.fromkeys(k["codes"] + [item["code"]]))

    if REPORT.exists() and not args.refresh:
        cached = json.loads(REPORT.read_text(encoding="utf-8"))
        found = {k: tuple(v) for r in cached.values() for k, v in r["sources"].items() if k in keys}
    else:
        found = resolve(keys)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    existing = {p.stem: p.name for p in IMG_DIR.iterdir()}
    by_url, images, downloaded, failed = {}, {}, 0, {}
    for key, (url, _) in found.items():
        if key in existing:
            by_url.setdefault(url, existing[key])
        elif url not in by_url and url not in failed:
            if (args.limit is not None and downloaded >= args.limit) or len(failed) >= 3:
                continue
            try:
                body, ctype = get(url, raw=True)
            except urllib.error.HTTPError as e:
                failed[url] = e.code
                continue
            if ctype not in EXT:
                continue
            by_url[url] = f"{key}.{EXT[ctype]}"
            (IMG_DIR / by_url[url]).write_bytes(body)
            downloaded += 1
        if url in by_url:
            images[key] = "img/items/" + by_url[url]

    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUT_JS.write_text("window.CET_IMAGES = " + json.dumps(images, indent=0, sort_keys=True) + ";\n", encoding="utf-8")
    report = {}
    for key, k in sorted(keys.items()):
        tab = report.setdefault(k["tab"], {"total": 0, "matched": 0, "downloaded": 0, "unmatched": [], "sources": {}})
        tab["total"] += 1
        if key in found:
            tab["matched"] += 1
            tab["sources"][key] = found[key]
            tab["downloaded"] += key in images
        else:
            tab["unmatched"].append(key)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    for tab, r in report.items():
        print(f"{tab}: matched {r['matched']}/{r['total']}, images {r['downloaded']}")
    print(f"downloaded {downloaded} new files")
    if failed:
        print("download stopped after errors:", *(f"{c} {u}" for u, c in failed.items()), sep="\n  ")


if __name__ == "__main__":
    main()
