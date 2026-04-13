import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataPath = path.join(repoRoot, "data", "live_website_opportunities.json");
const summaryPath = path.join(repoRoot, "LIVE_AUTO_FEED_SUMMARY.md");
const archivePath = path.join(repoRoot, "data", "website_tenders_2026_quality_checked_final.json");

const API_BASE = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages";
const LOOKBACK_DAYS = Number(process.env.FTS_LOOKBACK_DAYS || 180);
const PAGE_DELAY_MS = Number(process.env.FTS_PAGE_DELAY_MS || 750);
const LIMIT = Number(process.env.FTS_LIMIT || 100);
const STAGES = ["tender", "planning"];
const NOW = new Date();

const EXACT_CPVS = new Set(["72212224", "72413000", "72415000", "72416000"]);

const WEBSITE_TERMS = [
  "website",
  "web site",
  "websites",
  "web development",
  "website development",
  "website redesign",
  "website rebuild",
  "website refresh",
  "website migration",
  "website build",
  "website upgrade",
  "web content",
  "web content engagement",
  "web design",
  "intranet",
  "cms",
  "content management system",
  "corporate website",
  "tenant website",
  "website and intranet",
  "website specialist",
  "microsite",
  "site design",
];

const WEBSITE_PATTERNS = WEBSITE_TERMS.map((term) => new RegExp(`\\b${escapeRegExp(term).replace(/\\ /g, "\\s+")}\\b`, "i"));

const DIFFICULTY_ADDERS = [
  "mobile app",
  "integration",
  "integrations",
  "clinical",
  "patient",
  "framework",
  "managed service",
  "strategic",
  "portal",
  "intranet",
  "multiple",
  "migration",
];

const DIFFICULTY_REDUCERS = [
  "audit",
  "single website",
  "corporate website",
  "website refresh",
  "website redesign",
  "website rebuild",
  "website upgrade",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(value) {
  return (value || "").toString().toLowerCase().replace(/\s+/g, " ").trim();
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDisplayDate(value) {
  const date = parseDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .replace(" ", "")
    .toLowerCase();
  return `${parts}, ${time}`;
}

function formatMoney(amount, currency) {
  if (typeof amount !== "number" || Number.isNaN(amount) || amount <= 0) return "";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "GBP",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency || "GBP"}`;
  }
}

function collectCpvs(tender) {
  const codes = new Set();
  if (tender?.classification?.scheme === "CPV" && tender.classification.id) {
    codes.add(tender.classification.id);
  }
  for (const item of tender?.items || []) {
    for (const cpv of item?.additionalClassifications || []) {
      if (cpv?.scheme === "CPV" && cpv.id) codes.add(cpv.id);
    }
  }
  return [...codes];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textHasWebsiteTerm(text) {
  return WEBSITE_PATTERNS.some((pattern) => pattern.test(text || ""));
}

function isWebsiteCandidate(title, description, cpvs) {
  const titleText = String(title || "");
  const descriptionText = String(description || "");
  const titleHit = textHasWebsiteTerm(titleText);
  const descriptionHit = textHasWebsiteTerm(descriptionText);
  const cpvHit = cpvs.some((cpv) => EXACT_CPVS.has(cpv));
  return titleHit || (descriptionHit && cpvHit);
}

function stageStatus(stage) {
  return stage === "tender" ? "current_tender" : "current_pre_tender";
}

function scoreDifficulty(text, amount, lotsCount) {
  let score = 3;
  score += Math.min(DIFFICULTY_ADDERS.filter((term) => text.includes(term)).length, 4);
  score -= Math.min(DIFFICULTY_REDUCERS.filter((term) => text.includes(term)).length, 2);
  if (lotsCount > 1) score += 1;
  if (amount >= 500000) score += 2;
  else if (amount >= 150000) score += 1;
  return Math.max(1, Math.min(8, score));
}

function difficultyLabel(score) {
  if (score <= 2) return "VERY EASY";
  if (score <= 3.5) return "EASY";
  if (score <= 5.5) return "MEDIUM";
  return "MEDIUM-HARD";
}

function daysUntil(date) {
  if (!date) return null;
  return Math.ceil((date.getTime() - NOW.getTime()) / 86400000);
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

function normalizeResult(release, stage) {
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
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0",
    },
  });

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

async function main() {
  const archiveSeed = await loadArchiveSeed();
  const seen = new Set(archiveSeed.map((item) => item.notice_id));
  const results = [...archiveSeed];
  let scanned = 0;

  for (const stage of STAGES) {
    let nextUrl = buildStageUrl(stage);

    while (nextUrl) {
      const payload = await fetchJson(nextUrl);
      const releases = Array.isArray(payload.releases) ? payload.releases : [];

      for (const release of releases) {
        if (!release?.id || seen.has(release.id)) continue;
        seen.add(release.id);
        scanned += 1;

        const tender = release?.tender || {};
        const published = parseDate(release?.date);
        const cpvs = collectCpvs(tender);
        if (!isCurrentNotice(stage, tender, published)) continue;
        if (!isWebsiteCandidate(tender.title, tender.description, cpvs)) continue;

        results.push(normalizeResult(release, stage));
      }

      nextUrl = payload?.links?.next || null;
      await sleep(PAGE_DELAY_MS);
    }
  }

  results.sort((a, b) => {
    const statusGap = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
    if (statusGap !== 0) return statusGap;
    const difficultyGap = (a.difficulty ?? 99) - (b.difficulty ?? 99);
    if (difficultyGap !== 0) return difficultyGap;
    const dateGap = compareDates(parseDateish(a.tender_submission_deadline || a.engagement_deadline), parseDateish(b.tender_submission_deadline || b.engagement_deadline));
    if (dateGap !== 0) return dateGap;
    return a.title.localeCompare(b.title);
  });

  const payload = {
    refreshed_at: NOW.toISOString(),
    source: "Official FTS OCDS API",
    lookback_days: LOOKBACK_DAYS,
    scanned_notices: scanned,
    seeded_verified_current: archiveSeed.length,
    live_count: results.length,
    results,
  };

  const summaryLines = [
    "# Auto-Refreshed Live Website Opportunities",
    "",
    `- Refreshed at: ${NOW.toISOString()}`,
    `- Source: Official FTS OCDS API`,
    `- Lookback days: ${LOOKBACK_DAYS}`,
    `- Notices scanned: ${scanned}`,
    `- Verified current seed carried forward: ${archiveSeed.length}`,
    `- Live opportunities kept: ${results.length}`,
    "",
  ];

  await fs.mkdir(path.dirname(dataPath), { recursive: true });
  await fs.writeFile(dataPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.writeFile(summaryPath, `${summaryLines.join("\n")}\n`, "utf8");
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

const STATUS_ORDER = {
  current_tender: 0,
  current_pre_tender: 1,
};

function parseDateish(value) {
  if (!value) return null;
  const cleaned = String(value).replace(/(\d{1,2}:\d{2})(am|pm)/i, "$1 $2").replace(",", "").trim();
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function compareDates(a, b) {
  if (a && b) return a - b;
  if (a) return -1;
  if (b) return 1;
  return 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
