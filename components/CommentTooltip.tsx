import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { Comment, rpcContract } from "../contract";
import { editorStore } from "../lib/editor-store";
import { highlights } from "../lib/highlights";

const MARGIN = 8;
const cache = new Map<string, Comment | null>();

/** Read-only bubble over a comment pill, in the composer or in a sent message. */
export function CommentTooltip() {
  const rpc = useRpc<typeof rpcContract>();
  const [hover, setHover] = useState<{ id: string; pill: Element } | null>(null);
  const [comment, setComment] = useState<Comment | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const editing = useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot) !== null;
  // Pending comments can still be edited, so a cached body may be stale.
  useRealtime("comments-changed", () => cache.clear());

  useEffect(() => {
    highlights.onPillHover((id, pill) => setHover(id && pill ? { id, pill } : null));
    return () => highlights.onPillHover(null);
  }, []);

  useEffect(() => {
    if (!hover) {
      setComment(null);
      return;
    }
    const known = cache.get(hover.id);
    if (known !== undefined) {
      setComment(known);
      return;
    }
    let live = true;
    rpc.call("comments_get", { ids: [hover.id] }).then(
      ({ comments }) => {
        cache.set(hover.id, comments[0] ?? null);
        if (live) setComment(comments[0] ?? null);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [rpc, hover]);

  useEffect(() => {
    highlights.setPreview(editing ? null : (comment?.quote ?? null));
    return () => highlights.setPreview(null);
  }, [comment, editing]);

  useLayoutEffect(() => {
    const card = ref.current;
    if (!card || !hover) return;
    const anchor = hover.pill.getBoundingClientRect();
    const { width, height } = card.getBoundingClientRect();
    const above = anchor.top - MARGIN - height;
    const top = above >= MARGIN ? above : anchor.bottom + MARGIN;
    const left = Math.min(
      Math.max(MARGIN, anchor.right - width),
      window.innerWidth - width - MARGIN,
    );
    setStyle({ top, left });
  }, [hover, comment]);

  if (!hover || !comment || editing) return null;
  const body = comment.body.trim();
  return (
    <div
      ref={ref}
      role="tooltip"
      style={style}
      className="pointer-events-none fixed z-50 w-max max-w-[min(28rem,calc(100vw-1rem))] rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
    >
      <p className="line-clamp-3 break-words border-l-2 border-border pl-2 text-xs leading-4 text-muted-foreground">
        {comment.quote}
      </p>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-5">
        {body || <span className="text-muted-foreground">No comment</span>}
      </p>
    </div>
  );
}
