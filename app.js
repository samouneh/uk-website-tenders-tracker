const STATUS_META = {
  all: { label: "All notices" },
  current_tender: { label: "Current tender" },
  current_pre_tender: { label: "Current pre-tender" },
  future_pipeline: { label: "Future pipeline" },
  expired: { label: "Expired" },
  awarded_taken: { label: "Awarded / not open" },
};

const STATUS_PRIORITY = {
  current_tender: 0,
  current_pre_tender: 1,
  future_pipeline: 2,
  expired: 3,
  awarded_taken: 4,
};

const state = {
  data: [],
  status: "all",
  search: "",
  sort: "urgency",
};

const summaryGrid = document.querySelector("#summary-grid");
const filterBar = document.querySelector("#filter-bar");
const resultsGrid = document.querySelector("#results-grid");
const liveGrid = document.querySelector("#live-grid");
const emptyState = document.querySelector("#empty-state");
const heroMeta = document.querySelector("#hero-meta");
const topFocus = document.querySelector("#top-focus");
const searchInput = document.querySelector("#search-input");
const sortSelect = document.querySelector("#sort-select");
const cardTemplate = document.querySelector("#card-template");

const fmtDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

init();

async function init() {
  const response = await fetch("./data/website_tenders_2026_quality_checked_final.json");
  const data = await response.json();
  state.data = data;

  buildHero(data);
  buildSummary(data);
  buildFilters(data);
  bindControls();
  render();
}

function buildHero(data) {
  const live = data.filter(
    (item) => item.status === "current_tender" || item.status === "current_pre_tender",
  );
  const verifiedDate = "13 April 2026";

  heroMeta.innerHTML = [
    chip(`${live.length} live opportunities`),
    chip(`${data.filter((item) => item.status === "awarded_taken").length} already taken`),
    chip(`${data.filter((item) => item.status === "expired").length} expired`),
    chip(`verified ${verifiedDate}`),
  ].join("");

  const top = [...live].sort(compareByUrgency)[0];
  if (!top) {
    topFocus.innerHTML = `<p>No live notices available in the current dataset.</p>`;
    return;
  }

  topFocus.innerHTML = `
    <div class="focus-card">
      <h3>${escapeHtml(top.title)}</h3>
      <p>${escapeHtml(top.status_reason)}</p>
      <p><strong>${escapeHtml(findPrimaryDateLabel(top))}</strong></p>
      <a class="focus-link" href="${top.live_url}" target="_blank" rel="noreferrer">Open official notice</a>
    </div>
  `;
}

function buildSummary(data) {
  const counts = [
    ["Current tender", countBy(data, "current_tender")],
    ["Current pre-tender", countBy(data, "current_pre_tender")],
    ["Future pipeline", countBy(data, "future_pipeline")],
    ["Expired", countBy(data, "expired")],
    ["Awarded / not open", countBy(data, "awarded_taken")],
    ["Total checked", data.length],
  ];

  summaryGrid.innerHTML = counts
    .map(
      ([label, value]) => `
        <article class="summary-card">
          <strong>${value}</strong>
          <span>${label}</span>
        </article>
      `,
    )
    .join("");
}

function buildFilters(data) {
  const counts = {
    all: data.length,
    current_tender: countBy(data, "current_tender"),
    current_pre_tender: countBy(data, "current_pre_tender"),
    future_pipeline: countBy(data, "future_pipeline"),
    expired: countBy(data, "expired"),
    awarded_taken: countBy(data, "awarded_taken"),
  };

  filterBar.innerHTML = Object.entries(STATUS_META)
    .map(
      ([value, meta]) => `
        <button class="filter-button ${value === state.status ? "active" : ""}" data-status="${value}">
          ${meta.label} <strong>${counts[value]}</strong>
        </button>
      `,
    )
    .join("");

  filterBar.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", () => {
      state.status = button.dataset.status;
      buildFilters(state.data);
      render();
    });
  });
}

function bindControls() {
  searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    render();
  });

  sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });
}

function render() {
  const live = state.data
    .filter((item) => item.status === "current_tender" || item.status === "current_pre_tender")
    .sort(compareByUrgency);

  liveGrid.innerHTML = live.map(renderCard).join("");

  const filtered = state.data
    .filter(matchesStatus)
    .filter(matchesSearch)
    .sort(getComparator(state.sort));

  resultsGrid.innerHTML = filtered.map(renderCard).join("");
  emptyState.classList.toggle("hidden", filtered.length > 0);
}

