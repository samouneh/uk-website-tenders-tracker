export const EXACT_CPVS = new Set(["72212224", "72413000", "72415000", "72416000"]);

export const WEBSITE_TERMS = [
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

export const DEFAULT_DISCOVERY_TERMS = [
  "website",
  "website redesign",
  "website development",
  "web development",
  "website build",
  "cms",
  "intranet",
  "microsite",
];

export const STATUS_ORDER = {
  current_tender: 0,
  current_pre_tender: 1,
};

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

const ENTITY_MAP = new Map([
  ["nbsp", " "],
  ["amp", "&"],
  ["quot", "\""],
  ["apos", "'"],
  ["lt", "<"],
  ["gt", ">"],
  ["ndash", "-"],
  ["mdash", "-"],
]);

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalize(value) {
  return normalizeSpace(value).toLowerCase();
}

export function normalizeSpace(value) {
  return String(value || "")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLabel(value) {
  return normalizeSpace(value).toLowerCase().replace(/:$/, "");
}

export function parseDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseDateish(value) {
  if (!value) return null;
  const cleaned = normalizeSpace(String(value))
    .replace(/(\d{1,2}:\d{2})(am|pm)/i, "$1 $2")
    .replace(",", "")
    .trim();

  const slashMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (slashMatch) {
    const [, day, month, year, hour = "0", minute = "0"] = slashMatch;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return parseDate(cleaned);
}

export function formatDisplayDate(value) {
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

export function formatMoney(amount, currency) {
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

export function collectCpvs(tender) {
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

export function textHasWebsiteTerm(text) {
  return WEBSITE_PATTERNS.some((pattern) => pattern.test(text || ""));
}

export function matchesDiscoveryTerm(text, searchTerms = []) {
  const normalizedText = normalize(text);
  return searchTerms.some((term) => normalizedText.includes(normalize(term)));
}

export function isWebsiteCandidate(title, description, cpvs) {
  const titleHit = textHasWebsiteTerm(title || "");
  const descriptionHit = textHasWebsiteTerm(description || "");
  const cpvHit = (cpvs || []).some((cpv) => EXACT_CPVS.has(cpv));
  return titleHit || (descriptionHit && cpvHit);
}

export function scoreDifficulty(text, amount = 0, lotsCount = 0) {
  const normalizedText = normalize(text);
  let score = 3;
  score += Math.min(DIFFICULTY_ADDERS.filter((term) => normalizedText.includes(term)).length, 4);
  score -= Math.min(DIFFICULTY_REDUCERS.filter((term) => normalizedText.includes(term)).length, 2);
  if (lotsCount > 1) score += 1;
  if (amount >= 500000) score += 2;
  else if (amount >= 150000) score += 1;
  return Math.max(1, Math.min(8, score));
}

export function difficultyLabel(score) {
  if (score <= 2) return "VERY EASY";
  if (score <= 3.5) return "EASY";
  if (score <= 5.5) return "MEDIUM";
  return "MEDIUM-HARD";
}

export function daysUntil(date, now = new Date()) {
  const parsed = parseDate(date);
  if (!parsed) return null;
  return Math.ceil((parsed.getTime() - now.getTime()) / 86400000);
}

export function extractNoticeYear(noticeId) {
  const match = String(noticeId || "").match(/-(\d{4})$/);
  return match ? Number(match[1]) : null;
}

export function extractNoticeSequence(noticeId) {
  const match = String(noticeId || "").match(/^(\d+)/);
  return match ? Number(match[1]) : 0;
}

export function compareDates(a, b) {
  if (a && b) return a - b;
  if (a) return -1;
  if (b) return 1;
  return 0;
}

export function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, entity) => ENTITY_MAP.get(entity.toLowerCase()) ?? match);
}

export function htmlToLines(html) {
  const noScripts = String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ");

  const withLineBreaks = noScripts.replace(
    /<(?:br|\/p|\/div|\/li|\/ul|\/ol|\/h[1-6]|\/dd|\/dt|\/tr|\/section|\/article|\/header|\/footer|\/main|\/table|\/tbody|\/thead|\/dl)>/gi,
    "\n",
  );

  return decodeHtmlEntities(withLineBreaks.replace(/<[^>]+>/g, " "))
    .split(/\r?\n/)
    .map((line) => normalizeSpace(line))
    .filter(Boolean);
}

export function findValueAfterLabels(lines, labels, maxLookahead = 4) {
  const normalizedLabels = new Set(labels.map((label) => normalizeLabel(label)));
  for (let index = 0; index < lines.length; index += 1) {
    if (!normalizedLabels.has(normalizeLabel(lines[index]))) continue;
    for (let lookahead = index + 1; lookahead < Math.min(lines.length, index + 1 + maxLookahead); lookahead += 1) {
      const candidate = normalizeSpace(lines[lookahead]);
      if (!candidate) continue;
      if (/^#{2,3}\s/.test(candidate)) break;
      return candidate;
    }
  }
  return "";
}

export function extractNoticeType(text) {
  const match = String(text || "").match(/\b(UK\d+|F\d+)\s*:\s*([^\n]+)/i);
  return {
    noticeCode: match ? normalizeSpace(match[1].toUpperCase()) : "",
    noticeType: match ? normalizeSpace(match[2]) : "",
  };
}

export function extractPublished(text) {
  const match = String(text || "").match(
    /Published\s+([0-9]{1,2}\s+\w+\s+\d{4}(?:,\s*[0-9]{1,2}:\d{2}(?:am|pm))?)/i,
  );
  return match ? normalizeSpace(match[1]) : "";
}

export function extractSupplier(text) {
  const patterns = [
    /Supplier(?:\s+Supplier)?\s+([^\n]+)/i,
    /Name and address of the contractor(?:\(s\))?\s+([^\n]+)/i,
  ];

  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) return normalizeSpace(match[1]);
  }

  return "";
}

export function extractBuyer(lines, text) {
  const direct = findValueAfterLabels(lines, [
    "Organisation name",
    "Name and address",
    "Name and addresses",
    "Buyer",
  ]);
  if (direct) return direct;

  const fallback = String(text || "").match(/Organisation name\s+([^\n]+)/i);
  return fallback ? normalizeSpace(fallback[1]) : "";
}

export function extractValueText(lines) {
  return findValueAfterLabels(lines, [
    "Estimated value excluding VAT",
    "Estimated total value excluding VAT",
    "Value excluding VAT",
    "Total value excluding VAT",
    "Total value of the procurement",
  ]);
}

export function extractAmountFromValueText(valueText) {
  const match = String(valueText || "")
    .replace(/,/g, "")
    .match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function startOfDay(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function isOnOrAfter(date, now) {
  return parseDate(date)?.getTime() >= startOfDay(now).getTime();
}

export function classifyNoticePage(record, now = new Date()) {
  const noticeCode = String(record.notice_code || "").toUpperCase();
  const noticeType = normalize(record.notice_type || "");
  const title = normalize(record.title || "");
  const tenderDeadline = parseDateish(record.tender_submission_deadline || "");
  const engagementDeadline = parseDateish(record.engagement_deadline || "");
  const participationDeadline = parseDateish(record.participation_deadline || "");
  const estimatedTenderNotice = parseDateish(record.estimated_tender_notice || "");

  if (
    noticeCode === "UK6" ||
    noticeCode === "UK7" ||
    noticeType.includes("award notice") ||
    noticeType.includes("contract details notice") ||
    noticeType.includes("award") ||
    noticeType.includes("contract details")
  ) {
    return {
      status: "awarded_taken",
      statusReason: "Award or contract details notice",
    };
  }

  const effectiveTenderDeadline = tenderDeadline || participationDeadline;

  if (noticeCode === "UK4" || noticeType.includes("tender notice") || noticeType.includes("contract notice")) {
    if (effectiveTenderDeadline) {
      return isOnOrAfter(effectiveTenderDeadline, now)
        ? {
            status: "current_tender",
            statusReason: "Tender notice with future submission deadline",
          }
        : {
            status: "expired",
            statusReason: "Tender notice deadline has passed",
          };
    }

    return {
      status: "unclear",
      statusReason: "Tender notice but no submission deadline found",
    };
  }

  if (
    noticeCode === "UK2" ||
    noticeCode === "UK3" ||
    noticeType.includes("market engagement") ||
    noticeType.includes("planned procurement")
  ) {
    if (tenderDeadline && isOnOrAfter(tenderDeadline, now)) {
      return {
        status: "current_pre_tender",
        statusReason: "Planning notice with future submission deadline",
      };
    }
    if (engagementDeadline && isOnOrAfter(engagementDeadline, now)) {
      return {
        status: "current_pre_tender",
        statusReason: "Planning notice with future engagement deadline",
      };
    }
    if (estimatedTenderNotice && isOnOrAfter(estimatedTenderNotice, now)) {
      return {
        status: "future_pipeline",
        statusReason: "Planning notice with future estimated tender publication",
      };
    }
    return {
      status: "expired",
      statusReason: "Planning or engagement notice has passed",
    };
  }

  if (
    noticeCode === "UK13" ||
    noticeCode === "UK14" ||
    noticeType.includes("dynamic market intention notice")
  ) {
    return {
      status: "future_pipeline",
      statusReason: "Dynamic market notice rather than a direct bid opportunity",
    };
  }

  if (title.includes("request for information") || title.includes("expression of interest")) {
    if (tenderDeadline && isOnOrAfter(tenderDeadline, now)) {
      return {
        status: "current_pre_tender",
        statusReason: "RFI or EOI with future response deadline",
      };
    }
    if (engagementDeadline && isOnOrAfter(engagementDeadline, now)) {
      return {
        status: "current_pre_tender",
        statusReason: "RFI or EOI with future engagement deadline",
      };
    }
    return {
      status: "expired",
      statusReason: "RFI or EOI response window appears to have passed",
    };
  }

  if (effectiveTenderDeadline) {
    return isOnOrAfter(effectiveTenderDeadline, now)
      ? {
          status: "current_tender",
          statusReason: "Future submission deadline found",
        }
      : {
          status: "expired",
          statusReason: "Most relevant deadline has passed",
        };
  }

  return {
    status: "unclear",
    statusReason: "Could not confidently determine live status",
  };
}

export function normalizeNoticePageResult(candidate, html, now = new Date()) {
  const lines = htmlToLines(html);
  const text = lines.join("\n");
  const { noticeCode, noticeType } = extractNoticeType(text);
  const tenderSubmissionDeadline = findValueAfterLabels(lines, [
    "Tender submission deadline",
    "Submission deadline",
    "Time limit for receipt of tenders or requests to participate",
    "Time limit for receipt of tenders",
  ]);
  const participationDeadline = findValueAfterLabels(lines, [
    "Deadline for requests to participate",
    "Deadline for expressions of interest",
    "Time limit for receipt of requests to participate",
  ]);
  const engagementDeadline = findValueAfterLabels(lines, [
    "Engagement deadline",
    "Deadline for clarification questions",
  ]);
  const estimatedTenderNotice = findValueAfterLabels(lines, [
    "Publication date of tender notice (estimated)",
    "Estimated date of publication of contract notice",
  ]);
  const dateSigned = findValueAfterLabels(lines, ["Date signed", "Date of conclusion of the contract"]);
  const published = extractPublished(text);
  const supplier = extractSupplier(text) || findValueAfterLabels(lines, ["Supplier", "Name and address of the contractor"]);
  const buyer = candidate.buyer || extractBuyer(lines, text);
  const valueText = candidate.value_text || extractValueText(lines);
  const difficulty = scoreDifficulty(
    `${candidate.title || ""} ${noticeType} ${text}`,
    extractAmountFromValueText(valueText),
    0,
  );

  const classified = classifyNoticePage(
    {
      ...candidate,
      notice_code: noticeCode,
      notice_type: noticeType,
      tender_submission_deadline: tenderSubmissionDeadline,
      engagement_deadline: engagementDeadline,
      participation_deadline: participationDeadline,
      estimated_tender_notice: estimatedTenderNotice,
    },
    now,
  );

  const primaryDeadline =
    parseDateish(tenderSubmissionDeadline) ||
    parseDateish(participationDeadline) ||
    parseDateish(engagementDeadline) ||
    parseDateish(estimatedTenderNotice);

  return {
    title: candidate.title || "",
    notice_id: candidate.notice_id || "",
    live_url: candidate.live_url || `https://www.find-tender.service.gov.uk/Notice/${candidate.notice_id}`,
    status: classified.status,
    status_reason: candidate.discovery_source
      ? `Discovered in the FTS search UI and verified against the official notice page. ${classified.statusReason}`
      : classified.statusReason,
    difficulty,
    difficulty_label: difficultyLabel(difficulty),
    published,
    tender_submission_deadline: tenderSubmissionDeadline,
    engagement_deadline: engagementDeadline,
    estimated_tender_notice: estimatedTenderNotice,
    date_signed: dateSigned,
    supplier,
    buyer,
    notice_code: noticeCode,
    notice_type: noticeType,
    verification_source: candidate.live_url || `https://www.find-tender.service.gov.uk/Notice/${candidate.notice_id}`,
    value_text: valueText,
    days_until_deadline: daysUntil(primaryDeadline, now),
    search_terms: Array.isArray(candidate.search_terms) ? [...candidate.search_terms] : [],
  };
}
