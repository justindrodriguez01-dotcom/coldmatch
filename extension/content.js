// Guard against duplicate injection (popup fallback re-injects this file)
if (!window.__liExtractorLoaded) {
  window.__liExtractorLoaded = true;

  console.log('[LI Extractor] Content script registered');

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[LI Extractor] Message received:', request.action);
    if (request.action === 'extractProfile') {
      const data = extractProfileData();
      console.log('[LI Extractor] Extracted data:', data);
      sendResponse(data);
    }
    return true;
  });
}

// Exact-match UI labels to skip (buttons, badges, degree indicators)
const UI_LABELS = /^(message|connect|follow|more|save|share|like|report|block|remove|endorse|pending|view profile|open to|1st|2nd|3rd|\d+(st|nd|rd|th)?)$/i;
const UI_CONTAINS = /try premium|premium for|linkedin premium|\$0|upgrade/i;

// LinkedIn nav items that bleed into top-of-page candidate scrapes
const NAV_ITEMS = new Set(['home', 'my network', 'jobs', 'messaging', 'notifications', 'for business', '1st', '2nd', '3rd']);

// Strings that look like date ranges or durations — skip when building role/edu entries
const LOOKS_LIKE_DATE = /\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|\bmos\b|\byrs?\b|\bpresent\b|·/i;

// Find the nearest sizeable container for a section heading (e.g. "Experience")
function findSectionContainer(heading) {
  for (const el of document.querySelectorAll('h2, h3, span, div, p')) {
    if (el.children.length > 0) continue;
    if (el.innerText?.trim() !== heading) continue;
    let node = el.parentElement;
    while (node && node.children.length < 3) {
      node = node.parentElement;
    }
    return node;
  }
  return null;
}

// Collect non-date, non-UI leaf texts from a container, up to `limit` items
function collectSectionLeaves(container, heading, limit) {
  const results = [];
  for (const el of container.querySelectorAll('p, span, div, li')) {
    if (el.children.length > 0) continue;
    const text = el.innerText?.trim();
    if (!text || text.length < 3) continue;
    if (text === heading) continue;
    if (UI_LABELS.test(text)) continue;
    if (LOOKS_LIKE_DATE.test(text)) continue;
    results.push(text);
    if (results.length >= limit) break;
  }
  return results;
}

function extractHeadline(nameAnchor) {
  // Try 1: element within 100px below the name that is 12–13px and longer than 10 chars.
  // This is reliable because LinkedIn always renders the headline directly under the name.
  if (nameAnchor) {
    const nameBottom = nameAnchor.top + (nameAnchor.el.getBoundingClientRect().height || 0);
    for (const el of document.querySelectorAll('p, span, div, h2')) {
      if (el.children.length > 0) continue;
      const text = el.innerText?.trim();
      if (!text || text.length < 20) continue;
      if (UI_LABELS.test(text)) continue;
      if (UI_CONTAINS.test(text)) continue;
      if (NAV_ITEMS.has(text.toLowerCase())) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.top < nameBottom) continue;
      if (rect.top > nameBottom + 100) continue;
      const fontSize = parseFloat(getComputedStyle(el).fontSize) || 0;
      if (fontSize < 11 || fontSize > 14) continue;
      console.log('[LI Extractor] Headline try1 (proximity+font-size):', text, `${fontSize}px`);
      return text;
    }
    console.log('[LI Extractor] Headline try1: no match near name');
  }

  // Try 2: .text-body-medium.break-words exact compound class
  const t2 = document.querySelector('.text-body-medium.break-words');
  console.log('[LI Extractor] Headline try2 (.text-body-medium.break-words):', t2?.innerText?.trim() || null);
  if (t2) {
    const text = t2.innerText?.trim();
    if (text && text.length > 10) return text;
  }

  // Try 3: any div/span with class containing "text-body-medium" in top 400px
  for (const el of document.querySelectorAll('div[class*="text-body-medium"], span[class*="text-body-medium"]')) {
    const text = el.innerText?.trim();
    if (!text || text.length <= 10) continue;
    if (UI_LABELS.test(text)) continue;
    if (UI_CONTAINS.test(text)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.top < 0 || rect.top > 400) continue;
    console.log('[LI Extractor] Headline try3 (text-body-medium scan):', text);
    return text;
  }

  console.log('[LI Extractor] Headline: not found');
  return null;
}

// Matches strings that look like geographic locations
const LOCATION_PATTERN = /\bArea\b|\bCity\b|\bMetro\b|\bRegion\b|\bGreater\b|\bRemote\b|United States|United Kingdom|Canada|Australia|Germany|France|India|Singapore|New York|Los Angeles|San Francisco|Chicago|Boston|Seattle|Austin|Denver|Miami|Atlanta|Washington|\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b/i;

function extractLocation(candidates, excludeTexts) {
  const excluded = new Set((excludeTexts || []).filter(Boolean).map(t => t.toLowerCase()));

  // Scan candidates (already on the page, near the top) for a location-like string
  for (const text of (candidates || [])) {
    if (excluded.has(text.toLowerCase())) continue;
    if (LOCATION_PATTERN.test(text)) {
      console.log('[LI Extractor] Location found in candidates:', text);
      return text;
    }
  }

  console.log('[LI Extractor] Location: not found in candidates');
  return null;
}

