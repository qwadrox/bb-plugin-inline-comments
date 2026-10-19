import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  useComposers,
  useRealtime,
  useRpc,
  type ExperimentalAppOverlayProps,
  type PluginComposerApi,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { Comment, rpcContract } from "../contract";
import { editorStore, type EditorRequest } from "../lib/editor-store";
import { highlights } from "../lib/highlights";
import { attachComment, attachedCommentIds, detachComment } from "../lib/mentions";
import { CommentCard } from "./CommentCard";
import { CommentTooltip } from "./CommentTooltip";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function threadComposer(composers: readonly PluginComposerApi[], threadId: string) {
  return composers.find((c) => c.scope.kind === "thread" && c.scope.threadId === threadId) ?? null;
}

/**
 * Always mounted: mirrors the comment pills of every open thread composer into
 * text highlights, and shows the comment card when one is being added or edited.
 */
export function CommentOverlay(_props: ExperimentalAppOverlayProps) {
  const rpc = useRpc<typeof rpcContract>();
  const composers = useComposers();
  const request = useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot);
  const [comments, setComments] = useState<ReadonlyMap<string, Comment>>(new Map());

  const attachedIds = composers
    .filter((c) => c.scope.kind === "thread")
    .flatMap(attachedCommentIds);
  const idsKey = attachedIds.join(",");

  const load = useCallback(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0) {
      setComments(new Map());
      return;
    }
    rpc.call("comments_get", { ids }).then(
      ({ comments: found }) => setComments(new Map(found.map((c) => [c.id, c]))),
      () => {},
    );
  }, [rpc, idsKey]);
  useEffect(load, [load]);
  useRealtime("comments-changed", load);

  useEffect(() => {
    highlights.setComments(
      attachedIds.flatMap((id) => {
        const comment = comments.get(id);
        return comment ? [{ id, quote: comment.quote }] : [];
      }),
    );
    // attachedIds is derived from idsKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, comments]);

  useEffect(() => {
    highlights.onClick((id, anchor) => {
      const comment = comments.get(id);
      if (!comment) return;
      editorStore.open({
        mode: "edit",
        threadId: comment.threadId,
        commentId: id,
        anchor: anchor ?? undefined,
      });
    });
    return () => highlights.onClick(null);
  }, [comments]);

  let card = null;
  if (request?.mode === "create") {
    card = <CreateCard key={request.quote + request.messageId} request={request} />;
  } else if (request?.mode === "edit") {
    const comment = comments.get(request.commentId);
    const composer = threadComposer(composers, request.threadId);
    if (comment && composer) {
      card = (
        <EditCard key={comment.id} comment={comment} composer={composer} anchorEl={request.anchor} />
      );
    }
  }
  return (
    <>
      <CommentTooltip />
      {card}
    </>
  );
}

function CreateCard({ request }: { request: Extract<EditorRequest, { mode: "create" }> }) {
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);
  const anchor = useMemo(() => {
    const range = request.range;
    return () => {
      if (!range?.startContainer.isConnected) return null;
      const rects = range.getClientRects();
      return rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    };
  }, [request.range]);

  useEffect(() => {
    highlights.setPending(request.range);
    return () => highlights.setPending(null);
  }, [request.range]);

  return (
    <CommentCard
      mode="create"
      quote={request.quote}
      initialBody=""
      anchor={anchor}
      busy={busy}
      onCancel={() => editorStore.close()}
      onSubmit={(body) => {
        const id = crypto.randomUUID();
        setBusy(true);
        rpc
          .call("comment_save", {
            id,
            threadId: request.threadId,
            messageId: request.messageId,
            quote: request.quote,
            body,
          })
          .then(() => {
            if (request.range) highlights.pin(id, request.range);
            attachComment(request.composer, id, request.quote);
            editorStore.close();
            request.composer.focus();
          })
          .catch((error: unknown) => {
            setBusy(false);
            toast.error("Could not add the comment", { description: message(error) });
          });
      }}
    />
  );
}

function EditCard({
  comment,
  composer,
  anchorEl,
}: {
  comment: Comment;
  composer: PluginComposerApi;
  anchorEl?: Element;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);
  const anchor = useCallback(() => {
    if (anchorEl?.isConnected) return anchorEl.getBoundingClientRect();
    const range = highlights.rangeFor(comment.id);
    if (!range?.startContainer.isConnected) return null;
    const rects = range.getClientRects();
    return rects.length ? rects[rects.length - 1] : null;
  }, [comment.id, anchorEl]);

  useEffect(() => {
    highlights.setActive(comment.id);
    return () => highlights.setActive(null);
  }, [comment.id]);

  return (
    <CommentCard
      mode="edit"
      quote={comment.quote}
      initialBody={comment.body}
      anchor={anchor}
      busy={busy}
      onCancel={() => editorStore.close()}
      onDelete={() => {
        detachComment(composer, comment.id);
        editorStore.close();
        void rpc.call("comment_delete", { id: comment.id }).catch(() => {});
      }}
      onSubmit={(body) => {
        setBusy(true);
        rpc
          .call("comment_save", { ...comment, body })
          .then(() => editorStore.close())
          .catch((error: unknown) => {
            setBusy(false);
            toast.error("Could not save the comment", { description: message(error) });
          });
      }}
    />
  );
}
