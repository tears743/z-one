
import { useEffect } from "react";
import { AppSettings, DEFAULT_SETTINGS } from "../types/settings";

export function useSettings() {
  // We'll manage settings state in App.tsx or a Context, 
  // but for now let's just export the loader logic
  return {};
}

export const loadSettings = async (setSettings: (s: AppSettings) => void) => {
  if (window.electron && window.electron.ipcRenderer) {
    try {
      const savedSettings = await window.electron.ipcRenderer.invoke(
        "db:get-app-settings",
      );
      if (savedSettings) {
        setSettings({ ...DEFAULT_SETTINGS, ...savedSettings });
      }
    } catch (e) {
      console.error("Failed to load settings from DB", e);
    }
  } else {
    const savedSettings = localStorage.getItem("z-one-settings");
    if (savedSettings) {
      try {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) });
      } catch (e) {
        console.error("Failed to parse settings", e);
      }
    }
  }
};

export const saveSettings = async (
  newSettings: AppSettings, 
  setSettings: (s: AppSettings) => void
) => {
  setSettings(newSettings);
  if (window.electron && window.electron.ipcRenderer) {
    try {
      await window.electron.ipcRenderer.invoke(
        "db:save-app-settings",
        newSettings,
      );
    } catch (e) {
      console.error("Failed to save settings to DB", e);
    }
  } else {
    localStorage.setItem("z-one-settings", JSON.stringify(newSettings));
  }
};
