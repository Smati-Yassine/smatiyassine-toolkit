import * as vscode from 'vscode';
import { ActivityTracker } from './tracker';
import { SidebarProvider } from './sidebar';

export function activate(context: vscode.ExtensionContext) {
  const tracker = new ActivityTracker(context.globalState);
  const sidebar = new SidebarProvider(context.extensionUri, tracker);

  context.subscriptions.push(
    tracker,
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar)
  );
}

export function deactivate() {}
