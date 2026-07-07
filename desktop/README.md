# tBai Desktop

A minimal, always-on Windows desktop wrapper for tBai. It's a thin Electron shell
that loads the existing tBai web app at `https://localhost:5173`, so it has the full
feature set (chat, lists, notifications, admin, Google login) with no duplicated code.

"Minimal by design" is the shell: a compact window that hides to the system tray and
is summoned with a global hotkey.

## Prerequisite

The local tBai stack must be running — start it from the repo root:

```powershell
.\start.bat
```

(This launches Ollama, the backend, the Vite dev server on `:5173`, and the tunnel.)
If the app opens before the stack is up it shows a "Starting tBai…" screen and
connects automatically once `localhost:5173` responds.

## Run (development)

```powershell
cd desktop
npm install
npm start
```

## Build a Windows executable

```powershell
cd desktop
npm run dist
```

This produces an installer under `desktop/dist/`. Install and run that exe for daily
use — a real installed executable is what makes **Launch on Windows startup** work
(it points Windows at the installed app rather than a bare `electron.exe`).

## Feature toolbar

A compact icon toolbar sits above the web app for one-click access from any page:

`🏠 Home · 💬 Chats · ➕ New Chat · 📝 Lists · 🛡️ Admin (admins only) · [model ▾] · 🔔 Notifications · ⚙️ Settings · ⏻ Sign out`

The toolbar drives the web app through a tiny command bridge (`app-preload.js` /
`toolbar-preload.js`, relayed by `main.js`). The web app participates only through
`frontend/src/desktopBridge.js`, which is a no-op in a normal browser — so the web
app is unchanged when opened outside the desktop shell.

## Features / behaviors

- **System tray** — closing the window hides it to the tray; click the tray icon to
  toggle, right-click for the menu (Show, Launch on startup, Quit).
- **Global hotkey** — `Ctrl+Shift+Space` shows/hides the window from anywhere.
- **Launch on Windows startup** — toggle it from the tray menu; when enabled the app
  starts minimized to the tray at login.

## Notes

- The window loads `https://localhost:5173` specifically (not `127.0.0.1`) because
  that exact origin is the one authorized for Google sign-in.
- The app trusts Vite's self-signed certificate for `localhost:5173` only.
- It reports a plain Chrome user-agent so Google's OAuth flows don't reject it as an
  embedded browser.
