# CET Armory

A free, fan-made item browser for Cyberpunk 2077, styled like the in-game inventory. Find an item by its picture, queue it up and copy the Cyber Engine Tweaks console command.

![CET Armory screenshot](docs/screenshot.png)

**Live site:** https://mrerrorsan.github.io/cp2077-cet-armory/

## Features

- Visual browsing with item pictures instead of a wall of text
- Filter by type, class and slot
- Tiers 1 to 5++, plus Iconic and Phantom Liberty filters
- Search by name or by item code
- One tile per tier, so each variant is easy to pick
- Command queue with one-click copy
- Keyboard shortcuts: Q / E / C / X / Esc, and `/` to focus search
- Works offline, just open the page
- All 12 sheet tabs, including teleports, progress and cheats

## How to use

1. Install [Cyber Engine Tweaks](https://github.com/maximegmd/CyberEngineTweaks) for Cyberpunk 2077.
2. Open the CET console in game (default key is set in the CET overlay).
3. On the site, add items to the queue and press copy.
4. Paste into the console and press Enter.

## Run locally

Open `site/index.html` in your browser. No server or install is needed.

## Rebuild data

Requires Python 3 and Node.js. The only data source is `data/source/ConsoleCommandList_2.0.xlsx`.

```
python -I tools/build_data.py
python -I tools/fetch_images.py
```

Tests:

```
python -I -m unittest discover -s tests
node --test tests/js/
```

## Project structure

```
site/     the website (index.html, css, js, fonts, data, img)
tools/    build_data.py, fetch_images.py
tests/    Python and JS tests
data/     source spreadsheet
docs/     plans, specs, screenshot
.github/  GitHub Pages workflow
```

## Credits

- Console command list by the CET team and the redmodding Discord #cet-support: https://wiki.redmodding.org/cyber-engine-tweaks/console/console/how-do-i
- [Cyber Engine Tweaks](https://github.com/maximegmd/CyberEngineTweaks)
- Item images from the Cyberpunk Wiki: https://cyberpunk.fandom.com
- Rajdhani font, SIL Open Font License

## Disclaimer

This is an unofficial fan project. It is not affiliated with or endorsed by CD PROJEKT RED. Cyberpunk 2077 assets and trademarks belong to CD PROJEKT S.A. Images are used under CDPR's fan content guidelines, and will be removed on request.

## License

The code is MIT licensed, see [LICENSE](LICENSE). Game assets are excluded, and the spreadsheet data belongs to its authors.
