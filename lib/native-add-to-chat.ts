// bb's selection menu always lists its own "Add to chat" (which pastes a
// quote into the composer) before plugin actions. This plugin's action has the
// same label and supersedes it, so when both are present the first one, the
// built-in, is hidden together with the divider after it. If bb changes the
// menu's markup nothing matches and both stay visible.
export const NATIVE_LABEL = "Add to chat";

function hideDuplicate(menu: Element) {
  const buttons = [...menu.querySelectorAll("button")].filter(
    (button) => button.textContent?.trim() === NATIVE_LABEL,
  );
  if (buttons.length < 2) return;
  const item = buttons[0].parentElement;
  if (!item || item.parentElement !== buttons[1].parentElement?.parentElement) return;
  (item as HTMLElement).style.display = "none";
  const divider = item.nextElementSibling?.querySelector(":scope > span[aria-hidden='true']");
  if (divider) (divider as HTMLElement).style.display = "none";
}

export function mountNativeAddToChatHider() {
  const scan = () => {
    for (const wrapper of document.querySelectorAll("[data-radix-popper-content-wrapper]")) {
      hideDuplicate(wrapper);
    }
  };
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
  scan();
  return () => observer.disconnect();
}
