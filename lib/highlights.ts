import { MENTION_PROVIDER } from "../contract";

// Paints attached comments onto assistant text with the CSS Custom Highlight
// API and makes them clickable. Highlights are not elements, so clicks and
// hover are hit-tested against the ranges' client rects.

const ASSISTANT_MARKDOWN_SELECTOR =
  '[data-message-column] > [data-sidebar-swipe-selectable="true"] [data-markdown-preview]';
const IGNORED_TEXT_SELECTOR = "button, input, textarea, script, style, [aria-hidden='true']";
const BLOCK_TAGS = new Set(
  "ADDRESS BLOCKQUOTE DD DIV DL DT FIGCAPTION FIGURE H1 H2 H3 H4 H5 H6 LI P PRE TD TH".split(" "),
);

type Boundary = { node: Text; offset: number };
type IndexedCharacter = { value: string; start: Boundary; end: Boundary };
export type HighlightedComment = { id: string; quote: string };

const normalized = (value: string) => value.replace(/\s+/gu, " ").trim();

function textNodes(root: Element) {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.textContent && !node.parentElement?.closest(IGNORED_TEXT_SELECTOR)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node as Text);
  return nodes;
}

function nearestBlock(node: Text, root: Element) {
  for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
    if (BLOCK_TAGS.has(el.tagName)) return el;
  }
  return root;
}

/** Whitespace-collapsed text of `root`, with each character mapped back to the DOM. */
function normalizedIndex(root: Element) {
  const characters: IndexedCharacter[] = [];
  const append = (value: string, start: Boundary, end: Boundary) => {
    if (/\s/u.test(value)) {
      const last = characters.at(-1);
      if (last?.value === " ") last.end = end;
      else characters.push({ value: " ", start, end });
      return;
    }
    characters.push({ value, start, end });
  };
  let previous: Text | undefined;
  for (const node of textNodes(root)) {
    if (previous && nearestBlock(previous, root) !== nearestBlock(node, root)) {
      append(" ", { node: previous, offset: previous.data.length }, { node, offset: 0 });
    }
    for (let offset = 0; offset < node.data.length; offset += 1) {
      append(node.data[offset], { node, offset }, { node, offset: offset + 1 });
    }
    previous = node;
  }
  return { characters, text: characters.map((c) => c.value).join("") };
}

