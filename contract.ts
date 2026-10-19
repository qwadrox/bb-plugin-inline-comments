import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** Mention provider id; every comment travels as one of its pills. */
export const MENTION_PROVIDER = "comment";

const commentId = z.string().regex(/^[\w-]{1,100}$/);

export const commentSchema = z.object({
  id: commentId,
  threadId: z.string().min(1).max(200),
  messageId: z.string().min(1).max(2000),
  quote: z.string().trim().min(1).max(20000),
  body: z.string().max(10000),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Comment = z.infer<typeof commentSchema>;

export const rpcContract = defineRpcContract({
  comments_get: {
    input: z.object({ ids: z.array(commentId).max(200) }),
    output: z.object({ comments: z.array(commentSchema) }),
  },
  comment_save: {
    input: commentSchema.pick({
      id: true,
      threadId: true,
      messageId: true,
      quote: true,
      body: true,
    }),
    output: commentSchema,
  },
  comment_delete: {
    input: z.object({ id: commentId }),
    output: z.object({ removed: z.boolean() }),
  },
});
