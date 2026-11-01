// @ts-check
(function () {
  // @ts-ignore acquireVsCodeApi is provided by the webview host.
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  // Passwords are never saved; only which screen and sections are open.
  const ui = {
    view: saved.view || 'home',
    todayOpen: saved.todayOpen !== false,
    appsOpen: saved.appsOpen !== false,
    scope: saved.scope || 'selection'
  };

  /** @param {string} id */
  const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const password = /** @type {HTMLInputElement} */ ($('password'));
  const confirm = /** @type {HTMLInputElement} */ ($('confirm'));
  const encryptButton = /** @type {HTMLButtonElement} */ ($('encrypt'));
  const decryptButton = /** @type {HTMLButtonElement} */ ($('decrypt'));

  function save() {
    vscode.setState(ui);
  }

  function render() {
    $('home').hidden = ui.view !== 'home';
    $('crypt').hidden = ui.view !== 'crypt';
    for (const name of ['today', 'apps']) {
      const open = ui[name + 'Open'];
      $(name + '-header').setAttribute('aria-expanded', String(open));
      $(name + '-body').hidden = !open;
    }
    /** @type {HTMLInputElement} */ ($('scope-selection')).checked = ui.scope === 'selection';
    /** @type {HTMLInputElement} */ ($('scope-document')).checked = ui.scope === 'document';
  }

  /** @param {number} seconds */
  function duration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`;
  }

  /** @param {string} text @param {boolean} isError */
  function showMessage(text, isError) {
    const message = $('message');
    message.textContent = text;
    message.classList.toggle('error', isError);
  }

  /** @param {boolean} busy */
  function setBusy(busy) {
    encryptButton.disabled = busy;
    decryptButton.disabled = busy;
  }

  for (const name of ['today', 'apps']) {
    $(name + '-header').addEventListener('click', () => {
      ui[name + 'Open'] = !ui[name + 'Open'];
      save();
      render();
    });
  }

  $('open-crypt').addEventListener('click', () => {
    ui.view = 'crypt';
    save();
    render();
    password.focus();
  });

  $('back').addEventListener('click', () => {
    ui.view = 'home';
    save();
    render();
  });

  for (const id of ['scope-selection', 'scope-document']) {
    $(id).addEventListener('change', (e) => {
      ui.scope = /** @type {HTMLInputElement} */ (e.target).value;
      save();
    });
  }

  $('crypt-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!password.value) {
      showMessage('Enter a password.', true);
      return;
    }
    if (password.value !== confirm.value) {
      showMessage("The passwords don't match.", true);
      return;
    }
    setBusy(true);
    showMessage('Encrypting…', false);
    vscode.postMessage({ type: 'encrypt', password: password.value, scope: ui.scope });
  });

  decryptButton.addEventListener('click', () => {
    if (!password.value) {
      showMessage('Enter a password.', true);
      return;
    }
    setBusy(true);
    showMessage('Decrypting…', false);
    vscode.postMessage({ type: 'decrypt', password: password.value, scope: ui.scope });
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'stats': {
        const percent = message.goalSeconds > 0 ? Math.min(100, Math.round((message.todaySeconds / message.goalSeconds) * 100)) : 0;
        $('today-time').textContent = duration(message.todaySeconds);
        $('goal-fill').style.width = percent + '%';
        $('goal-meter').setAttribute('aria-valuenow', String(percent));
        $('goal-text').textContent = `${percent}% of ${duration(message.goalSeconds)} daily goal`;
        $('week-time').textContent = duration(message.weekSeconds);
        $('streak').textContent = message.streakDays === 1 ? '1 day' : `${message.streakDays} days`;
        $('top-language').textContent = message.topLanguage || 'None yet';
        break;
      }
      case 'editor':
        if (!message.fileName) {
          $('selection-info').textContent = '(no file open)';
          $('document-info').textContent = '';
        } else {
          const lines = message.selectedLines;
          $('selection-info').textContent = lines === 0 ? '(nothing selected)' : lines === 1 ? '(1 line)' : `(${lines} lines)`;
          $('document-info').textContent = `(${message.fileName})`;
        }
        break;
      case 'result':
        setBusy(false);
        showMessage(message.text, !message.ok);
        if (message.ok) {
          confirm.value = '';
        }
        break;
    }
  });

  render();
  vscode.postMessage({ type: 'ready' });
})();
