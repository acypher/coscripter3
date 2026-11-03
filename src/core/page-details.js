// Read reusable article details from the current document. This is local,
// deterministic extraction: descriptions come from the page, never a model.

function text(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function firstText(values) {
  for (const value of values) {
    const result = text(value);
    if (result) return result;
  }
  return "";
}

function httpUrl(value, base) {
  const candidate = text(value);
  if (!candidate) return "";
  try {
    const url = new URL(candidate, base || undefined);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function imageValues(value) {
  if (Array.isArray(value)) return value.flatMap(imageValues);
  if (value && typeof value === "object") {
    return [value.url, value.contentUrl, value["@id"]].flatMap(imageValues);
  }
  return typeof value === "string" ? [value] : [];
}

const ARTICLE_TYPES = new Set([
  "Article", "NewsArticle", "BlogPosting", "TechArticle", "ScholarlyArticle",
  "AnalysisNewsArticle", "OpinionNewsArticle", "ReportageNewsArticle",
  "ReviewNewsArticle", "BackgroundNewsArticle", "Report",
]);

function isArticle(node) {
  const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  return types.some((type) => typeof type === "string" &&
    ARTICLE_TYPES.has(type.split(/[\/#]/).pop()));
}

function articleNodes(doc) {
  const articles = [];
  function visit(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 32) return;
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (isArticle(node)) articles.push(node);
    Object.values(node).forEach((value) => visit(value, depth + 1));
  }
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(script.textContent || ""));
    } catch {
      // A malformed publisher block must not hide another valid block.
    }
  }
  return articles;
}

function shortenParagraph(value, limit = 300) {
  const paragraph = text(value);
  if (paragraph.length <= limit) return paragraph;
  const head = paragraph.slice(0, limit + 1);
  const ends = [...head.matchAll(/[.!?](?=\s|$)/g)];
  const end = ends.length ? ends[ends.length - 1].index + 1 : 0;
  if (end >= 80 && end <= limit) return head.slice(0, end);
  const lastSpace = paragraph.lastIndexOf(" ", limit - 1);
  return paragraph.slice(0, lastSpace > 0 ? lastSpace : limit - 1).trimEnd() + "…";
}

function firstParagraph(doc) {
  for (const paragraph of doc.querySelectorAll('article p, main p, [role="main"] p')) {
    const value = text(paragraph.textContent);
    // Skip tiny captions and navigation fragments in the article container.
    if (value.length >= 50 && value.split(" ").length >= 7) {
      return shortenParagraph(value);
    }
  }
  return "";
}

export function readPageDetails(doc = document) {
  const url = typeof doc.location?.href === "string" ? doc.location.href.trim() : "";
  const base = doc.baseURI || url;
  const metadata = new Map();
  for (const meta of doc.querySelectorAll("meta")) {
    const key = (meta.getAttribute("property") || meta.getAttribute("name") || "").trim().toLowerCase();
    const value = text(meta.getAttribute("content"));
    if (!key || !value) continue;
    if (!metadata.has(key)) metadata.set(key, []);
    metadata.get(key).push(value);
  }
  const values = (...keys) => keys.flatMap((key) => metadata.get(key) || []);
  const articles = articleNodes(doc);
  const title = firstText([
    ...values("og:title", "twitter:title"),
    ...articles.map((article) => firstText([article.headline, article.name])),
    doc.querySelector("h1")?.textContent,
    doc.title,
  ]);
  const description = firstText([
    ...values("og:description", "twitter:description", "description"),
    ...articles.map((article) => article.description),
  ]) || firstParagraph(doc);
  const images = [
    ...values("og:image", "og:image:secure_url", "twitter:image", "twitter:image:src"),
    ...articles.flatMap((article) => imageValues(article.image)),
  ];
  let image = "";
  for (const candidate of images) {
    image = httpUrl(candidate, base);
    if (image) break;
  }
  return { title, description, image, url };
}
