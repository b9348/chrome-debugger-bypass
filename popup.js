const DEFAULT_SETTINGS = {
  enabled: true,
  allSites: false,
  protectedOrigins: [],
  dynamicGuard: true,
};

const elements = {
  enabled: document.querySelector("#enabled"),
  currentSite: document.querySelector("#currentSite"),
  allSites: document.querySelector("#allSites"),
  dynamicGuard: document.querySelector("#dynamicGuard"),
  origin: document.querySelector("#origin"),
  status: document.querySelector("#status"),
  notice: document.querySelector("#notice"),
};

let tab;
let origin;
let settings;

function parseOrigin(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:", "file:"].includes(parsed.protocol)) return null;
    return parsed.protocol === "file:" ? "file://" : parsed.origin;
  } catch {
    return null;
  }
}

function render() {
  const siteEnabled = Boolean(origin && settings.protectedOrigins.includes(origin));
  const active = settings.enabled && Boolean(origin) && (settings.allSites || siteEnabled);
  elements.enabled.checked = settings.enabled;
  elements.allSites.checked = settings.allSites;
  elements.currentSite.checked = settings.allSites || siteEnabled;
  elements.currentSite.disabled = !origin || settings.allSites || !settings.enabled;
  elements.allSites.disabled = !settings.enabled;
  elements.dynamicGuard.disabled = !settings.enabled;
  elements.dynamicGuard.checked = settings.dynamicGuard;
  elements.origin.textContent = origin || "此类 Chrome 页面无法注入脚本";
  elements.status.textContent = active ? "当前页面已保护" : "当前页面未保护";
}

async function save(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.local.set(patch);
  render();
  if (tab?.id === undefined) return;

  const result = await chrome.runtime.sendMessage({
    type: "REFRESH_TAB",
    tabId: tab.id,
    url: tab.url,
  });
  const shouldAttach = settings.enabled && origin
    && (settings.allSites || settings.protectedOrigins.includes(origin));
  if (shouldAttach && !result.attached) {
    elements.notice.textContent = "无法附加到此页面。请关闭该页面的其他调试器后重试。";
    elements.notice.classList.add("error");
  } else {
    elements.notice.textContent = "设置已生效。刷新网页后再打开开发者工具。";
    elements.notice.classList.remove("error");
  }
}

elements.enabled.addEventListener("change", () => save({ enabled: elements.enabled.checked }));
elements.allSites.addEventListener("change", () => save({ allSites: elements.allSites.checked }));
elements.dynamicGuard.addEventListener("change", () => save({ dynamicGuard: elements.dynamicGuard.checked }));
elements.currentSite.addEventListener("change", () => {
  if (!origin) return;
  const origins = new Set(settings.protectedOrigins);
  elements.currentSite.checked ? origins.add(origin) : origins.delete(origin);
  save({ protectedOrigins: [...origins] });
});

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  origin = parseOrigin(tab?.url);
  settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) };
  render();
})();
