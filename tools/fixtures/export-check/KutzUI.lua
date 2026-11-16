KutzUIDB = {
  monitor = { findings = {
    updated = 1700000000, game = "1.60.1",
    session = {
      started = 1700000000, ended = 1700000600, minutes = 10, fps = 60,
      errors = 2, errorsOmitted = 0, blocked = 1, hitches = 0, hitchesInCombat = 0,
      worstMs = 0, addonsLoaded = 3, cpuProfiling = false,
    },
    findings = { { rank = 1, tag = "BLOCKED", score = 801, addon = "Foo", text = "Foo: 1 blocked" } },
    errors = { { addon = "Foo", count = 2, message = "boom", throughBlizzard = false, first = 1700000000, last = 1700000500, inCombat = true, stack = "Foo.lua:1" } },
    blocked = { { addon = "Foo", kind = "blocked", fn = "TargetUnit", count = 1 } },
    memoryGrowth = { { addon = "Foo", kbPerHour = 800, kb = 12000 } },
    history = { { started = 1690000000, minutes = 30, fps = 80, errors = 0, errorAddons = "", blocked = 0, hitches = 1, worstMs = 110, cpuTop = "" } },
  } },
}
