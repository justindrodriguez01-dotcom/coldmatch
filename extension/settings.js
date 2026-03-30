const BACKEND = "https://liken-server-production.up.railway.app";

const loadingEl    = document.getElementById("loading");
const loggedInEl   = document.getElementById("logged-in");
const notLoggedInEl = document.getElementById("not-logged-in");

function show(el) {
  [loadingEl, loggedInEl, notLoggedInEl].forEach(e => e.classList.add("hidden"));
  el.classList.remove("hidden");
}

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
    const profile = await res.json();
    document.getElementById("profile-name").textContent = profile.name || "";
    document.getElementById("profile-school").textContent = profile.school || "";
    show(loggedInEl);
  } catch (e) {
    show(notLoggedInEl);
  }
});

document.getElementById("edit-profile-btn").addEventListener("click", async () => {
  const { cm_token } = await chrome.storage.local.get("cm_token");
  const url = "https://coldmatch.co/onboarding.html?token=" + cm_token;
  chrome.tabs.create({ url });
});

document.getElementById("sign-out-btn").addEventListener("click", () => {
  chrome.storage.local.remove("cm_token", () => {
    show(notLoggedInEl);
  });
});

document.getElementById("signin-btn").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://coldmatch.co/login.html" });
});

document.getElementById("signup-btn").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://coldmatch.co/signup.html" });
});
