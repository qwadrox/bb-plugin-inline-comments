// Stores comment bodies and turns each comment pill into agent context when
// the message is sent. Which comments are pending is not stored here: that is
// whatever pills the thread's composer draft still holds.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  MENTION_PROVIDER,
  commentSchema,
  rpcContract,
  type Comment,
} from "./contract";

const COMMENTS_CHANGED = "comments-changed";
// Sent comments stay readable from their pills (hover) for a year.
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

const key = (id: string) => `comment:${id}`;

export function formatContext(comment: Comment): string {
  const quote = comment.quote
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const body = comment.body.trim();
  return [
    "The user attached this passage from the conversation to their message:",
    quote,
    body ? `Their comment on it: ${body}` : "(No separate comment: read it together with the message text.)",
  ].join("\n\n");
}

export default async function plugin(bb: BbPluginApi) {
  async function read(id: string): Promise<Comment | null> {
    const parsed = commentSchema.safeParse(await bb.storage.kv.get(key(id)));
    return parsed.success ? parsed.data : null;
  }

  async function collectGarbage() {
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const k of await bb.storage.kv.list("comment:")) {
      const comment = await read(k.slice("comment:".length));
      if (!comment || Date.parse(comment.updatedAt) < cutoff) await bb.storage.kv.delete(k);
    }
  }
  void collectGarbage().catch((error) => bb.log.warn(`cleanup failed: ${String(error)}`));

  bb.rpc.register(rpcContract, {
    comments_get: async ({ ids }) => {
      const found = await Promise.all(ids.map(read));
      return { comments: found.filter((c): c is Comment => c !== null) };
    },
    comment_save: async (input) => {
      const now = new Date().toISOString();
      const previous = await read(input.id);
      const comment: Comment = {
        ...input,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      await bb.storage.kv.set(key(comment.id), comment);
      bb.realtime.publish(COMMENTS_CHANGED, { threadId: comment.threadId });
      return comment;
    },
    comment_delete: async ({ id }) => {
      const previous = await read(id);
      if (!previous) return { removed: false };
      await bb.storage.kv.delete(key(id));
      bb.realtime.publish(COMMENTS_CHANGED, { threadId: previous.threadId });
      return { removed: true };
    },
  });

  bb.ui.registerMentionProvider({
    id: MENTION_PROVIDER,
    label: "Comments",
    // Pills are only ever inserted by the selection action, never picked.
    search: () => [],
    async resolve(itemId) {
      const comment = await read(itemId);
      if (!comment) {
        throw new Error("This comment no longer exists. Remove its pill and add it again.");
      }
      return { context: formatContext(comment) };
    },
  });
}
