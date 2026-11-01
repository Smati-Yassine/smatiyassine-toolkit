import * as vscode from 'vscode';

const STORAGE_KEY = 'smatiyassineToolkit.activity';
// A gap longer than this between edits or cursor moves counts as a break, not coding time.
const IDLE_LIMIT_MS = 2 * 60 * 1000;
const KEEP_DAYS = 60;
const STREAK_MIN_SECONDS = 60;

interface DayActivity {
  seconds: number;
  languages: Record<string, number>;
}

type History = Record<string, DayActivity>;

export interface Stats {
  todaySeconds: number;
  weekSeconds: number;
  streakDays: number;
  topLanguage: string | undefined;
  goalSeconds: number;
}

const LANGUAGE_NAMES: Record<string, string> = {
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  go: 'Go',
  html: 'HTML',
  java: 'Java',
  javascript: 'JavaScript',
  javascriptreact: 'JavaScript React',
  json: 'JSON',
  markdown: 'Markdown',
  php: 'PHP',
  plaintext: 'Plain Text',
  python: 'Python',
  rust: 'Rust',
  shellscript: 'Shell',
  sql: 'SQL',
  typescript: 'TypeScript',
  typescriptreact: 'TypeScript React',
  yaml: 'YAML'
};

function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function languageName(id: string): string {
  return LANGUAGE_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export class ActivityTracker implements vscode.Disposable {
  private readonly history: History;
  private lastBeat = 0;
  private dirty = false;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];

  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly storage: vscode.Memento) {
    this.history = storage.get<History>(STORAGE_KEY, {});
    this.prune();

    const beat = () => this.beat();
    const timer = setInterval(() => this.flush(), 30_000);
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === vscode.window.activeTextEditor?.document) {
          beat();
        }
      }),
      vscode.window.onDidChangeTextEditorSelection(beat),
      vscode.window.onDidChangeActiveTextEditor(beat),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          beat();
        } else {
          this.lastBeat = 0;
        }
      }),
      { dispose: () => clearInterval(timer) },
      this.changeEmitter
    );
  }

  stats(): Stats {
    const today = new Date();
    const goalHours = vscode.workspace.getConfiguration('smatiyassineToolkit').get<number>('dailyGoalHours', 4);

    // The week starts on Monday.
    const daysSinceMonday = (today.getDay() + 6) % 7;
    let weekSeconds = 0;
    const weekLanguages: Record<string, number> = {};
    for (let i = 0; i <= daysSinceMonday; i++) {
      const day = this.history[dayKey(this.daysAgo(today, i))];
      if (!day) {
        continue;
      }
      weekSeconds += day.seconds;
      for (const [lang, seconds] of Object.entries(day.languages)) {
        weekLanguages[lang] = (weekLanguages[lang] ?? 0) + seconds;
      }
    }
    const top = Object.entries(weekLanguages).sort((a, b) => b[1] - a[1])[0];

    // Today still counts toward the streak while it's in progress.
    let streakDays = 0;
    let offset = (this.history[dayKey(today)]?.seconds ?? 0) >= STREAK_MIN_SECONDS ? 0 : 1;
    while ((this.history[dayKey(this.daysAgo(today, offset))]?.seconds ?? 0) >= STREAK_MIN_SECONDS) {
      streakDays++;
      offset++;
    }

    return {
      todaySeconds: this.history[dayKey(today)]?.seconds ?? 0,
      weekSeconds,
      streakDays,
      topLanguage: top ? languageName(top[0]) : undefined,
      goalSeconds: goalHours * 3600
    };
  }

  flush() {
    if (!this.dirty) {
      return;
    }
    this.dirty = false;
    void this.storage.update(STORAGE_KEY, this.history);
    this.changeEmitter.fire();
  }

  dispose() {
    this.flush();
    this.disposables.forEach((d) => d.dispose());
  }

  private beat() {
    const now = Date.now();
    const editor = vscode.window.activeTextEditor;
    if (editor && this.lastBeat && now - this.lastBeat <= IDLE_LIMIT_MS) {
      const seconds = (now - this.lastBeat) / 1000;
      const day = (this.history[dayKey(new Date(now))] ??= { seconds: 0, languages: {} });
      const lang = editor.document.languageId;
      day.seconds += seconds;
      day.languages[lang] = (day.languages[lang] ?? 0) + seconds;
      this.dirty = true;
    }
    this.lastBeat = now;
  }

  private prune() {
    const oldest = dayKey(this.daysAgo(new Date(), KEEP_DAYS));
    for (const key of Object.keys(this.history)) {
      if (key < oldest) {
        delete this.history[key];
      }
    }
  }

  private daysAgo(from: Date, days: number): Date {
    return new Date(from.getFullYear(), from.getMonth(), from.getDate() - days);
  }
}
