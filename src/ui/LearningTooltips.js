/**
 * LearningTooltips.js
 * Shared Interactive Learning System across all 4 Studio Simulator Apps:
 *  1. Floating Pop-Up Learning Tips (hover or click '?' badges & control labels)
 *  2. Foldable / Collapsible Educational Drawers (<details class="edu-foldable">)
 *  3. Cross-App Audio Coordination with the Master Web App Hub (postMessage pause/status)
 */

const EDU_STYLES = `
/* ============================================================================
   INTERACTIVE LEARNING TOOLTIPS, POPOVERS & FOLDABLE DRAWERS
   ============================================================================ */
.edu-tip-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(0, 245, 212, 0.14);
  border: 1px solid rgba(0, 245, 212, 0.45);
  color: #00f5d4;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  margin-left: 5px;
  cursor: pointer;
  vertical-align: middle;
  transition: all 0.15s ease;
  user-select: none;
  flex-shrink: 0;
}

.edu-tip-badge:hover,
.edu-tip-badge.edu-active {
  background: #00f5d4;
  color: #090b0e;
  box-shadow: 0 0 10px rgba(0, 245, 212, 0.5);
  transform: scale(1.08);
}

.edu-tip-badge.edu-amber {
  background: rgba(255, 183, 77, 0.15);
  border-color: rgba(255, 183, 77, 0.5);
  color: #ffb74d;
}

.edu-tip-badge.edu-amber:hover,
.edu-tip-badge.edu-amber.edu-active {
  background: #ffb74d;
  color: #090b0e;
  box-shadow: 0 0 10px rgba(255, 183, 77, 0.5);
}

/* Foldable Educational Text Box (<details class="edu-foldable">) */
details.edu-foldable {
  background: rgba(14, 17, 22, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-left: 3px solid #ffb74d;
  border-radius: 6px;
  overflow: hidden;
  transition: border-color 0.15s ease, background 0.15s ease;
  margin-top: 4px;
}

details.edu-foldable.edu-cyan {
  border-left-color: #00f5d4;
}

details.edu-foldable[open] {
  background: rgba(16, 20, 27, 0.94);
  border-color: rgba(255, 183, 77, 0.32);
}

details.edu-foldable.edu-cyan[open] {
  border-color: rgba(0, 245, 212, 0.35);
}

details.edu-foldable > summary {
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
  color: #e8edf2;
  user-select: none;
}

details.edu-foldable > summary::-webkit-details-marker {
  display: none;
}

details.edu-foldable > summary:hover {
  background: rgba(255, 255, 255, 0.04);
}

.edu-foldable-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.edu-foldable-tag {
  font-size: 9.5px;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(255, 183, 77, 0.15);
  color: #ffb74d;
  border: 1px solid rgba(255, 183, 77, 0.35);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

details.edu-foldable.edu-cyan .edu-foldable-tag {
  background: rgba(0, 245, 212, 0.14);
  color: #00f5d4;
  border-color: rgba(0, 245, 212, 0.35);
}

.edu-foldable-chevron {
  font-size: 10px;
  color: #93a1b0;
  transition: transform 0.18s ease;
}

details.edu-foldable[open] .edu-foldable-chevron {
  transform: rotate(180deg);
  color: #ffb74d;
}

details.edu-foldable.edu-cyan[open] .edu-foldable-chevron {
  color: #00f5d4;
}

.edu-foldable-body {
  padding: 7px 11px 9px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
  font-size: 11.5px;
  line-height: 1.48;
  color: #cbd5e1;
}

.edu-foldable-body strong {
  color: #ffffff;
}

.edu-foldable-try {
  margin-top: 5px;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(0, 245, 212, 0.08);
  border: 1px solid rgba(0, 245, 212, 0.22);
  color: #a5f3fc;
  font-size: 11px;
}

/* Floating Pop-Up Tooltip Card */
.edu-popover-card {
  position: fixed;
  z-index: 99999;
  width: 310px;
  max-width: calc(100vw - 24px);
  background: rgba(14, 17, 23, 0.97);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(0, 245, 212, 0.45);
  border-radius: 8px;
  padding: 10px 12px;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(0, 0, 0, 0.6);
  color: #e8edf2;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
  font-size: 12px;
  line-height: 1.45;
  pointer-events: auto;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.14s ease, transform 0.14s ease;
}

.edu-popover-card.edu-visible {
  opacity: 1;
  transform: translateY(0);
}

.edu-popover-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 6px;
  margin-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.edu-popover-title {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  font-weight: 700;
  color: #00f5d4;
  letter-spacing: 0.02em;
}

.edu-popover-close {
  appearance: none;
  background: transparent;
  border: none;
  color: #93a1b0;
  font-size: 13px;
  cursor: pointer;
  padding: 0 3px;
  line-height: 1;
}

.edu-popover-close:hover {
  color: #fff;
}

.edu-popover-body {
  color: #d1d9e2;
  font-size: 11.5px;
}

.edu-popover-try {
  margin-top: 7px;
  padding: 5px 8px;
  border-radius: 5px;
  background: rgba(255, 183, 77, 0.11);
  border-left: 2px solid #ffb74d;
  color: #fde68a;
  font-size: 11px;
}

.edu-popover-try strong {
  color: #ffb74d;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  text-transform: uppercase;
}
`;

