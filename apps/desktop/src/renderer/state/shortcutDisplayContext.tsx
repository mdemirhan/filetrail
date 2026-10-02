import { type ReactNode, createContext, useContext } from "react";

import { DEFAULT_SHORTCUT_DISPLAY, type ShortcutDisplay } from "../lib/shortcutDisplay";

// The shortcuts as they are shown, for the buttons and menus that name one. It changes
// only when a shortcut is changed in Settings.
const ShortcutDisplayContext = createContext<ShortcutDisplay>(DEFAULT_SHORTCUT_DISPLAY);

export function ShortcutDisplayProvider({
  value,
  children,
}: {
  value: ShortcutDisplay;
  children: ReactNode;
}) {
  return (
    <ShortcutDisplayContext.Provider value={value}>{children}</ShortcutDisplayContext.Provider>
  );
}

export function useShortcutDisplay(): ShortcutDisplay {
  return useContext(ShortcutDisplayContext);
}
