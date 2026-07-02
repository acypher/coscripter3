// Regression: YouTube playlist rows must label thumbnail/title clicks with
// the clicked item's title, not the first title in a shared list container.
// Run: node scripts/test-playlist-label.mjs

function norm(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function isDurationOnly(s) {
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(norm(s));
}

function isMeaningfulLinkText(s) {
  const t = norm(s);
  return t.length > 0 && /[a-z]/i.test(t) && !isDurationOnly(t);
}

function stripYouTubeDurationSuffix(s) {
  return norm(s).replace(/\s+\d+\s+(?:minutes?,?\s*)?(?:\d+\s*)?(?:seconds?|secs?).*$/i, "");
}

function extractNowPlayingTitle(text) {
  const t = norm(text);
  const m = t.match(/now playing\s+(.+)$/i);
  if (!m) return "";
  let rest = m[1].replace(/^(\d+\s+)?(\d{1,2}:\d{2}\s*)+/i, "");
  const authorMatch = rest.match(/^(.+?\d(?:min|sec)?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)$/);
  if (authorMatch) return norm(authorMatch[1]);
  return norm(rest);
}

function cleanLinkLabel(text, aria) {
  const candidates = [];
  const push = (s) => {
    const n = norm(s);
    if (n && isMeaningfulLinkText(n)) candidates.push(n);
  };
  if (isMeaningfulLinkText(text)) push(text);
  if (aria) push(stripYouTubeDurationSuffix(aria));
  push(extractNowPlayingTitle(text));
  push(extractNowPlayingTitle(aria || ""));
  if (!candidates.length) {
    return norm(text) || stripYouTubeDurationSuffix(aria || "");
  }
  candidates.sort((a, b) => a.length - b.length);
  return candidates[0];
}

let failed = 0;
function assertEq(actual, expected, msg) {
  if (actual === expected) console.log("ok:", msg);
  else {
    console.error(`FAIL: ${msg}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
    failed++;
  }
}

assertEq(
  cleanLinkLabel("Stagecast 1995 2min", "Stagecast 1995 2min 2 minutes, 3 seconds"),
  "Stagecast 1995 2min",
  "short visible text beats verbose aria-label"
);
assertEq(
  cleanLinkLabel("2:03", ""),
  "2:03",
  "duration-only text kept as fallback when no aria"
);
assertEq(
  cleanLinkLabel("", "Stagecast 1995 2min 2 minutes, 3 seconds"),
  "Stagecast 1995 2min",
  "aria duration suffix stripped"
);
assertEq(
  cleanLinkLabel(
    "2 2:03 2:03 Now playing Stagecast 1995 2min Allen Cypher",
    ""
  ),
  "Stagecast 1995 2min",
  "sidebar now-playing row text cleaned"
);
assertEq(
  cleanLinkLabel("CoScripter 2007 3min", "CoScripter 2007 3min 2 minutes, 56 seconds"),
  "CoScripter 2007 3min",
  "first playlist item title preserved"
);
assertEq(isMeaningfulLinkText("2:03"), false, "duration is not meaningful");
assertEq(isMeaningfulLinkText("Stagecast 1995 2min"), true, "title is meaningful");

process.exit(failed ? 1 : 0);