let popoverEl = null;
let activeTriggerEl = null;
let hideTimer = null;

function ensurePopoverDOM() {
  if (!document.getElementById('edu-learning-styles')) {
    const style = document.createElement('style');
    style.id = 'edu-learning-styles';
    style.textContent = EDU_STYLES;
    document.head.appendChild(style);
  }

  if (!popoverEl) {
    popoverEl = document.createElement('div');
    popoverEl.className = 'edu-popover-card';
    popoverEl.setAttribute('role', 'tooltip');
    popoverEl.style.display = 'none';
    popoverEl.innerHTML = `
      <div class="edu-popover-head">
        <span class="edu-popover-title" data-edu-part="title">STUDIO CONCEPT</span>
        <button type="button" class="edu-popover-close" aria-label="Close tip">✕</button>
      </div>
      <div class="edu-popover-body" data-edu-part="body"></div>
      <div class="edu-popover-try" data-edu-part="try" style="display:none;"></div>
    `;
    document.body.appendChild(popoverEl);

    popoverEl.querySelector('.edu-popover-close').addEventListener('click', () => {
      hidePopover(true);
    });

    popoverEl.addEventListener('mouseenter', () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    });

    popoverEl.addEventListener('mouseleave', () => {
      scheduleHide();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hidePopover(true);
    });
  }
}

function showPopoverFor(triggerEl) {
  ensurePopoverDOM();
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  if (activeTriggerEl && activeTriggerEl !== triggerEl) {
    activeTriggerEl.classList.remove('edu-active');
  }
  activeTriggerEl = triggerEl;
  triggerEl.classList.add('edu-active');

  const title = triggerEl.getAttribute('data-edu-title') || 'Acoustic & Studio Concept';
  const body = triggerEl.getAttribute('data-edu-tip') || '';
  const tryText = triggerEl.getAttribute('data-edu-try') || '';

  popoverEl.querySelector('[data-edu-part="title"]').textContent = title;
  popoverEl.querySelector('[data-edu-part="body"]').innerHTML = body;

  const tryEl = popoverEl.querySelector('[data-edu-part="try"]');
  if (tryText) {
    tryEl.style.display = 'block';
    tryEl.innerHTML = `<strong>🎧 Try This:</strong> ${tryText}`;
  } else {
    tryEl.style.display = 'none';
  }

  popoverEl.style.display = 'block';

  // Compute viewport-safe position
  const rect = triggerEl.getBoundingClientRect();
  const popRect = popoverEl.getBoundingClientRect();
  const pad = 10;

  let top = rect.bottom + 8;
  if (top + popRect.height > window.innerHeight - pad) {
    top = Math.max(pad, rect.top - popRect.height - 8);
  }

  let left = rect.left + rect.width / 2 - popRect.width / 2;
  left = Math.max(pad, Math.min(window.innerWidth - popRect.width - pad, left));

  popoverEl.style.top = `${Math.round(top)}px`;
  popoverEl.style.left = `${Math.round(left)}px`;

  requestAnimationFrame(() => {
    if (popoverEl) popoverEl.classList.add('edu-visible');
  });
}

