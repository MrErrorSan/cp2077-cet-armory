import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import build_data as bd  # noqa: E402

PAX = {"Tags": "Weapon, Universal, Tier 1", "Command (Replace X with Quality)": 'Game.AddToInventory("Items.GenericMod1_X")',
       "Title": "Pax", "Description": "Common - Legendary", "_row": 2}


class ParseTier(unittest.TestCase):
    def test_title(self):
        self.assertEqual(bd.parse_tier("Toxic Mantis Blades (Tier 5++)", "Items.X", []), "5++")

    def test_code_prefix(self):
        self.assertEqual(bd.parse_tier("Breakthrough", "Items.Legendary_Nekomata_Breakthrough", []), "5")

    def test_level_scaled(self):
        self.assertIsNone(bd.parse_tier("A-22B Chao", "Items.Preset_Chao_Default", []))

    def test_code_suffix(self):
        self.assertEqual(bd.parse_tier("Pax", "Items.GenericMod1_Epic", []), "4")


class NormaliseCommand(unittest.TestCase):
    def test_bare_add(self):
        self.assertEqual(bd.normalise_command('Game.AddToInventory("Items.Preset_VB_Axe")'),
                         ('Game.AddToInventory("Items.Preset_VB_Axe", {qty})', {"kind": "qty"}, 1))

    def test_explicit_amount(self):
        cmd, inp, qty = bd.normalise_command('Game.AddToInventory("Items.CommonMaterial1", 100)')
        self.assertEqual((cmd, inp, qty), ('Game.AddToInventory("Items.CommonMaterial1", {qty})', {"kind": "qty"}, 100))

    def test_xyz(self):
        cmd, inp, _ = bd.normalise_command('Game.SetLevel("Level", XYZ, 1)')
        self.assertIn("{value}", cmd)
        self.assertEqual(inp["kind"], "value")

    def test_vehicle_unchanged(self):
        lua = "vs = Game.GetVehicleSystem() vs:EnablePlayerVehicle('Vehicle.v_standard2_archer_hella_player', true, false)"
        self.assertEqual(bd.normalise_command(lua), (lua, None, 1))


class ExpandMod(unittest.TestCase):
    def test_full_range(self):
        out = bd.expand_mod(PAX)
        self.assertEqual([v["code"] for v in out],
                         [f"Items.GenericMod1_{q}" for q in ("Common", "Uncommon", "Rare", "Epic", "Legendary")])
        self.assertEqual([v["tier"] for v in out], ["1", "2", "3", "4", "5"])

    def test_partial_range(self):
        self.assertEqual(len(bd.expand_mod({**PAX, "Description": "Epic - Legendary"})), 2)


class Build(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = bd.build(bd.XLSX)
        cls.items = cls.data["items"]

    def test_counts(self):
        counts = self.data["meta"]["counts"]
        # Spec §2 counts; teleport/cheats exclude instruction rows, shards exclude 758 rows with an empty code "Items.".
        expected = {"weapons": 544, "clothing": 1538, "cyberware": 1004, "quickhacks": 74, "crafting": 137,
                    "shards": 744, "consumables": 218, "vehicles": 89, "teleport": 177, "progress": 8, "cheats": 90}
        for tab, n in expected.items():
            self.assertEqual(counts[tab], n, tab)
        self.assertGreaterEqual(counts["modifications"], 89)

    def test_items_sane(self):
        self.assertTrue(all(i["cmd"] for i in self.items))
        ids = [i["id"] for i in self.items]
        self.assertEqual(len(ids), len(set(ids)))

    def test_groups_consistent(self):
        groups = {t["id"]: {g["id"]: set(g["values"]) for g in t["groups"]} for t in self.data["tabs"]}
        for i in self.items:
            for gid, val in i["group"].items():
                self.assertIn(val, groups[i["tab"]][gid], i["id"])
        for t in self.data["tabs"]:
            for g in t["groups"]:
                self.assertTrue(all(len(v) <= 30 for v in g["values"]), g)

    def test_apostrophe_title(self):
        hammer = next(i for i in self.items if i["name"] == "Comrade's Hammer" and i["tier"] == "5"
                      and i["tab"] == "weapons")
        self.assertIn('"Items.Legendary_Burya_Comrade"', hammer["cmd"])

    def test_duplicate_titles(self):
        prejudice = [i for i in self.items if i["tab"] == "weapons" and i["name"] == "Prejudice"]
        self.assertEqual(len(prejudice), 2)
        self.assertNotEqual(prejudice[0]["id"], prejudice[1]["id"])

    def test_sheet_fix_stamina_comma(self):
        stamina = next(i for i in self.items if i["tab"] == "cheats" and "gamedataStatType.Stamina" in i["cmd"])
        self.assertIn("gamedataStatType.Stamina, gameStatModifierType", stamina["cmd"])

    def test_component_default_qty(self):
        comp = next(i for i in self.items if i["code"] == "Items.CommonMaterial1")
        self.assertEqual(comp["qty"], 10000)
        self.assertTrue(all(i["qty"] is None for i in self.items if not i["input"] or i["input"]["kind"] != "qty"))


if __name__ == "__main__":
    unittest.main()
