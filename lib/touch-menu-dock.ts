import { NATIVE_LABEL } from "./native-add-to-chat";

// On touch devices the OS draws its own selection callout (Copy, Look Up, ...)
// right where bb places the selection menu, above the selected text. The callout
// sits on top of the web view and takes every touch inside it, so taps on the
// covered part of "Add to chat" never reach the page, or trigger Copy instead.
// Web pages can't move or disable the callout, so the menu moves: it docks just
// above the composer, away from the selection in all but its last lines.
// If bb changes the menu's markup nothing matches and the menu stays in place.
const DOCK_ATTRIBUTE = "data-inline-comments-dock";
const DOCK_X = "--inline-comments-dock-x";
const DOCK_Y = "--inline-comments-dock-y";
const COMPOSER_SELECTOR = "[data-follow-up-composer]";
const COMPOSER_STACK_SELECTOR = "[data-app-composer]";
const GAP = 8;
const FALLBACK_BOTTOM_GAP = 24;

const STYLE = `
  [${DOCK_ATTRIBUTE}] {
    top: 0 !important;
    left: 0 !important;
    transform: translate(var(${DOCK_X}, 0), var(${DOCK_Y}, 0)) !important;
  }
  [${DOCK_ATTRIBUTE}] button {
    min-height: 44px;
    padding-inline: 12px;
    font-size: 14px;
    white-space: nowrap;
  }
`;

/** The bottom edge of the docked menu, in viewport coordinates. */
function dockBottom() {
  // The whole stack: the bars above the input (background commands, queued
  // messages, ...) paint over this menu and would take its touches.
  const composer = document.querySelector(COMPOSER_SELECTOR)?.closest(COMPOSER_STACK_SELECTOR);
  const rect = composer?.getBoundingClientRect();
  if (rect && rect.height > 0) return rect.top - GAP;
  return (window.visualViewport?.height ?? window.innerHeight) - FALLBACK_BOTTOM_GAP;
}

function hasPluginAction(wrapper: Element) {
  return [...wrapper.querySelectorAll("button")].some(
    (button) => button.textContent?.trim() === NATIVE_LABEL,
  );
}

// bb portals the menu into a layer of the scrolled transcript that is the
// containing block even for position: fixed, so viewport coordinates are
// reached by correcting the current offset against the measured position.
function dock(wrapper: HTMLElement) {
  wrapper.setAttribute(DOCK_ATTRIBUTE, "");
  const rect = wrapper.getBoundingClientRect();
  const offset = (name: string) => Number.parseFloat(wrapper.style.getPropertyValue(name)) || 0;
  const x = offset(DOCK_X) + (window.innerWidth - rect.width) / 2 - rect.left;
  const y = offset(DOCK_Y) + dockBottom() - rect.height - rect.top;
  wrapper.style.setProperty(DOCK_X, `${Math.round(x)}px`);
  wrapper.style.setProperty(DOCK_Y, `${Math.round(y)}px`);
}

export function mountTouchMenuDock() {
  if (!window.matchMedia("(pointer: coarse)").matches) return () => {};

  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  const scan = () => {
    for (const wrapper of document.querySelectorAll<HTMLElement>(
      "[data-radix-popper-content-wrapper]",
    )) {
      if (hasPluginAction(wrapper)) dock(wrapper);
    }
  };
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("scroll", scan, true);
  window.addEventListener("resize", scan);
  window.visualViewport?.addEventListener("resize", scan);
  scan();

  return () => {
    observer.disconnect();
    window.removeEventListener("scroll", scan, true);
    window.removeEventListener("resize", scan);
    window.visualViewport?.removeEventListener("resize", scan);
    style.remove();
    for (const wrapper of document.querySelectorAll(`[${DOCK_ATTRIBUTE}]`)) {
      wrapper.removeAttribute(DOCK_ATTRIBUTE);
    }
  };
}