function renderCard(item) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector(".status-pill").textContent = STATUS_META[item.status]?.label ?? item.status;
  node.querySelector(".status-pill").classList.add(`status-${item.status}`);
  node.querySelector(".difficulty-pill").textContent = simplifyDifficulty(item.difficulty_label);
  node.querySelector(".notice-title").textContent = item.title;
  node.querySelector(".notice-meta").textContent = buildMeta(item);
  node.querySelector(".notice-reason").textContent = item.status_reason;
  node.querySelector(".detail-list").innerHTML = buildDetails(item);
  node.querySelector(".card-links").innerHTML = buildLinks(item);
  return node.outerHTML;
}

function buildMeta(item) {
  const bits = [item.notice_id];
  if (item.notice_code) bits.push(item.notice_code);
  if (item.notice_type) bits.push(item.notice_type);
  return bits.join(" • ");
}

function buildDetails(item) {
  const rows = [];
  const primaryDate = findPrimaryDate(item);
  if (primaryDate) {
    rows.push(["Timing", primaryDate]);
  }
  if (item.verification_source) {
    rows.push(["Verified by", "Official notice + live mirror"]);
  }
  if (typeof item.difficulty === "number") {
    rows.push(["Ease score", item.difficulty.toFixed(1)]);
  }

  return rows
    .map(
      ([label, value]) => `
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(value)}</dd>
      `,
    )
    .join("");
}

function buildLinks(item) {
  const links = [
    `<a href="${item.live_url}" target="_blank" rel="noreferrer">Official notice</a>`,
  ];

  if (item.verification_source && item.verification_source !== item.live_url) {
    links.push(
      `<a href="${item.verification_source}" target="_blank" rel="noreferrer">Verification source</a>`,
    );
  }

  return links.join("");
}

function matchesStatus(item) {
  return state.status === "all" ? true : item.status === state.status;
}

function matchesSearch(item) {
  if (!state.search) return true;
  const haystack = [
    item.title,
    item.notice_id,
    item.notice_code,
    item.notice_type,
    item.status_reason,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(state.search);
}

function getComparator(sort) {
  if (sort === "ease") {
    return (a, b) => (a.difficulty ?? 99) - (b.difficulty ?? 99) || compareByUrgency(a, b);
  }

  if (sort === "title") {
    return (a, b) => a.title.localeCompare(b.title);
  }

  return compareByUrgency;
}

function compareByUrgency(a, b) {
  const statusGap = (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99);
  if (statusGap !== 0) return statusGap;

  const dateGap = compareDates(findPrimaryDateObject(a), findPrimaryDateObject(b));
  if (dateGap !== 0) return dateGap;

  return (a.difficulty ?? 99) - (b.difficulty ?? 99) || a.title.localeCompare(b.title);
}

function compareDates(a, b) {
  if (a && b) return a - b;
  if (a) return -1;
  if (b) return 1;
  return 0;
}

function findPrimaryDate(item) {
  if (item.tender_submission_deadline) return `Deadline: ${item.tender_submission_deadline}`;
  if (item.engagement_deadline) return `Engagement: ${item.engagement_deadline}`;
  if (item.estimated_tender_notice) return `Estimated tender: ${item.estimated_tender_notice}`;
  return "";
}

function findPrimaryDateLabel(item) {
  const date = findPrimaryDate(item);
  return date || "No date listed";
}

function findPrimaryDateObject(item) {
  const source =
    item.tender_submission_deadline ||
    item.engagement_deadline ||
    item.estimated_tender_notice ||
    "";
  return parseDate(source);
}

function parseDate(value) {
  if (!value) return null;
  const cleaned = value
    .replace(/(\d{1,2}:\d{2})(am|pm)/i, "$1 $2")
    .replace(",", "")
    .trim();
  const date = new Date(cleaned);
  return Number.isNaN(date.getTime()) ? null : date;
}

function simplifyDifficulty(label) {
  return String(label || "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

function countBy(data, status) {
  return data.filter((item) => item.status === status).length;
}

function chip(text) {
  return `<span class="hero-chip">${escapeHtml(text)}</span>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
