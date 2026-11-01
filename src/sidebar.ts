import * as path from 'path';
import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { DecryptError, TOKEN_PATTERN, decryptText, encryptText } from './crypto';
import { ActivityTracker } from './tracker';

type Scope = 'selection' | 'document';

type IncomingMessage =
  | { type: 'ready' }
  | { type: 'encrypt'; password: string; scope: Scope }
  | { type: 'decrypt'; password: string; scope: Scope };

const WHOLE_TOKEN = new RegExp(`^${TOKEN_PATTERN.source}$`);

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'smatiyassineToolkit.sidebar';

  private view: vscode.WebviewView | undefined;
  // Focusing the sidebar can clear activeTextEditor, so remember the last one.
  private lastEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly tracker: ActivityTracker
  ) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);

    const subscriptions = [
      view.webview.onDidReceiveMessage((message: IncomingMessage) => this.onMessage(message)),
      this.tracker.onDidChange(() => this.postStats()),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.lastEditor = editor;
        }
        this.postEditor();
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        this.lastEditor = e.textEditor;
        this.postEditor();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('smatiyassineToolkit')) {
          this.postStats();
        }
      }),
      view.onDidChangeVisibility(() => {
        if (view.visible) {
          this.tracker.flush();
          this.postStats();
          this.postEditor();
        }
      })
    ];
    view.onDidDispose(() => {
      subscriptions.forEach((d) => d.dispose());
      this.view = undefined;
    });
  }

  private async onMessage(message: IncomingMessage) {
    switch (message.type) {
      case 'ready':
        this.postStats();
        this.postEditor();
        break;
      case 'encrypt':
        await this.run(() => this.encrypt(message.password, message.scope));
        break;
      case 'decrypt':
        await this.run(() => this.decrypt(message.password, message.scope));
        break;
    }
  }

  private async run(action: () => Promise<string>) {
    try {
      this.post({ type: 'result', ok: true, text: await action() });
    } catch (err) {
      const text = err instanceof DecryptError || err instanceof UserError ? err.message : `Something went wrong: ${String(err)}`;
      this.post({ type: 'result', ok: false, text });
    }
  }

  private async encrypt(password: string, scope: Scope): Promise<string> {
    const editor = this.editor();
    const ranges = this.ranges(editor, scope);
    const document = editor.document;
    const version = document.version;

    const texts = ranges.map((r) => document.getText(r));
    if (texts.some((t) => WHOLE_TOKEN.test(t.trim()))) {
      throw new UserError('This text is already encrypted.');
    }
    const encrypted = await Promise.all(texts.map((t) => encryptText(t, password)));

    await this.apply(editor, version, ranges.map((range, i) => ({ range, text: encrypted[i] })));
    return `Encrypted the ${scope}. Press Ctrl+Z to undo.`;
  }

  private async decrypt(password: string, scope: Scope): Promise<string> {
    const editor = this.editor();
    const ranges = this.ranges(editor, scope);
    const document = editor.document;
    const version = document.version;

    const tokens: { range: vscode.Range; token: string }[] = [];
    for (const range of ranges) {
      const start = document.offsetAt(range.start);
      for (const match of document.getText(range).matchAll(TOKEN_PATTERN)) {
        const offset = start + (match.index ?? 0);
        tokens.push({
          range: new vscode.Range(document.positionAt(offset), document.positionAt(offset + match[0].length)),
          token: match[0]
        });
      }
    }
    if (tokens.length === 0) {
      throw new UserError(`No encrypted text found in the ${scope}.`);
    }
    const plain = await Promise.all(tokens.map((t) => decryptText(t.token, password)));

    await this.apply(editor, version, tokens.map((t, i) => ({ range: t.range, text: plain[i] })));
    return tokens.length === 1 ? 'Decrypted.' : `Decrypted ${tokens.length} blocks.`;
  }

  private editor(): vscode.TextEditor {
    const editor = vscode.window.activeTextEditor ?? this.lastEditor;
    if (!editor || editor.document.isClosed) {
      throw new UserError('Open a text file first.');
    }
    return editor;
  }

  private ranges(editor: vscode.TextEditor, scope: Scope): vscode.Range[] {
    if (scope === 'document') {
      const document = editor.document;
      return [new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length))];
    }
    const selections = editor.selections.filter((s) => !s.isEmpty);
    if (selections.length === 0) {
      throw new UserError('Select some text first, or choose Whole document.');
    }
    return selections;
  }

  private async apply(editor: vscode.TextEditor, version: number, edits: { range: vscode.Range; text: string }[]) {
    if (editor.document.version !== version) {
      throw new UserError('The file changed while this was running. Try again.');
    }
    const ok = await editor.edit((builder) => edits.forEach((e) => builder.replace(e.range, e.text)));
    if (!ok) {
      throw new UserError('VS Code could not change the file. Is it read-only?');
    }
  }

  private postStats() {
    this.post({ type: 'stats', ...this.tracker.stats() });
  }

  private postEditor() {
    const editor = vscode.window.activeTextEditor ?? this.lastEditor;
    if (!editor || editor.document.isClosed) {
      this.post({ type: 'editor', fileName: null, selectedLines: 0 });
      return;
    }
    const selectedLines = editor.selections
      .filter((s) => !s.isEmpty)
      .reduce((sum, s) => sum + s.end.line - s.start.line + (s.end.character === 0 ? 0 : 1), 0);
    this.post({ type: 'editor', fileName: path.basename(editor.document.fileName), selectedLines });
  }

  private post(message: object) {
    void this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview, media: vscode.Uri): string {
    const nonce = randomBytes(16).toString('base64');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'sidebar.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'sidebar.js'));
    const chevron = '<svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
<title>SmatiYassine#Toolkit</title>
</head>
<body>
<main>
  <div id="home">
    <button type="button" class="section-header" id="today-header" aria-expanded="true" aria-controls="today-body">${chevron}TODAY</button>
    <div class="section-body stats" id="today-body">
      <div class="stat-group">
        <div class="row"><span>Coded today</span><span id="today-time">0m</span></div>
        <div class="meter" id="goal-meter" role="progressbar" aria-label="Daily goal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="meter-fill" id="goal-fill"></div></div>
        <div class="hint" id="goal-text"></div>
      </div>
      <div class="row"><span>This week</span><span id="week-time">0m</span></div>
      <div class="row"><span>Streak</span><span id="streak">0 days</span></div>
      <div class="row"><span>Top language</span><span id="top-language">None yet</span></div>
    </div>

    <button type="button" class="section-header" id="apps-header" aria-expanded="true" aria-controls="apps-body">${chevron}APPS</button>
    <div class="section-body" id="apps-body">
      <button type="button" class="list-item" id="open-crypt">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
        Crypt / Decrypt
      </button>
    </div>
  </div>

  <div id="crypt" hidden>
    <div class="view-header">
      <button type="button" class="icon-button" id="back" aria-label="Back to apps" title="Back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
      </button>
      CRYPT / DECRYPT
    </div>
    <form class="form" id="crypt-form">
      <fieldset>
        <legend>Apply to</legend>
        <label class="radio" for="scope-selection"><input type="radio" id="scope-selection" name="scope" value="selection">Selection <span class="hint" id="selection-info"></span></label>
        <label class="radio" for="scope-document"><input type="radio" id="scope-document" name="scope" value="document">Whole document <span class="hint" id="document-info"></span></label>
      </fieldset>
      <div class="field">
        <label for="password">Password</label>
        <input type="password" id="password" autocomplete="off">
      </div>
      <div class="field">
        <label for="confirm">Confirm password</label>
        <input type="password" id="confirm" autocomplete="off">
        <span class="hint">Needed to encrypt. A typo here would lock the text for good.</span>
      </div>
      <div class="buttons">
        <button type="submit" class="primary" id="encrypt">Encrypt</button>
        <button type="button" class="secondary" id="decrypt">Decrypt</button>
      </div>
      <div id="message" role="status"></div>
    </form>
  </div>
</main>

<footer>
  <a href="https://yassinesmati.vercel.app/" class="icon-button" aria-label="Portfolio" title="Portfolio">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
  </a>
  <a href="https://github.com/Smati-Yassine" class="icon-button" aria-label="GitHub" title="GitHub">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
  </a>
  <a href="https://www.linkedin.com/in/smati-yassine/" class="icon-button" aria-label="LinkedIn" title="LinkedIn">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect width="4" height="12" x="2" y="9"/><circle cx="4" cy="4" r="2"/></svg>
  </a>
</footer>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

class UserError extends Error {}
