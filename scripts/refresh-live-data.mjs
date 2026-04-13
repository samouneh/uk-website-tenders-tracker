import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STATUS_ORDER,
  collectCpvs,
  compareDates,
  extractNoticeSequence,
  extractNoticeYear,
  formatDisplayDate,
  formatMoney,
  htmlToLines,
  isWebsiteCandidate,
  matchesDiscoveryTerm,
  normalize,
  normalizeNoticePageResult,
  parseDate,
  parseDateish,
  scoreDifficulty,
  sleep,
  textHasWebsiteTerm,
} from "./lib/fts-website-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataPath = path.join(repoRoot, "data", "live_website_opportunities.json");
const summaryPath = path.join(repoRoot, "LIVE_AUTO_FEED_SUMMARY.md");
const archivePath = path.join(repoRoot, "data", "website_tenders_2026_quality_checked_final.json");
const discoveryPath = path.join(repoRoot, "data", "fts_search_discovery.json");

const API_BASE = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages";
const LOOKBACK_DAYS = Number(process.env.FTS_LOOKBACK_DAYS || 180);
const PAGE_DELAY_MS = Number(process.env.FTS_PAGE_DELAY_MS || 750);
const DISCOVERY_FETCH_DELAY_MS = Number(process.env.FTS_DISCOVERY_FETCH_DELAY_MS || 100);
const DISCOVERY_VERIFY_LIMIT = Number(process.env.FTS_DISCOVERY_VERIFY_LIMIT || 6);
const LIMIT = Number(process.env.FTS_LIMIT || 100);
const STAGES = ["tender", "planning"];
const NOW = new Date();

function daysUntil(date) {
  if (!date) return null;
  return Math.ceil((date.getTime() - NOW.getTime()) / 86400000);
}

function stageStatus(stage) {
  return stage === "tender" ? "current_tender" : "current_pre_tender";
}

function isCurrentNotice(stage, tender, published) {
  const status = tender?.status || "";
  const deadline = parseDate(tender?.tenderPeriod?.endDate);
  const daysLeft = daysUntil(deadline);

  if (stage === "tender") {
    return status === "active" && deadline && daysLeft !== null && daysLeft >= 0;
  }

  if (stage === "planning") {
    if (status !== "planned") return false;
    if (deadline && daysLeft !== null && daysLeft >= 0) return true;
    if (!published) return false;
    const ageDays = Math.floor((NOW.getTime() - published.getTime()) / 86400000);
    return ageDays <= 120;
  }

  return false;
}

function normalizeApiResult(release, stage) {
  const tender = release?.tender || {};
  const title = tender.title || "";
  const description = tender.description || "";
  const text = normalize(`${title} ${description}`);
  const cpvs = collectCpvs(tender);
  const deadline = parseDate(tender?.tenderPeriod?.endDate);
  const published = parseDate(release?.date);
  const amount = typeof tender?.value?.amount === "number" ? tender.value.amount : 0;
  const difficulty = scoreDifficulty(text, amount, Array.isArray(tender?.lots) ? tender.lots.length : 0);

  return {
    title,
    notice_id: release?.id || "",
    live_url: release?.id ? `https://www.find-tender.service.gov.uk/Notice/${release.id}` : "",
    status: stageStatus(stage),
    status_reason:
      stage === "tender"
        ? "Auto-refreshed from the official FTS OCDS feed; tender deadline is still open."
        : "Auto-refreshed from the official FTS OCDS feed; planning or engagement notice is still current.",
    difficulty,
    difficulty_label: difficultyLabel(difficulty),
    published: formatDisplayDate(release?.date),
    tender_submission_deadline: stage === "tender" ? formatDisplayDate(tender?.tenderPeriod?.endDate) : "",
    engagement_deadline: stage === "planning" ? formatDisplayDate(tender?.tenderPeriod?.endDate) : "",
    estimated_tender_notice: "",
    date_signed: "",
    supplier: "",
    buyer: release?.buyer?.name || "",
    notice_code: stage.toUpperCase(),
    notice_type: tender?.procurementMethodDetails || tender?.procurementMethod || "",
    verification_source: "Official FTS OCDS API",
    value_text: formatMoney(amount, tender?.value?.currency),
    days_until_deadline: daysUntil(deadline),
  };
}

