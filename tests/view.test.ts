import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/diff', () => ({ ClipboardDiff: class {} }));
vi.mock('obsidian', () => ({
  Plugin: class {}, MarkdownView: class {}, Menu: class {}, Notice: class {}, TFile: class {},
  TextFileView: class {
    data = '';
    file: { path: string } | null = null;
    requestSave = vi.fn();
    save = vi.fn(async () => {});
    async setState(state: { file: string }) { this.file = { path: state.file }; }
    getState() { return { file: this.file?.path }; }
  },
}));

import { ClipboardCompareView, DEFAULT_OPTIONS } from '../src/main';

const plugin = { options: { ...DEFAULT_OPTIONS } } as never;

describe('Obsidian file lifecycle', () => {
  it('loads external file data without scheduling another write', () => {
    const view = new ClipboardCompareView({} as never, plugin);
    view.setViewData('笔记\n\n[[链接]]\n', false);
    expect(view.getViewData()).toBe('笔记\n\n[[链接]]\n');
    expect(view.data).toBe(view.getViewData());
    expect(view.requestSave).not.toHaveBeenCalled();
  });

  it('persists the clipboard snapshot and uses the current path after a rename', async () => {
    const view = new ClipboardCompareView({} as never, plugin);
    await view.setState({ file: 'old.md', clipboard: 'clipboard snapshot' }, { history: false });
    Object.assign(view, { file: { path: 'renamed.md' } });
    expect(view.getState()).toMatchObject({ file: 'renamed.md', clipboard: 'clipboard snapshot' });
  });

  it('clears the model without requesting a save of an empty file', () => {
    const view = new ClipboardCompareView({} as never, plugin);
    view.setViewData('keep on disk', true);
    view.clear();
    expect(view.getViewData()).toBe('');
    expect(view.requestSave).not.toHaveBeenCalled();
  });

  it('flushes pending changes on close', async () => {
    const view = new ClipboardCompareView({} as never, plugin);
    view.setViewData('pending edits', true);
    await view.onClose();
    expect(view.save).toHaveBeenCalledOnce();
  });
});
