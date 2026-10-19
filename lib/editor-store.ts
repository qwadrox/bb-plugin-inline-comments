import type { PluginComposerApi } from "@get-bb/plugin-sdk/app";

export type EditorRequest =
  | {
      mode: "create";
      threadId: string;
      messageId: string;
      quote: string;
      range: Range | null;
      composer: PluginComposerApi;
    }
  | {
      mode: "edit";
      threadId: string;
      commentId: string;
      /** Where to open; defaults to the comment's highlight in the transcript. */
      anchor?: Element;
    };

let current: EditorRequest | null = null;
const listeners = new Set<() => void>();

export const editorStore = {
  getSnapshot: () => current,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  open(request: EditorRequest) {
    current = request;
    for (const listener of listeners) listener();
  },
  close() {
    if (current === null) return;
    current = null;
    for (const listener of listeners) listener();
  },
};
