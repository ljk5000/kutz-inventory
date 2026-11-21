// Tooltip cleaner: an item tooltip as the game showed it to one character -> the lines that are the item's own.
// English client only. No dependencies and no Node APIs: plain CommonJS, so a server can copy this file as it is.
// tools/convert.js carries the block between the two marker lines word for word (it must stay one file that also
// runs in a browser page); tools/tooltip_clean.test.js fails when the two copies differ.
//
//   cleanTooltip(lines) -> { lines, durability? }
//     lines in:  each a string (left text) or [left, right]
//     lines out: the same shapes, cleaned; a line with nothing left is dropped
//     durability: the maximum from a "Durability 85 / 100" line (the line itself is dropped: the current value is
//                 the copy's, the maximum is the item's)
//   cleanTooltipText(text) -> one text without colour codes and other markup, white space collapsed
//
// What goes, and why:
//   colour codes (|cffRRGGBB ... |r, |cnNAME: ... |r)   red only says this character does not meet a requirement
//   textures, atlases, and a link's wrapper (its text stays), "|n" (a line break: one space)
//   set counts "(2/5)" -> "(5)"                          how many pieces this character wears
//   "Durability n / m"                                   see above
//   "Already known"                                      this character's recipe book
//   "Cooldown remaining: ..."                            this character's cooldown
//   "<Made by Name>" and the like                        a maker's or giver's name is a player's
//   "Equipment Sets: ...", "You haven't collected this appearance"   this character's own sets and collection
// Which pieces of a set this character wears is told by colour alone, so it goes with the colour.
"use strict";

// >>> tooltip cleaner: begin (copied word for word into tools/convert.js)
function cleanTooltipText(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\|\|/g, "\u0000")                                  // an escaped pipe, put back at the end
    .replace(/\|c[0-9a-fA-F]{8}/g, "").replace(/\|cn[A-Za-z0-9_]+:/g, "").replace(/\|r/g, "")
    .replace(/\|T[^|]*\|t/g, "").replace(/\|A[^|]*\|a/g, "")
    .replace(/\|H[^|]*\|h/g, "").replace(/\|h/g, "")
    .replace(/\|n/g, " ")
    .replace(/\|[A-Za-z]/g, "")                                  // any other code: the letter goes with its pipe
    .replace(/\u0000/g, "|")
    .replace(/[\u0001-\u001f\u007f\s]+/g, " ").trim();
}
const TOOLTIP_DURABILITY = /^Durability (\d{1,6}) \/ (\d{1,6})$/;
const TOOLTIP_DROPPED = [/^Already known$/i, /^Cooldown remaining: /i, /^<[^<>]*\b(by|from) [^<>]+>$/i,
                         /^Equipment Sets: /i, /^You(?: have|'ve|) (?:not |n't )?collected this appearance/i, /^You haven't collected this appearance/i];
function cleanTooltip(lines) {
  const out = [];
  let durability;
  for (const line of Array.isArray(lines) ? lines : []) {
    let left = cleanTooltipText(Array.isArray(line) ? line[0] : line);
    const right = Array.isArray(line) ? cleanTooltipText(line[1]) : "";
    const worn = TOOLTIP_DURABILITY.exec(left);
    if (worn && !right) { durability = Number(worn[2]); continue; }
    if (TOOLTIP_DROPPED.some((re) => re.test(left))) continue;
    left = left.replace(/ \((\d{1,2})\/(\d{1,2})\)$/, " ($2)");   // "Dreadmist Raiment (2/8)" -> "Dreadmist Raiment (8)"
    if (!left && !right) continue;
    out.push(right ? [left, right] : left);
  }
  return durability === undefined ? { lines: out } : { lines: out, durability };
}
// <<< tooltip cleaner: end

module.exports = { cleanTooltip, cleanTooltipText };
