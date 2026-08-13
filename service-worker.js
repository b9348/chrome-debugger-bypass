const DEFAULT_SETTINGS = {
  enabled: true,
  allSites: false,
  protectedOrigins: [],
  dynamicGuard: true,
};

const attachedTabs = new Set();
const tabOperations = new Map();
const PAGE_GUARD_ID = "page-guard-main-world";
let pageGuardOperation = Promise.resolve();

function isSupportedUrl(url) {
  return /^(https?|file):/.test(url || "");
}

function getOrigin(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "file:" ? "file://" : parsed.origin;
  } catch {
    return null;
  }
}

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

function isProtected(url, settings) {
  if (!settings.enabled || !isSupportedUrl(url)) return false;
  const origin = getOrigin(url);
  return Boolean(origin && (settings.allSites || settings.protectedOrigins.includes(origin)));
}

function originToMatchPattern(origin) {
  if (origin === "file://") return "file:///*";
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}

async function syncPageGuardNow() {
  const settings = await getSettings();
  await chrome.scripting.unregisterContentScripts({ ids: [PAGE_GUARD_ID] }).catch(() => {});
  if (!settings.enabled || !settings.dynamicGuard) return;

  const matches = settings.allSites
    ? ["<all_urls>"]
    : [...new Set(settings.protectedOrigins.map(originToMatchPattern).filter(Boolean))];
  if (!matches.length) return;

  await chrome.scripting.registerContentScripts([{
    id: PAGE_GUARD_ID,
    matches,
    js: ["page-guard.js"],
    runAt: "document_start",
    world: "MAIN",
    allFrames: true,
    persistAcrossSessions: true,
  }]);
}

function syncPageGuard() {
  pageGuardOperation = pageGuardOperation
    .catch(() => {})
    .then(syncPageGuardNow);
  return pageGuardOperation;
}

async function detach(tabId) {
  if (!attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // The target may already be closed or detached by Chrome.
  } finally {
    attachedTabs.delete(tabId);
  }
}

async function updateBadge(tabId, active, failed = false) {
  try {
    await chrome.action.setBadgeText({ tabId, text: failed ? "!" : active ? "ON" : "" });
    await chrome.action.setBadgeBackgroundColor({
      tabId,
      color: failed ? "#b42318" : "#16784a",
    });
  } catch {
    // Tab may disappear while async work is running.
  }
}

async function attachNow(tabId, url) {
  const settings = await getSettings();
  if (!isProtected(url, settings)) {
    await detach(tabId);
    await updateBadge(tabId, false);
    return false;
  }

  try {
    if (!attachedTabs.has(tabId)) {
      await chrome.debugger.attach({ tabId }, "1.3");
      attachedTabs.add(tabId);
    }
    await chrome.debugger.sendCommand({ tabId }, "Debugger.enable");
    await chrome.debugger.sendCommand(
      { tabId },
      "Debugger.setSkipAllPauses",
      { skip: true },
    );
    await updateBadge(tabId, true);
    return true;
  } catch (error) {
    attachedTabs.delete(tabId);
    await updateBadge(tabId, false, true);
    console.warn("无法启用断点绕过", error);
    return false;
  }
}

function attach(tabId, url) {
  const previous = tabOperations.get(tabId) || Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(() => attachNow(tabId, url));
  tabOperations.set(tabId, operation);
  operation.finally(() => {
    if (tabOperations.get(tabId) === operation) tabOperations.delete(tabId);
  });
  return operation;
}

async function refreshAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => attach(tab.id, tab.url)));
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get();
  await chrome.storage.local.set({ ...DEFAULT_SETTINGS, ...current });
  await syncPageGuard();
  await refreshAllTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  await syncPageGuard();
  await refreshAllTabs();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" || changeInfo.url) {
    attach(tabId, changeInfo.url || tab.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  tabOperations.delete(tabId);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await attach(tabId, tab.url);
  } catch {
    // Ignore tabs that close during activation.
  }
});

chrome.debugger.onDetach.addListener(({ tabId }) => {
  attachedTabs.delete(tabId);
  updateBadge(tabId, false);
});

chrome.debugger.onEvent.addListener((source, method) => {
  if (method === "Debugger.paused" && attachedTabs.has(source.tabId)) {
    chrome.debugger.sendCommand(source, "Debugger.resume").catch(() => {});
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.keys(changes).some((key) => key in DEFAULT_SETTINGS)) {
    syncPageGuard().catch((error) => console.warn("无法更新页面防护", error));
    refreshAllTabs();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_PROTECTION_STATE") {
    getSettings().then((settings) => {
      sendResponse({
        protected: isProtected(sender.url || sender.tab?.url, settings),
        dynamicGuard: settings.dynamicGuard,
      });
    });
    return true;
  }

  if (message.type === "REFRESH_TAB") {
    attach(message.tabId, message.url).then((attached) => sendResponse({ attached }));
    return true;
  }
});
