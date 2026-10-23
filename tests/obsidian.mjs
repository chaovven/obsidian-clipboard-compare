// Optional integration suite. Open a disposable vault named clipboard-compare-test-vault
// in Obsidian, install/enable the build there, then run this script. No other vault is touched.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const cli = process.env.OBSIDIAN_BIN ?? '/Applications/Obsidian.app/Contents/MacOS/obsidian';
function evaluate(code) {
  const output = execFileSync(cli, ['vault=clipboard-compare-test-vault', 'eval', `code=${code}`], { encoding: 'utf8' }).trim();
  const start = output.indexOf('=> ');
  if (start < 0) throw new Error(`Obsidian did not return a result: ${output}`);
  return JSON.parse(output.slice(start + 3));
}

assert.equal(evaluate('JSON.stringify(app.vault.getName())'), 'clipboard-compare-test-vault');
// Keep the native test entirely on a synthetic file. Capture and restore the clipboard.
execFileSync(cli, ['vault=clipboard-compare-test-vault', 'eval', `code=
  window.__clipboardCompareTest = {done:false};
  (async()=>{
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
    const wait = async predicate => { for(let i=0;i<100;i++){if(await predicate()) return;await sleep(50);}throw new Error('Timed out waiting for file synchronization'); };
    const originalClipboard = await navigator.clipboard.readText();
    let noteView;
    let comparison;
    try {
      const path = 'Clipboard Compare Integration.md';
      let file = app.vault.getFileByPath(path);
      if (!file) file = await app.vault.create(path, '# Native test\\n\\nOld sentence.\\n\\nKeep this unchanged.\\n');
      else await app.vault.modify(file, '# Native test\\n\\nOld sentence.\\n\\nKeep this unchanged.\\n');
      const leaf = app.workspace.getLeaf('tab');
      await leaf.openFile(file);
      noteView = leaf.view;
      noteView.editor.setValue('# Native test\\n\\nUnsaved sentence.\\n\\nKeep this unchanged.\\n');
      const baseline = noteView.editor.getValue();
      await navigator.clipboard.writeText(baseline.replace('Unsaved sentence.', 'Clipboard sentence.'));
      await app.plugins.plugins['clipboard-compare'].compare(noteView);
      comparison = app.workspace.getLeavesOfType('clipboard-compare').find(leaf => leaf.view.file === file).view;
      await wait(() => comparison.diff.editor.getLineChanges() !== null);
      assert(comparison.getViewData() === baseline, 'Unsaved editor contents were not used');
      assert(comparison.diff.original.getValue().includes('Clipboard sentence.'), 'Clipboard snapshot missing');
      await navigator.clipboard.writeText('Unrelated new clipboard');
      assert(comparison.diff.original.getValue().includes('Clipboard sentence.'), 'Snapshot changed with clipboard');

      const model = comparison.diff.modified;
      const replacement = baseline.replace('Unsaved sentence.', 'Clipboard sentence.');
      model.pushEditOperations([], [{range:model.getFullModelRange(),text:replacement}], () => null);
      await comparison.save();
      await wait(async () => await app.vault.read(file) === replacement);
      await wait(() => noteView.editor.getValue() === replacement);
      assert(comparison.getViewData() === replacement, 'Comparison view did not track edits');
      await model.undo();
      await comparison.save();
      await wait(async () => await app.vault.read(file) === baseline);
      await wait(() => noteView.editor.getValue() === baseline);

      const external = baseline + '\\nExternal editor update.\\n';
      noteView.editor.setValue(external);
      await noteView.save();
      await wait(() => comparison.getViewData() === external);
      assert(comparison.diff.modified.getValue() === external, 'External edit missing from Monaco');

      await app.fileManager.renameFile(file, 'Clipboard Compare Renamed.md');
      assert(comparison.getState().file === 'Clipboard Compare Renamed.md', 'Stale path after rename');
      await app.fileManager.renameFile(file, path);
      const final = external + '\\nSaved on close.\\n';
      model.pushEditOperations([], [{range:model.getFullModelRange(),text:final}], () => null);
      comparison.leaf.detach();
      await wait(async () => await app.vault.read(file) === final);
      await app.plugins.plugins['clipboard-compare'].compare(noteView);
      const reopened = app.workspace.getLeavesOfType('clipboard-compare').find(leaf => leaf.view.file === file).view;
      const pending = final + '\\nSaved when disabled.\\n';
      reopened.diff.modified.pushEditOperations([], [{range:reopened.diff.modified.getFullModelRange(),text:pending}], () => null);
      await app.plugins.disablePlugin('clipboard-compare');
      await wait(async () => await app.vault.read(file) === pending);
      await app.plugins.enablePlugin('clipboard-compare');
      window.__clipboardCompareTest = {done:true,passed:8};
    } catch(error) {
      window.__clipboardCompareTest = {done:true,error:String(error),stack:error.stack};
    } finally {
      await navigator.clipboard.writeText(originalClipboard);
    }
  })();
`], { encoding: 'utf8' });

let result;
for (let attempt = 0; attempt < 100; attempt++) {
  result = evaluate('JSON.stringify(window.__clipboardCompareTest)');
  if (result.done) break;
  await new Promise(resolve => setTimeout(resolve, 200));
}
assert.equal(result?.done, true, 'Integration test did not complete');
assert.equal(result.error, undefined, result.stack ?? result.error);
console.log(`Passed ${result.passed} native Obsidian checks: unsaved note, clipboard snapshot, save, undo, other-tab sync, rename, close flush, disable flush.`);
