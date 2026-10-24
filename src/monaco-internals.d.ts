// Minimal types for Monaco internals that are not part of the public editor API.
declare module 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js' {
  export const PasteAction: {
    addImplementation(priority: number, name: string, implementation: () => boolean | Promise<void>): { dispose(): void };
  } | undefined;
}

declare module 'monaco-editor/editor/browser/controller/editContext/clipboardUtils.js' {
  export const InMemoryClipboardMetadataManager: {
    INSTANCE: { get(text: string): { isFromEmptySelection?: boolean; multicursorText?: string[] | null; mode?: string | null } | null };
  };
}
