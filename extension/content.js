let activeEditor = null;
let actionButton = null;
let statusBox = null;

function isEditor(element) {
  return element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement && ['text', 'search'].includes(element.type)) ||
    element?.getAttribute?.('contenteditable') === 'true';
}

function editorText(editor) {
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    const start = editor.selectionStart ?? 0;
    const end = editor.selectionEnd ?? editor.value.length;
    return start !== end ? editor.value.slice(start, end) : editor.value;
  }
  return window.getSelection()?.toString().trim() || editor.innerText || editor.textContent || '';
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
  editor.textContent = text;
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}

function showStatus(message, error = false) {
  if (!statusBox) {
    statusBox = document.createElement('div');
    statusBox.className = 'clarift-extension-status';
    document.body.appendChild(statusBox);
  }
  statusBox.textContent = message;
  statusBox.dataset.error = error ? 'true' : 'false';
  statusBox.hidden = false;
  window.setTimeout(() => { statusBox.hidden = true; }, 5000);
}

async function refineActiveEditor() {
  if (!activeEditor || !document.contains(activeEditor)) return;
  const prompt = editorText(activeEditor).trim();
  if (!prompt) { showStatus('Enter a prompt before refining.', true); return; }
  actionButton.disabled = true;
  actionButton.textContent = 'Refining...';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'clarift-refine', prompt });
    if (!response?.ok) throw new Error(response?.error || 'Clarift request failed.');
    replaceEditorText(activeEditor, response.refinedPrompt);
    showStatus('Prompt refined.');
  } catch (error) {
    showStatus(error.message || 'Clarift request failed.', true);
  } finally {
    actionButton.disabled = false;
    actionButton.textContent = 'Refine with Clarift';
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
  const candidate = event.target?.closest?.('textarea, input[type="text"], input[type="search"], [contenteditable="true"]');
  if (!isEditor(candidate)) return;
  activeEditor = candidate;
  ensureButton();
  actionButton.hidden = false;
});

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'r' && activeEditor) {
    event.preventDefault();
    refineActiveEditor();
  }
});

document.addEventListener('focusout', () => window.setTimeout(() => {
  if (actionButton && !isEditor(document.activeElement)) actionButton.hidden = true;
}, 150));
