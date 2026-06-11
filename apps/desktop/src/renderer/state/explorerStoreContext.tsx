import { type ReactNode, createContext, useContext } from "react";

import type { NavigationStore, PreferencesStore, WriteOperationsStore } from "./explorerStores";

// Store contexts let leaf components (dialogs, panes) subscribe to domain
// state directly instead of receiving every field through App's prop chain.
const NavigationContext = createContext<NavigationStore | null>(null);
const DialogsContext = createContext<WriteOperationsStore | null>(null);
const PreferencesContext = createContext<PreferencesStore | null>(null);

export function ExplorerStoreProvider({
  navigation,
  dialogs,
  preferences,
  children,
}: {
  navigation: NavigationStore;
  dialogs: WriteOperationsStore;
  preferences: PreferencesStore;
  children: ReactNode;
}) {
  return (
    <NavigationContext.Provider value={navigation}>
      <DialogsContext.Provider value={dialogs}>
        <PreferencesContext.Provider value={preferences}>{children}</PreferencesContext.Provider>
      </DialogsContext.Provider>
    </NavigationContext.Provider>
  );
}

function useRequiredContext<T>(context: React.Context<T | null>, name: string): T {
  const value = useContext(context);
  if (value === null) {
    throw new Error(`${name} must be used within ExplorerStoreProvider`);
  }
  return value;
}

export function useNavigationStore(): NavigationStore {
  return useRequiredContext(NavigationContext, "useNavigationStore");
}

export function useDialogStore(): WriteOperationsStore {
  return useRequiredContext(DialogsContext, "useDialogStore");
}

export function usePreferencesStore(): PreferencesStore {
  return useRequiredContext(PreferencesContext, "usePreferencesStore");
}
