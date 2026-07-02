// Regression: media clicks after a link navigation should use the link label,
// not a stale watch-page heading from the previous video.

function norm(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function lower(s) {
  return norm(s).toLowerCase();
}

function isGenericMediaLabel(s) {
  const l = lower(s);
  return !l || l === "video" || l.includes("video player") || l === "youtube";
}

function parseDocumentTitle(doc) {
  if (!doc) return "";
  const t = norm(doc.title).replace(/\s*[-–—|]\s*YouTube\s*$/i, "");
  if (t && !/^youtube$/i.test(t)) return t;
  return "";
}

function mediaLabelFor(recentVideoLabel, docTitle, staleHeading) {
  const labels = [];
  const push = (s) => {
    const n = norm(s);
    if (n && !isGenericMediaLabel(n)) labels.push(n);
  };
  push(recentVideoLabel);
  push(parseDocumentTitle({ title: docTitle }));
  push(staleHeading);
  return labels[0] || "video";
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("ok:", msg);
  }
}

assert(
  mediaLabelFor("#pinkvenom #lisa", "Stagecast 1995 2min - YouTube", "Stagecast 1995 2min") === "#pinkvenom #lisa",
  "recent link label beats stale page title"
);
assert(
  mediaLabelFor("", "#pinkvenom #lisa - YouTube", "Stagecast 1995 2min") === "#pinkvenom #lisa",
  "document title beats stale heading"
);
assert(
  mediaLabelFor("", "Stagecast 1995 2min - YouTube", "Stagecast 1995 2min") === "Stagecast 1995 2min",
  "falls back to heading when title matches"
);

process.exit(failed ? 1 : 0);
