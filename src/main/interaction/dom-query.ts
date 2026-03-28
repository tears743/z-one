/**
 * DOM Query — Compact DOM Serialization
 *
 * Generates JavaScript code to inject into the renderer process
 * for extracting DOM structure in a compact, token-efficient format.
 *
 * Four query modes:
 * - skeleton: Interactive elements + text nodes + minimal ancestors
 * - full: All visible elements
 * - interactive: Flat list of actionable elements (buttons, inputs, links, etc.)
 * - scoped: Subtree under a specific CSS selector
 */

type DomQueryMode = 'skeleton' | 'full' | 'interactive' | 'scoped';

/**
 * Generate a JS script string to inject into webContents.executeJavaScript().
 * Returns the serialized DOM structure as JSON.
 */
export function generateDomQueryScript(mode: DomQueryMode, selector?: string): string {
  switch (mode) {
    case 'interactive':
      return INTERACTIVE_QUERY_SCRIPT;
    case 'skeleton':
      return SKELETON_QUERY_SCRIPT;
    case 'full':
      return FULL_QUERY_SCRIPT;
    case 'scoped':
      if (!selector) return INTERACTIVE_QUERY_SCRIPT;
      return SCOPED_QUERY_SCRIPT.replace('__SELECTOR__', selector.replace(/'/g, "\\'"));
    default:
      return INTERACTIVE_QUERY_SCRIPT;
  }
}

// ─── Interactive Mode ───────────────────────────────────────
// Flat list of actionable elements with computed selectors
const INTERACTIVE_QUERY_SCRIPT = `
(function() {
  const interactive = 'a,button,input,textarea,select,[role="button"],[role="link"],[role="menuitem"],[tabindex],[contenteditable="true"]';
  const els = document.querySelectorAll(interactive);
  const items = [];
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const sel = getSelector(el);
    items.push({
      idx: i,
      tag: el.tagName.toLowerCase(),
      sel: sel,
      text: (el.textContent || '').trim().slice(0, 60),
      type: el.getAttribute('type') || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      role: el.getAttribute('role') || undefined,
      value: (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? el.value?.slice(0, 30) : undefined,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    });
  }
  return { mode: 'interactive', count: items.length, items: items };

  function getSelector(el) {
    if (el.id) return '#' + el.id;
    const classes = Array.from(el.classList).filter(c => !c.startsWith('_'));
    if (classes.length > 0) {
      const sel = '.' + classes.join('.');
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    // Fallback: parent > tag:nth-child(n)
    const parent = el.parentElement;
    if (!parent) return el.tagName.toLowerCase();
    const siblings = Array.from(parent.children);
    const idx = siblings.indexOf(el) + 1;
    const parentSel = getSelector(parent);
    return parentSel + ' > ' + el.tagName.toLowerCase() + ':nth-child(' + idx + ')';
  }
})()
`;

// ─── Skeleton Mode ──────────────────────────────────────────
// Interactive elements + visible text nodes + minimal structure
const SKELETON_QUERY_SCRIPT = `
(function() {
  const items = [];
  function walk(node, depth) {
    if (depth > 10) return;
    if (node.nodeType === 3) {
      const text = node.textContent.trim();
      if (text.length > 0 && text.length < 200) {
        items.push({ type: 'text', content: text.slice(0, 100), depth: depth });
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node;
    const tag = el.tagName.toLowerCase();
    if (['script','style','noscript','svg','path'].includes(tag)) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const isInteractive = el.matches('a,button,input,textarea,select,[role="button"],[tabindex]');
    if (isInteractive) {
      items.push({
        type: 'element',
        tag: tag,
        sel: getSelector(el),
        text: (el.textContent || '').trim().slice(0, 60),
        interactive: true,
        depth: depth,
      });
      return; // Don't recurse into interactive elements
    }

    for (const child of el.childNodes) {
      walk(child, depth + 1);
    }
  }

  function getSelector(el) {
    if (el.id) return '#' + el.id;
    const classes = Array.from(el.classList).filter(c => !c.startsWith('_'));
    if (classes.length > 0) {
      const sel = '.' + classes.join('.');
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    const parent = el.parentElement;
    if (!parent) return el.tagName.toLowerCase();
    const siblings = Array.from(parent.children);
    const idx = siblings.indexOf(el) + 1;
    return getSelector(parent) + ' > ' + el.tagName.toLowerCase() + ':nth-child(' + idx + ')';
  }

  walk(document.body, 0);
  return { mode: 'skeleton', count: items.length, items: items };
})()
`;

// ─── Full Mode ──────────────────────────────────────────────
const FULL_QUERY_SCRIPT = `
(function() {
  const items = [];
  function walk(el, depth) {
    if (depth > 8) return;
    const tag = el.tagName?.toLowerCase();
    if (!tag || ['script','style','noscript','svg','path'].includes(tag)) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    items.push({
      tag: tag,
      sel: getSelector(el),
      text: (el.textContent || '').trim().slice(0, 40),
      attrs: getAttrs(el),
      depth: depth,
    });

    for (const child of el.children) {
      walk(child, depth + 1);
    }
  }

  function getSelector(el) {
    if (el.id) return '#' + el.id;
    return el.tagName.toLowerCase();
  }

  function getAttrs(el) {
    const attrs = {};
    for (const a of ['class','id','role','type','placeholder','href','src']) {
      const v = el.getAttribute(a);
      if (v) attrs[a] = v.slice(0, 50);
    }
    return Object.keys(attrs).length > 0 ? attrs : undefined;
  }

  walk(document.body, 0);
  return { mode: 'full', count: items.length, items: items };
})()
`;

// ─── Scoped Mode ────────────────────────────────────────────
const SCOPED_QUERY_SCRIPT = `
(function() {
  const root = document.querySelector('__SELECTOR__');
  if (!root) return { mode: 'scoped', error: 'Selector not found', selector: '__SELECTOR__' };
  const items = [];

  function walk(el, depth) {
    if (depth > 6) return;
    const tag = el.tagName?.toLowerCase();
    if (!tag || ['script','style','noscript'].includes(tag)) return;
    items.push({
      tag: tag,
      text: (el.textContent || '').trim().slice(0, 60),
      interactive: el.matches('a,button,input,textarea,select,[role="button"]') || false,
    });
    for (const child of el.children) {
      walk(child, depth + 1);
    }
  }

  walk(root, 0);
  return { mode: 'scoped', selector: '__SELECTOR__', count: items.length, items: items };
})()
`;
