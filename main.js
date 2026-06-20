"use strict";

var DEFAULT_FEED_URL = "news-feed.json";
var DEFAULT_REFRESH_SECONDS = 60;
var RECENT_WINDOW_HOURS = 8;
var STORAGE_KEY = "gold-news-bias-settings";

var fallbackEvents = [
  {
    id: "sample-cpi",
    time: new Date(Date.now() - 46 * 60 * 1000).toISOString(),
    currency: "USD",
    impact: "high",
    category: "inflation",
    event: "Core CPI m/m",
    actual: "0.2%",
    forecast: "0.3%",
    previous: "0.3%"
  },
  {
    id: "sample-claims",
    time: new Date(Date.now() - 94 * 60 * 1000).toISOString(),
    currency: "USD",
    impact: "high",
    category: "laborClaims",
    event: "Unemployment Claims",
    actual: "238K",
    forecast: "222K",
    previous: "218K"
  },
  {
    id: "sample-fed",
    time: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    currency: "USD",
    impact: "high",
    category: "fed",
    event: "Fed Chair Powell Speaks",
    tone: "dovish",
    actual: "Dovish",
    forecast: "Neutral",
    previous: "Hawkish"
  }
];

var ruleDefinitions = [
  {
    category: "inflation",
    label: "CPI / PCE / PPI",
    hotter: "Hotter inflation usually pressures gold short because yields and USD can rise.",
    cooler: "Cooler inflation usually supports gold long because rate-cut expectations rise."
  },
  {
    category: "labor",
    label: "NFP / Average Hourly Earnings",
    hotter: "Stronger jobs or wages usually bias gold short through hawkish Fed expectations.",
    cooler: "Weaker jobs or wages usually bias gold long through lower yields or safety demand."
  },
  {
    category: "laborClaims",
    label: "Jobless Claims",
    hotter: "Lower claims show labor strength and usually bias gold short.",
    cooler: "Higher claims show labor weakness and usually bias gold long."
  },
  {
    category: "unemployment",
    label: "Unemployment Rate",
    hotter: "Lower unemployment usually biases gold short.",
    cooler: "Higher unemployment usually biases gold long."
  },
  {
    category: "growth",
    label: "GDP / Retail Sales / PMI",
    hotter: "Stronger growth usually biases gold short if yields and USD rise.",
    cooler: "Weaker growth usually biases gold long if yields fall or safe-haven demand appears."
  },
  {
    category: "fed",
    label: "FOMC / Fed Speakers",
    hotter: "Hawkish Fed language usually biases gold short.",
    cooler: "Dovish Fed language usually biases gold long."
  },
  {
    category: "dollar",
    label: "US Dollar",
    hotter: "A stronger dollar usually biases gold short.",
    cooler: "A weaker dollar usually biases gold long."
  },
  {
    category: "yields",
    label: "US Yields",
    hotter: "Rising yields usually bias gold short.",
    cooler: "Falling yields usually bias gold long."
  }
];

var elements = {
  biasCard: document.getElementById("biasCard"),
  currentBiasTitle: document.getElementById("currentBiasTitle"),
  biasSummary: document.getElementById("biasSummary"),
  longScore: document.getElementById("longScore"),
  shortScore: document.getElementById("shortScore"),
  confidence: document.getElementById("confidence"),
  connectionStatus: document.getElementById("connectionStatus"),
  lastChecked: document.getElementById("lastChecked"),
  nextCheck: document.getElementById("nextCheck"),
  releaseRows: document.getElementById("releaseRows"),
  rulesGrid: document.getElementById("rulesGrid"),
  settingsForm: document.getElementById("settingsForm"),
  feedUrl: document.getElementById("feedUrl"),
  refreshSeconds: document.getElementById("refreshSeconds"),
  highImpactOnly: document.getElementById("highImpactOnly"),
  refreshNow: document.getElementById("refreshNow")
};

var settings = loadSettings();
var countdownTimer = null;
var pollTimer = null;
var nextRefreshAt = null;

renderRules();
applySettingsToForm();
bindEvents();
refreshFeed();

function bindEvents() {
  elements.settingsForm.addEventListener("submit", function (event) {
    event.preventDefault();
    settings = {
      feedUrl: elements.feedUrl.value.trim() || DEFAULT_FEED_URL,
      refreshSeconds: Number(elements.refreshSeconds.value) || DEFAULT_REFRESH_SECONDS,
      highImpactOnly: elements.highImpactOnly.checked
    };
    saveSettings(settings);
    refreshFeed();
  });

  elements.refreshNow.addEventListener("click", refreshFeed);
}

