import { MarkdownView, Menu, Notice, Plugin, TextFileView, TFile, type ViewStateResult } from 'obsidian';
import { ClipboardDiff } from './diff';

export const VIEW_TYPE = 'clipboard-compare';

interface CompareState extends Record<string, unknown> {
  file?: string;
  clipboard?: string;
  sideBySide?: boolean;
  hideUnchanged?: boolean;
  ignoreWhitespace?: boolean;
  wordWrap?: boolean;
}

export default class ClipboardComparePlugin extends Plugin {
  onload(): void {
    this.registerView(VIEW_TYPE, leaf => new ClipboardCompareView(leaf));
    this.addCommand({
      id: 'compare-active-file-with-clipboard',
      name: 'Compare active file with clipboard',
      checkCallback: checking => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) return false;
        if (!checking) void this.compare(view);
        return true;
      },
    });
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file, source, leaf) => {
      if (!(file instanceof TFile) || file.extension !== 'md' || !(leaf?.view instanceof MarkdownView) || leaf.view.file !== file) return;
      menu.addItem(item => item.setTitle('Compare with clipboard').setIcon('git-compare-arrows')
        .onClick(() => { void this.compare(leaf.view as MarkdownView); }));
    }));
  }

  private async compare(view: MarkdownView): Promise<void> {
    const file = view.file;
    if (!file) return;
    try {
      // Freeze the clipboard once; never poll or overwrite the user's clipboard.
      const clipboard = await navigator.clipboard.readText();
      await view.save();
      const leaf = this.app.workspace.getLeaf('tab');
      try {
        await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { file: file.path, clipboard } });
        await this.app.workspace.revealLeaf(leaf);
      } catch (error) {
        leaf.detach();
        throw error;
      }
    } catch (error) {
      console.error('Clipboard Compare:', error);
      new Notice('Could not open clipboard comparison. Check clipboard permission and try again.');
    }
  }

}

/** TextFileView delegates saving, renames, deletion and external updates to Obsidian. */
export class ClipboardCompareView extends TextFileView {
  private diff?: ClipboardDiff;
  private clipboard = '';
  private text = '';
  private state: CompareState = {};
  private status?: HTMLElement;
  private themeObserver?: MutationObserver;
  private loading = false;

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return `Clipboard ↔ ${this.file?.name ?? 'Note'}`; }
  getIcon(): string { return 'git-compare-arrows'; }
  canAcceptExtension(extension: string): boolean { return extension === 'md'; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('clipboard-compare-view');
    const toolbar = this.contentEl.createDiv({ cls: 'clipboard-compare-toolbar' });
    this.status = toolbar.createSpan({ text: 'Comparing…', cls: 'clipboard-compare-status' });
    this.button(toolbar, 'Previous change', '↑', () => this.diff?.navigate('previous'));
    this.button(toolbar, 'Next change', '↓', () => this.diff?.navigate('next'));
    this.button(toolbar, 'Comparison options', '⋯', event => this.showOptions(event));
    const labels = this.contentEl.createDiv({ cls: 'clipboard-compare-labels' });
    labels.createSpan({ text: 'Clipboard · read only' });
    labels.createSpan({ text: 'Current note · editable' });
    const container = this.contentEl.createDiv({ cls: 'clipboard-compare-editor' });
    this.diff = new ClipboardDiff(container, this.clipboard, this.text, text => {
      if (this.loading) return;
      this.text = text;
      this.data = text;
      this.requestSave();
    });
    this.register(() => this.diff?.dispose());
    const updates = this.diff.editor.onDidUpdateDiff(() => {
      const changes = this.diff?.editor.getLineChanges();
      if (this.status) this.status.textContent = changes === null || changes === undefined
        ? 'Comparing…' : changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : 'No differences';
    });
    this.register(() => updates.dispose());
    this.themeObserver = new MutationObserver(() => this.updateTheme());
    this.themeObserver.observe(this.contentEl.ownerDocument.body, { attributes: true, attributeFilter: ['class'] });
    this.register(() => this.themeObserver?.disconnect());
    this.updateTheme();
  }

  private button(parent: HTMLElement, label: string, text: string, action: (event: MouseEvent) => void): void {
    const button = parent.createEl('button', { text, attr: { 'aria-label': label, title: label } });
    this.registerDomEvent(button, 'click', action);
  }

  private updateTheme(): void {
    this.diff?.setTheme(this.contentEl.ownerDocument.body.classList.contains('theme-dark'));
  }

  private applyOptions(): void {
    this.diff?.setSideBySide(this.state.sideBySide !== false);
    this.diff?.setHideUnchanged(this.state.hideUnchanged === true);
    this.diff?.setIgnoreWhitespace(this.state.ignoreWhitespace !== false);
    this.diff?.setWordWrap(this.state.wordWrap === true);
  }

  private showOptions(event: MouseEvent): void {
    const menu = new Menu();
    const options: [keyof CompareState, string, boolean][] = [
      ['sideBySide', 'Side by side', this.state.sideBySide !== false],
      ['hideUnchanged', 'Hide unchanged regions', this.state.hideUnchanged === true],
      ['ignoreWhitespace', 'Ignore leading and trailing whitespace', this.state.ignoreWhitespace !== false],
      ['wordWrap', 'Word wrap', this.state.wordWrap === true],
    ];
    for (const [key, title, enabled] of options) {
      menu.addItem(item => item.setTitle(title).setChecked(enabled).onClick(() => {
        this.state = { ...this.state, [key]: !enabled };
        this.applyOptions();
        this.app.workspace.requestSaveLayout();
      }));
    }
    menu.showAtMouseEvent(event);
  }

  async setState(state: CompareState, result: ViewStateResult): Promise<void> {
    this.state = { ...state };
    this.clipboard = state.clipboard ?? '';
    if (this.diff && this.diff.original.getValue() !== this.clipboard) this.diff.original.setValue(this.clipboard);
    await super.setState(state, result);
    this.applyOptions();
  }

  getState(): CompareState {
    // Persist the snapshot so a restored comparison never reads an unrelated clipboard.
    return { ...super.getState(), ...this.state, file: this.file?.path, clipboard: this.clipboard };
  }

  getViewData(): string { return this.text; }

  setViewData(data: string, clear: boolean): void {
    this.text = data;
    this.data = data;
    this.loading = true;
    try {
      if (clear && this.diff) this.diff.modified.setValue(data);
      else this.diff?.setNote(data);
    } finally {
      this.loading = false;
    }
  }

  clear(): void {
    this.text = '';
    this.data = '';
    this.loading = true;
    try { this.diff?.modified.setValue(''); }
    finally { this.loading = false; }
  }

  async onClose(): Promise<void> {
    await this.save();
    this.diff?.dispose();
    this.themeObserver?.disconnect();
  }
}
