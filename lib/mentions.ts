import type { ComposerMention, PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { MENTION_PROVIDER } from "../contract";

declare const __BB_PLUGIN_ID__: string | undefined;
const PLUGIN_ID = typeof __BB_PLUGIN_ID__ === "string" ? __BB_PLUGIN_ID__ : undefined;

type PluginMention = Extract<ComposerMention, { kind: "plugin" }>;

export function isCommentMention(mention: ComposerMention): mention is PluginMention {
  return (
    mention.kind === "plugin" &&
    mention.provider === MENTION_PROVIDER &&
    (PLUGIN_ID === undefined || mention.pluginId === PLUGIN_ID)
  );
}

/** Comment ids whose pills are in the composer, in draft order. */
export function attachedCommentIds(composer: PluginComposerApi): string[] {
  return composer.draft.mentions.filter(isCommentMention).map((m) => m.id);
}

export function pillLabel(quote: string): string {
  const flat = quote.replace(/\s+/gu, " ").trim();
  return flat.length > 36 ? `${flat.slice(0, 34).trimEnd()}…` : flat;
}

export function attachComment(composer: PluginComposerApi, id: string, quote: string) {
  const text = composer.draft.text;
  const pill = { provider: MENTION_PROVIDER, id, label: pillLabel(quote) };
  const lead = text.length > 0 && !/\s$/u.test(text) ? [" "] : [];
  composer.insert([...lead, pill, " "], { at: "end" });
}

/** Removes the comment's pill and the space that followed it. */
export function detachComment(composer: PluginComposerApi, id: string) {
  composer.replace((current) => {
    const target = current.mentions.find((m) => isCommentMention(m) && m.id === id);
    if (!target) return current;
    const end = current.text[target.to] === " " ? target.to + 1 : target.to;
    const removed = end - target.from;
    return {
      text: current.text.slice(0, target.from) + current.text.slice(end),
      mentions: current.mentions
        .filter((m) => m !== target)
        .map((m) => (m.from >= end ? { ...m, from: m.from - removed, to: m.to - removed } : m)),
    };
  });
}