function loadSettings() {
  try {
    var stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored && typeof stored === "object") {
      return {
        feedUrl: stored.feedUrl || DEFAULT_FEED_URL,
        refreshSeconds: Number(stored.refreshSeconds) || DEFAULT_REFRESH_SECONDS,
        highImpactOnly: stored.highImpactOnly !== false
      };
    }
  } catch (error) {
    // Ignore invalid stored settings and fall back to safe defaults.
  }

  return {
    feedUrl: DEFAULT_FEED_URL,
    refreshSeconds: DEFAULT_REFRESH_SECONDS,
    highImpactOnly: true
  };
}

function saveSettings(nextSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSettings));
}

function applySettingsToForm() {
  elements.feedUrl.value = settings.feedUrl;
  elements.refreshSeconds.value = String(settings.refreshSeconds);
  elements.highImpactOnly.checked = settings.highImpactOnly;
}

function refreshFeed() {
  stopTimers();
  setConnectionStatus("Checking feed...", "");

  fetchEvents(settings.feedUrl)
    .then(function (events) {
      setConnectionStatus("Feed connected", "ok");
      updateDashboard(events, false);
    })
    .catch(function () {
      setConnectionStatus("Using sample data", "error");
      updateDashboard(fallbackEvents, true);
    })
    .finally(function () {
      elements.lastChecked.textContent = "Last checked: " + formatTime(new Date());
      scheduleNextRefresh();
    });
}

function fetchEvents(feedUrl) {
  return fetch(feedUrl, { cache: "no-store" })
    .then(function (response) {
      if (!response.ok) {
        throw new Error("Feed returned " + response.status);
      }
      return response.json();
    })
    .then(function (payload) {
      if (Array.isArray(payload)) {
        return payload;
      }
      if (payload && Array.isArray(payload.events)) {
        return payload.events;
      }
      throw new Error("Feed must be an array or an object with an events array.");
    });
}

function updateDashboard(events, usingFallback) {
  var normalized = events
    .map(normalizeEvent)
    .filter(function (event) {
      return event && event.currency === "USD";
    })
    .filter(function (event) {
      return !settings.highImpactOnly || event.impact === "high";
    })
    .sort(function (a, b) {
      return b.timestamp - a.timestamp;
    });

  var scoredEvents = normalized.map(scoreEvent);
  var recentScoredEvents = scoredEvents.filter(isRecentRelease);
  var aggregate = aggregateBias(recentScoredEvents);

  renderBias(aggregate, recentScoredEvents, usingFallback);
  renderReleaseRows(scoredEvents);
}

function normalizeEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== "object") {
    return null;
  }

  var eventName = String(rawEvent.event || rawEvent.title || rawEvent.name || "").trim();
  if (!eventName) {
    return null;
  }

  var timeValue = rawEvent.time || rawEvent.datetime || rawEvent.releaseTime || rawEvent.date;
  var timestamp = parseTimestamp(timeValue);

  return {
    id: rawEvent.id || eventName + "-" + timestamp,
    event: eventName,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    currency: String(rawEvent.currency || "USD").toUpperCase(),
    impact: String(rawEvent.impact || rawEvent.importance || "medium").toLowerCase(),
    category: inferCategory(rawEvent.category, eventName),
    actual: rawEvent.actual,
    forecast: rawEvent.forecast || rawEvent.consensus,
    previous: rawEvent.previous || rawEvent.prior,
    tone: rawEvent.tone ? String(rawEvent.tone).toLowerCase() : "",
    note: rawEvent.note || rawEvent.description || ""
  };
}

