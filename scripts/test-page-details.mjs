// Run: node scripts/test-page-details.mjs
// Fixtures contain only authored sample content; no browser or network is used.
import assert from "node:assert/strict";
import test from "node:test";
import { readPageDetails } from "../src/core/page-details.js";

const SOURCE = "https://example.org/news/story?edition=2";

function fixture({
  url = SOURCE, baseURI = url, title = "Document title", h1 = "",
  meta = [], json = [], paragraphs = [], canonical = "https://elsewhere.test/canonical",
} = {}) {
  const metadata = meta.map(([key, content, attr = "property"]) => ({
    getAttribute(name) { return name === attr ? key : name === "content" ? content : null; },
  }));
  const scripts = json.map((value) => ({
    textContent: typeof value === "string" ? value : JSON.stringify(value),
  }));
  return {
    title, baseURI, location: { href: url },
    querySelector(selector) {
      if (selector === "h1") return h1 ? { textContent: h1 } : null;
      if (selector === 'link[rel="canonical"]') return { href: canonical };
      throw new Error(`Unexpected fixture selector: ${selector}`);
    },
    querySelectorAll(selector) {
      if (selector === "meta") return metadata;
      if (selector === 'script[type="application/ld+json"]') return scripts;
      if (selector === 'article p, main p, [role="main"] p') {
        return paragraphs.map((textContent) => ({ textContent }));
      }
      throw new Error(`Unexpected fixture selector: ${selector}`);
    },
  };
}

test("OG fields take precedence regardless of metadata order; source stays the actual page", () => {
  const details = readPageDetails(fixture({
    h1: "Fallback heading",
    meta: [
      ["twitter:title", "Twitter title", "name"],
      ["description", "Basic description", "name"],
      ["og:title", "  Actual \n headline  "],
      ["og:description", "Actual article description"],
      ["og:image", "/photos/lead.jpg"],
    ],
    json: [{ "@type": "NewsArticle", headline: "Structured headline", url: "https://elsewhere.test/wrong" }],
  }));
  assert.deepEqual(details, {
    title: "Actual headline", description: "Actual article description",
    image: "https://example.org/photos/lead.jpg", url: SOURCE,
  });
});

test("Twitter metadata precedes basic descriptions and structured article fields", () => {
  const details = readPageDetails(fixture({
    meta: [
      ["description", "Basic description", "name"],
      ["twitter:title", "Twitter headline", "name"],
      ["twitter:description", "Twitter description", "name"],
      ["twitter:image", "//images.example.org/twitter.jpg", "name"],
    ],
    json: [{ "@type": "Article", headline: "JSON title", description: "JSON description", image: "/json.jpg" }],
  }));
  assert.equal(details.title, "Twitter headline");
  assert.equal(details.description, "Twitter description");
  assert.equal(details.image, "https://images.example.org/twitter.jpg");
});

test("blank metadata is skipped, including blank duplicates before useful values", () => {
  const details = readPageDetails(fixture({
    meta: [
      ["og:title", " \n "], ["og:title", "Nonblank headline"],
      ["og:description", " "], ["description", "Plain metadata description", "name"],
      ["og:image", ""], ["twitter:image:src", "./lead.jpg", "name"],
    ],
  }));
  assert.equal(details.title, "Nonblank headline");
  assert.equal(details.description, "Plain metadata description");
  assert.equal(details.image, "https://example.org/news/lead.jpg");
});

test("malformed JSON-LD does not hide a later valid article", () => {
  const details = readPageDetails(fixture({
    json: ["{broken JSON", {
      "@type": "https://schema.org/NewsArticle",
      headline: "Valid structured headline", description: "Valid structured description",
      image: { "@type": "ImageObject", contentUrl: "/structured.jpg" },
    }],
  }));
  assert.equal(details.title, "Valid structured headline");
  assert.equal(details.description, "Valid structured description");
  assert.equal(details.image, "https://example.org/structured.jpg");
});

