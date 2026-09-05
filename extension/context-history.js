/* User-started history collection. DOM and scrolling only; no private provider APIs. */
(() => {
  if (globalThis.ClariftHistory) return;
  const core = globalThis.ClariftContext;
  let current = null;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function progress(id) {
    if (!current || current.id !== id) throw new Error('This history collection is no longer available.');
    return {
      id, status: current.status, phase: current.phase, steps: current.steps,
      count: current.capture.messages.length, characters: current.characters,
      ...(current.status !== 'running' ? { capture: current.capture, error: current.error } : {})
    };
  }
  function cancel(id) { if (current?.id === id) current.stop = 'cancelled'; }

  function start(options = {}) {
    if (current?.status === 'running') throw new Error('A history collection is already running in this frame.');
    const capture = globalThis.ClariftCapture.capture('chat');
    if (!capture.messages.length) throw new Error('No chat messages recognized. Use the whole-chat handoff request or import a transcript.');
    const job = current = {
      id: crypto.randomUUID(), pageKey: location.href, status: 'running', phase: 'older messages',
      capture, steps: 0, characters: capture.messages.reduce((total, message) => total + message.text.length, 0),
      stop: null, gaps: false, edited: false,
      // Bounds also apply to options used by synthetic tests.
      waitMs: Math.max(30, Math.min(2000, options.waitMs ?? 450)),
      maxMs: Math.max(500, Math.min(180000, options.maxMs ?? 180000)),
      maxSteps: Math.max(1, Math.min(600, options.maxSteps ?? 400)),
      settlePasses: Math.max(2, Math.min(12, options.settlePasses ?? 6))
    };
    collect(job).catch((error) => {
      job.status = 'error'; job.error = error.message;
      job.capture.warnings.push('History collection failed; this is only a partial capture.');
    });
    return progress(job.id);
  }

  async function collect(job) {
    const scroller = globalThis.ClariftCapture.scrollContainer();
    if (!scroller) throw new Error('No readable chat scroll area found.');
    const original = { top: scroller.scrollTop, left: scroller.scrollLeft };
    const originalBehavior = scroller.style.getPropertyValue('scroll-behavior');
    const originalPriority = scroller.style.getPropertyPriority('scroll-behavior');
    const started = performance.now();
    const banner = document.createElement('div');
    banner.className = 'clarift-extension-status'; banner.setAttribute('data-clarift-ui', '');
    const label = document.createElement('span');
    const stop = document.createElement('button'); stop.type = 'button'; stop.textContent = 'Stop collection';
    stop.style.cssText = 'display:block;margin-top:8px;padding:6px 10px;cursor:pointer';
    stop.addEventListener('click', () => { job.stop = 'cancelled'; });
    banner.append(label, stop); document.body.append(banner);
    const interrupt = () => { job.stop = 'cancelled'; };
    const navigation = () => { job.stop = 'navigation'; };
    window.addEventListener('wheel', interrupt, { passive: true });
    window.addEventListener('touchmove', interrupt, { passive: true });
    window.addEventListener('pagehide', navigation);
    window.navigation?.addEventListener('currententrychange', navigation);
    scroller.style.setProperty('scroll-behavior', 'auto', 'important');

    const check = () => {
      if (location.href !== job.pageKey) job.stop = 'navigation';
      if (!scroller.isConnected) job.stop = 'container';
      if (!job.stop && (performance.now() - started >= job.maxMs || job.steps >= job.maxSteps)) job.stop = 'limit';
      return !job.stop;
    };
    const sample = (direction) => {
      const snapshot = globalThis.ClariftCapture.capture('chat');
      if (snapshot.pageKey !== job.pageKey) { job.stop = 'navigation'; return; }
      const merged = core.mergeWindows(job.capture.messages, snapshot.messages, direction);
      job.gaps ||= merged.gap;
      const before = new Map(job.capture.messages.filter((message) => message.id).map((message) => [message.id, message.text]));
      job.edited ||= snapshot.messages.some((message) => message.id && before.has(message.id) && before.get(message.id) !== message.text);
      let remaining = core.MAX_CAPTURE_CHARACTERS;
      const bounded = [];
      for (const message of merged.messages) {
        if (remaining <= 0 || bounded.length >= 2000) { job.stop = 'size'; break; }
        bounded.push({ ...message, text: message.text.slice(0, remaining) });
        if (message.text.length > remaining) job.stop = 'size';
        remaining -= bounded[bounded.length - 1].text.length;
      }
      job.capture.messages = bounded;
      job.characters = core.MAX_CAPTURE_CHARACTERS - remaining;
      if (snapshot.truncated) job.stop = 'size';
      label.textContent = `Clarift is collecting ${job.phase}: ${bounded.length} messages. Scrolling returns to your starting position when finished.`;
    };
    const edge = (direction) => {
      const reverse = getComputedStyle(scroller).flexDirection === 'column-reverse';
      const extent = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      return direction === 'up' ? (reverse ? -extent : 0) : (reverse ? 0 : extent);
    };
    async function walk(direction) {
      let stable = 0;
      while (check()) {
        sample(direction);
        if (!check()) break;
        const previousHeight = scroller.scrollHeight;
        const previousCount = job.capture.messages.length;
        const previousCharacters = job.characters;
        const target = edge(direction);
        const atEdge = Math.abs(scroller.scrollTop - target) < 2;
        const step = Math.max(80, scroller.clientHeight * 0.6);
        scroller.scrollTop = atEdge ? target : direction === 'up' ? Math.max(target, scroller.scrollTop - step) : Math.min(target, scroller.scrollTop + step);
        job.steps += 1;
        await pause(job.waitMs);
        if (!check()) break;
        sample(direction);
        const unchanged = scroller.scrollHeight === previousHeight && job.capture.messages.length === previousCount && job.characters === previousCharacters;
        if (atEdge && Math.abs(scroller.scrollTop - edge(direction)) < 2 && unchanged) stable += 1;
        else stable = 0;
        if (stable >= job.settlePasses) return;
      }
    }
    try {
      await walk('up');
      if (check()) {
        job.phase = 'newer messages';
        // A lazy prepend can jump from the old first turn to a new first turn.
        // The downward sweep fills that gap using stable message anchors.
        job.gaps = false;
        await walk('down');
      }
      if (job.stop === 'navigation') {
        job.capture.messages = []; job.characters = 0;
        job.error = 'The conversation changed during collection. Capture it again; histories were not mixed.';
        job.status = 'error';
      } else {
        job.status = job.stop ? 'partial' : 'complete';
        job.capture.capturedAt = new Date().toISOString();
        job.capture.warnings = job.capture.warnings.filter((warning) => !warning.startsWith('Message recognition'));
        job.capture.warnings.push(`History scan ${job.stop ? `stopped (${job.stop})` : 'reached stable scroll boundaries'} after ${job.steps} steps. Earlier history that the site did not load may still be missing.`);
        if (job.gaps) job.capture.warnings.push('Some scroll windows did not overlap. Gaps or duplicate segments may remain; review the transcript.');
        if (job.edited) job.capture.warnings.push('Messages changed during collection. Wait for generation to finish and review the captured versions.');
        if (job.capture.messages.some((message) => !message.id)) job.capture.warnings.push('Some messages lacked stable IDs. Overlapping sequences were matched by role and text; identical repeated windows can be ambiguous.');
        if (job.stop === 'size') { job.capture.truncated = true; job.capture.warnings.push('Reached the 500,000-character / 2,000-message capture limit.'); }
        job.capture.history = { steps: job.steps, status: job.status, reason: job.stop, gaps: job.gaps };
      }
    } finally {
      window.removeEventListener('wheel', interrupt);
      window.removeEventListener('touchmove', interrupt);
      window.removeEventListener('pagehide', navigation);
      window.navigation?.removeEventListener('currententrychange', navigation);
      // Do not move the newly opened conversation if navigation interrupted us.
      if (scroller.isConnected && location.href === job.pageKey && job.stop !== 'navigation') {
        scroller.scrollTop = original.top; scroller.scrollLeft = original.left;
      }
      if (originalBehavior) scroller.style.setProperty('scroll-behavior', originalBehavior, originalPriority);
      else scroller.style.removeProperty('scroll-behavior');
      banner.remove();
    }
  }
  globalThis.ClariftHistory = Object.freeze({ start, progress, cancel });
})();
