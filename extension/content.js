(() => {
  if (globalThis.__clariftPromptRefineryInjected) return;
  globalThis.__clariftPromptRefineryInjected = true;

  let activeEditor = null;
  let actionButton = null;
  let statusBox = null;
  let statusTimer = null;
  let reviewedContext = null;
  const RESPONSE_TIMEOUT_MS = 50000;

  function withResponseTimeout(promise) {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('Clarift took too long to respond. Please try again.')),
        RESPONSE_TIMEOUT_MS
      );
      promise.then(resolve, reject).finally(() => window.clearTimeout(timeout));
    });
  }

  function isEditor(element) {
    if (!element || element.closest?.('[data-clarift-ui], [inert], [aria-disabled="true"], [aria-readonly="true"]')) return false;
    if (element.disabled || element.readOnly || element.matches?.(':disabled')) return false;
    if (element instanceof HTMLInputElement && !['text', 'search'].includes(element.type)) return false;
    return element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLInputElement && ['text', 'search'].includes(element.type)) ||
      element.isContentEditable;
  }

  function findEditor(target) {
    const candidate = target?.closest?.('textarea, input, [contenteditable]');
    if (!isEditor(candidate)) return null;
    let root = candidate;
    while (root.parentElement?.isContentEditable) root = root.parentElement;
    return isEditor(root) ? root : null;
  }

  function selectionBelongsTo(editor) {
    const selection = window.getSelection();
    return Boolean(selection?.anchorNode && selection?.focusNode && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode));
  }

  function editorText(editor) {
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const start = editor.selectionStart ?? 0;
      const end = editor.selectionEnd ?? editor.value.length;
      return start !== end ? editor.value.slice(start, end) : editor.value;
    }

    const selection = window.getSelection();
    return selectionBelongsTo(editor) && !selection.isCollapsed
      ? selection.toString()
      : editor.innerText || editor.textContent || '';
  }

  function replaceEditorText(editor, text) {
    editor.focus();
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const start = editor.selectionStart ?? 0;
      const end = editor.selectionEnd ?? editor.value.length;
      const next = start === end ? text : editor.value.slice(0, start) + text + editor.value.slice(end);
      // Use the native setter so controlled React inputs observe the input event.
      const prototype = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(editor, next);
      const cursor = start === end ? text.length : start + text.length;
      editor.setSelectionRange(cursor, cursor);
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      return;
    }

    const selection = window.getSelection();
    if (!selection) return;
    if (!selectionBelongsTo(editor) || selection.isCollapsed) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    if (!document.execCommand('insertText', false, text)) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }

  function showStatus(message, error = false) {
    if (!statusBox) {
      statusBox = document.createElement('div');
      statusBox.className = 'clarift-extension-status';
      statusBox.setAttribute('data-clarift-ui', '');
      statusBox.setAttribute('role', 'status');
      document.body.appendChild(statusBox);
    }
    window.clearTimeout(statusTimer);
    statusBox.textContent = message;
    statusBox.dataset.error = error ? 'true' : 'false';
    statusBox.hidden = false;
    statusTimer = window.setTimeout(() => { statusBox.hidden = true; }, 5000);
  }

  async function refineActiveEditor() {
    if (!activeEditor?.isConnected || !isEditor(activeEditor)) return;
    if (actionButton?.disabled) return;
    const editor = activeEditor;
    const original = editor.value ?? editor.innerText;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selection = window.getSelection();
    const range = selectionBelongsTo(editor) && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    const pageKey = location.href;
    const prompt = editorText(editor).trim();
    if (!prompt) {
      showStatus('Enter a prompt before refining.', true);
      return;
    }

    actionButton.disabled = true;
    actionButton.textContent = 'Refining...';
    try {
      const response = await withResponseTimeout(
        chrome.runtime.sendMessage({
          type: 'clarift-refine', prompt,
          ...(reviewedContext?.pageKey === pageKey ? { context: { text: reviewedContext.text, consent: true } } : {})
        })
      );
      if (!response?.ok) throw new Error(response?.error || 'Clarift request failed.');
      if (!editor.isConnected || !isEditor(editor) || location.href !== pageKey || (editor.value ?? editor.innerText) !== original) {
        throw new Error('The editor changed while refining. Your current text was preserved; refine again when ready.');
      }
      if (typeof start === 'number') editor.setSelectionRange(start, end);
      else if (range && selection) { selection.removeAllRanges(); selection.addRange(range); }
      replaceEditorText(editor, response.refinedPrompt);
      if (response.qualityTier === 'fallback') {
        const basic = response.basicMode || {};
        let message = 'Prompt refined in Basic mode.';
        if (basic.reason === 'request_size') message = 'Prompt refined in Basic mode because it exceeds the generative limit.';
        else if (basic.reason === 'monthly_limit' && basic.resetAt) message = `Prompt refined in Basic mode. Generative access resets ${new Date(basic.resetAt).toLocaleDateString()}.`;
        else if (basic.reason === 'daily_limit' && basic.resetAt) message = `Prompt refined in Basic mode. Generative access resets at ${new Date(basic.resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
        else if (basic.reason === 'budget_limit') message = 'Prompt refined in Basic mode. Generative access resets tomorrow.';
        showStatus(message);
      } else {
        showStatus('Prompt refined.');
      }
    } catch (error) {
      showStatus(error.message || 'Clarift request failed.', true);
    } finally {
      if (actionButton) {
        actionButton.disabled = false;
        actionButton.textContent = 'Refine with Clarift';
      }
    }
  }

  function ensureButton() {
    if (actionButton) return;
    actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.className = 'clarift-extension-action';
    actionButton.setAttribute('data-clarift-ui', '');
    actionButton.textContent = 'Refine with Clarift';
    actionButton.hidden = true;
    actionButton.addEventListener('mousedown', (event) => event.preventDefault());
    actionButton.addEventListener('click', refineActiveEditor);
    document.body.appendChild(actionButton);
  }

  document.addEventListener('focusin', (event) => {
    const candidate = event.composedPath().map(findEditor).find(Boolean);
    if (!isEditor(candidate)) return;
    activeEditor = candidate;
    ensureButton();
    actionButton.hidden = false;
  });

  document.addEventListener('focusout', () => window.setTimeout(() => {
    let focused = document.activeElement;
    while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    if (actionButton && !isEditor(findEditor(focused)) && focused !== actionButton) actionButton.hidden = true;
  }, 150));

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'clarift-discover') {
      chrome.runtime.sendMessage({ type: 'clarift-discovered', requestId: message.requestId, pageKey: location.href, title: document.title }).catch(() => {});
      sendResponse({ ready: true }); return false;
    }
    if (['clarift-capture', 'clarift-history-start', 'clarift-history-progress', 'clarift-history-cancel'].includes(message?.type)) {
      try {
        if (message.pageKey !== location.href) throw new Error('The conversation changed. Reopen the context tool from the source tab.');
        let result;
        if (message.type === 'clarift-capture') result = { capture: globalThis.ClariftCapture.capture(message.mode) };
        if (message.type === 'clarift-history-start') result = globalThis.ClariftHistory.start();
        if (message.type === 'clarift-history-progress') result = globalThis.ClariftHistory.progress(message.id);
        if (message.type === 'clarift-history-cancel') { globalThis.ClariftHistory.cancel(message.id); result = {}; }
        sendResponse({ ok: true, ...result });
      } catch (error) { sendResponse({ ok: false, error: error.message }); }
      return false;
    }
    if (message?.type === 'clarift-set-context') {
      if (message.pageKey !== location.href) { sendResponse({ ok: false, error: 'The source conversation changed. Capture it again.' }); return false; }
      const text = message.text;
      if (typeof text !== 'string' || text.length > globalThis.ClariftContext.MAX_CONTEXT_CHARACTERS) {
        sendResponse({ ok: false, error: 'Reviewed context must be at most 5,600 characters.' }); return false;
      }
      reviewedContext = text.trim() ? { text, pageKey: location.href } : null;
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type !== 'clarift-ping') return false;
    sendResponse({ ready: true, hasContext: Boolean(reviewedContext?.pageKey === location.href) });
    return false;
  });
  // A context attachment belongs to one conversation, including SPA navigations.
  const clearContext = () => { reviewedContext = null; };
  window.addEventListener('popstate', clearContext);
  window.addEventListener('hashchange', clearContext);
  window.addEventListener('pagehide', clearContext);
  window.navigation?.addEventListener('currententrychange', clearContext);
  // An already-focused editor should work immediately after activation.
  let initial = document.activeElement;
  while (initial?.shadowRoot?.activeElement) initial = initial.shadowRoot.activeElement;
  if (findEditor(initial)) {
    activeEditor = findEditor(initial);
    ensureButton();
    actionButton.hidden = false;
  }
})();
