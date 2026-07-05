// Keyboard shortcut (Alt+Shift+F) → fill active tab with the active profile.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "fill-form") return;
  const { profiles = [], activeProfileId } = await chrome.storage.local.get(["profiles", "activeProfileId"]);
  const profile = profiles.find(p => p.id === activeProfileId) || profiles[0];
  if (!profile) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  // Send to every frame — signup forms often live inside iframes.
  try {
    const frames = await chrome.webNavigation?.getAllFrames?.({ tabId: tab.id }) || [];
    if (frames.length) {
      for (const f of frames) {
        chrome.tabs.sendMessage(tab.id, { action: "smartfill", profile }, { frameId: f.frameId }, () => chrome.runtime.lastError);
      }
    } else {
      chrome.tabs.sendMessage(tab.id, { action: "smartfill", profile }, () => chrome.runtime.lastError);
    }
  } catch {
    chrome.tabs.sendMessage(tab.id, { action: "smartfill", profile }, () => chrome.runtime.lastError);
  }
});