function inferCategory(category, eventName) {
  var text = String(category || eventName).toLowerCase();

  if (text.indexOf("fed") !== -1 || text.indexOf("fomc") !== -1 || text.indexOf("powell") !== -1 || text.indexOf("rate decision") !== -1) {
    return "fed";
  }
  if (text.indexOf("claim") !== -1) {
    return "laborClaims";
  }
  if (text.indexOf("unemployment") !== -1) {
    return "unemployment";
  }
  if (text.indexOf("payroll") !== -1 || text.indexOf("earnings") !== -1 || text.indexOf("wage") !== -1 || text.indexOf("jolts") !== -1) {
    return "labor";
  }
  if (text.indexOf("cpi") !== -1 || text.indexOf("pce") !== -1 || text.indexOf("ppi") !== -1 || text.indexOf("inflation") !== -1) {
    return "inflation";
  }
  if (text.indexOf("dxy") !== -1 || text.indexOf("dollar") !== -1) {
    return "dollar";
  }
  if (text.indexOf("yield") !== -1 || text.indexOf("treasury") !== -1) {
    return "yields";
  }
  if (text.indexOf("war") !== -1 || text.indexOf("risk") !== -1 || text.indexOf("geopolitical") !== -1) {
    return "risk";
  }

  return "growth";
}

function parseTimestamp(timeValue) {
  if (!timeValue) {
    return Date.now();
  }

  var text = String(timeValue).trim();
  var relative = text.match(/^now\s*([+-])\s*(\d+)\s*([mhd])$/i);
  if (relative) {
    var sign = relative[1] === "-" ? -1 : 1;
    var amount = Number(relative[2]);
    var unit = relative[3].toLowerCase();
    var unitMs = unit === "d" ? 24 * 60 * 60 * 1000 : unit === "h" ? 60 * 60 * 1000 : 60 * 1000;
    return Date.now() + sign * amount * unitMs;
  }

  var timestamp = new Date(text).getTime();
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function scoreEvent(event) {
  var surprise = getSurprise(event);
  var direction = "wait";
  var reason = "No actual figure yet. Wait for the release.";
  var magnitude = Math.abs(surprise.value);

  if (event.category === "fed") {
    return scoreToneEvent(event, "Hawkish Fed language usually lifts yields/USD and pressures gold.", "Dovish Fed language usually lowers yields/USD and supports gold.");
  }

  if (event.category === "risk") {
    return scoreToneEvent(event, "Risk-off or crisis headlines usually support gold.", "Calmer risk tone can reduce safe-haven demand.");
  }

  if (!surprise.hasActual || !surprise.hasForecast || surprise.value === 0) {
    return Object.assign({}, event, {
      bias: "wait",
      score: 0,
      confidence: "Low",
      surpriseLabel: "Waiting",
      reason: reason
    });
  }

  if (event.category === "laborClaims" || event.category === "unemployment") {
    if (surprise.value > 0) {
      direction = "long";
      reason = "Higher labor weakness than forecast can lower yields and support gold.";
    } else {
      direction = "short";
      reason = "Stronger labor than forecast can raise yields/USD and pressure gold.";
    }
  } else if (event.category === "dollar" || event.category === "yields") {
    if (surprise.value > 0) {
      direction = "short";
      reason = "A stronger USD or higher yields usually weighs on gold.";
    } else {
      direction = "long";
      reason = "A weaker USD or lower yields usually supports gold.";
    }
  } else {
    if (surprise.value > 0) {
      direction = "short";
      reason = "A hotter or stronger print can lift yields/USD and pressure gold.";
    } else {
      direction = "long";
      reason = "A cooler or weaker print can lower yields/USD and support gold.";
    }
  }

  var score = scoreMagnitude(event, magnitude);

  return Object.assign({}, event, {
    bias: direction,
    score: score,
    confidence: confidenceFromScore(score),
    surpriseLabel: formatSurprise(surprise),
    reason: reason
  });
}

function scoreToneEvent(event, positiveShortReason, positiveLongReason) {
  var tone = event.tone || String(event.actual || "").toLowerCase();
  var bias = "wait";
  var reason = "Waiting for clear language.";

  if (tone.indexOf("hawkish") !== -1 || tone.indexOf("higher") !== -1 || tone.indexOf("restrictive") !== -1) {
    bias = event.category === "risk" ? "long" : "short";
    reason = positiveShortReason;
  } else if (tone.indexOf("dovish") !== -1 || tone.indexOf("lower") !== -1 || tone.indexOf("cut") !== -1 || tone.indexOf("weak") !== -1) {
    bias = event.category === "risk" ? "short" : "long";
    reason = positiveLongReason;
  }

  return Object.assign({}, event, {
    bias: bias,
    score: bias === "wait" ? 0 : 2,
    confidence: bias === "wait" ? "Low" : "Medium",
    surpriseLabel: tone ? capitalize(tone) : "Waiting",
    reason: reason
  });
}

function getSurprise(event) {
  var actual = parseNumber(event.actual);
  var forecast = parseNumber(event.forecast);

  if (!actual.hasValue || !forecast.hasValue) {
    return {
      value: 0,
      actual: actual.value,
      forecast: forecast.value,
      hasActual: actual.hasValue,
      hasForecast: forecast.hasValue
    };
  }

  return {
    value: roundTo(actual.value - forecast.value, 6),
    actual: actual.value,
    forecast: forecast.value,
    hasActual: true,
    hasForecast: true,
    unit: actual.unit || forecast.unit
  };
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") {
    return { hasValue: false, value: 0, unit: "" };
  }

  if (typeof value === "number") {
    return { hasValue: Number.isFinite(value), value: value, unit: "" };
  }

  var text = String(value).trim();
  var multiplier = 1;
  if (/k$/i.test(text)) {
    multiplier = 1000;
  } else if (/m$/i.test(text)) {
    multiplier = 1000000;
  } else if (/b$/i.test(text)) {
    multiplier = 1000000000;
  }

  var match = text.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!match) {
    return { hasValue: false, value: 0, unit: "" };
  }

  return {
    hasValue: true,
    value: Number(match[0]) * multiplier,
    unit: text.indexOf("%") !== -1 ? "%" : ""
  };
}

