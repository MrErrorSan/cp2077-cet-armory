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
        # progress: 8 sheet rows plus 3 from data/research/extra-commands.json.
        expected = {"weapons": 544, "clothing": 1538, "cyberware": 1004, "quickhacks": 74, "crafting": 137,
                    "shards": 744, "consumables": 218, "vehicles": 89, "teleport": 177, "progress": 11, "cheats": 90}
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

    def test_placeholders_become_fillable(self):
        attr = next(i for i in self.items if i["tab"] == "progress" and "SetAttribute(" in i["cmd"])
        self.assertIn('SetAttribute("{choice}", {value})', attr["cmd"])
        attr_opts = attr["input"]["choice"]["options"]
        self.assertTrue(all(isinstance(o, dict) and set(o) == {"label", "value"} for o in attr_opts))
        self.assertEqual([o["value"] for o in attr_opts],
                         ["Strength", "Reflexes", "TechnicalAbility", "Intelligence", "Cool"])
        self.assertNotIn("Espionage", [o["value"] for o in attr_opts])
        skill = next(i for i in self.items if i["tab"] == "progress" and "ProficiencyType" in i["cmd"])
        self.assertIn("gamedataProficiencyType.{choice}", skill["cmd"])
        self.assertNotIn("{choice}Skill", skill["cmd"])
        skill_opts = skill["input"]["choice"]["options"]
        self.assertEqual({o["value"]: o["label"] for o in skill_opts},
                         {"CoolSkill": "Headhunter", "IntelligenceSkill": "Netrunner", "ReflexesSkill": "Shinobi",
                          "StrengthSkill": "Solo", "TechnicalAbilitySkill": "Engineer"})
        fact = next(i for i in self.items if "GetFactStr(" in i["cmd"] and "print(" in i["cmd"])
        self.assertIn('GetFactStr("{value}")', fact["cmd"])
        self.assertTrue(fact["input"]["text"])
        self.assertFalse(any("Attribute Category" in i["cmd"] or "SKILLSkill" in i["cmd"] for i in self.items))

    def test_fixed_numbers_become_editable(self):
        tpl, inp, name = bd.fixed_value('Game.ModStatPlayer("Health", "100")', "+100 Max Health [cumulative]")
        self.assertEqual((tpl, inp["default"], name), ('Game.ModStatPlayer("Health", "{value}")', "100", "Add Max Health [cumulative]"))
        # the second, different number (start delay) stays fixed
        tpl, inp, _ = bd.fixed_value('Game.ModStatPlayer("StaminaRegenRateMult", 20) Game.ModStatPlayer("StaminaRegenStartDelay", -10)', "x")
        self.assertIn("{value}) ", tpl)
        self.assertIn("-10)", tpl)
        # on/off flags are not numbers to edit
        self.assertIsNone(bd.fixed_value('Game.ModStatPlayer("HasAirThrusters", "1")', "Rocket Boots"))
        self.assertEqual(bd.fixed_value("Game.GetTimeSystem():SetGameTimeByHMS(22, 0, 0)", "t")[1]["default"], "22")

    def test_every_value_input_has_a_default(self):
        for i in self.items:
            if i["input"] and i["input"]["kind"] == "value" and not i["input"].get("text"):
                self.assertTrue(i["input"].get("default"), i["id"])
        self.assertFalse(any("XYZ" in i["name"] for i in self.items if i["tab"] in ("cheats", "progress")))
        points = next(i for i in self.items if "DevelopmentPointType.Attribute" in i["cmd"])
        self.assertIn("negative", points["input"]["hint"])

    def test_cheat_sections(self):
        cheats = [i for i in self.items if i["tab"] == "cheats"]
        self.assertTrue(all(i["group"]["section"] in bd.CHEAT_SECTION_ORDER for i in cheats))
        by = {i["name"]: i["group"]["section"] for i in cheats}
        self.assertEqual(by["Takemura Is Dead"], "Quests & story")
        self.assertEqual(by["Force Unequip HEAD"], "Equipment")
        self.assertEqual(by["Enable all vehicles"], "Vehicles")

    def test_armor_clothing(self):
        armored = [i for i in self.items if i.get("armor")]
        self.assertEqual(len(armored), 77)
        self.assertTrue(all(i["tab"] == "clothing" for i in armored))
        self.assertIn("Items.Helmet_07_basic_01", {i["code"] for i in armored})
        self.assertNotIn("Items.Helmet_01_basic_01", {i["code"] for i in armored})
        tab = next(t for t in self.data["tabs"] if t["id"] == "clothing")
        self.assertIn("armor", tab["toggles"])

    def test_clothing_kind_from_code(self):
        self.assertEqual(bd.clothing_kind("Items.Balaclava_01_rich_01"), "Balaclavas")
        self.assertEqual(bd.clothing_kind("Items.Q203_Spacesuit_Outfit"), "Quest & special")
        cl = [i for i in self.items if i["tab"] == "clothing"]
        self.assertTrue(all(i["group"].get("kind") for i in cl))
        tab = next(t for t in self.data["tabs"] if t["id"] == "clothing")
        self.assertEqual([g["id"] for g in tab["groups"]][:2], ["slot", "kind"])


    def test_nudity_flag(self):
        flagged = {i["code"] for i in self.items if i["nudity"]}
        self.assertEqual(flagged, {"Items.Preset_Dildo_Stout", "Items.Preset_Dildo_SexShop"})
        self.assertTrue(all(i["nudity"] is True for i in self.items if i["code"] in flagged))

    def test_censored_stout_has_info(self):
        stout = [i for i in self.items if i["code"] == "Items.Preset_Stout_Censored"]
        self.assertTrue(stout)
        self.assertTrue(all(i["info"].strip() for i in stout))

    def test_extra_progress_commands(self):
        by_id = {i["id"]: i for i in self.items}
        expected = {"progress-x01": ("ResetNewPerks", "ResetAttributes"), "progress-x02": ("ResetNewPerks",),
                    "progress-x03": ("GetDevPoints",)}
        for xid, calls in expected.items():
            self.assertIn(xid, by_id)
            x = by_id[xid]
            self.assertEqual(x["tab"], "progress")
            for call in calls:
                self.assertIn(call, x["cmd"], xid)
            self.assertIsNone(x["input"], xid)
        self.assertNotIn("ResetAttributes", by_id["progress-x02"]["cmd"])

    def test_no_raw_placeholders_left(self):
        for i in self.items:
            if i["tab"] in ("progress", "cheats"):
                self.assertNotIn("Attribute Category", i["cmd"], i["id"])
                self.assertNotIn("SKILLSkill", i["cmd"], i["id"])

if __name__ == "__main__":
    unittest.main()