// Shared helper: find a section by scanning for an h2 whose text matches `heading`
function findSectionByH2(heading) {
  for (const h2 of document.querySelectorAll('h2')) {
    if (h2.innerText?.trim() !== heading) continue;
    // Walk up to the nearest <section> ancestor
    let node = h2.parentElement;
    while (node && node.tagName !== 'SECTION') node = node.parentElement;
    if (node) {
      console.log(`[LI Extractor] ${heading} section found via h2 -> section`);
      return node;
    }
  }
  return null;
}

// Shared helper: extract aria-hidden span texts from a list item
function ariaTextsFromLi(li) {
  return [...li.querySelectorAll('span[aria-hidden="true"]')]
    .map(el => el.innerText?.trim())
    .filter(t => t && t.length > 1);
}

function extractAbout() {
  let section = null;

  // Try 1: sibling of a heading element whose text is exactly "About"
  for (const el of document.querySelectorAll('h2, h3, span, div')) {
    if (el.children.length > 0) continue;
    if (el.innerText?.trim() !== 'About') continue;
    // Look for the next sibling or parent's next sibling that has real text
    const parent = el.closest('section') || el.parentElement;
    if (parent) { section = parent; break; }
  }
  console.log('[LI Extractor] About try1 (heading sibling):', section ? 'found' : 'not found');

  // Try 2: data-generated-suggestion-target attribute
  if (!section) {
    const t2 = document.querySelector('[data-generated-suggestion-target]');
    console.log('[LI Extractor] About try2 ([data-generated-suggestion-target]):', t2 ? 'found' : 'not found');
    if (t2) section = t2.closest('section') || t2.parentElement;
  }

  // Try 3: legacy .pv-about-section class
  if (!section) {
    const t3 = document.querySelector('.pv-about-section');
    console.log('[LI Extractor] About try3 (.pv-about-section):', t3 ? 'found' : 'not found');
    if (t3) section = t3;
  }

  if (!section) {
    console.log('[LI Extractor] About: not found');
    return null;
  }

  const raw = section.innerText?.trim() || '';
  const text = raw.replace(/^About\s*/i, '').replace(/\s+/g, ' ').slice(0, 600).trim() || null;
  console.log('[LI Extractor] About:', text);
  return text;
}

function extractRawSection(heading, maxChars) {
  let section = null;

  // Try 1: h2 matching heading -> walk up to enclosing <section>
  section = findSectionByH2(heading);
  console.log(`[LI Extractor] ${heading} try1 (h2->section):`, section ? 'found' : 'not found');

  // Try 2: pvs-list container inside any element containing an h2 with that heading
  if (!section) {
    for (const h2 of document.querySelectorAll('h2')) {
      if (!h2.innerText?.trim().includes(heading)) continue;
      const pvs = h2.closest('div, section')?.querySelector('[class*="pvs-list"]');
      if (pvs) { section = pvs.closest('section') || pvs.parentElement; break; }
    }
    console.log(`[LI Extractor] ${heading} try2 (pvs-list):`, section ? 'found' : 'not found');
  }

  if (!section) {
    console.log(`[LI Extractor] ${heading}: section not found`);
    return null;
  }

  const raw = section.innerText?.trim() || '';
  // Strip the heading label from the start, collapse whitespace, cap length
  const text = raw
    .replace(new RegExp(`^${heading}\\s*`, 'i'), '')
    .replace(/[ \t]+/g, ' ')      // collapse horizontal whitespace
    .replace(/\n{3,}/g, '\n\n')   // collapse excess blank lines
    .trim()
    .slice(0, maxChars) || null;

  console.log(`[LI Extractor] ${heading} raw (${text?.length ?? 0} chars):`, text);
  return text;
}

function extractFullExperience() {
  return extractRawSection('Experience', 800);
}

function extractFullEducation() {
  return extractRawSection('Education', 400);
}

