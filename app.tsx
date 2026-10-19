// Inline Comments: select text in a message, choose "Add to chat", and the
// passage (with an optional comment) rides along with your next message as a
// pill in the composer. Highlighted passages open their comment on click.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { CommentOverlay } from "./components/CommentOverlay";
import { editorStore } from "./lib/editor-store";
import { captureSelection, highlights } from "./lib/highlights";
import { NATIVE_LABEL, mountNativeAddToChatHider } from "./lib/native-add-to-chat";

const MAX_QUOTE = 20000;

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "comment-highlights",
    mount: ({ generation }) => highlights.mount(generation),
  });
  app.contentScripts.register({
    id: "replace-native-add-to-chat",
    mount: () => mountNativeAddToChatHider(),
  });

  app.slots.experimental_appOverlay({ id: "comment-card", component: CommentOverlay });

  app.slots.messageAction({
    id: "add-to-chat",
    title: NATIVE_LABEL,
    icon: "MessageSquarePlus",
    run({ threadId, message, selectedText, composer }) {
      if (!composer) {
        toast.info("Open the thread's composer to add comments.");
        return;
      }
      const quote = (selectedText?.trim() ? selectedText : message.text).trim();
      if (!quote) return;
      if (quote.length > MAX_QUOTE) {
        toast.error("Select at most 20,000 characters.");
        return;
      }
      editorStore.open({
        mode: "create",
        threadId,
        messageId: message.id,
        quote,
        range: selectedText?.trim() ? captureSelection(quote) : null,
        composer,
      });
    },
  });
});