function scoreMagnitude(event, magnitude) {
  if (event.category === "laborClaims") {
    if (magnitude >= 20000) {
      return 3;
    }
    if (magnitude >= 8000) {
      return 2;
    }
    return 1;
  }

  if (event.category === "labor") {
    if (/payroll|jolts/i.test(event.event)) {
      if (magnitude >= 100000) {
        return 3;
      }
      if (magnitude >= 40000) {
        return 2;
      }
      return 1;
    }
  }

  if (magnitude >= 0.3) {
    return 3;
  }
  if (magnitude >= 0.1) {
    return 2;
  }
  return 1;
}

function confidenceFromScore(score) {
  if (score >= 3) {
    return "High";
  }
  if (score >= 2) {
    return "Medium";
  }
  return "Low";
}

function formatSurprise(surprise) {
  if (!surprise.hasActual) {
    return "No actual";
  }
  if (!surprise.hasForecast) {
    return "No forecast";
  }

  var prefix = surprise.value > 0 ? "+" : "";
  if (Math.abs(surprise.value) >= 1000) {
    return prefix + compactNumber(surprise.value);
  }

  return prefix + roundTo(surprise.value, 3) + (surprise.unit || "");
}

function isRecentRelease(event) {
  var ageMs = Date.now() - event.timestamp;
  return ageMs >= 0 && ageMs <= RECENT_WINDOW_HOURS * 60 * 60 * 1000 && event.bias !== "wait";
}

function aggregateBias(events) {
  var longScore = 0;
  var shortScore = 0;
  var leadingEvent = null;

  events.forEach(function (event) {
    var freshness = freshnessWeight(event.timestamp);
    var weightedScore = event.score * freshness;

    if (event.bias === "long") {
      longScore += weightedScore;
    } else if (event.bias === "short") {
      shortScore += weightedScore;
    }

    if (!leadingEvent || event.score > leadingEvent.score) {
      leadingEvent = event;
    }
  });

  var net = longScore - shortScore;
  var bias = "wait";
  if (Math.abs(net) < 0.75 && (longScore > 0 || shortScore > 0)) {
    bias = "mixed";
  } else if (net > 0) {
    bias = "long";
  } else if (net < 0) {
    bias = "short";
  }

  return {
    bias: bias,
    longScore: roundTo(longScore, 1),
    shortScore: roundTo(shortScore, 1),
    net: roundTo(net, 1),
    confidence: aggregateConfidence(Math.abs(net), events.length),
    leadingEvent: leadingEvent
  };
}

function freshnessWeight(timestamp) {
  var ageHours = Math.max(0, (Date.now() - timestamp) / (60 * 60 * 1000));
  return Math.max(0.35, 1 - ageHours / RECENT_WINDOW_HOURS);
}

function aggregateConfidence(netScore, eventCount) {
  if (eventCount === 0 || netScore < 0.75) {
    return "Low";
  }
  if (netScore >= 2.25) {
    return "High";
  }
  return "Medium";
}

