/**
 * DOM Query Engine — Compact DOM serialization for CLI remote control.
 *
 * Generates JavaScript code to be injected into BrowserWindow's webContents.
 * Returns a token-optimized DOM representation with 3 modes:
 *
 * - skeleton:    Tree with pruning (no hidden/empty/SVG internals)
 * - interactive: Flat list of actionable elements only
 * - full:        Complete visible DOM tree
 */

// ─── Types ──────────────────────────────────────────────────────────────

export interface CompactNode {
  s: string;          // unique CSS selector
  t: string;          // tag name
  tx?: string;        // visible text (leaf, truncated 50 chars)
  id?: string;
  cls?: string;       // first 3 class names
  val?: string;       // input/select value
  ph?: string;        // placeholder
  tp?: string;        // input type
  chk?: boolean;      // checked state
  dis?: boolean;      // disabled
  r?: [number, number, number, number]; // [x, y, w, h]
  ch?: CompactNode[]; // children
}

export type DomQueryMode = "skeleton" | "interactive" | "full";

export interface DomQueryParams {
  mode?: DomQueryMode;
  selector?: string;   // scope to a subtree
  maxDepth?: number;    // default 15
  withRects?: boolean;  // include bounding rects (default true)
}

// ─── JS Code Generator ─────────────────────────────────────────────────

/**
 * Generate JavaScript code string to inject via webContents.executeJavaScript().
 * The code runs in the renderer context and returns a CompactNode tree or flat list.
 */
