import * as monaco from 'monaco-editor/editor/editor.api.js';
import '../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/editor/browser/coreCommands.js';
import 'monaco-editor/editor/browser/widget/diffEditor/diffEditor.contribution.js';
import 'monaco-editor/editor/browser/widget/diffEditor/registrations.contribution.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js';

declare const __EDITOR_WORKER_SOURCE__: string;

let workerUrl: string | undefined;
let consumers = 0;
const hostWindow = window as Window & { MonacoEnvironment?: monaco.Environment };
let previousEnvironment: monaco.Environment | undefined;
let environment: monaco.Environment | undefined;

function acquireWorker(): void {
  if (!workerUrl) {
    workerUrl = URL.createObjectURL(new Blob([__EDITOR_WORKER_SOURCE__], { type: 'text/javascript' }));
    previousEnvironment = hostWindow.MonacoEnvironment;
    const url = workerUrl;
    environment = {
      getWorker: () => new Worker(url, { name: 'clipboard-compare-diff' }),
    };
    hostWindow.MonacoEnvironment = environment;
  }
  consumers++;
}

/** The same diff widget used by VS Code; no custom diff algorithm or merge logic. */
export class ClipboardDiff {
  readonly editor: monaco.editor.IStandaloneDiffEditor;
  readonly original: monaco.editor.ITextModel;
  readonly modified: monaco.editor.ITextModel;
  private readonly subscriptions: monaco.IDisposable[] = [];
  private updating = false;
  private disposed = false;
  private readonly observer: ResizeObserver;

  constructor(container: HTMLElement, clipboard: string, note: string, onChange: (text: string) => void) {
    acquireWorker();
    this.original = monaco.editor.createModel(clipboard, 'markdown');
    this.modified = monaco.editor.createModel(note, 'markdown');
    this.editor = monaco.editor.createDiffEditor(container, {
      originalEditable: false,
      readOnly: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
      renderMarginRevertIcon: true,
      glyphMargin: true,
      // Keep VS Code's familiar restore arrows instead of SCM-specific gutter actions.
      renderGutterMenu: false,
      ignoreTrimWhitespace: true,
      diffAlgorithm: 'advanced',
      automaticLayout: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      fontSize: 14,
      wordWrap: 'off',
      accessibilityVerbose: true,
      originalAriaLabel: 'Clipboard (read only)',
      modifiedAriaLabel: 'Current note (editable)',
      hideUnchangedRegions: { enabled: false },
    });
    this.editor.setModel({ original: this.original, modified: this.modified });
    this.subscriptions.push(this.modified.onDidChangeContent(() => {
      if (!this.updating) onChange(this.modified.getValue());
    }));
    this.observer = new ResizeObserver(() => this.editor.layout());
    this.observer.observe(container);
  }

  /** External edits become undoable edits, rather than destroying the undo history. */
  setNote(text: string): void {
    if (this.modified.getValue() === text) return;
    this.updating = true;
    try {
      this.modified.pushStackElement();
      this.modified.pushEditOperations([], [{ range: this.modified.getFullModelRange(), text }], () => null);
      this.modified.pushStackElement();
    } finally {
      this.updating = false;
    }
  }

  setTheme(dark: boolean): void { monaco.editor.setTheme(dark ? 'vs-dark' : 'vs'); }
  navigate(direction: 'next' | 'previous'): void { this.editor.goToDiff(direction); }
  setSideBySide(value: boolean): void { this.editor.updateOptions({ renderSideBySide: value }); }
  setHideUnchanged(value: boolean): void { this.editor.updateOptions({ hideUnchangedRegions: { enabled: value } }); }
  setIgnoreWhitespace(value: boolean): void { this.editor.updateOptions({ ignoreTrimWhitespace: value }); }
  setWordWrap(value: boolean): void { this.editor.updateOptions({ diffWordWrap: value ? 'on' : 'off' }); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    for (const subscription of this.subscriptions) subscription.dispose();
    this.editor.dispose();
    this.original.dispose();
    this.modified.dispose();
    if (--consumers === 0 && workerUrl) {
      URL.revokeObjectURL(workerUrl);
      workerUrl = undefined;
      if (hostWindow.MonacoEnvironment === environment) {
        if (previousEnvironment === undefined) delete hostWindow.MonacoEnvironment;
        else hostWindow.MonacoEnvironment = previousEnvironment;
      }
      environment = undefined;
      previousEnvironment = undefined;
    }
  }
}
