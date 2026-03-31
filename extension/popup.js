const loadingEl    = document.getElementById("loading");
const errorEl      = document.getElementById("error");
const errorMsg     = document.getElementById("error-message");
const resultEl     = document.getElementById("result");
const nameEl       = document.getElementById("name");
const copyConfirm  = document.getElementById("copy-confirm");
const emailInput   = document.getElementById("email-input");
const subjectInput = document.getElementById("subject-input");
const messageBody  = document.getElementById("message-body");
const gmailBtn        = document.getElementById("gmail-btn");
const draftBtn        = document.getElementById("draft-btn");
const draftConfirmEl  = document.getElementById("draft-confirm");
const copyMsgBtn      = document.getElementById("copy-msg-btn");
const aiLoadingEl     = document.getElementById("ai-loading");
const composeInputsEl = document.getElementById("compose-inputs");
const angleSectionEl  = document.getElementById("angle-section");
const angleEl         = document.getElementById("angle-text");
const regenBtn        = document.getElementById("regen-btn");
const settingsBtn     = document.getElementById("settings-btn");
const contextBanner   = document.getElementById("context-banner");
const setupPromptEl   = document.getElementById("setup-prompt");
const setupNameEl     = document.getElementById("setup-name");
const setupBtn        = document.getElementById("setup-btn");
const scoreCardEl     = document.getElementById("score-card");
const scoreNameEl     = document.getElementById("score-name");
const scoreNumberEl   = document.getElementById("score-number");
const scoreRecEl      = document.getElementById("score-rec");
const scoreReasonsEl  = document.getElementById("score-reasons");
const generateBtn     = document.getElementById("generate-btn");
const skipBtnEl       = document.getElementById("skip-btn");
const skipStateEl     = document.getElementById("skip-state");
const notLoggedInEl   = document.getElementById("not-logged-in");
const targetingStepEl = document.getElementById("targeting-step");

const BACKEND = "https://liken-server-production.up.railway.app";

