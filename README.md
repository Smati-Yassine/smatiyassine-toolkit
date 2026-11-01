# SmatiYassine#Toolkit

Everyday tools in the VS Code sidebar. It follows your VS Code theme and stays out of the way.

Open it from the wrench icon in the activity bar.

## Today

A small dashboard of your coding time:

- **Coded today**, with progress toward a daily goal (4 hours by default)
- **This week**, counted from Monday
- **Streak**: days in a row with at least a minute of coding
- **Top language** this week

Time counts while you type or move the cursor in an editor. A pause longer than 2 minutes counts as a break. Everything is stored on your computer; nothing is sent anywhere.

Change the goal in Settings: `smatiyassineToolkit.dailyGoalHours`.

## Crypt / Decrypt

Encrypt text in the file you're editing, right where it is.

1. Select the text, or choose **Whole document**.
2. Type a password twice and press **Encrypt**. The text is replaced with a single `TK1:…` line.
3. To read it again, enter the password and press **Decrypt**. With **Whole document**, every encrypted block in the file is decrypted.

Press `Ctrl+Z` to undo either step.

Encryption uses AES-256-GCM with a key derived from your password by scrypt. There is no way to recover text if you forget the password.

## Links

- Portfolio: https://yassinesmati.vercel.app/
- GitHub: https://github.com/Smati-Yassine
- LinkedIn: https://www.linkedin.com/in/smati-yassine/

## License

MIT
