-- Made-up example (nobody's real characters), written the way WoW writes SavedVariables\KutzInventory.lua.
-- Generated from tools/fixtures/example-KutzInventory.lua by `node tools/examples.js --write`.

KutzInventoryDB = {
	["chars"] = {
		["Examplemage-Example Realm"] = {
			["name"] = "Examplemage",
			["surname"] = "Examplesurname",
			["realm"] = "Example Realm",
			["level"] = 24,
			["class"] = "Mage",
			["classFile"] = "MAGE",
			["race"] = "Gnome",
			["faction"] = "Alliance",
			["sex"] = 3,
			["guild"] = "Example Guild",
			["guid"] = "Player-4395-0A1B2C3D",
			["spec"] = "Fire",
			["role"] = "DAMAGER",
			["money"] = 418275,
			["xp"] = 6120,
			["xpMax"] = 13900,
			["restedXP"] = 2400,
			["ilvl"] = 21.4375,
			["ilvlEquipped"] = 21.0625,
			["lastSeen"] = 1762905600,
			["location"] = {
				["zone"] = "Wetlands",
				["subzone"] = "Menethil Harbor",
				["mapID"] = 1437,
				["x"] = 10.8,
				["y"] = 59.6,
			},
			["hearth"] = "Stormwind City",
			["legacyTree"] = {
				["currency"] = {
					["available"] = 12,
					["spent"] = 4,
					["max"] = 16,
				},
				["trees"] = {
					["1187"] = {
						["spentInTree"] = 3,
						["nodes"] = {
							["100"] = 2,
							["101"] = 1,
						},
					},
					["1188"] = {
						["spentInTree"] = 1,
						["nodes"] = {
							["102"] = 1,
						},
					},
					["1189"] = {
						["spentInTree"] = 0,
						["nodes"] = {
						},
					},
				},
				["choices"] = {
					["101"] = 201,
				},
			},
			["updated"] = {
				["bags"] = 1762905600,
				["bank"] = 1762819200,
				["equipped"] = 1762905600,
				["stats"] = 1762905500,
				["sheet"] = 1762905500,
				["talents"] = 1762905400,
				["reputation"] = 1762905300,
				["statistics"] = 1762905200,
				["pvp"] = 1762905100,
				["money"] = 1762905600,
				["location"] = 1762905600,
				["professions"] = 1762905000,
				["currencies"] = 1762905000,
				["skills"] = 1762905000,
				["spells"] = 1762905000,
				["recipes"] = 1762900000,
				["trainers"] = 1762800000,
			},
			["bags"] = {
				[0] = {
					["name"] = "Backpack",
					["size"] = 16,
					["items"] = {
						{
							["id"] = 2589,
							["count"] = 14,
							["name"] = "Linen Cloth",
							["quality"] = 1,
							["icon"] = 132889,
							["classID"] = 7,
							["subClassID"] = 5,
							["type"] = "Tradeskill",
							["subType"] = "Cloth",
						}, -- [1]
						{
							["id"] = 4306,
							["count"] = 6,
							["name"] = "Silk Cloth",
							["quality"] = 1,
							["icon"] = 132905,
							["classID"] = 7,
							["subClassID"] = 5,
							["type"] = "Tradeskill",
							["subType"] = "Cloth",
						}, -- [2]
						{
							["id"] = 2455,
							["count"] = 4,
							["name"] = "Minor Mana Potion",
							["quality"] = 1,
							["icon"] = 134851,
							["classID"] = 0,
							["subClassID"] = 1,
							["type"] = "Consumable",
							["subType"] = "Potion",
						}, -- [3]
					},
				},
				[1] = {
					["name"] = "Linen Bag",
					["size"] = 6,
					["link"] = "|cffffffff|Hitem:4238::::::::24:::::::|h[Linen Bag]|h|r",
					["items"] = {
						{
							["id"] = 2996,
							["count"] = 3,
							["name"] = "Bolt of Linen Cloth",
							["quality"] = 1,
							["icon"] = 132890,
							["classID"] = 7,
							["subClassID"] = 5,
							["type"] = "Tradeskill",
							["subType"] = "Cloth",
						}, -- [1]
					},
				},
			},
			["bank"] = {
				[-1] = {
					["name"] = "Bank",
					["size"] = 24,
					["items"] = {
						{
							["id"] = 2592,
							["count"] = 20,
							["name"] = "Wool Cloth",
							["quality"] = 1,
							["icon"] = 132911,
							["classID"] = 7,
							["subClassID"] = 5,
							["type"] = "Tradeskill",
							["subType"] = "Cloth",
						}, -- [1]
					},
				},
			},
			["equipped"] = {
				[1] = {
					["id"] = 4321,
					["name"] = "Embroidered Hood",
					["slot"] = "HeadSlot",
					["quality"] = 2,
					["ilvl"] = 23,
					["icon"] = 132539,
					["equipLoc"] = "INVTYPE_HEAD",
					["link"] = "|cff1eff00|Hitem:4321::::::::24:::::::|h[Embroidered Hood]|h|r",
					["durability"] = 30,
					["durabilityMax"] = 35,
					["stats"] = {
						["ITEM_MOD_INTELLECT_SHORT"] = 4,
						["RESISTANCE0_NAME"] = 18,
					},
				},
				[5] = {
					["id"] = 6242,
					["name"] = "Blue Linen Robe",
					["slot"] = "ChestSlot",
					["quality"] = 2,
					["ilvl"] = 19,
					["icon"] = 132662,
					["equipLoc"] = "INVTYPE_ROBE",
					["link"] = "|cff1eff00|Hitem:6242:41:::::::24:::::::|h[Blue Linen Robe]|h|r",
					["durability"] = 60,
					["durabilityMax"] = 70,
					["stats"] = {
						["ITEM_MOD_INTELLECT_SHORT"] = 3,
						["ITEM_MOD_SPIRIT_SHORT"] = 2,
						["RESISTANCE0_NAME"] = 24,
					},
				},
				[16] = {
					["id"] = 5240,
					["name"] = "Torchlight Wand",
					["slot"] = "MainHandSlot",
					["quality"] = 2,
					["ilvl"] = 22,
					["icon"] = 135139,
					["equipLoc"] = "INVTYPE_RANGEDRIGHT",
					["link"] = "|cff1eff00|Hitem:5240::::::::24:::::::|h[Torchlight Wand]|h|r",
				},
			},
			["stats"] = {
				["strength"] = 18,
				["strengthBase"] = 18,
				["agility"] = 21,
				["agilityBase"] = 21,
				["stamina"] = 40,
				["staminaBase"] = 35,
				["intellect"] = 71,
				["intellectBase"] = 63,
				["spirit"] = 62,
				["spiritBase"] = 58,
				["armor"] = 96,
				["health"] = 512,
				["power"] = 1033,
				["critMelee"] = 5.1,
				["critRanged"] = 5.1,
				["critSpell"] = 6.2,
				["ratings"] = {
				},
			},
			["sheet"] = {
				["general"] = {
					["health"] = 512,
					["power"] = 1033,
					["powerType"] = "MANA",
					["moveSpeed"] = 100,
				},
				["primary"] = {
					["intellect"] = {
						["base"] = 63,
						["total"] = 71,
						["bonus"] = 8,
						["penalty"] = 0,
					},
				},
				["defense"] = {
					["armor"] = {
						["base"] = 54,
						["total"] = 96,
						["bonus"] = 42,
					},
				},
				["resistances"] = {
					["fire"] = {
						["base"] = 0,
						["total"] = 5,
						["bonus"] = 5,
						["penalty"] = 0,
					},
				},
			},
			["talents"] = {
				["system"] = "tabs",
				["tabs"] = {
					{
						["tab"] = 1,
						["name"] = "Arcane",
						["spent"] = 0,
					}, -- [1]
					{
						["tab"] = 2,
						["name"] = "Fire",
						["spent"] = 15,
					}, -- [2]
					{
						["tab"] = 3,
						["name"] = "Frost",
						["spent"] = 0,
					}, -- [3]
				},
				["taken"] = {
					{
						["name"] = "Improved Fireball",
						["spellID"] = 11069,
						["rank"] = 5,
						["maxRank"] = 5,
						["tab"] = 2,
						["tier"] = 1,
						["column"] = 2,
					}, -- [1]
					{
						["name"] = "Ignite",
						["spellID"] = 11119,
						["rank"] = 5,
						["maxRank"] = 5,
						["tab"] = 2,
						["tier"] = 2,
						["column"] = 3,
					}, -- [2]
				},
				["trees"] = {
				},
				["pvp"] = {
				},
			},
			["professions"] = {
				{
					["name"] = "Tailoring",
					["skillLine"] = 197,
					["skill"] = 112,
					["max"] = 150,
					["icon"] = 136249,
					["kind"] = "primary",
				}, -- [1]
				{
					["name"] = "Enchanting",
					["skillLine"] = 333,
					["skill"] = 95,
					["max"] = 150,
					["icon"] = 136244,
					["kind"] = "primary",
				}, -- [2]
				{
					["name"] = "Cooking",
					["skillLine"] = 185,
					["skill"] = 40,
					["max"] = 75,
					["icon"] = 133971,
					["kind"] = "secondary",
				}, -- [3]
			},
			["currencies"] = {
				{
					["name"] = "Honor Points",
					["currencyID"] = 1901,
					["quantity"] = 0,
					["icon"] = 1455894,
				}, -- [1]
			},
			["skills"] = {
				{
					["name"] = "Staves",
					["category"] = "Weapon Skills",
					["rank"] = 101,
					["max"] = 120,
					["skillID"] = 136,
				}, -- [1]
				{
					["name"] = "Wands",
					["category"] = "Weapon Skills",
					["rank"] = 110,
					["max"] = 120,
					["skillID"] = 228,
				}, -- [2]
				{
					["name"] = "Common",
					["category"] = "Languages",
					["rank"] = 300,
					["max"] = 300,
					["skillID"] = 98,
				}, -- [3]
			},
			["spells"] = {
				{
					["name"] = "Fireball",
					["spellID"] = 8400,
					["rank"] = 5,
				}, -- [1]
				{
					["name"] = "Arcane Intellect",
					["spellID"] = 1460,
					["rank"] = 2,
				}, -- [2]
			},
			["reputation"] = {
				{
					["factionID"] = 72,
					["name"] = "Stormwind",
					["group"] = "Alliance",
					["reaction"] = 5,
					["standing"] = "Friendly",
					["value"] = 4100,
					["min"] = 3000,
					["max"] = 9000,
				}, -- [1]
			},
			["statistics"] = {
				{
					["id"] = 60,
					["name"] = "Total deaths",
					["category"] = "Deaths",
					["value"] = 7,
				}, -- [1]
			},
			["achievementPoints"] = 0,
			["pvp"] = {
				["honorableKills"] = 12,
				["dishonorableKills"] = 0,
				["highestRank"] = 0,
				["rated"] = {
				},
			},
			["trainers"] = {
				["Tailoring"] = {
					{
						["name"] = "Red Linen Robe",
						["skillReq"] = 40,
						["cost"] = 200,
						["reqLevel"] = 8,
						["status"] = "used",
					}, -- [1]
				},
			},
			["recipes"] = {
				["Tailoring"] = {
					["professionID"] = 197,
					["skill"] = 112,
					["max"] = 150,
					["updated"] = 1762900000,
					["recipes"] = {
						{
							["recipeID"] = 2385,
							["name"] = "Brown Linen Vest",
							["difficulty"] = 3,
							["outputItemID"] = 2568,
							["makesMin"] = 1,
							["makesMax"] = 1,
							["reagents"] = {
								{
									["itemID"] = 2996,
									["name"] = "Bolt of Linen Cloth",
									["quantity"] = 1,
								}, -- [1]
								{
									["itemID"] = 2320,
									["name"] = "Coarse Thread",
									["quantity"] = 1,
								}, -- [2]
							},
						}, -- [1]
					},
					["unlearned"] = {
						{
							["recipeID"] = 3914,
							["name"] = "Brown Linen Pants",
							["outputItemID"] = 4343,
							["source"] = "trainer",
						}, -- [1]
					},
				},
			},
		},
		["Examplewarrior-Example Realm"] = {
			["name"] = "Examplewarrior",
			["surname"] = "Examplefamily",
			["realm"] = "Example Realm",
			["level"] = 8,
			["class"] = "Warrior",
			["classFile"] = "WARRIOR",
			["race"] = "Human",
			["faction"] = "Alliance",
			["sex"] = 3,
			["guid"] = "Player-4395-0A1B2C3E",
			["money"] = 1530,
			["xp"] = 1100,
			["xpMax"] = 2900,
			["restedXP"] = 0,
			["ilvl"] = 6.5,
			["ilvlEquipped"] = 6.5,
			["lastSeen"] = 1762732800,
			["location"] = {
				["zone"] = "Elwynn Forest",
				["subzone"] = "Goldshire",
				["mapID"] = 1429,
				["x"] = 42.1,
				["y"] = 65.3,
			},
			["updated"] = {
				["bags"] = 1762732800,
				["equipped"] = 1762732800,
				["stats"] = 1762732700,
			},
			["bags"] = {
				[0] = {
					["name"] = "Backpack",
					["size"] = 16,
					["items"] = {
						{
							["id"] = 2589,
							["count"] = 3,
							["name"] = "Linen Cloth",
							["quality"] = 1,
							["icon"] = 132889,
							["classID"] = 7,
							["subClassID"] = 5,
						}, -- [1]
					},
				},
			},
			["equipped"] = {
				[16] = {
					["id"] = 25,
					["name"] = "Worn Shortsword",
					["slot"] = "MainHandSlot",
					["quality"] = 1,
					["ilvl"] = 2,
					["icon"] = 135274,
					["link"] = "|cffffffff|Hitem:25::::::::8:::::::|h[Worn Shortsword]|h|r",
					["stats"] = {
						["ITEM_MOD_STRENGTH_SHORT"] = 1,
					},
				},
			},
			["stats"] = {
				["strength"] = 23,
				["strengthBase"] = 23,
				["stamina"] = 22,
				["staminaBase"] = 22,
				["health"] = 158,
				["power"] = 100,
				["armor"] = 40,
				["ratings"] = {
				},
			},
			["professions"] = {
			},
			["currencies"] = {
			},
			["skills"] = {
			},
			["spells"] = {
			},
			["reputation"] = {
			},
			["statistics"] = {
			},
		},
	},
	["warband"] = {
		["money"] = 50000,
		["updated"] = 1762905600,
		["updatedBy"] = "Examplemage-Example Realm",
		["bank"] = {
			[13] = {
				["name"] = "Warband Bank Tab 1",
				["size"] = 98,
				["items"] = {
					{
						["id"] = 2592,
						["count"] = 40,
						["name"] = "Wool Cloth",
						["quality"] = 1,
						["icon"] = 132911,
					}, -- [1]
				},
			},
		},
	},
	["guilds"] = {
		["Example Guild-Example Realm"] = {
			["money"] = 1250000,
			["updated"] = 1762819200,
			["tabs"] = {
				{
					["name"] = "Mats",
					["size"] = 98,
					["updated"] = 1762819200,
					["items"] = {
						{
							["id"] = 4306,
							["count"] = 60,
							["name"] = "Silk Cloth",
							["quality"] = 1,
							["icon"] = 132905,
						}, -- [1]
					},
				}, -- [1]
			},
		},
	},
	["prices"] = {
		["vendor"] = {
			["2320"] = {
				["price"] = 10,
				["vendor"] = "Some Trader",
			},
		},
		["sell"] = {
			["2568"] = 18,
			["2589"] = 13,
		},
	},
	["raids"] = {
		["QX7K2M"] = {
			["string"] = "KR1.QX7K2M.409.1762891200.MZXW6YTBOI4A",
			["instanceId"] = 409,
			["start"] = 1762891200,
			["events"] = {
				{
					["t"] = 1762890300,
					["kind"] = "start",
					["instanceId"] = 409,
					["instanceName"] = "Molten Core",
					["instanceType"] = "raid",
					["difficultyId"] = 9,
					["by"] = "Examplemage-Example Realm",
				}, -- [1]
				{
					["t"] = 1762890300,
					["kind"] = "roster",
					["members"] = {
						"Examplemage-Example Realm", -- [1]
						"Exampleraider-Example Realm", -- [2]
						"Examplehealer-Example Realm", -- [3]
					},
				}, -- [2]
				{
					["t"] = 1762891500,
					["kind"] = "encounter_start",
					["encounterId"] = 663,
					["encounterName"] = "Lucifron",
					["difficultyId"] = 9,
					["groupSize"] = 40,
				}, -- [3]
				{
					["t"] = 1762891620,
					["kind"] = "encounter_end",
					["encounterId"] = 663,
					["encounterName"] = "Lucifron",
					["difficultyId"] = 9,
					["groupSize"] = 40,
					["success"] = true,
				}, -- [4]
				{
					["t"] = 1762891620,
					["kind"] = "roster",
					["members"] = {
						"Examplemage-Example Realm", -- [1]
						"Exampleraider-Example Realm", -- [2]
						"Examplehealer-Example Realm", -- [3]
					},
				}, -- [5]
				{
					["t"] = 1762891680,
					["kind"] = "loot",
					["itemId"] = 16800,
					["itemLink"] = "|cffa335ee|Hitem:16800::::::::60:::::|h[Arcanist Boots]|h|r",
					["count"] = 1,
					["looter"] = "Exampleraider-Example Realm",
				}, -- [6]
				{
					["t"] = 1762891700,
					["kind"] = "loot",
					["itemId"] = 17011,
					["itemLink"] = "|cff1eff00|Hitem:17011::::::::60:::::|h[Lava Core]|h|r",
					["count"] = 2,
					["looter"] = "Examplemage-Example Realm",
				}, -- [7]
				{
					["t"] = 1762898400,
					["kind"] = "end",
					["instanceId"] = 409,
					["instanceName"] = "Molten Core",
				}, -- [8]
			},
		},
		["H4RD9P"] = {
			["string"] = "KR1.H4RD9P.0.1763496000.ABCDEFGH2345",
			["instanceId"] = 0,
			["start"] = 1763496000,
			["events"] = {
			},
		},
	},
}
KutzInventoryObsDB = {
	["v"] = 1,
	["on"] = true,
	["agreed"] = true,
	["noted"] = true,
	["addon"] = "1.20.0",
	["prefix"] = "k1f9c2",
	["n"] = 30,
	["events"] = {
		{
			["id"] = "k1f9c2-000017",
			["t"] = 1762905600,
			["b"] = "1.60.1.70888",
			["type"] = "loot",
			["src"] = {
				["kind"] = "boss",
				["npc"] = 11502,
				["guid"] = "Creature-0-4170-409-1234-11502-000012ABCD",
				["via"] = "slot",
			},
			["where"] = {
				["map"] = 409,
				["uiMap"] = 232,
				["itype"] = "raid",
				["difficulty"] = 9,
			},
			["who"] = {
				["level"] = 60,
				["class"] = 4,
				["faction"] = "Alliance",
				["name"] = "Exampleobserver",
				["surname"] = "Examplefamily",
			},
			["items"] = {
				{
					["id"] = 17076,
					["n"] = 1,
					["link"] = "|cffff8000|Hitem:17076|h[Bonereaver's Edge]|h|r",
				}, -- [1]
				{
					["id"] = 18264,
					["n"] = 2,
					["link"] = "|cffa335ee|Hitem:99999|h[Wrong Id]|h|r",
				}, -- [2]
			},
		}, -- [1]
		{
			["id"] = "k1f9c2-000018",
			["t"] = 1762905650,
			["b"] = "1.60.1.70888",
			["type"] = "loot",
			["src"] = {
				["kind"] = "mob",
				["npc"] = 2958,
				["guid"] = "Creature-0-4170-0-1234-2958-000012ABCE",
				["level"] = 14,
				["via"] = "target",
			},
			["where"] = {
				["map"] = 0,
				["uiMap"] = 1429,
				["x"] = 0.4123,
				["y"] = 0.6543,
			},
			["who"] = {
				["level"] = 60,
				["class"] = 4,
				["faction"] = "Alliance",
			},
			["items"] = {
			},
		}, -- [2]
		{
			["id"] = "k1f9c2-000019",
			["t"] = 1762905660,
			["b"] = "1.60.1.70888",
			["type"] = "loot",
			["src"] = {
				["kind"] = "skin",
				["npc"] = 2958,
				["guid"] = "Creature-0-4170-0-1234-2958-000012ABCE",
				["level"] = 14,
				["via"] = "slot",
			},
			["where"] = {
				["map"] = 0,
				["uiMap"] = 1429,
				["x"] = 0.4123,
				["y"] = 0.6543,
			},
			["who"] = {
				["level"] = 60,
				["class"] = 4,
				["faction"] = "Alliance",
			},
			["items"] = {
				{
					["id"] = 2318,
					["n"] = 2,
				}, -- [1]
			},
		}, -- [3]
		{
			["id"] = "k1f9c2-000020",
			["t"] = 1762905680,
			["b"] = "1.60.1.70888",
			["type"] = "quest",
			["act"] = "accept",
			["quest"] = 7787,
			["npc"] = 11811,
			["where"] = {
				["map"] = 1,
				["uiMap"] = 1449,
				["x"] = 0.5012,
				["y"] = 0.3301,
			},
			["who"] = {
				["level"] = 58,
				["class"] = 4,
				["faction"] = "Alliance",
			},
			["lv"] = 58,
			["group"] = 5,
			["freq"] = "daily",
			["timed"] = true,
			["obj"] = {
				{
					["t"] = "item",
					["n"] = 1,
					["text"] = "Carry the crate to the far camp.",
				}, -- [1]
				{
					["t"] = "monster",
					["n"] = 4,
					["text"] = "Clear the road of raiders.",
				}, -- [2]
			},
			["poi"] = {
				{
					["map"] = 1449,
					["x"] = 50.12,
					["y"] = 33.01,
				}, -- [1]
				{
					["map"] = 1449,
					["x"] = 42.19,
					["y"] = 67.84,
				}, -- [2]
			},
			["text"] = {
				["title"] = "A Made-up Errand",
				["details"] = "You look capable, $N.\n\nTake this crate to the far camp.",
				["objectives"] = "Carry the crate to the far camp.",
			},
		}, -- [4]
		{
			["id"] = "k1f9c2-000021",
			["t"] = 1762905700,
			["b"] = "1.60.1.70888",
			["type"] = "quest",
			["act"] = "turnin",
			["quest"] = 7787,
			["npc"] = 11811,
			["where"] = {
				["map"] = 1,
				["uiMap"] = 1449,
				["x"] = 0.5012,
				["y"] = 0.3301,
			},
			["who"] = {
				["level"] = 58,
				["class"] = 4,
				["faction"] = "Alliance",
			},
			["rewards"] = {
				["items"] = {
					{
						["id"] = 19019,
						["n"] = 1,
					}, -- [1]
				},
				["choices"] = {
					19018, -- [1]
					19019, -- [2]
				},
				["chose"] = 19019,
			},
			["xp"] = 6600,
			["rep"] = {
				{
					["f"] = 47,
					["d"] = 62,
				}, -- [1]
				{
					["f"] = 72,
					["d"] = 250,
				}, -- [2]
			},
			["text"] = {
				["title"] = "A Made-up Errand",
				["progress"] = "Is the crate here, $N?",
				["completion"] = "The camp thanks you, $N.",
			},
		}, -- [5]
		{
			["id"] = "k1f9c2-000022",
			["t"] = 1762905800,
			["b"] = "1.60.1.70888",
			["type"] = "vendor",
			["npc"] = 12944,
			["rx"] = 5,
			["where"] = {
				["map"] = 0,
				["uiMap"] = 1428,
				["x"] = 0.0912,
				["y"] = 0.2287,
			},
			["who"] = {
				["level"] = 60,
				["class"] = 4,
				["faction"] = "Alliance",
				["name"] = "Exampleobserver",
				["surname"] = "Examplefamily",
			},
			["items"] = {
				{
					["id"] = 19326,
					["n"] = 1,
					["price"] = 0,
					["cost"] = {
						{
							["item"] = 17010,
							["n"] = 1,
						}, -- [1]
					},
					["link"] = "|cffa335ee|Hitem:19326|h[Made-up Cloak]|h|r",
				}, -- [1]
				{
					["id"] = 4470,
					["n"] = 1,
					["price"] = 38,
					["limited"] = 5,
				}, -- [2]
			},
		}, -- [6]
		{
			["id"] = "k1f9c2-000023",
			["t"] = 1762906000,
			["b"] = "1.60.1.70888",
			["type"] = "trainer",
			["npc"] = 5146,
			["kind"] = "class",
			["rx"] = 6,
			["where"] = {
				["map"] = 0,
				["uiMap"] = 1453,
				["x"] = 0.3812,
				["y"] = 0.7907,
			},
			["who"] = {
				["level"] = 20,
				["class"] = 8,
				["faction"] = "Alliance",
			},
			["rows"] = {
				{
					["s"] = 7322,
					["name"] = "Frostbolt",
					["rank"] = "Rank 4",
					["lv"] = 20,
					["cost"] = 1800,
					["st"] = "a",
				}, -- [1]
				{
					["s"] = 8427,
					["name"] = "Blizzard",
					["rank"] = "Rank 2",
					["lv"] = 28,
					["cost"] = 4000,
					["needs"] = {
						"Blizzard", -- [1]
					},
					["st"] = "u",
				}, -- [2]
				{
					["s"] = 116,
					["name"] = "Frostbolt",
					["rank"] = "Rank 1",
					["lv"] = 4,
					["cost"] = 100,
					["st"] = "k",
				}, -- [3]
				{
					["name"] = "Made-up Ward",
					["lv"] = 30,
					["cost"] = 10,
					["st"] = "a",
				}, -- [4]
			},
		}, -- [7]
		{
			["id"] = "k1f9c2-000024",
			["t"] = 1762906100,
			["b"] = "1.60.1.70888",
			["type"] = "taxi",
			["npc"] = 352,
			["node"] = 2,
			["rx"] = 5,
			["where"] = {
				["map"] = 0,
				["uiMap"] = 1453,
				["x"] = 0.7081,
				["y"] = 0.7254,
			},
			["who"] = {
				["level"] = 20,
				["class"] = 8,
				["faction"] = "Alliance",
			},
			["to"] = {
				{
					["node"] = 4,
					["cost"] = 1050,
					["hops"] = 2,
				}, -- [1]
				{
					["node"] = 5,
					["cost"] = 270,
					["hops"] = 1,
				}, -- [2]
				{
					["node"] = 6,
					["cost"] = 1800,
					["hops"] = 3,
				}, -- [3]
			},
		}, -- [8]
		{
			["id"] = "k1f9c2-000025",
			["t"] = 1762906300,
			["b"] = "1.60.1.70888",
			["type"] = "flight",
			["from"] = 2,
			["to"] = 5,
			["sec"] = 181,
			["who"] = {
				["level"] = 20,
				["class"] = 8,
				["faction"] = "Alliance",
			},
		}, -- [9]
		{
			["id"] = "k1f9c2-000026",
			["t"] = 1762906350,
			["b"] = "1.60.1.70888",
			["type"] = "gossip",
			["npc"] = 352,
			["kind"] = "gossip",
			["text"] = "Welcome back, $N. The northern road is clear.",
			["where"] = {
				["uiMap"] = 1453,
				["x"] = 0.7081,
				["y"] = 0.7254,
			},
			["who"] = {
				["level"] = 20,
				["class"] = 8,
				["faction"] = "Alliance",
				["name"] = "Exampleobserver",
				["surname"] = "Examplefamily",
			},
		}, -- [10]
		{
			["id"] = "k1f9c2-000027",
			["t"] = 1762906400,
			["b"] = "1.60.1.70888",
			["type"] = "read",
			["object"] = 1617,
			["title"] = "Example Field Journal",
			["page"] = 1,
			["material"] = "Parchment",
			["last"] = true,
			["text"] = "The watch keeps the northern road open. The lanterns are lit each evening.",
			["where"] = {
				["uiMap"] = 1453,
				["x"] = 0.7081,
				["y"] = 0.7254,
			},
			["who"] = {
				["level"] = 20,
				["class"] = 8,
				["faction"] = "Alliance",
				["name"] = "Exampleobserver",
				["surname"] = "Examplefamily",
			},
		}, -- [11]
		{
			["id"] = "k1f9c2-000028",
			["t"] = 1762906450,
			["b"] = "1.60.1.70888",
			["type"] = "line",
			["npc"] = 352,
			["kind"] = "say",
			["text"] = "Keep the road clear, $N.",
			["where"] = {
				["uiMap"] = 1453,
				["x"] = 0.7081,
				["y"] = 0.7254,
			},
			["who"] = {
				["level"] = 20,
				["class"] = 8,
				["faction"] = "Alliance",
				["name"] = "Exampleobserver",
				["surname"] = "Examplefamily",
			},
		}, -- [12]
		{
			["id"] = "k1f9c2-000029",
			["t"] = 1762906500,
			["b"] = "1.60.1.70888",
			["type"] = "tame",
			["npc"] = 525,
			["lv"] = 11,
			["fam"] = 1,
			["spells"] = {
				{
					["s"] = 2649,
					["name"] = "Growl",
					["rank"] = "Rank 1",
				}, -- [1]
				{
					["s"] = 17253,
					["name"] = "Bite",
					["rank"] = "Rank 1",
				}, -- [2]
			},
			["spd"] = 200,
			["diet"] = {
				"Fish", -- [1]
				"Meat", -- [2]
			},
			["where"] = {
				["map"] = 0,
				["uiMap"] = 1429,
				["x"] = 0.4123,
				["y"] = 0.6543,
			},
			["who"] = {
				["level"] = 12,
				["class"] = 3,
				["faction"] = "Alliance",
				["name"] = "Exampleobserver",
				["surname"] = "Examplefamily",
			},
		}, -- [13]
		{
			["id"] = "k1f9c2-000030",
			["t"] = 1762906550,
			["b"] = "1.60.1.70888",
			["type"] = "credit",
			["quest"] = 7788,
			["i"] = 1,
			["ot"] = "monster",
			["npc"] = 2958,
			["by"] = "name",
			["where"] = {
				["map"] = 0,
				["uiMap"] = 1429,
				["x"] = 0.4219,
				["y"] = 0.6784,
			},
			["who"] = {
				["level"] = 14,
				["class"] = 4,
				["faction"] = "Alliance",
				["name"] = "Exampleobserver",
				["surname"] = "Examplefamily",
			},
		}, -- [14]
		{
			["id"] = "not an id",
			["t"] = 1762905900,
			["type"] = "loot",
			["src"] = {
				["kind"] = "mob",
			},
			["items"] = {
			},
		}, -- [15]
	},
	["npcs"] = {
		[525] = {
			["name"] = "Made-up Wolf",
			["lv"] = {
				10, -- [1]
				12, -- [2]
			},
			["cls"] = "normal",
			["ct"] = 1,
			["fam"] = 1,
			["rxA"] = 2,
			["spd"] = 200,
			["spds"] = {
				[200] = 3,
				[150] = 1,
			},
			["day"] = 20404,
			["cells"] = {
				["1429:41:65"] = 2,
				["1429:42:65"] = 1,
			},
		},
		[1346] = {
			["name"] = "Made-up Tailor",
			["lv"] = {
				30, -- [1]
				30, -- [2]
			},
			["cls"] = "normal",
			["ct"] = 7,
			["rxA"] = 5,
			["sub"] = "Made-up Tailoring Supplies",
			["svc"] = {
				["vendor"] = true,
				["repair"] = true,
				["gossip"] = true,
			},
			["day"] = 20405,
			["cells"] = {
				["1453:63:72"] = 4,
				["nowhere"] = 9,
			},
		},
		[6109] = {
			["name"] = "Made-up Dragon",
			["boss"] = true,
			["cls"] = "worldboss",
			["ct"] = 2,
			["rxA"] = 1,
			["day"] = 20403,
		},
		[2958] = {
			["lv"] = {
				14, -- [1]
				14, -- [2]
			},
			["cls"] = "normal",
		},
	},
}
