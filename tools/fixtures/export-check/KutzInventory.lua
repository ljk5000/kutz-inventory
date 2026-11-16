KutzInventoryDB = {
  chars = {
    ["Tester-Realm"] = {
      name = "Tester", realm = "Realm", level = 12, class = "Warrior", classFile = "WARRIOR", race = "Human",
      faction = "Alliance", sex = 2, guid = "Player-1-00ABCDEF", money = 12345, xp = 10, xpMax = 100, lastSeen = 1700000000,
      location = { zone = "Elwynn Forest", subzone = "Goldshire", mapID = 1429, x = 42.1, y = 65.3 },
      updated = { bags = 1700000000 },
      bags = { [0] = { name = "Backpack", size = 16, items = { [1] = { id = 2589, count = 5, name = "Linen Cloth", quality = 1 } } } },
      equipped = { [16] = { id = 25, name = "Worn Shortsword", slot = "MainHandSlot", stats = { ITEM_MOD_STRENGTH_SHORT = 1 } } },
      recipes = { Tailoring = { professionID = 197, skill = 10, max = 75, updated = 1700000000,
        recipes = { { recipeID = 2385, name = "Brown Linen Vest", difficulty = 0, outputItemID = 2568, makesMin = 1,
                      reagents = { { itemID = 2996, name = "Bolt of Linen Cloth", quantity = 1 } } } } } },
    },
  },
  prices = { vendor = { ["2996"] = { price = 40, vendor = "Someone" } }, sell = { ["2568"] = 20 },
             ah = { ["Realm|horde"] = {
               [2568] = { p = { 30, 35, 40 }, q = { 1, 2, 1 }, n = 4, t = 1700000100 },
               [2996] = { p = {}, q = {}, n = 0, t = 1700000100 },
               [4306] = { p = { 99 }, q = { 1 }, n = 1, t = 1600000000 },      -- an older scan's reading: not sent
             } },
             scans = { ["Realm|horde"] = { startedAt = 1700000000, finishedAt = 1700000200, method = "search", complete = false,
                                           queued = 3, answered = 2, houseSource = "npc", addonVersion = "1.3.0", region = 1 } } },
  uiHealth = {
    updated = 100, game = "old",
    session = { errors = 1, blocked = 9 },
    findings = { { rank = 1, tag = "ERRORS", score = 10, addon = "Old", text = "old one" } },
    errors = {}, blocked = {}, memoryGrowth = {}, history = {},
  },
}