test("JSON-LD arrays, @graph, type arrays and image arrays are supported", () => {
  const details = readPageDetails(fixture({
    json: [[
      { "@type": "Organization", name: "Publisher", image: "/publisher.jpg" },
      { "@graph": [{
        "@type": ["Thing", "Article"], headline: "Article inside graph",
        description: "Graph article description", image: ["javascript:bad()", { url: "/graph.jpg" }],
      }] },
    ]],
  }));
  assert.equal(details.title, "Article inside graph");
  assert.equal(details.image, "https://example.org/graph.jpg");
});

test("JSON-LD publisher/product fields are not mistaken for an article", () => {
  const details = readPageDetails(fixture({
    h1: "Page heading",
    json: [{ "@graph": [
      { "@type": "Organization", name: "Publisher", description: "Publisher description" },
      { "@type": "Product", name: "Advertisement", image: "/ad.jpg" },
    ] }],
  }));
  assert.equal(details.title, "Page heading");
  assert.equal(details.description, "");
  assert.equal(details.image, "");
});

test("empty JSON-LD headlines fall through to article name and later nonempty descriptions", () => {
  const details = readPageDetails(fixture({
    json: [{ "@graph": [
      { "@type": "Article", headline: "  ", name: "Article name", description: "" },
      { "@type": "NewsArticle", headline: "Other headline", description: "Useful description" },
    ] }],
  }));
  assert.equal(details.title, "Article name");
  assert.equal(details.description, "Useful description");
});

test("headline falls back to h1, then document title", () => {
  assert.equal(readPageDetails(fixture({ h1: "  Heading \n on the page  " })).title, "Heading on the page");
  assert.equal(readPageDetails(fixture({ h1: "   ", title: "Browser title" })).title, "Browser title");
});

test("relative image URLs honor document base URI", () => {
  const details = readPageDetails(fixture({
    baseURI: "https://cdn.example.org/assets/", meta: [["og:image", "lead.png"]],
  }));
  assert.equal(details.image, "https://cdn.example.org/assets/lead.png");
  assert.equal(details.url, SOURCE);
});

test("unsafe image protocols are rejected and a lower priority safe candidate is used", () => {
  const details = readPageDetails(fixture({
    meta: [
      ["og:image", "javascript:alert(1)"], ["og:image:secure_url", "data:image/png;base64,abc"],
      ["twitter:image", "https://images.example.org/safe.jpg", "name"],
    ],
  }));
  assert.equal(details.image, "https://images.example.org/safe.jpg");
});

test("only unsafe or malformed image URLs yield an empty field", () => {
  for (const image of ["data:image/png;base64,abc", "file:///tmp/picture.jpg", "blob:https://example.org/id", "https://["]) {
    assert.equal(readPageDetails(fixture({ meta: [["og:image", image]] })).image, "");
  }
});

test("description fallback skips tiny paragraphs and preserves useful source text", () => {
  const paragraph = "This is the first useful paragraph from the article, explaining the actual reported event.";
  const details = readPageDetails(fixture({ paragraphs: ["Photo credit", "Read more", paragraph] }));
  assert.equal(details.description, paragraph);
});

test("long paragraph fallback ends at an available sentence boundary", () => {
  const firstSentence = "This reported discovery explains a detailed change in the natural world and the evidence behind it.";
  const details = readPageDetails(fixture({ paragraphs: [firstSentence + " " + "Additional reported details continue without a sentence boundary ".repeat(8)] }));
  assert.equal(details.description, firstSentence);
  assert.ok(details.description.length <= 300);
});

test("long paragraph without sentence boundaries truncates at a word and marks the excerpt", () => {
  const paragraph = "Researchers provide additional useful details about the discovery and its implications ".repeat(8);
  const description = readPageDetails(fixture({ paragraphs: [paragraph] })).description;
  assert.ok(description.length <= 300);
  assert.ok(description.endsWith("…"));
  assert.ok(paragraph.startsWith(description.slice(0, -1)));
});

test("missing source details remain empty, and subsequent reads cannot retain old fields", () => {
  readPageDetails(fixture({ meta: [["og:title", "Previous page"], ["og:image", "/previous.jpg"]] }));
  assert.deepEqual(readPageDetails(fixture({ title: "", h1: "", url: "", baseURI: "" })), {
    title: "", description: "", image: "", url: "",
  });
});
