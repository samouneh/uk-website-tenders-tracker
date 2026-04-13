import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractNoticeSequence,
  DEFAULT_DISCOVERY_TERMS,
  extractNoticeYear,
  matchesDiscoveryTerm,
  normalize,
  parseDate,
  sleep,
  textHasWebsiteTerm,
} from "./lib/fts-website-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputPath = path.join(repoRoot, "data", "fts_search_discovery.json");

const NOW = new Date();
const SEARCH_URL = "https://www.find-tender.service.gov.uk/Search";
const SEARCH_RESULTS_URL = "https://www.find-tender.service.gov.uk/Search/Results";
const HEADLESS = process.env.FTS_DISCOVERY_HEADLESS !== "false";
const MAX_PAGES = Number(process.env.FTS_DISCOVERY_MAX_PAGES || 8);
const PAGE_DELAY_MS = Number(process.env.FTS_DISCOVERY_PAGE_DELAY_MS || 1200);
const TERM_DELAY_MS = Number(process.env.FTS_DISCOVERY_TERM_DELAY_MS || 2500);
const SELECTOR_TIMEOUT_MS = Number(process.env.FTS_DISCOVERY_SELECTOR_TIMEOUT_MS || 15000);
const RETENTION_DAYS = Number(process.env.FTS_DISCOVERY_RETENTION_DAYS || 180);
const MIN_NOTICE_YEAR = Number(process.env.FTS_DISCOVERY_MIN_NOTICE_YEAR || NOW.getFullYear() - 1);
const SEARCH_TERMS = (process.env.FTS_DISCOVERY_TERMS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    error.message = `Playwright is not installed. Run "npm install" and "npx playwright install chromium" first.\n${error.message}`;
    throw error;
  }
}

async function loadExistingDiscovery() {
  try {
    const payload = JSON.parse(await fs.readFile(outputPath, "utf8"));
    return pruneCandidates(Array.isArray(payload?.results) ? payload.results : []);
  } catch {
    return [];
  }
}

function mergeCandidate(target, candidate, nowIso) {
  const existing = target.get(candidate.notice_id) || {
    notice_id: candidate.notice_id,
    title: candidate.title,
    live_url: candidate.live_url,
    search_terms: [],
    search_hits: [],
    first_seen_at: nowIso,
    last_seen_at: nowIso,
    discovery_source: "FTS search UI via Playwright",
  };

  existing.title = existing.title.length >= candidate.title.length ? existing.title : candidate.title;
  existing.live_url = candidate.live_url || existing.live_url;
  existing.last_seen_at = nowIso;
  existing.search_terms = [...new Set([...existing.search_terms, candidate.term])].sort((a, b) => a.localeCompare(b));
  existing.search_hits = mergeSearchHits(existing.search_hits, candidate.term, candidate.page);

  target.set(candidate.notice_id, existing);
}

function mergeSearchHits(existingHits, term, page) {
  const hits = Array.isArray(existingHits) ? [...existingHits] : [];
  if (!hits.some((hit) => hit.term === term && hit.page === page)) {
    hits.push({ term, page });
  }
  return hits
    .sort((a, b) => a.term.localeCompare(b.term) || a.page - b.page)
    .slice(0, 24);
}

function pruneCandidates(candidates, now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86400000);
  return candidates.filter((candidate) => {
    const lastSeen = parseDate(candidate.last_seen_at || candidate.first_seen_at || "");
    if (lastSeen && lastSeen < cutoff) return false;
    const noticeYear = extractNoticeYear(candidate.notice_id);
    if (noticeYear && noticeYear < MIN_NOTICE_YEAR) return false;
    return storedCandidateLooksRelevant(candidate);
  });
}

function storedCandidateLooksRelevant(candidate) {
  const title = candidate.title || "";
  const searchTerms = Array.isArray(candidate.search_terms) ? candidate.search_terms : [];
  return textHasWebsiteTerm(title) || matchesDiscoveryTerm(title, searchTerms);
}

async function gotoSearchResults(page) {
  await page.goto(SEARCH_RESULTS_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1200);

  const resultsInput = page.locator("#keywords, input[name='keywords']").first();
  if ((await resultsInput.count()) > 0) return;

  await page.goto(SEARCH_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1200);

  const openSearchButton = page.locator("#button_search");
  if ((await openSearchButton.count()) > 0) {
    await openSearchButton.first().click();
    await page.waitForLoadState("networkidle", { timeout: 30000 });
    await page.waitForTimeout(1200);
  }
}

async function submitSearch(page, term) {
  const input = page.locator("#keywords, input[name='keywords']").first();
  await input.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
  await input.fill("");
  await input.fill(term);
  await page.waitForTimeout(300);

  const updateButton = page.locator("button:has-text('Update results'), input[value='Update results']").first();
  if ((await updateButton.count()) > 0) {
    await updateButton.click();
  } else {
    await input.press("Enter");
  }

  await page.waitForLoadState("networkidle", { timeout: 30000 });
  await page.waitForSelector("a[href*='/Notice/']", { timeout: SELECTOR_TIMEOUT_MS });
  await page.waitForTimeout(1000);
}

