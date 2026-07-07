import { createContext, useContext, useEffect, useMemo } from "react";
import { useAuth } from "./AuthContext";
import { getTheme } from "./themes";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const { user } = useAuth();
  const theme = useMemo(
    () => getTheme(user?.theme_mode || "dark", user?.theme_accent || "mauve"),
    [user?.theme_mode, user?.theme_accent]
  );

  useEffect(() => {
    const root = document.documentElement;
    Object.entries(theme.cssVars).forEach(([name, value]) => {
      root.style.setProperty(name, value);
    });
  }, [theme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
