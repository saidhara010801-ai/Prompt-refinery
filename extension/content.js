(() => {
  if (globalThis.__clariftPromptRefineryInjected) return;
  globalThis.__clariftPromptRefineryInjected = true;

  let activeEditor = null;
  let actionButton = null;
  let statusBox = null;
  let statusTimer = null;
  const RESPONSE_TIMEOUT_MS = 115000;

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
    return element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLInputElement && ['text', 'search'].includes(element.type)) ||
      element?.getAttribute?.('contenteditable') === 'true' ||
      element?.getAttribute?.('role') === 'textbox';
  }

  function findEditor(target) {
    return target?.closest?.('textarea, input[type="text"], input[type="search"], [contenteditable="true"], [role="textbox"]') || null;
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
      editor.setRangeText(text, start === end ? 0 : start, start === end ? editor.value.length : end, 'end');
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
    if (!activeEditor || !document.contains(activeEditor)) return;
    if (actionButton?.disabled) return;
    const prompt = editorText(activeEditor).trim();
    if (!prompt) {
      showStatus('Enter a prompt before refining.', true);
      return;
    }

    actionButton.disabled = true;
    actionButton.textContent = 'Refining...';
    try {
      const response = await withResponseTimeout(
        chrome.runtime.sendMessage({ type: 'clarift-refine', prompt })
      );
      if (!response?.ok) throw new Error(response?.error || 'Clarift request failed.');
      replaceEditorText(activeEditor, response.refinedPrompt);
      showStatus('Prompt refined.');
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
    actionButton.textContent = 'Refine with Clarift';
    actionButton.hidden = true;
    actionButton.addEventListener('mousedown', (event) => event.preventDefault());
    actionButton.addEventListener('click', refineActiveEditor);
    document.body.appendChild(actionButton);
  }

  document.addEventListener('focusin', (event) => {
    const candidate = findEditor(event.target);
    if (!isEditor(candidate)) return;
    activeEditor = candidate;
    ensureButton();
    actionButton.hidden = false;
  });

  document.addEventListener('focusout', () => window.setTimeout(() => {
    if (actionButton && !isEditor(findEditor(document.activeElement))) actionButton.hidden = true;
  }, 150));

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'clarift-ping') return false;
    sendResponse({ ready: true });
    return false;
  });
})();
