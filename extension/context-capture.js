/* Read rendered text only. No cookies, provider endpoints, or page JS state. */
(() => {
  if (globalThis.ClariftCapture) return;
  const EXCLUDE = 'script, style, noscript, template, nav, header, footer, aside, button, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [hidden], [aria-hidden="true"], [data-clarift-ui]';
  const MESSAGE_SELECTOR = '[data-message-author-role], [data-testid="user-message"], [data-testid="assistant-message"], [data-testid="human-message"], user-query, model-response, [data-role="user"], [data-role="assistant"], [data-author="user"], [data-author="assistant"], [data-testid="user-query"], [data-testid="answer"], .font-user-message, .font-claude-message, [data-content="user"], [data-content="ai"], [data-testid="message-content"]';
  const LIMIT = globalThis.ClariftContext.MAX_CAPTURE_CHARACTERS;

  function visible(element) {
    if (!element || element.closest('[hidden], [aria-hidden="true"], [data-clarift-ui]')) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && element.getClientRects().length > 0;
  }

  function renderedText(root, limit) {
    let text = '';
    let truncated = false;
    function walk(node) {
      if (truncated) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.textContent || '';
        if (text.length + value.length > limit) { text += value.slice(0, limit - text.length); truncated = true; }
        else text += value;
        return;
      }
      if (!(node instanceof Element) && !(node instanceof ShadowRoot)) return;
      if (node instanceof Element) {
        if (node.matches(EXCLUDE) || !visible(node)) return;
        if (node.tagName === 'BR') { text += '\n'; return; }
      }
      const children = node.shadowRoot ? node.shadowRoot.childNodes : node.childNodes;
      for (const child of children) walk(child);
      if (node instanceof Element && /^(P|DIV|SECTION|ARTICLE|LI|PRE|H[1-6]|TR|BLOCKQUOTE|USER-QUERY|MODEL-RESPONSE)$/.test(node.tagName)) text += '\n';
    }
    walk(root);
    return { text: text.slice(0, limit).replace(/\n{3,}/g, '\n\n').trim(), truncated: truncated || text.length > limit };
  }

  function queryAll(root, selector) {
    const result = [];
    const pending = [...root.children].reverse();
    while (pending.length) {
      const element = pending.pop();
      if (element.matches(selector)) result.push(element);
      pending.push(...[...(element.shadowRoot?.children || element.children)].reverse());
    }
    return result;
  }

  function role(node) {
    const label = [node.getAttribute('data-message-author-role'), node.getAttribute('data-role'), node.getAttribute('data-author'), node.getAttribute('data-testid'), node.getAttribute('data-content'), node.className, node.tagName].filter(Boolean).join(' ').toLowerCase();
    if (/user|human/.test(label)) return 'user';
    if (/assistant|model|answer|claude|\bai\b/.test(label)) return 'assistant';
    return 'unknown';
  }

  function messageNodes() {
    const scope = document.querySelector('main, [role="main"]') || document.body;
    if (!scope) return [];
    const candidates = queryAll(scope, MESSAGE_SELECTOR).filter(visible);
    const candidateSet = new Set(candidates);
    return candidates.filter((node) => {
      for (let parent = node.parentElement || node.getRootNode().host; parent; parent = parent.parentElement || parent.getRootNode().host) if (candidateSet.has(parent)) return false;
      return true;
    }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  }

  function messageId(node) {
    for (let parent = node; parent && parent !== document.body; parent = parent.parentElement || parent.getRootNode().host) {
      const id = parent.getAttribute('data-message-id') || parent.getAttribute('data-turn-id') || (/^(conversation-turn|message|turn)[-_:]/.test(parent.id) ? parent.id : '') || (/^conversation-turn-/.test(parent.getAttribute('data-testid') || '') ? parent.getAttribute('data-testid') : '');
      if (id) return `${id}:${role(node)}`;
    }
    return null;
  }

  function scrollContainer() {
    const nodes = messageNodes();
    let node = nodes[0];
    // Select the chat scroller, not a code block or composer textarea.
    for (node = node?.parentElement || node?.getRootNode().host; node; node = node.parentElement || node.getRootNode().host) {
      if (node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 2 && /auto|scroll|overlay/.test(getComputedStyle(node).overflowY)) return node;
    }
    return document.scrollingElement;
  }

  function capture(mode = 'chat') {
    const warnings = [];
    const messages = [];
    let remaining = LIMIT;
    let truncated = false;
    const scope = document.querySelector('main, [role="main"]') || document.body;
    if (!scope) throw new Error('This page has no readable content.');
    if (mode === 'page') {
      const read = renderedText(scope, remaining);
      if (read.text) messages.push({ role: 'page', text: read.text });
      truncated = read.truncated;
      warnings.push('Page-text capture: this is not a role-labelled chat transcript. Review for unrelated page content.');
    } else {
      const nodes = messageNodes();
      for (const node of nodes) {
        if (remaining <= 0 || messages.length >= 2000) { truncated = true; break; }
        const read = renderedText(node, remaining);
        if (read.text) { messages.push({ id: messageId(node), role: role(node), text: read.text }); remaining -= read.text.length; }
        truncated ||= read.truncated;
      }
      if (!messages.length) warnings.push('No recognized chat messages found. Try Page text, another frame, or paste an exported transcript.');
      warnings.push('Message recognition is best effort. Load earlier messages, wait for generation to finish, then recapture.');
    }
    if (truncated) warnings.push('Capture reached its 500,000-character or 2,000-message limit. Some text was omitted; import smaller sections if needed.');
    const url = new URL(location.href);
    return {
      version: 1, title: document.title || location.hostname, provider: location.hostname,
      url: `${url.origin}${url.pathname}`, pageKey: location.href,
      capturedAt: new Date().toISOString(), mode, messages, warnings, truncated
    };
  }
  globalThis.ClariftCapture = Object.freeze({ capture, scrollContainer });
})();