export function generateDomQueryScript(params: DomQueryParams = {}): string {
  const mode = params.mode || "skeleton";
  const selector = params.selector || "body";
  const maxDepth = params.maxDepth || 15;
  const withRects = params.withRects !== false;

  // The entire script is a self-executing function that returns JSON
  return `(function() {
  const MODE = "${mode}";
  const MAX_DEPTH = ${maxDepth};
  const WITH_RECTS = ${withRects};

  const INTERACTIVE_TAGS = new Set(["button","input","select","textarea","a"]);
  const SKIP_TAGS = new Set(["script","style","noscript","link","meta","head"]);
  const SVG_INTERNAL = new Set(["path","circle","line","rect","polygon","polyline","ellipse","g","defs","clippath","use","symbol","lineargradient","radialgradient","stop","text","tspan","mask","filter","fegaussianblur","fecolormatrix"]);

  function isVisible(el) {
    if (!el.offsetParent && el.tagName !== "BODY" && el.tagName !== "HTML") {
      // Check computed style as fallback (position fixed elements have no offsetParent)
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") return false;
      if (s.position !== "fixed" && s.position !== "sticky") return false;
    }
    return true;
  }

  function getSelector(el) {
    if (el.id) return "#" + CSS.escape(el.id);
    if (el === document.body) return "body";
    if (el === document.documentElement) return "html";

    // Try unique class
    if (el.className && typeof el.className === "string") {
      const classes = el.className.trim().split(/\\s+/).filter(c => c && !c.startsWith("lucide"));
      for (const c of classes) {
        try {
          if (document.querySelectorAll("." + CSS.escape(c)).length === 1) {
            return "." + CSS.escape(c);
          }
        } catch(e) {}
      }
    }

    // nth-child path
    const parent = el.parentElement;
    if (!parent) return el.tagName.toLowerCase();
    const siblings = Array.from(parent.children);
    const sameTags = siblings.filter(s => s.tagName === el.tagName);
    const idx = sameTags.indexOf(el);
    const parentSel = getSelector(parent);
    const tag = el.tagName.toLowerCase();
    if (sameTags.length === 1) return parentSel + " > " + tag;
    return parentSel + " > " + tag + ":nth-child(" + (siblings.indexOf(el) + 1) + ")";
  }

  function getDirectText(el) {
    let text = "";
    for (const n of el.childNodes) {
      if (n.nodeType === 3) text += n.textContent;
    }
    return text.trim().substring(0, 50);
  }

  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.has(tag)) return true;
    if (el.getAttribute("role") === "button") return true;
    if (el.hasAttribute("onclick") || el.hasAttribute("tabindex")) return true;
    return false;
  }

  function hasMeaningfulContent(el) {
    if (el.id) return true;
    if (el.dataset && el.dataset.testid) return true;
    if (isInteractive(el)) return true;
    if (getDirectText(el).length > 0) return true;
    return false;
  }

  function buildNode(el, depth) {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return null;
    if (!isVisible(el)) return null;
    if (depth > MAX_DEPTH) return null;

    // SVG: collapse to single node
    if (tag === "svg" || SVG_INTERNAL.has(tag)) {
      if (tag === "svg") {
        return { s: getSelector(el), t: "svg" };
      }
      return null; // skip SVG internals
    }

    const node = { s: getSelector(el), t: tag };

    // Attributes
    if (el.id) node.id = el.id;
    if (el.className && typeof el.className === "string") {
      const cls = el.className.trim().split(/\\s+/).filter(c => c && !c.startsWith("lucide")).slice(0, 3).join(" ");
      if (cls) node.cls = cls;
    }

    const directText = getDirectText(el);
    if (directText) node.tx = directText;

    // Interactive attrs
    if (tag === "input" || tag === "textarea") {
      if (el.value) node.val = el.value.substring(0, 100);
      if (el.placeholder) node.ph = el.placeholder.substring(0, 50);
      if (el.type) node.tp = el.type;
      if (el.checked) node.chk = true;
      if (el.disabled) node.dis = true;
    }
    if (tag === "select") {
      node.val = el.value;
      if (el.disabled) node.dis = true;
    }
    if (tag === "button" || tag === "a") {
      if (el.disabled) node.dis = true;
    }

    // Bounding rect
    if (WITH_RECTS) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        node.r = [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)];
      }
    }

    // Children
    const children = Array.from(el.children);
    if (children.length > 0) {
      const childNodes = [];
      for (const child of children) {
        const cn = buildNode(child, depth + 1);
        if (cn) childNodes.push(cn);
      }

      if (MODE === "skeleton") {
        // In skeleton mode, only keep meaningful nodes
        // If a node has no text, no id, is not interactive, and has exactly one child,
        // replace it with that child (flatten)
        if (childNodes.length > 0) node.ch = childNodes;
      } else {
        if (childNodes.length > 0) node.ch = childNodes;
      }
    }

    // Skeleton pruning: skip pure wrapper nodes with no content and single child
    if (MODE === "skeleton") {
      if (!hasMeaningfulContent(el) && (!node.ch || node.ch.length === 0)) {
        return null;
      }
    }

    return node;
  }

  function buildInteractiveList(root) {
    const result = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node;
    while (node = walker.nextNode()) {
      if (!isVisible(node)) continue;
      if (!isInteractive(node)) continue;
      const tag = node.tagName.toLowerCase();
      const item = { s: getSelector(node), t: tag };
      const text = node.textContent?.trim().substring(0, 50);
      if (text) item.tx = text;
      if (node.id) item.id = node.id;
      if (node.className && typeof node.className === "string") {
        const cls = node.className.trim().split(/\\s+/).filter(c => c && !c.startsWith("lucide")).slice(0, 3).join(" ");
        if (cls) item.cls = cls;
      }
      if (tag === "input" || tag === "textarea") {
        if (node.value) item.val = node.value.substring(0, 100);
        if (node.placeholder) item.ph = node.placeholder.substring(0, 50);
        if (node.type) item.tp = node.type;
        if (node.checked) item.chk = true;
        if (node.disabled) item.dis = true;
      }
      if (tag === "select") {
        item.val = node.value;
      }
      if (node.disabled) item.dis = true;
      if (WITH_RECTS) {
        const rect = node.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          item.r = [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)];
        }
      }
      result.push(item);
    }
    return result;
  }

  try {
    const root = document.querySelector("${selector.replace(/"/g, '\\"')}");
    if (!root) return JSON.stringify({ error: "Selector not found: ${selector.replace(/"/g, '\\"')}" });

    if (MODE === "interactive") {
      return JSON.stringify(buildInteractiveList(root));
    } else {
      return JSON.stringify(buildNode(root, 0));
    }
  } catch(e) {
    return JSON.stringify({ error: e.message });
  }
})()`;
}

