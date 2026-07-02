// Node tests for navigation stack / back detection logic used in background.js

function navUrlKey(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    let href = u.href;
    if (href.endsWith("/") && u.pathname !== "/") href = href.slice(0, -1);
    return href;
  } catch (e) {
    return url || "";
  }
}

function isHistoryNavigation(d) {
  return d.transitionQualifiers?.includes("forward_back") || d.transitionType === "back_forward";
}

function handleHistoryNavigation(stack, url) {
  const key = navUrlKey(url);
  const entries = stack.entries.map(navUrlKey);
  if (stack.index > 0 && entries[stack.index - 1] === key) {
    stack.index -= 1;
    return "go back";
  }
  if (stack.index >= 0 && stack.index < entries.length - 1 && entries[stack.index + 1] === key) {
    stack.index += 1;
    return "go forward";
  }
  return "go back";
}

function pushNavEntry(stack, url) {
  const key = navUrlKey(url);
  const entries = stack.entries.map(navUrlKey);
  if (stack.index >= 0 && entries[stack.index] === key) return stack;
  if (stack.index === -1 && stack.entries.length === 0) {
    stack.entries = [url];
    stack.index = 0;
    return stack;
  }
  stack.entries = stack.entries.slice(0, stack.index + 1);
  stack.entries.push(url);
  stack.index = stack.entries.length - 1;
  return stack;
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

const home = "https://acypher.com/";
const creator = "https://acypher.com/creator/";
const playlist = "https://www.youtube.com/playlist?list=PLZorCfSJnW4K20AItuQaNH-zPyIvrpnuB";
const watch = "https://www.youtube.com/watch?v=C_4A62w-dEI&list=PLZorCfSJnW4K20AItuQaNH-zPyIvrpnuB&index=2";

let stack = { entries: [home], index: 0 };
stack = pushNavEntry(stack, creator);
assert(stack.index === 1, "push creator");
assert(handleHistoryNavigation(stack, home) === "go back", "creator -> home back");

stack = { entries: [playlist], index: 0 };
stack = pushNavEntry(stack, watch);
assert(handleHistoryNavigation(stack, playlist) === "go back", "youtube watch -> playlist back");

assert(isHistoryNavigation({ transitionType: "link", transitionQualifiers: ["forward_back"] }), "link + forward_back");
assert(isHistoryNavigation({ transitionType: "back_forward", transitionQualifiers: [] }), "back_forward type");
assert(!isHistoryNavigation({ transitionType: "link", transitionQualifiers: [] }), "plain link nav");

process.exit(failed ? 1 : 0);
