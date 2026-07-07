// tBai desktop — an always-on Electron shell around the existing tBai web app.
// The window is split into a native TOOLBAR strip on top (local toolbar.html) and
// the untouched web app below (loaded from its authorized dev origin so the whole
// feature set and Google login work unchanged). The two halves talk through the
// main process via IPC; the web app participates through a tiny preload bridge and
// is otherwise unaware of the desktop shell.
//
// The local tBai stack (Ollama + backend + Vite + tunnel, via start.bat) must be
// running for the app view to load; if it isn't up yet we show loading.html and retry.

const path = require("path");
const {
  app,
  BaseWindow,
  WebContentsView,
  Tray,
  Menu,
  globalShortcut,
  shell,
  nativeImage,
  ipcMain,
} = require("electron");

// The tBai web app's real origin. It MUST be https://localhost:5173 (not 127.0.0.1)
// because that exact origin is what's registered as an Authorized JavaScript Origin
// in the Google Cloud OAuth client — Google Identity Services validates against it.
const APP_URL = "https://localhost:5173";

// Present as plain Chrome, not Electron. Google refuses its OAuth flows in browsers
// whose user-agent says "Electron" (disallowed_useragent) — this keeps both the
// login button and the Calendar/Gmail/Drive auth-code popup working.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const TOOLBAR_H = 44;
const RETRY_MS = 3000;
const startHidden = process.argv.includes("--hidden");

let win = null;
let toolbarView = null;
let appView = null;
let tray = null;
let isQuitting = false;
let retryTimer = null;

// --- single instance ---------------------------------------------------------
// The global hotkey and launch-at-startup can both try to open the app; keep one.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
}

// --- self-signed cert --------------------------------------------------------
// Vite serves https via @vitejs/plugin-basic-ssl (self-signed). Trust it, but ONLY
// for our local origin — never blanket-disable certificate checking.
app.on("certificate-error", (event, _webContents, url, _error, _cert, callback) => {
  if (url.startsWith(APP_URL)) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

function loadApp() {
  if (!appView) return;
  appView.webContents.loadURL(APP_URL, { userAgent: USER_AGENT }).catch(() => {
    // did-fail-load handles the retry; swallow the rejection.
  });
}

function showLoading() {
  if (!appView) return;
  appView.webContents.loadFile(path.join(__dirname, "loading.html")).catch(() => {});
}

function layoutViews() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  toolbarView.setBounds({ x: 0, y: 0, width, height: TOOLBAR_H });
  appView.setBounds({ x: 0, y: TOOLBAR_H, width, height: Math.max(0, height - TOOLBAR_H) });
}

function createWindow() {
  win = new BaseWindow({
    width: 480,
    height: 820,
    minWidth: 380,
    minHeight: 520,
    show: false,
    title: "tBai",
    backgroundColor: "#181825",
    icon: path.join(__dirname, "build", "icon.ico"),
  });

  // Toolbar strip (local page) — always on top of the layout.
  toolbarView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "toolbar-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  toolbarView.setBackgroundColor("#181825");
  toolbarView.webContents.loadFile(path.join(__dirname, "toolbar.html"));

  // App view (the real web app).
  appView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "app-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  appView.webContents.setUserAgent(USER_AGENT);

  win.contentView.addChildView(toolbarView);
  win.contentView.addChildView(appView);
  layoutViews();

  showLoading();
  loadApp();

  // Retry until the local stack is reachable (survives launch-at-startup racing
  // the tBai stack coming up).
  appView.webContents.on("did-fail-load", (_e, errorCode, _desc, validatedURL) => {
    // -3 is ERR_ABORTED (normal on navigation); ignore it and non-app URLs.
    if (errorCode === -3) return;
    if (validatedURL && !validatedURL.startsWith(APP_URL)) return;
    showLoading();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(loadApp, RETRY_MS);
  });

  appView.webContents.on("did-finish-load", () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  });

  // Keep Google OAuth popups (auth-code connect flow) inside the app; send every
  // other external link to the system browser.
  appView.webContents.setWindowOpenHandler(({ url }) => {
    if (isGoogleUrl(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false },
        },
      };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  // OAuth popup windows need the same Chrome UA or Google rejects them.
  appView.webContents.on("did-create-window", (childWindow) => {
    childWindow.webContents.setUserAgent(USER_AGENT);
  });

  win.on("resize", layoutViews);

  // Closing hides to tray instead of quitting (unless we're really quitting).
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  if (!startHidden) win.show();
}

function isGoogleUrl(url) {
  try {
    const h = new URL(url).hostname;
    return h === "accounts.google.com" || h.endsWith(".google.com");
  } catch {
    return false;
  }
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && !win.isMinimized()) {
    win.hide();
  } else {
    showWindow();
  }
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(
    path.join(__dirname, "build", "tray.png")
  );
  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
  tray.setToolTip("tBai");
  rebuildTrayMenu();
  tray.on("click", toggleWindow);
}

function rebuildTrayMenu() {
  if (!tray) return;
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  const menu = Menu.buildFromTemplate([
    { label: "Show tBai", click: showWindow },
    { type: "separator" },
    {
      label: "Launch on Windows startup",
      type: "checkbox",
      checked: openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ["--hidden"] });
        rebuildTrayMenu();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

// --- toolbar <-> app relay ---------------------------------------------------
// Commands flow toolbar → app; state snapshots flow app → toolbar.
ipcMain.on("tbai:command", (_e, cmd) => {
  if (appView && !appView.webContents.isDestroyed()) {
    appView.webContents.send("tbai:command", cmd);
  }
});
ipcMain.on("tbai:state", (_e, state) => {
  if (toolbarView && !toolbarView.webContents.isDestroyed()) {
    toolbarView.webContents.send("tbai:state", state);
  }
});

if (gotLock) {
  app.whenReady().then(() => {
    createWindow();
    createTray();

    globalShortcut.register("CommandOrControl+Shift+Space", toggleWindow);

    app.on("activate", () => {
      if (!win) createWindow();
      else showWindow();
    });
  });

  // Tray app: don't quit when the window closes.
  app.on("window-all-closed", (e) => {
    e.preventDefault();
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    if (retryTimer) clearTimeout(retryTimer);
  });
}