// Convert all-caps or mixed-case names to Title Case
function toTitleCase(str) {
  if (!str) return "";
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// Stored after stage 1 so stage 2 and regen can re-use them
let lastStructuredData = null;
let lastParsed = null;
// User profile fetched from backend
let userProfile = null;
// Selected angle from targeting step
let targetingAngle = "career_path";

function show(el) {
  [loadingEl, errorEl, setupPromptEl, scoreCardEl, targetingStepEl, skipStateEl, resultEl, notLoggedInEl].forEach(e => e.classList.add("hidden"));
  el.classList.remove("hidden");
}

function isContextComplete(profile) {
  return profile && profile.name && profile.name.trim() && profile.background_blurb && profile.background_blurb.trim();
}

function showError(msg) {
  errorMsg.textContent = msg;
  show(errorEl);
}

function displayProfile(data) {
  nameEl.textContent = toTitleCase(data.name);
  show(resultEl);
}

function renderContextBanner() {
  if (!contextBanner) return;
  const hasName = userProfile && userProfile.name;
  if (hasName) {
    // Profile is set up — no banner needed
    return;
  }
  contextBanner.textContent = "Add your background for better results →";
  contextBanner.className = "context-banner no-context";
  contextBanner.onclick = () => chrome.runtime.openOptionsPage();
  contextBanner.classList.remove("hidden");
}

settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
setupBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const loginErrorEl = document.getElementById("login-error");
  const loginSubmitBtn = document.getElementById("login-submit-btn");
  loginErrorEl.classList.add("hidden");
  loginSubmitBtn.disabled = true;
  loginSubmitBtn.textContent = "Signing in…";

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  try {
    const res = await fetch(`${BACKEND}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) {
      loginErrorEl.textContent = data.error || data.message || "Invalid email or password.";
      loginErrorEl.classList.remove("hidden");
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.textContent = "Sign in";
      return;
    }
    const token = data.token || data.access_token;
    chrome.storage.local.set({ cm_token: token }, () => {
      location.reload();
    });
  } catch (err) {
    loginErrorEl.textContent = "Could not reach server. Try again.";
    loginErrorEl.classList.remove("hidden");
    loginSubmitBtn.disabled = false;
    loginSubmitBtn.textContent = "Sign in";
  }
});

document.getElementById("signup-link").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: "https://coldmatch.co/signup" });
});

function init() {
  show(loadingEl);
  chrome.storage.local.get(["cm_token"], async ({ cm_token: token }) => {
    if (!token) {
      show(notLoggedInEl);
      return;
    }

    try {
      const res = await fetch(`${BACKEND}/profile`, {
        headers: { Authorization: "Bearer " + token }
      });
      if (res.status === 401) {
        chrome.storage.local.remove("cm_token");
        show(notLoggedInEl);
        return;
      }
      userProfile = await res.json();
      console.log('[ColdMatch] User profile loaded:', userProfile);
    } catch (e) {
      showError("Could not reach ColdMatch server.");
      return;
    }

    // Shared handler: branch on context completeness after extraction
    async function handleProfileData(data) {
      if (!isContextComplete(userProfile)) {
        setupNameEl.textContent = toTitleCase(data.name);
        show(setupPromptEl);
        return;
      }
      // Pre-set name so result state is ready when stage 2 runs
      nameEl.textContent = toTitleCase(data.name);

      // Stage 1: score the match via backend
      const parts = [`Name: ${data.name}`];
      if (data.headline)       parts.push(`Headline: ${data.headline}`);
      if (data.location)       parts.push(`Location: ${data.location}`);
      if (data.candidates?.length) parts.push(data.candidates.join("\n"));
      if (data.about)          parts.push(`About: ${data.about}`);
      if (data.experienceRaw)  parts.push(`Experience:\n${data.experienceRaw}`);
      if (data.educationRaw)   parts.push(`Education:\n${data.educationRaw}`);
      const combinedText = parts.join("\n");
      const scoreData = await callAI(combinedText);
      console.log("SCORE:", scoreData);
      lastStructuredData = combinedText;
      lastParsed = { name: toTitleCase(data.name) };
      const partialLoad = !data.experienceRaw && !data.educationRaw;
      showScoreCard(scoreData, { name: toTitleCase(data.name) }, partialLoad);
    }

    // Query the active tab and ask content script for profile data
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      console.log('[LI Popup] Active tab:', tab?.url);

      if (!tab || !tab.url) {
        showError("No active tab found.");
        return;
      }

      if (!tab.url.match(/https:\/\/www\.linkedin\.com\/in\//)) {
        showError("Not a LinkedIn profile page.");
        return;
      }

      console.log('[LI Popup] Sending extractProfile message to tab', tab.id);
      chrome.tabs.sendMessage(tab.id, { action: "extractProfile" }, async (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[LI Popup] sendMessage failed (content script not loaded):', chrome.runtime.lastError.message);
          // Content script not yet injected (SPA navigation) — inject and retry
          chrome.scripting.executeScript(
            { target: { tabId: tab.id }, files: ["content.js"] },
            () => {
              if (chrome.runtime.lastError) {
                console.error('[LI Popup] executeScript failed:', chrome.runtime.lastError.message);
                showError("Could not inject script.");
                return;
              }
              console.log('[LI Popup] Script injected, retrying message...');
              // Small delay to let the script initialise
              setTimeout(() => {
                chrome.tabs.sendMessage(tab.id, { action: "extractProfile" }, async (resp) => {
                  console.log('[LI Popup] Retry response:', resp, chrome.runtime.lastError?.message);
                  if (chrome.runtime.lastError || !resp) {
                    showError("Could not read page data.");
                    return;
                  }
                  handleProfileData(resp);
                });
              }, 300);
            }
          );
          return;
        }

        console.log('[LI Popup] Response received:', response);
        if (!response) {
          showError("No data returned from page.");
          return;
        }

        handleProfileData(response);
      });
    });
  });
}

init();

// Stage 2a: "Generate email →" on score card → show targeting step
generateBtn.addEventListener("click", () => {
  show(targetingStepEl);
});

// Stage 2b: "← Back" on targeting step → return to score card
document.getElementById("targeting-back-btn").addEventListener("click", () => {
  show(scoreCardEl);
});

// Stage 2c: "Generate email →" on targeting step → generate
document.getElementById("targeting-generate-btn").addEventListener("click", async () => {
  targetingAngle = document.getElementById("targeting-angle").value;
  show(resultEl);
  renderContextBanner();
  showAILoading(true);
  const generated = await generateMessage(lastStructuredData, targetingAngle);
  console.log("MESSAGE:", generated);
  subjectInput.value = generated.subject;
  messageBody.value  = generated.body;
  angleEl.textContent = generated.hook || deriveAngle(lastParsed);
  angleSectionEl.classList.remove("hidden");
  showAILoading(false);
});

skipBtnEl.addEventListener("click", () => show(skipStateEl));

function showScoreCard(scoreData, parsed, partialLoad) {
  scoreNameEl.textContent = toTitleCase(parsed.name);
  const colorClass = scoreData.score >= 70 ? "score-green"
                   : scoreData.score >= 40 ? "score-amber"
                   : "score-red";
  scoreNumberEl.textContent = scoreData.score;
  scoreNumberEl.className   = `score-number ${colorClass}`;
  scoreRecEl.textContent    = scoreData.recommendation;
  scoreRecEl.className      = `score-badge ${colorClass}`;
  scoreReasonsEl.innerHTML  = "";
  (scoreData.reasons || []).forEach(reason => {
    const li = document.createElement("li");
    li.textContent = reason;
    scoreReasonsEl.appendChild(li);
  });

  // Show or hide partial-load warning
  let warningEl = document.getElementById("partial-load-warning");
  if (partialLoad) {
    if (!warningEl) {
      warningEl = document.createElement("p");
      warningEl.id = "partial-load-warning";
      warningEl.style.cssText = "font-size:11px;color:#6b7280;text-align:center;margin:6px 0 0;";
      scoreCardEl.querySelector(".profile-card").after(warningEl);
    }
    warningEl.textContent = "For best results, let the page fully load before scanning.";
  } else if (warningEl) {
    warningEl.remove();
  }

  show(scoreCardEl);
}


// Save draft directly to Gmail via backend
draftBtn.addEventListener("click", () => {
  const to      = emailInput.value.trim();
  const subject = subjectInput.value.trim();
  const body    = messageBody.value.trim();

  draftBtn.disabled = true;
  draftBtn.textContent = "Saving…";
  draftConfirmEl.classList.add("hidden");

  chrome.storage.local.get(["cm_token"], async ({ cm_token: token }) => {
    try {
      const res = await fetch(`${BACKEND}/auth/gmail/draft`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ to, subject, body }),
      });
      const data = await res.json();

      if (!res.ok) {
        draftConfirmEl.textContent = data.error === "gmail_not_connected"
          ? "Connect Gmail at coldmatch.co/dashboard"
          : "Failed to save draft. Try again.";
        draftConfirmEl.className = "draft-confirm draft-error";
      } else {
        draftConfirmEl.textContent = "✓ Draft saved in Gmail";
        draftConfirmEl.className = "draft-confirm draft-success";
      }
    } catch (_) {
      draftConfirmEl.textContent = "Could not reach server. Try again.";
      draftConfirmEl.className = "draft-confirm draft-error";
    }

    draftConfirmEl.classList.remove("hidden");
    draftBtn.disabled = false;
    draftBtn.textContent = "Save as draft";
  });
});

// Open Gmail compose window with pre-filled fields
gmailBtn.addEventListener("click", () => {
  const to      = emailInput.value.trim();
  const subject = subjectInput.value.trim();
  const body    = messageBody.value.trim();
  const url     = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  chrome.tabs.create({ url });
});

// Regenerate message using stored profile data
regenBtn.addEventListener("click", async () => {
  if (!lastStructuredData) return;
  showAILoading(true);
  const generated = await generateMessage(lastStructuredData, targetingAngle);
  console.log("REGENERATED MESSAGE:", generated);
  subjectInput.value = generated.subject;
  messageBody.value  = generated.body;
  showAILoading(false);
});

// Copy only the email body
copyMsgBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(messageBody.value.trim()).then(() => {
    copyConfirm.classList.remove("hidden");
    setTimeout(() => copyConfirm.classList.add("hidden"), 2000);
  });
});

// Show/hide the compose-phase AI loading spinner
function showAILoading(on) {
  if (on) {
    aiLoadingEl.classList.remove("hidden");
    composeInputsEl.classList.add("hidden");
  } else {
    aiLoadingEl.classList.add("hidden");
    composeInputsEl.classList.remove("hidden");
  }
}

// Derive a one-line angle from structured profile data (no extra API call)
function deriveAngle(parsed) {
  const prev = parsed.previous_roles;
  const goal = userProfile && userProfile.goal;

  // Relational angle when user profile + goal is available
  if (goal) {
    const roleOrCo = parsed.current_role
      ? `${parsed.current_role}${parsed.company ? ` at ${parsed.company}` : ""}`
      : parsed.company || "their field";
    return `Their experience in ${roleOrCo} is directly relevant to your goal of ${goal.toLowerCase()}`;
  }

  if (prev && prev.length > 0 && parsed.current_role) {
    return `Curious about their transition from ${prev[0]} to ${parsed.current_role}`;
  }
  if (parsed.current_role && parsed.company) {
    return `Relevant to their current work as ${parsed.current_role} at ${parsed.company}`;
  }
  if (parsed.education) {
    return `Anchored by their background at ${parsed.education}`;
  }
  return `Based on their experience as ${parsed.current_role || "a professional"}`;
}

function buildToneInstruction(goal) {
  switch (goal) {
    case "Finding a job":
      return "The sender is actively looking for opportunities. The tone should be purposeful and professional — subtly signal their interest in roles or teams without being blunt about job-seeking. The ask should feel natural, not transactional.";
    case "Seeking mentorship":
      return "The sender wants guidance from this person. Use a curious, deferential, and eager-to-learn tone. Genuine admiration for the recipient's path is appropriate. The ask should be humble — a short call to learn from their experience.";
    case "Exploring a career pivot":
      return "The sender is considering a career change and is drawn to this person's background. The tone should be open and exploratory — someone trying to understand a new field through the lens of someone who has navigated it.";
    case "Networking generally":
      return "No specific agenda — the sender genuinely wants to connect. Keep the tone warm, low-pressure, and authentic. The ask should feel like a conversation, not a pitch.";
    case "Finding collaborators":
      return "The sender is looking for people to work with on projects or ideas. Use an energetic, collaborative tone — convey excitement about what the recipient is building and suggest exploring shared interests.";
    default:
      return "Polished, respectful, and human. Confident but not pushy. Keep it natural and not overly formal.";
  }
}

async function generateMessage(structuredData, angle) {
  const requestBody = { profileData: structuredData, userProfile, targetingAngle: angle };
  console.log('[ColdMatch] Sending to email:', requestBody);
  const response = await fetch(`${BACKEND}/generate/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });
  return response.json();
}

async function callAI(profileData) {
  const requestBody = { profileData, userProfile };
  console.log('[ColdMatch] Sending to score:', requestBody);
  const response = await fetch(`${BACKEND}/generate/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });
  return response.json();
}
