// The renderer has no `process`; the preload bridge passes the platform along (window.api.platform)
// for the few places macOS conventions differ - window controls and keyboard shortcuts.
export const isMac = window.api.platform === 'darwin'

/** The split-session shortcut: VS Code's on each platform. On macOS, Cmd+Shift+5 is the
 *  system's Screenshot tool and never reaches the app. */
export const SPLIT_SHORTCUT_LABEL = isMac ? '⌘\\' : 'Ctrl+Shift+5'
