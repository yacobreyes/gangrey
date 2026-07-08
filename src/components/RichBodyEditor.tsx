"use client";

import { useEffect, useState, useCallback } from "react";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Youtube from "@tiptap/extension-youtube";
import type { JSONContent } from "@tiptap/react";
import { straightenQuotes } from "@/lib/straighten";
import { CRIMSON, TEXT_DARK, BORDER } from "@/lib/palette";

const CURLY = /[‘’‚‛′‵ʼʻʽ＇❛❜“”„‟″‶＂❝❞]/;

// Scan the whole doc and replace every curly quote with its straight equivalent.
// Returns true if it dispatched a change. Position math is safe because every
// replacement is the same length as the text it replaces.
function straightenDoc(view: { state: EditorState; dispatch: (tr: Transaction) => void }): boolean {
  const { state } = view;
  let tr = state.tr;
  let changed = false;
  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text || !CURLY.test(node.text)) return;
    tr = tr.insertText(straightenQuotes(node.text), pos, pos + node.text.length);
    changed = true;
  });
  if (changed) view.dispatch(tr.setMeta("addToHistory", false));
  return changed;
}

// Forces straight quotes: rewrites any curly/smart quote the moment it lands in
// the document — whether typed, OS-substituted, or pasted. appendTransaction
// covers desktop typing and paste; the compositionend handler (registered in
// editorProps) covers mobile/IME smart-punctuation, where a mid-composition
// transaction would be reverted by the browser.
const StraightQuotes = Extension.create({
  name: "straightQuotes",
  addProseMirrorPlugins() {
    let pmView: EditorView | null = null;
    return [
      new Plugin({
        key: new PluginKey("straightQuotes"),
        view(view) {
          pmView = view;
          return { destroy() { pmView = null; } };
        },
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some(t => t.docChanged)) return null;
          // Don't fight an active IME composition (mobile smart-punctuation):
          // a mid-composition edit gets reverted by the browser. The
          // compositionend handler straightens once the composition resolves.
          if (pmView?.composing) return null;
          let tr = newState.tr;
          let changed = false;
          newState.doc.descendants((node, pos) => {
            if (!node.isText || !node.text || !CURLY.test(node.text)) return;
            tr = tr.insertText(straightenQuotes(node.text), pos, pos + node.text.length);
            changed = true;
          });
          return changed ? tr : null;
        },
      }),
    ];
  },
});

const FONT = "var(--font-inter), sans-serif";

export interface ToolbarHandles {
  openLink: () => void;
  openImage: () => void;
  openEmbed: () => void;
}

interface Props {
  initialContent: JSONContent;
  onChange: (doc: JSONContent) => void;
  onEditor?: (editor: Editor | null) => void;
  onToolbar?: (handles: ToolbarHandles | null) => void;
  minHeight?: number;
  placeholder?: string;
  editable?: boolean;
  // Typing surface font. Defaults to the site face; the story editor passes the
  // Mac system stack (Imago chrome rule), while the newsletter canvas keeps the
  // site font so it mimics the email preview.
  fontFamily?: string;
}