function scheduleHide() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hidePopover(false);
  }, 220);
}

export function hidePopover(immediate = false) {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (activeTriggerEl) {
    activeTriggerEl.classList.remove('edu-active');
    activeTriggerEl = null;
  }
  if (!popoverEl) return;
  popoverEl.classList.remove('edu-visible');
  if (immediate) {
    popoverEl.style.display = 'none';
  } else {
    setTimeout(() => {
      if (popoverEl && !popoverEl.classList.contains('edu-visible')) {
        popoverEl.style.display = 'none';
      }
    }, 150);
  }
}

/**
 * Attaches a '?' pop-up badge onto a target element (or selector) with educational content.
 */
export function attachTipBadge(targetOrSelector, { title, tip, tryIt, variant = 'cyan' }, root = document) {
  ensurePopoverDOM();
  const el =
    typeof targetOrSelector === 'string'
      ? root.querySelector(targetOrSelector)
      : targetOrSelector;
  if (!el) return null;

  // Avoid duplicate badges
  if (el.querySelector(':scope > .edu-tip-badge')) return null;

  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = `edu-tip-badge ${variant === 'amber' ? 'edu-amber' : ''}`;
  badge.textContent = '?';
  badge.setAttribute('aria-label', `Learn about ${title}`);
  badge.setAttribute('data-edu-title', title);
  badge.setAttribute('data-edu-tip', tip);
  if (tryIt) badge.setAttribute('data-edu-try', tryIt);

  bindTipInteractions(badge);
  el.appendChild(badge);
  return badge;
}

export function bindTipInteractions(el) {
  ensurePopoverDOM();
  if (el.dataset.eduBound === 'true') return;
  el.dataset.eduBound = 'true';

  el.addEventListener('mouseenter', () => {
    showPopoverFor(el);
  });
  el.addEventListener('mouseleave', () => {
    scheduleHide();
  });
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (activeTriggerEl === el && popoverEl && popoverEl.style.display === 'block') {
      hidePopover(true);
    } else {
      showPopoverFor(el);
    }
  });
}

/**
 * Scans a container (or document) for any element with [data-edu-tip] and binds pop-up events.
 */
export function initDeclarativeTips(root = document) {
  ensurePopoverDOM();
  root.querySelectorAll('[data-edu-tip]').forEach((el) => {
    bindTipInteractions(el);
  });
}

/**
 * Registers a cross-window listener so the Master Web App Hub can cleanly pause/suspend
 * audio in inactive tabs when switching between the 4 studio simulators.
 */
export function registerHubAudioCoordinator(onPauseAudioCallback) {
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'STUDIO_HUB_SUSPEND_AUDIO') {
      try {
        onPauseAudioCallback();
      } catch (_) {}
    }
  });
}

/**
 * Notifies the Master Web App Hub whenever this app's audio starts or stops playing.
 */
export function notifyHubAudioState(appId, isPlaying) {
  if (window.parent && window.parent !== window) {
    try {
      window.parent.postMessage(
        {
          type: 'STUDIO_APP_AUDIO_STATE',
          appId,
          isPlaying: Boolean(isPlaying)
        },
        '*'
      );
    } catch (_) {}
  }
}