async function fetchJson(url, attempt = 1) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0",
      },
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    if (attempt <= 3) {
      await sleep(attempt * 3000);
      return fetchJson(url, attempt + 1);
    }
    throw error;
  }

  if (response.status === 429 && attempt <= 8) {
    const retryAfter = Number(response.headers.get("retry-after") || 0);
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : attempt * 10000;
    await sleep(waitMs);
    return fetchJson(url, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.json();
}

async function fetchText(url, attempt = 1) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(12000),
    });
  } catch (error) {
    if (attempt <= 1) {
      await sleep(attempt * 2000);
      return fetchText(url, attempt + 1);
    }
    throw error;
  }

  if (response.status === 429 && attempt <= 8) {
    const retryAfter = Number(response.headers.get("retry-after") || 0);
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : attempt * 10000;
    await sleep(waitMs);
    return fetchText(url, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.text();
}

function buildStageUrl(stage) {
  const updatedFrom = new Date(NOW.getTime() - LOOKBACK_DAYS * 86400000).toISOString();
  const params = new URLSearchParams({
    updatedFrom,
    updatedTo: NOW.toISOString(),
    stages: stage,
    limit: String(LIMIT),
  });
  return `${API_BASE}?${params.toString()}`;
}

async function loadArchiveSeed() {
  const archive = JSON.parse(await fs.readFile(archivePath, "utf8"));
  return archive
    .filter((item) => item.status === "current_tender" || item.status === "current_pre_tender")
    .filter((item) => {
      const relevant = parseDateish(
        item.tender_submission_deadline || item.engagement_deadline || item.estimated_tender_notice || "",
      );
      return relevant ? relevant.getTime() >= NOW.getTime() : true;
    })
    .map((item) => ({
      ...item,
      buyer: item.buyer || "",
      value_text: item.value_text || "",
    }));
}

async function loadDiscoveryCandidates() {
  try {
    const payload = JSON.parse(await fs.readFile(discoveryPath, "utf8"));
    const rows = Array.isArray(payload?.results) ? payload.results : [];
    const cutoff = new Date(NOW.getTime() - LOOKBACK_DAYS * 86400000);
    const minNoticeYear = Number(process.env.FTS_DISCOVERY_MIN_NOTICE_YEAR || NOW.getFullYear() - 1);

    return rows
      .filter((candidate) => candidate.notice_id)
      .filter((candidate) => {
        const lastSeen = parseDate(candidate.last_seen_at || candidate.first_seen_at || "");
        return !lastSeen || lastSeen >= cutoff;
      })
      .filter((candidate) => {
        const noticeYear = extractNoticeYear(candidate.notice_id);
        return !noticeYear || noticeYear >= minNoticeYear;
      })
      .filter((candidate) => textHasWebsiteTerm(candidate.title || "") || matchesDiscoveryTerm(candidate.title || "", candidate.search_terms))
      .map((candidate) => ({
        title: candidate.title || "",
        notice_id: candidate.notice_id,
        live_url: candidate.live_url || `https://www.find-tender.service.gov.uk/Notice/${candidate.notice_id}`,
        buyer: candidate.buyer || "",
        value_text: candidate.value_text || "",
        search_terms: Array.isArray(candidate.search_terms) ? candidate.search_terms : [],
        discovery_source: payload?.source || "FTS search UI via Playwright",
        first_seen_at: candidate.first_seen_at || "",
        last_seen_at: candidate.last_seen_at || "",
      }))
      .sort((a, b) => {
        const yearGap = (extractNoticeYear(b.notice_id) || 0) - (extractNoticeYear(a.notice_id) || 0);
        if (yearGap !== 0) return yearGap;
        const sequenceGap = extractNoticeSequence(b.notice_id) - extractNoticeSequence(a.notice_id);
        if (sequenceGap !== 0) return sequenceGap;
        const termGap = b.search_terms.length - a.search_terms.length;
        if (termGap !== 0) return termGap;
        return (parseDate(b.last_seen_at)?.getTime() || 0) - (parseDate(a.last_seen_at)?.getTime() || 0);
      })
      .slice(0, DISCOVERY_VERIFY_LIMIT);
  } catch {
    return [];
  }
}

function isDiscoveryRelevant(candidate, html) {
  const relevantText = normalize(`${candidate.title || ""} ${htmlToLines(html).join(" ")}`);
  return textHasWebsiteTerm(relevantText) || matchesDiscoveryTerm(relevantText, candidate.search_terms);
}

async function mergeDiscoveryCandidates(results, seen) {
  const candidates = await loadDiscoveryCandidates();
  let verified = 0;
  let kept = 0;

  for (const candidate of candidates) {
    if (!candidate.notice_id || seen.has(candidate.notice_id)) continue;

    try {
      const html = await fetchText(candidate.live_url);
      verified += 1;

      if (!isDiscoveryRelevant(candidate, html)) {
        await sleep(DISCOVERY_FETCH_DELAY_MS);
        continue;
      }

      const normalized = normalizeNoticePageResult(candidate, html, NOW);
      if (normalized.status !== "current_tender" && normalized.status !== "current_pre_tender") {
        await sleep(DISCOVERY_FETCH_DELAY_MS);
        continue;
      }

      results.push(normalized);
      seen.add(candidate.notice_id);
      kept += 1;
    } catch (error) {
      console.warn(`Skipping discovered notice ${candidate.notice_id}: ${error.message}`);
    }

    await sleep(DISCOVERY_FETCH_DELAY_MS);
  }

  return {
    loaded: candidates.length,
    verified,
    kept,
  };
}

function sortResults(results) {
  results.sort((a, b) => {
    const statusGap = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
    if (statusGap !== 0) return statusGap;
    const difficultyGap = (a.difficulty ?? 99) - (b.difficulty ?? 99);
    if (difficultyGap !== 0) return difficultyGap;
    const dateGap = compareDates(
      parseDateish(a.tender_submission_deadline || a.engagement_deadline),
      parseDateish(b.tender_submission_deadline || b.engagement_deadline),
    );
    if (dateGap !== 0) return dateGap;
    return a.title.localeCompare(b.title);
  });
}

async function main() {
  const archiveSeed = await loadArchiveSeed();
  const seen = new Set(archiveSeed.map((item) => item.notice_id));
  const apiSeen = new Set();
  const results = [...archiveSeed];
  let scanned = 0;

  for (const stage of STAGES) {
    let nextUrl = buildStageUrl(stage);

    while (nextUrl) {
      const payload = await fetchJson(nextUrl);
      const releases = Array.isArray(payload.releases) ? payload.releases : [];

      for (const release of releases) {
        if (!release?.id || apiSeen.has(release.id)) continue;
        apiSeen.add(release.id);
        scanned += 1;

        const tender = release?.tender || {};
        const published = parseDate(release?.date);
        const cpvs = collectCpvs(tender);
        if (!isCurrentNotice(stage, tender, published)) continue;
        if (!isWebsiteCandidate(tender.title, tender.description, cpvs)) continue;
        if (seen.has(release.id)) continue;

        seen.add(release.id);
        results.push(normalizeApiResult(release, stage));
      }

      nextUrl = payload?.links?.next || null;
      await sleep(PAGE_DELAY_MS);
    }
  }

  const discoveryStats = await mergeDiscoveryCandidates(results, seen);

  sortResults(results);

  const payload = {
    refreshed_at: NOW.toISOString(),
    source: "Official FTS OCDS API plus persisted FTS search discovery",
    lookback_days: LOOKBACK_DAYS,
    scanned_notices: scanned,
    seeded_verified_current: archiveSeed.length,
    discovery_candidates_loaded: discoveryStats.loaded,
    discovery_candidates_verified: discoveryStats.verified,
    discovery_candidates_kept: discoveryStats.kept,
    live_count: results.length,
    results,
  };

  const summaryLines = [
    "# Auto-Refreshed Live Website Opportunities",
    "",
    `- Refreshed at: ${NOW.toISOString()}`,
    `- Source: Official FTS OCDS API plus persisted FTS search discovery`,
    `- Lookback days: ${LOOKBACK_DAYS}`,
    `- API notices scanned: ${scanned}`,
    `- Verified current seed carried forward: ${archiveSeed.length}`,
    `- Discovery candidates loaded: ${discoveryStats.loaded}`,
    `- Discovery candidates verified: ${discoveryStats.verified}`,
    `- Discovery candidates kept: ${discoveryStats.kept}`,
    `- Live opportunities kept: ${results.length}`,
    "",
  ];

  await fs.mkdir(path.dirname(dataPath), { recursive: true });
  await fs.writeFile(dataPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.writeFile(summaryPath, `${summaryLines.join("\n")}\n`, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
