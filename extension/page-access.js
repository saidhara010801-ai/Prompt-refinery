(() => {
  const scripts = ['context-core.js', 'context-capture.js', 'context-history.js', 'content.js'];
  async function discover(tabId) {
    const response = await chrome.runtime.sendMessage({ type: 'clarift-discover-tab', tabId });
    return response?.frames || [];
  }
  async function enable(tabId) {
    let failure = null;
    let topOnly = false;
    try {
      await chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, files: ['content.css'] });
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: scripts });
    } catch (error) {
      topOnly = true;
      try {
        await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
        await chrome.scripting.executeScript({ target: { tabId }, files: scripts });
      } catch (error) { failure = error; }
    }
    // Existing permitted child-frame scripts may be available even if the browser
    // blocks injection into a managed top-level/new-tab surface.
    const frames = await discover(tabId);
    if (!frames.length) throw failure || new Error('No page tools responded. Reload the source page and try again.');
    return { topOnly, frames };
  }
  globalThis.ClariftPageAccess = Object.freeze({ enable, discover });
})();