function extractProfileData() {
  const data = { name: null, headline: null, candidates: [], about: null, location: null, experienceRaw: null, educationRaw: null };

  // ── NAME ──────────────────────────────────────────────────────────────────
  const NAME_BLOCKED = /\d|connection|follower|mutual|message|follow|endorse|open to|pronouns/i;
  const SIDEBAR_BLOCKED = /aside|sidebar|people-you-may-know|pymk/i;

  function isInSidebar(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const cls = (node.className || '').toString();
      const id  = (node.id || '').toString();
      if (SIDEBAR_BLOCKED.test(cls) || SIDEBAR_BLOCKED.test(id)) return true;
      node = node.parentElement;
    }
    return false;
  }

  const nameAnchor = (() => {
    // Method 1: target the h1 with LinkedIn's profile heading class
    const h1Candidates = document.querySelectorAll('h1');
    for (const el of h1Candidates) {
      const cls = (el.className || '').toString();
      if (!cls.includes('text-heading-xlarge') && !cls.includes('inline')) continue;
      const text = el.innerText?.trim();
      if (!text) continue;
      const words = text.split(/\s+/);
      if (words.length < 2 || words.length > 5) continue;
      if (text.length > 60) continue;
      if (NAME_BLOCKED.test(text)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.top < 0 || rect.top > 300) continue;
      if (isInSidebar(el)) continue;
      console.log('[LI Extractor] Name found via h1/text-heading-xlarge method:', text);
      return { el, text, top: rect.top, fontSize: parseFloat(getComputedStyle(el).fontSize) || 0 };
    }

    // Method 2: fallback — largest font-size element in top portion of page
    console.log('[LI Extractor] h1 method failed, falling back to font-size method');
    const els = document.querySelectorAll('p, span, div, h1, h2, h3');
    const pool = [];

    for (const el of els) {
      if (el.children.length > 0) continue;
      const text = el.innerText?.trim();
      if (!text) continue;
      const words = text.split(/\s+/);
      if (words.length < 2 || words.length > 5) continue;
      if (text.length > 60) continue;
      if (NAME_BLOCKED.test(text)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.top < 0 || rect.top > 300) continue;
      if (isInSidebar(el)) continue;
      const fontSize = parseFloat(getComputedStyle(el).fontSize) || 0;
      pool.push({ el, text, top: rect.top, fontSize });
    }

    console.log('[LI Extractor] Name pool (fallback):', pool.map(c => `"${c.text}" (${c.fontSize}px)`));
    if (pool.length === 0) return null;
    pool.sort((a, b) => b.fontSize - a.fontSize || a.top - b.top);
    console.log('[LI Extractor] Name found via font-size fallback method:', pool[0].text);
    return pool[0];
  })();

  if (!nameAnchor) {
    console.warn('[LI Extractor] Name not found — page may still be loading');
    return data;
  }

  data.name = nameAnchor.text;
  console.log('[LI Extractor] Name:', data.name);

  // ── HEADLINE (uses name anchor position for proximity search) ─────────────
  data.headline = extractHeadline(nameAnchor);
  console.log('[LI Extractor] Headline:', data.headline);

  // ── TOP-OF-PAGE CANDIDATES ────────────────────────────────────────────────
  const seen = new Set([data.name]);
  const raw = [];

  for (const el of document.querySelectorAll('p, span, div')) {
    if (el.children.length > 0) continue;
    const text = el.innerText?.trim();
    if (!text || text.length < 4) continue;
    if (UI_LABELS.test(text)) continue;
    if (UI_CONTAINS.test(text)) continue;
    if (NAV_ITEMS.has(text.toLowerCase())) continue;
    if (seen.has(text)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.top < 0 || rect.top > 600) continue;
    seen.add(text);
    raw.push({ text, top: rect.top });
  }

  data.candidates = raw
    .sort((a, b) => a.top - b.top)
    .map(c => c.text)
    .slice(0, 10);

  console.log('[LI Extractor] Candidates:', data.candidates);

  // ── LOCATION (scans candidates for a location-like string) ────────────────
  data.location = extractLocation(data.candidates, [data.name, data.headline]);
  if (data.location) data.candidates = data.candidates.filter(c => c !== data.location);
  console.log('[LI Extractor] Location:', data.location);

  // ── EXPERIENCE ────────────────────────────────────────────────────────────
  const expContainer = findSectionContainer('Experience');
  if (expContainer) {
    const leaves = collectSectionLeaves(expContainer, 'Experience', 6);
    console.log('[LI Extractor] Experience leaves:', leaves);

    // Pair consecutive strings as "Title — Company" for up to 2 roles
    for (let i = 0; i + 1 < leaves.length && i < 4; i += 2) {
      const role = `${leaves[i]} — ${leaves[i + 1]}`;
      if (!seen.has(role)) {
        seen.add(role);
        data.candidates.push(role);
        console.log('[LI Extractor] Experience found:', role);
      }
    }
  } else {
    console.log('[LI Extractor] Experience section not found');
  }

  // ── EDUCATION ─────────────────────────────────────────────────────────────
  const eduContainer = findSectionContainer('Education');
  if (eduContainer) {
    const leaves = collectSectionLeaves(eduContainer, 'Education', 4);
    console.log('[LI Extractor] Education leaves:', leaves);

    if (leaves.length >= 2) {
      const edu = `${leaves[0]} — ${leaves[1]}`;
      if (!seen.has(edu)) {
        seen.add(edu);
        data.candidates.push(edu);
        console.log('[LI Extractor] Education found:', edu);
      }
    } else if (leaves.length === 1 && !seen.has(leaves[0])) {
      seen.add(leaves[0]);
      data.candidates.push(leaves[0]);
      console.log('[LI Extractor] Education found:', leaves[0]);
    }
  } else {
    console.log('[LI Extractor] Education section not found');
  }

  // ── ABOUT ─────────────────────────────────────────────────────────────────
  data.about = extractAbout();

  // ── EXPERIENCE RAW ────────────────────────────────────────────────────────
  data.experienceRaw = extractFullExperience();

  // ── EDUCATION RAW ─────────────────────────────────────────────────────────
  data.educationRaw = extractFullEducation();

  console.log('[LI Extractor] Full extracted data:', data);
  return data;
}