/**
 * Generate JS to get a single element's detail by selector.
 */
export function generateElementQueryScript(selector: string): string {
  return `(function() {
  try {
    const el = document.querySelector("${selector.replace(/"/g, '\\"')}");
    if (!el) return JSON.stringify({ error: "Element not found" });
    const rect = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return JSON.stringify({
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      className: el.className || undefined,
      text: el.textContent?.trim().substring(0, 200),
      value: el.value,
      checked: el.checked,
      disabled: el.disabled,
      visible: s.display !== "none" && s.visibility !== "hidden",
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      attrs: Object.fromEntries(Array.from(el.attributes).map(a => [a.name, a.value]).slice(0, 20)),
      childCount: el.children.length,
    });
  } catch(e) {
    return JSON.stringify({ error: e.message });
  }
})()`;
}

/**
 * Generate JS to click an element by selector.
 */
export function generateClickScript(selector: string): string {
  return `(function() {
  try {
    const el = document.querySelector("${selector.replace(/"/g, '\\"')}");
    if (!el) return JSON.stringify({ error: "Element not found: ${selector.replace(/"/g, '\\"')}" });
    el.scrollIntoView({ block: "center" });
    el.click();
    return JSON.stringify({ success: true });
  } catch(e) {
    return JSON.stringify({ error: e.message });
  }
})()`;
}

/**
 * Generate JS to type text into an input/textarea element.
 */
export function generateTypeScript(selector: string, text: string): string {
  return `(function() {
  try {
    const el = document.querySelector("${selector.replace(/"/g, '\\"')}");
    if (!el) return JSON.stringify({ error: "Element not found" });
    el.focus();
    // Use native input event for React compatibility
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, "${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}");
    } else {
      el.value = "${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}";
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({ success: true });
  } catch(e) {
    return JSON.stringify({ error: e.message });
  }
})()`;
}

/**
 * Generate JS to select a value in a <select> element.
 */
export function generateSelectScript(selector: string, value: string): string {
  return `(function() {
  try {
    const el = document.querySelector("${selector.replace(/"/g, '\\"')}");
    if (!el || el.tagName !== "SELECT") return JSON.stringify({ error: "Select element not found" });
    el.value = "${value.replace(/"/g, '\\"')}";
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({ success: true });
  } catch(e) {
    return JSON.stringify({ error: e.message });
  }
})()`;
}

/**
 * Generate JS to scroll an element or the window.
 */
export function generateScrollScript(selector: string | null, deltaX: number, deltaY: number): string {
  if (selector) {
    return `(function() {
  try {
    const el = document.querySelector("${selector.replace(/"/g, '\\"')}");
    if (!el) return JSON.stringify({ error: "Element not found" });
    el.scrollBy(${deltaX}, ${deltaY});
    return JSON.stringify({ success: true, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft });
  } catch(e) {
    return JSON.stringify({ error: e.message });
  }
})()`;
  }
  return `(function() {
  window.scrollBy(${deltaX}, ${deltaY});
  return JSON.stringify({ success: true, scrollY: window.scrollY });
})()`;
}

/**
 * Generate JS to focus an element.
 */
export function generateFocusScript(selector: string): string {
  return `(function() {
  try {
    const el = document.querySelector("${selector.replace(/"/g, '\\"')}");
    if (!el) return JSON.stringify({ error: "Element not found" });
    el.focus();
    return JSON.stringify({ success: true });
  } catch(e) {
    return JSON.stringify({ error: e.message });
  }
})()`;
}