function renderBias(aggregate, scoredEvents, usingFallback) {
  var bias = aggregate.bias;
  var title = bias.toUpperCase();
  var summary = "Waiting for a high-impact release with an actual figure.";

  if (bias === "long") {
    summary = "Gold has a long bias from recent high-impact releases. Confirm that DXY and yields are falling before considering a trade.";
  } else if (bias === "short") {
    summary = "Gold has a short bias from recent high-impact releases. Confirm that DXY and yields are rising before considering a trade.";
  } else if (bias === "mixed") {
    summary = "Signals are mixed. No clean directional edge from the current news set.";
  }

  if (aggregate.leadingEvent) {
    summary += " Leading driver: " + aggregate.leadingEvent.event + " - " + aggregate.leadingEvent.reason;
  }

  if (usingFallback) {
    summary += " Sample data is showing because the live feed could not be loaded.";
  }

  if (!scoredEvents.length) {
    summary = "No recent high-impact USD release is available in the selected feed.";
  }

  elements.biasCard.className = "card bias-card " + bias;
  elements.currentBiasTitle.textContent = title;
  elements.biasSummary.textContent = summary;
  elements.longScore.textContent = aggregate.longScore;
  elements.shortScore.textContent = aggregate.shortScore;
  elements.confidence.textContent = aggregate.confidence;
}

function renderReleaseRows(events) {
  if (!events.length) {
    elements.releaseRows.innerHTML = "<tr><td colspan=\"7\" class=\"muted\">No matching USD high-impact releases found.</td></tr>";
    return;
  }

  elements.releaseRows.innerHTML = events.slice(0, 16).map(function (event) {
    return [
      "<tr>",
      "<td>" + escapeHtml(formatDateTime(event.timestamp)) + "</td>",
      "<td><strong>" + escapeHtml(event.event) + "</strong><br><span class=\"muted\">" + escapeHtml(event.impact.toUpperCase()) + " / " + escapeHtml(event.category) + "</span></td>",
      "<td>" + escapeHtml(formatValue(event.actual)) + "</td>",
      "<td>" + escapeHtml(formatValue(event.forecast)) + "</td>",
      "<td>" + escapeHtml(event.surpriseLabel) + "</td>",
      "<td><span class=\"bias-chip " + event.bias + "\">" + escapeHtml(event.bias) + "</span></td>",
      "<td>" + escapeHtml(event.reason) + "</td>",
      "</tr>"
    ].join("");
  }).join("");
}

function renderRules() {
  elements.rulesGrid.innerHTML = ruleDefinitions.map(function (rule) {
    return [
      "<article class=\"rule\">",
      "<h3>" + escapeHtml(rule.label) + "</h3>",
      "<p><strong>Hotter/stronger:</strong> " + escapeHtml(rule.hotter) + "</p>",
      "<p><strong>Cooler/weaker:</strong> " + escapeHtml(rule.cooler) + "</p>",
      "</article>"
    ].join("");
  }).join("");
}

function scheduleNextRefresh() {
  nextRefreshAt = Date.now() + settings.refreshSeconds * 1000;
  updateCountdown();

  countdownTimer = window.setInterval(updateCountdown, 1000);
  pollTimer = window.setTimeout(refreshFeed, settings.refreshSeconds * 1000);
}

function stopTimers() {
  if (countdownTimer) {
    window.clearInterval(countdownTimer);
  }
  if (pollTimer) {
    window.clearTimeout(pollTimer);
  }
}

function updateCountdown() {
  if (!nextRefreshAt) {
    elements.nextCheck.textContent = "Next check: --";
    return;
  }

  var seconds = Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000));
  elements.nextCheck.textContent = "Next check: " + seconds + "s";
}

function setConnectionStatus(text, className) {
  elements.connectionStatus.textContent = text;
  elements.connectionStatus.className = "status-pill" + (className ? " " + className : "");
}

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

function compactNumber(value) {
  var abs = Math.abs(value);
  var sign = value < 0 ? "-" : "";

  if (abs >= 1000000000) {
    return sign + roundTo(abs / 1000000000, 2) + "B";
  }
  if (abs >= 1000000) {
    return sign + roundTo(abs / 1000000, 2) + "M";
  }
  if (abs >= 1000) {
    return sign + roundTo(abs / 1000, 1) + "K";
  }
  return String(roundTo(value, 2));
}

function roundTo(value, places) {
  var factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

function capitalize(value) {
  if (!value) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