function isRendered(root: Element) {
  for (let el: Element | null = root; el; el = el.parentElement) {
    if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

/** The one visible assistant-text match of `quote`, or null when absent or ambiguous. */
function findUniqueRange(quote: string): Range | null {
  const needle = normalized(quote);
  if (!needle) return null;
  let match: Range | null = null;
  for (const root of document.querySelectorAll(ASSISTANT_MARKDOWN_SELECTOR)) {
    if (!isRendered(root)) continue;
    const { characters, text } = normalizedIndex(root);
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
      if (match) return null;
      const first = characters[i];
      const last = characters[i + needle.length - 1];
      match = document.createRange();
      match.setStart(first.start.node, first.start.offset);
      match.setEnd(last.end.node, last.end.offset);
    }
  }
  return match;
}

function rangeMatches(range: Range, quote: string) {
  return (
    range.startContainer.isConnected &&
    range.endContainer.isConnected &&
    normalized(range.toString()) === normalized(quote)
  );
}

function rectsContain(range: Range, x: number, y: number) {
  for (const rect of range.getClientRects()) {
    if (x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1) {
      return true;
    }
  }
  return false;
}

let names: { comment: string; pending: string; active: string } | null = null;
let comments: HighlightedComment[] = [];
const exact = new Map<string, Range>();
const resolved = new Map<string, Range>();
let pending: Range | null = null;
let activeId: string | null = null;
let hoveredId: string | null = null;
let queued = false;
let painted: { name: string; range: Range }[] = [];
let preview: string | null = null;
let pillHoverHandler: ((id: string | null, pill: Element | null) => void) | null = null;
let clickHandler: ((id: string, anchor: Element | null) => void) | null = null;

/** The comment id behind a composer pill, if the pill is one of ours. */
function pillCommentId(pill: Element): string | null {
  try {
    // The pill carries the wire id "<provider>:<item id>".
    const resource = JSON.parse(pill.getAttribute("data-prompt-mention-resource") ?? "null");
    const prefix = `${MENTION_PROVIDER}:`;
    return resource?.kind === "plugin" &&
      typeof resource.itemId === "string" &&
      resource.itemId.startsWith(prefix)
      ? resource.itemId.slice(prefix.length)
      : null;
  } catch {
    return null;
  }
}

const supported = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

function rebuild() {
  queued = false;
  if (!names || !supported()) return;
  resolved.clear();
  for (const comment of comments) {
    const captured = exact.get(comment.id);
    const range =
      captured && rangeMatches(captured, comment.quote) ? captured : findUniqueRange(comment.quote);
    if (range) {
      resolved.set(comment.id, range);
      exact.set(comment.id, range);
    }
  }
  const emphasized = activeId ?? hoveredId;
  const normal = [...resolved].filter(([id]) => id !== emphasized).map(([, r]) => r);
  const strong = emphasized ? resolved.get(emphasized) : undefined;
  const previewRange = preview ? findUniqueRange(preview) : null;
  const next: { name: string; range: Range }[] = [];
  const set = (name: string, ranges: Range[]) => {
    for (const range of ranges) next.push({ name, range });
    return ranges.length ? CSS.highlights.set(name, new Highlight(...ranges)) : CSS.highlights.delete(name);
  };
  set(names.comment, normal);
  set(names.active, [strong, previewRange].filter((r): r is Range => !!r));
  set(names.pending, pending && pending.startContainer.isConnected ? [pending] : []);
  repaintRemoved(painted, next);
  painted = next;
}

const sameRange = (a: Range, b: Range) =>
  a.startContainer === b.startContainer &&
  a.startOffset === b.startOffset &&
  a.endContainer === b.endContainer &&
  a.endOffset === b.endOffset;

/**
 * WebKit (Safari and the iOS app) does not repaint text whose highlight was
 * removed or recolored, so the old yellow lingers until something else
 * repaints that spot (a tap there, a scroll). Nudge each element that lost a
 * highlight into a repaint for one frame.
 */
function repaintRemoved(before: typeof painted, after: typeof painted) {
  const stale = new Set<HTMLElement>();
  for (const old of before) {
    if (after.some((now) => now.name === old.name && sameRange(now.range, old.range))) continue;
    const node = old.range.commonAncestorContainer;
    const el = node instanceof Element ? node : node.parentElement;
    if (el instanceof HTMLElement && el.isConnected) stale.add(el);
  }
  for (const el of stale) {
    const opacity = el.style.opacity;
    el.style.opacity = "0.999";
    requestAnimationFrame(() => {
      el.style.opacity = opacity;
    });
  }
}

function queueRebuild() {
  if (queued || !names) return;
  queued = true;
  requestAnimationFrame(rebuild);
}

function hitTest(x: number, y: number): string | null {
  for (const [id, range] of resolved) if (rectsContain(range, x, y)) return id;
  return null;
}

export const highlights = {
  mount(generation: number) {
    names = {
      comment: `inline-comments-${generation}`,
      pending: `inline-comments-pending-${generation}`,
      active: `inline-comments-active-${generation}`,
    };
    const style = document.createElement("style");
    style.textContent = `
      ::highlight(${names.comment}) {
        background-color: color-mix(in oklab, rgb(234 179 8) 16%, transparent);
        text-decoration: underline 1.5px color-mix(in oklab, rgb(234 179 8) 75%, transparent);
        text-underline-offset: 3px;
      }
      ::highlight(${names.active}) {
        background-color: color-mix(in oklab, rgb(234 179 8) 32%, transparent);
        text-decoration: underline 2px rgb(234 179 8);
        text-underline-offset: 3px;
      }
      ::highlight(${names.pending}) {
        background-color: color-mix(in oklab, rgb(234 179 8) 24%, transparent);
      }
      [data-prompt-mention-resource*='"itemId":"${MENTION_PROVIDER}:'] { cursor: default; }
      html.inline-comments-hover [data-markdown-preview],
      html.inline-comments-hover [data-markdown-preview] * { cursor: pointer !important; }
      [contenteditable="true"] [data-prompt-mention-resource*='"itemId":"${MENTION_PROVIDER}:'] { cursor: pointer; }
    `;
    document.head.appendChild(style);

    const observer = new MutationObserver(() => {
      if (comments.length || pending) queueRebuild();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    let lastMove: PointerEvent | null = null;
    let moveQueued = false;
    const onMove = (event: PointerEvent) => {
      lastMove = event;
      if (moveQueued || resolved.size === 0) {
        if (resolved.size === 0 && hoveredId) {
          hoveredId = null;
          document.documentElement.classList.remove("inline-comments-hover");
        }
        return;
      }
      moveQueued = true;
      requestAnimationFrame(() => {
        moveQueued = false;
        if (!lastMove) return;
        const id = hitTest(lastMove.clientX, lastMove.clientY);
        if (id === hoveredId) return;
        hoveredId = id;
        document.documentElement.classList.toggle("inline-comments-hover", id !== null);
        rebuild();
      });
    };
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const pill = (event.target as Element | null)?.closest?.('[contenteditable="true"] [data-prompt-mention-resource]');
      const pillId = pill ? pillCommentId(pill) : null;
      if (pill && pillId) {
        event.preventDefault();
        clickHandler?.(pillId, pill);
        return;
      }
      if (resolved.size === 0) return;
      if (!window.getSelection()?.isCollapsed) return;
      const target = event.target as Element | null;
      if (target?.closest?.("a, button, input, textarea, [data-inline-comments-card]")) return;
      const id = hitTest(event.clientX, event.clientY);
      if (id) clickHandler?.(id, null);
    };
    // Hovering a pill, in the composer or in a sent message, shows its comment.
    let hoveredPill: Element | null = null;
    const onOver = (event: PointerEvent) => {
      const target = event.target as Element | null;
      const pill = target?.closest?.("[data-prompt-mention-resource]") ?? null;
      if (pill === hoveredPill) return;
      hoveredPill = pill;
      const id = pill ? pillCommentId(pill) : null;
      pillHoverHandler?.(id, id ? pill : null);
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("click", onClick);
    rebuild();

    return () => {
      observer.disconnect();
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("click", onClick);
      document.removeEventListener("pointerover", onOver);
      document.documentElement.classList.remove("inline-comments-hover");
      if (names && supported()) for (const name of Object.values(names)) CSS.highlights.delete(name);
      style.remove();
      names = null;
      painted = [];
      exact.clear();
      resolved.clear();
    };
  },

  /** The comments attached to visible composers; anything else is unpainted. */
  setComments(next: HighlightedComment[]) {
    comments = next;
    const ids = new Set(next.map((c) => c.id));
    for (const id of exact.keys()) if (!ids.has(id)) exact.delete(id);
    queueRebuild();
  },

  /** Pins a comment to the exact range the user selected (quotes can repeat). */
  pin(id: string, range: Range) {
    exact.set(id, range);
    queueRebuild();
  },

  setPending(range: Range | null) {
    pending = range;
    queueRebuild();
  },

  setActive(id: string | null) {
    activeId = id;
    queueRebuild();
  },

  /** Emphasizes a sent comment's passage while its pill is hovered. */
  setPreview(quote: string | null) {
    preview = quote;
    queueRebuild();
  },

  onPillHover(handler: ((id: string | null, pill: Element | null) => void) | null) {
    pillHoverHandler = handler;
  },

  rangeFor(id: string): Range | null {
    return resolved.get(id) ?? exact.get(id) ?? null;
  },

  onClick(handler: ((id: string, anchor: Element | null) => void) | null) {
    clickHandler = handler;
  },
};

/** The live selection inside an assistant message, if it is the one just acted on. */
export function captureSelection(quote: string): Range | null {
  const selection = window.getSelection();
  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0).cloneRange();
    if (!range.collapsed && normalized(range.toString()) === normalized(quote)) return range;
  }
  return findUniqueRange(quote);
}