export default function RichBodyEditor({ initialContent, onChange, onEditor, onToolbar, minHeight = 320, placeholder = "Type your story", editable = true, fontFamily = FONT }: Props) {
  const [linkModal, setLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [imageModal, setImageModal] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [embedModal, setEmbedModal] = useState(false);
  const [embedUrl, setEmbedUrl] = useState("");

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      StraightQuotes,
      Placeholder.configure({ placeholder }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ inline: false }),
      Youtube.configure({ width: 640, height: 360, nocookie: true }),
    ],
    content: initialContent,
    editable,
    onCreate({ editor }) {
      // The StraightQuotes plugin only fires on doc changes, so existing/pasted
      // content loaded on open keeps its curly quotes until edited. Straighten
      // the whole doc once up front so opened drafts match house style.
      straightenDoc(editor.view);
    },
    onUpdate({ editor }) {
      onChange(editor.getJSON());
    },
    editorProps: {
      attributes: {
        style: [
          "min-height:" + minHeight + "px",
          "padding:0",
          "font-family:" + fontFamily,
          "font-size:1rem",
          "line-height:1.8",
          "color:" + TEXT_DARK,
          "outline:none",
          "border:none",
          "background:transparent",
          "font-feature-settings:\"calt\" 0,\"liga\" 0",
        ].join(";"),
      },
      // Convert curly quotes the moment they're typed. macOS "smart
      // punctuation" substitutes straight quotes for curly ones at the input
      // layer; intercept that text and straighten it before it lands.
      handleTextInput(view, from, to, text) {
        if (!CURLY.test(text)) return false;
        view.dispatch(view.state.tr.insertText(straightenQuotes(text), from, to));
        return true;
      },
      handleDOMEvents: {
        // iOS/mobile "Smart Punctuation" inserts curly quotes through an IME
        // composition, which bypasses handleTextInput; dispatching during the
        // composition would be reverted by the browser. Straighten once the
        // composition has finished so the change sticks. The timeout lets the
        // browser commit the composition before we rewrite it.
        compositionend(view) {
          setTimeout(() => {
            if (!view.isDestroyed) straightenDoc(view);
          }, 0);
          return false;
        },
      },
      handleKeyDown(view, event) {
        // Cmd+K / Ctrl+K → open link modal
        if ((event.metaKey || event.ctrlKey) && event.key === "k") {
          event.preventDefault();
          return true; // handled via useEffect below
        }
        return false;
      },
    },
  });

  // Cmd+K listener
  useEffect(() => {
    if (!editor) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const existing = editor!.getAttributes("link").href ?? "";
        setLinkUrl(existing);
        setLinkModal(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);

  useEffect(() => {
    onEditor?.(editor ?? null);
    return () => onEditor?.(null);
  }, [editor]);

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    if (!editor) { onToolbar?.(null); return; }
    onToolbar?.({
      openLink: () => { setLinkUrl(editor.getAttributes("link").href ?? ""); setLinkModal(true); },
      openImage: () => { setImageUrl(""); setImageModal(true); },
      openEmbed: () => { setEmbedUrl(""); setEmbedModal(true); },
    });
    return () => onToolbar?.(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const current = JSON.stringify(editor.getJSON());
    const next = JSON.stringify(initialContent);
    if (current !== next) editor.commands.setContent(initialContent);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContent]);

  const applyLink = useCallback(() => {
    if (!editor) return;
    if (!linkUrl.trim()) {
      editor.chain().focus().unsetLink().run();
    } else {
      const href = linkUrl.startsWith("http") ? linkUrl : `https://${linkUrl}`;
      editor.chain().focus().setLink({ href }).run();
    }
    setLinkModal(false);
    setLinkUrl("");
  }, [editor, linkUrl]);

  const applyImage = useCallback(() => {
    if (!editor || !imageUrl.trim()) return;
    editor.chain().focus().setImage({ src: imageUrl.trim() }).run();
    setImageModal(false);
    setImageUrl("");
  }, [editor, imageUrl]);

  const applyEmbed = useCallback(() => {
    if (!editor || !embedUrl.trim()) return;
    editor.chain().focus().setYoutubeVideo({ src: embedUrl.trim() }).run();
    setEmbedModal(false);
    setEmbedUrl("");
  }, [editor, embedUrl]);

  if (!editor) return null;

  return (
    <>
      <style>{`
        .ProseMirror p.is-empty:first-child::before { content: attr(data-placeholder); color: #aaa; pointer-events: none; float: left; height: 0; }
        .ProseMirror p { margin: 0 0 1em; }
        .ProseMirror p:last-child { margin-bottom: 0; }
        .ProseMirror h2 { font-family: ${fontFamily}; font-size: 1.25rem; font-weight: 700; color: ${TEXT_DARK}; margin: 1.4em 0 0.4em; }
        .ProseMirror h3 { font-family: ${fontFamily}; font-size: 1.05rem; font-weight: 700; color: ${TEXT_DARK}; margin: 1.2em 0 0.3em; }
        .ProseMirror blockquote { border-left: 3px solid ${CRIMSON}; margin: 1em 0; padding: 0.1em 0 0.1em 1.2em; font-style: italic; color: #392a22; }
        .ProseMirror ul { list-style-type: disc; padding-left: 1.4em; margin: 0 0 1em; }
        .ProseMirror ol { list-style-type: decimal; padding-left: 1.4em; margin: 0 0 1em; }
        .ProseMirror li { margin-bottom: 0.25em; display: list-item; }
        .ProseMirror li p { margin: 0; }
        .ProseMirror a { color: ${CRIMSON}; text-decoration: underline; cursor: pointer; }
        .ProseMirror img { max-width: 100%; border-radius: 4px; margin: 0.5em 0; display: block; }
        .ProseMirror iframe { max-width: 100%; border-radius: 4px; margin: 0.5em 0; }
        .ProseMirror:focus { outline: none; }
        .editor-modal-overlay { position: fixed; inset: 0; zIndex: 500; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; }
        .editor-modal { background: white; border-radius: 8px; padding: 1.25rem; width: 360px; box-shadow: 0 8px 32px rgba(0,0,0,0.15); display: flex; flex-direction: column; gap: 0.75rem; }
      `}</style>

      <EditorContent editor={editor} />

      {/* Link modal */}
      {linkModal && (
        <div className="editor-modal-overlay" onClick={() => setLinkModal(false)}>
          <div className="editor-modal" onClick={e => e.stopPropagation()}>
            <p style={{ fontFamily: FONT, fontWeight: 700, fontSize: "0.9rem", margin: 0, color: TEXT_DARK }}>Insert link</p>
            <input
              autoFocus
              placeholder="https://..."
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") applyLink(); if (e.key === "Escape") setLinkModal(false); }}
              style={{ fontFamily: FONT, fontSize: "0.9rem", padding: "0.5rem 0.7rem", border: `1px solid ${BORDER}`, borderRadius: 4, outline: "none", width: "100%", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              {editor.isActive("link") && (
                <button type="button" onClick={() => { editor.chain().focus().unsetLink().run(); setLinkModal(false); }} style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "0.4rem 0.8rem", fontFamily: FONT, fontSize: "0.85rem", cursor: "pointer", color: "#392a22" }}>Remove</button>
              )}
              <button type="button" onClick={() => setLinkModal(false)} style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "0.4rem 0.8rem", fontFamily: FONT, fontSize: "0.85rem", cursor: "pointer", color: "#392a22" }}>Cancel</button>
              <button type="button" onClick={applyLink} style={{ background: CRIMSON, border: "none", borderRadius: 4, padding: "0.4rem 0.8rem", fontFamily: FONT, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", color: "white" }}>Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* Image modal */}
      {imageModal && (
        <div className="editor-modal-overlay" onClick={() => setImageModal(false)}>
          <div className="editor-modal" onClick={e => e.stopPropagation()}>
            <p style={{ fontFamily: FONT, fontWeight: 700, fontSize: "0.9rem", margin: 0, color: TEXT_DARK }}>Insert image</p>
            <input
              autoFocus
              placeholder="https://..."
              value={imageUrl}
              onChange={e => setImageUrl(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") applyImage(); if (e.key === "Escape") setImageModal(false); }}
              style={{ fontFamily: FONT, fontSize: "0.9rem", padding: "0.5rem 0.7rem", border: `1px solid ${BORDER}`, borderRadius: 4, outline: "none", width: "100%", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setImageModal(false)} style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "0.4rem 0.8rem", fontFamily: FONT, fontSize: "0.85rem", cursor: "pointer", color: "#392a22" }}>Cancel</button>
              <button type="button" onClick={applyImage} disabled={!imageUrl.trim()} style={{ background: CRIMSON, border: "none", borderRadius: 4, padding: "0.4rem 0.8rem", fontFamily: FONT, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", color: "white", opacity: imageUrl.trim() ? 1 : 0.5 }}>Insert</button>
            </div>
          </div>
        </div>
      )}

      {/* Embed modal */}
      {embedModal && (
        <div className="editor-modal-overlay" onClick={() => setEmbedModal(false)}>
          <div className="editor-modal" onClick={e => e.stopPropagation()}>
            <p style={{ fontFamily: FONT, fontWeight: 700, fontSize: "0.9rem", margin: 0, color: TEXT_DARK }}>Insert embed</p>
            <input
              autoFocus
              placeholder="https://..."
              value={embedUrl}
              onChange={e => setEmbedUrl(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") applyEmbed(); if (e.key === "Escape") setEmbedModal(false); }}
              style={{ fontFamily: FONT, fontSize: "0.9rem", padding: "0.5rem 0.7rem", border: `1px solid ${BORDER}`, borderRadius: 4, outline: "none", width: "100%", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setEmbedModal(false)} style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "0.4rem 0.8rem", fontFamily: FONT, fontSize: "0.85rem", cursor: "pointer", color: "#392a22" }}>Cancel</button>
              <button type="button" onClick={applyEmbed} disabled={!embedUrl.trim()} style={{ background: CRIMSON, border: "none", borderRadius: 4, padding: "0.4rem 0.8rem", fontFamily: FONT, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", color: "white", opacity: embedUrl.trim() ? 1 : 0.5 }}>Embed</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