async function extractCandidatesOnPage(page, term, pageNumber) {
  const rawLinks = await page.locator("a[href*='/Notice/']").evaluateAll((elements) =>
    elements.map((element) => ({
      href: element.getAttribute("href") || "",
      title: (element.textContent || "").trim(),
    })),
  );

  const unique = new Map();
  for (const link of rawLinks) {
    const match = link.href.match(/\/Notice\/([^/?&]+)/i);
    const noticeId = match ? match[1] : "";
    const title = String(link.title || "").replace(/\s+/g, " ").trim();
    if (!noticeId || title.length < 5 || unique.has(noticeId)) continue;
    if (!candidateLooksRelevant(title, term)) continue;
    const noticeYear = extractNoticeYear(noticeId);
    if (noticeYear && noticeYear < MIN_NOTICE_YEAR) continue;
    unique.set(noticeId, {
      notice_id: noticeId,
      title,
      live_url: link.href.startsWith("http")
        ? link.href
        : `https://www.find-tender.service.gov.uk${link.href}`,
      term,
      page: pageNumber,
    });
  }

  return [...unique.values()];
}

function candidateLooksRelevant(title, term) {
  const normalizedTitle = normalize(title);
  const normalizedTerm = normalize(term);

  if (textHasWebsiteTerm(title)) return true;
  if (normalizedTerm === "cms") {
    return /\bcms\b|content management system/.test(normalizedTitle);
  }
  if (normalizedTerm === "intranet") {
    return normalizedTitle.includes("intranet");
  }
  if (normalizedTerm === "microsite") {
    return normalizedTitle.includes("microsite") || normalizedTitle.includes("micro site");
  }

  return /website|web development|web design|wordpress|drupal|umbraco|portal|digital/.test(normalizedTitle);
}

async function advancePage(page) {
  const next = page.locator("a.standard-paginate-next, a:has-text('Next')").first();
  if ((await next.count()) === 0 || !(await next.isVisible())) {
    return false;
  }

  await next.click();
  await page.waitForLoadState("networkidle", { timeout: 30000 });
  await page.waitForTimeout(PAGE_DELAY_MS);
  return true;
}

async function main() {
  const { chromium } = await loadPlaywright();
  const searchTerms = SEARCH_TERMS.length > 0 ? SEARCH_TERMS : DEFAULT_DISCOVERY_TERMS;
  const existing = await loadExistingDiscovery();
  const merged = new Map(existing.map((candidate) => [candidate.notice_id, candidate]));
  const errors = [];

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1366, height: 900 },
      locale: "en-GB",
    });

    await context.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      if (resourceType === "image" || resourceType === "font" || resourceType === "media") {
        return route.abort();
      }
      return route.continue();
    });

    for (const term of searchTerms) {
      const page = await context.newPage();
      try {
        await gotoSearchResults(page);
        await submitSearch(page, term);

        let pageNumber = 1;
        let consecutiveEmptyPages = 0;

        while (pageNumber <= MAX_PAGES) {
          const candidates = await extractCandidatesOnPage(page, term, pageNumber);

          if (candidates.length === 0) {
            consecutiveEmptyPages += 1;
            if (consecutiveEmptyPages >= 2) break;
          } else {
            consecutiveEmptyPages = 0;
            for (const candidate of candidates) {
              mergeCandidate(merged, candidate, NOW.toISOString());
            }
          }

          if (pageNumber >= MAX_PAGES) break;
          const moved = await advancePage(page);
          if (!moved) break;
          pageNumber += 1;
        }
      } catch (error) {
        errors.push({
          term,
          message: error.message,
        });
      } finally {
        await page.close();
      }

      await sleep(TERM_DELAY_MS);
    }
  } finally {
    await browser.close();
  }

  const results = pruneCandidates([...merged.values()], NOW).sort((a, b) => {
    const yearGap = (extractNoticeYear(b.notice_id) || 0) - (extractNoticeYear(a.notice_id) || 0);
    if (yearGap !== 0) return yearGap;
    const sequenceGap = extractNoticeSequence(b.notice_id) - extractNoticeSequence(a.notice_id);
    if (sequenceGap !== 0) return sequenceGap;
    const termGap = b.search_terms.length - a.search_terms.length;
    if (termGap !== 0) return termGap;
    return a.title.localeCompare(b.title);
  });

  const payload = {
    refreshed_at: NOW.toISOString(),
    source: "FTS search UI via Playwright",
    search_terms: searchTerms,
    max_pages_per_term: MAX_PAGES,
    retention_days: RETENTION_DAYS,
    result_count: results.length,
    errors,
    results,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
