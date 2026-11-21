// Tooltip cleaner (tools/tooltip_clean.js): written examples of what stays and what goes, and the check that the copy
// inside tools/convert.js is the module's block word for word.
//   node --test tools/tooltip_clean.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { cleanTooltip, cleanTooltipText } = require("./tooltip_clean");
const convert = require("./convert");

const BEGIN = "// >>> tooltip cleaner: begin", END = "// <<< tooltip cleaner: end";
const block = (file) => {
  const text = fs.readFileSync(path.join(__dirname, file), "utf8").replace(/\r\n/g, "\n");
  const from = text.indexOf(BEGIN), to = text.indexOf(END);
  assert.ok(from >= 0 && to > from, file + " has the cleaner block");
  assert.equal(text.indexOf(BEGIN, from + 1), -1, file + " has it once");
  return text.slice(from, to + END.length);
};

test("the cleaner inside convert.js is the module's block, word for word, and behaves the same", () => {
  assert.equal(block("convert.js"), block("tooltip_clean.js"));
  const lines = [["|cffffffffSoldier's Shield of the Bear|r"], ["Off Hand", "Shield"], "Durability 12 / 85", "|cffff2020Requires Level 20|r"];
  assert.deepEqual(convert.cleanTooltip(lines), cleanTooltip(lines));
  assert.equal(convert.cleanTooltipText("|cff1eff00Green|r"), cleanTooltipText("|cff1eff00Green|r"));
});

test("the module is plain CommonJS with no dependency and no Node API", () => {
  const source = fs.readFileSync(path.join(__dirname, "tooltip_clean.js"), "utf8");
  assert.equal((source.match(/\brequire\s*\(/g) || []).length, 0, "no require");
  for (const name of ["process", "Buffer", "fetch", "__dirname", "fs.", "path."]) assert.ok(!source.includes(name), "no " + name);
  assert.deepEqual(Object.keys(require("./tooltip_clean")).sort(), ["cleanTooltip", "cleanTooltipText"]);
});

test("a random-suffix shield as one character saw it: colour, durability and the red requirement's colour go", () => {
  const seen = [
    "|cff1eff00Soldier's Shield of the Bear|r",
    "Binds when equipped",
    ["Off Hand", "Shield"],
    "478 Armor",
    "|cffffffff+3 Strength|r",
    "|cffffffff+3 Stamina|r",
    "Durability 71 / 85",
    "|cffff2020Requires Level 40|r",
  ];
  assert.deepEqual(cleanTooltip(seen), {
    lines: ["Soldier's Shield of the Bear", "Binds when equipped", ["Off Hand", "Shield"], "478 Armor", "+3 Strength", "+3 Stamina", "Requires Level 40"],
    durability: 85,
  });
  // another character, who meets the requirement and carries a more worn copy, gets the same answer
  const other = seen.map((l) => (l === "Durability 71 / 85" ? "Durability 3 / 85" : l === "|cffff2020Requires Level 40|r" ? "Requires Level 40" : l));
  assert.deepEqual(cleanTooltip(other), cleanTooltip(seen));
});

test("what is the reading character's own goes; what is the item's stays", () => {
  assert.deepEqual(cleanTooltip([
    "Pattern: Made-up Robe",
    "|cffff2020Already known|r",
    "Requires Tailoring (150)",
    "Classes: Mage, Warlock",
    "Use: Teaches you how to sew a Made-up Robe.",
    "Cooldown remaining: 2 hrs",
    "<Made by Somebody>",
    "|cff00ff00<Gift from Somebody>|r",
    "<Right Click to Read>",
    "Equipment Sets: Tank, Travel",
    "|cff88aaffYou haven't collected this appearance|r",
    "You have not collected this appearance",
    "You've collected this appearance, but not from this item",
    "Unique",
    "\"A flavour line.\"",
  ]).lines, ["Pattern: Made-up Robe", "Requires Tailoring (150)", "Classes: Mage, Warlock", "Use: Teaches you how to sew a Made-up Robe.",
             "<Right Click to Read>", "Unique", "\"A flavour line.\""]);
});

test("set pieces: the count of pieces worn becomes the set's size; which pieces are worn is only colour", () => {
  assert.deepEqual(cleanTooltip([
    "|cffffd100Dreadmist Raiment (2/8)|r",
    "  |cffffff9aDreadmist Belt|r",
    "  |cff808080Dreadmist Robe|r",
    "|cff808080(2) Set: +200 Armor.|r",
    "|cff00ff00(4) Set: +23 Spell Power.|r",
  ]).lines, ["Dreadmist Raiment (8)", "Dreadmist Belt", "Dreadmist Robe", "(2) Set: +200 Armor.", "(4) Set: +23 Spell Power."]);
});

test("markup: textures, atlases, links, colour names, line breaks and escaped pipes", () => {
  assert.equal(cleanTooltipText("|TInterface\\Icons\\INV_Misc_Gem_01:16|t Red Socket"), "Red Socket");
  assert.equal(cleanTooltipText("|A:socket-red:16:16|a  Socket"), "Socket");
  assert.equal(cleanTooltipText("Teaches |cff71d5ff|Hspell:1234|h[Made-up Spell]|h|r."), "Teaches [Made-up Spell].");
  assert.equal(cleanTooltipText("|cnRED_FONT_COLOR:Requires Level 60|r"), "Requires Level 60");
  assert.equal(cleanTooltipText("Use: A first line.|nA second line."), "Use: A first line. A second line.");
  assert.equal(cleanTooltipText("a || b"), "a | b");
  assert.equal(cleanTooltipText("  spaced \t out\r\n text  "), "spaced out text");
  assert.equal(cleanTooltipText(undefined), ""); assert.equal(cleanTooltipText(12), "");
});

test("shapes: right texts, empty lines, the durability line only when it is alone on its line, bad input", () => {
  assert.deepEqual(cleanTooltip([["Main Hand", "Sword"], ["12 - 23 Damage", "Speed 2.60"], "", "   ", ["", "|cffffffffOnly right|r"], ["|r", ""]]),
    { lines: [["Main Hand", "Sword"], ["12 - 23 Damage", "Speed 2.60"], ["", "Only right"]] });
  assert.deepEqual(cleanTooltip([["Durability 10 / 20", "x"]]), { lines: [["Durability 10 / 20", "x"]] }, "not the durability line");
  assert.deepEqual(cleanTooltip(["Durability 0 / 100"]), { lines: [], durability: 100 });
  assert.deepEqual(cleanTooltip(null), { lines: [] }); assert.deepEqual(cleanTooltip("text"), { lines: [] });
  assert.deepEqual(cleanTooltip([null, 3, {}, ["a"]]), { lines: ["a"] });
  assert.deepEqual(cleanTooltip(["Requires Level 20 (2/8)x", "Scales (1/1)"]).lines, ["Requires Level 20 (2/8)x", "Scales (1)"]);
});
