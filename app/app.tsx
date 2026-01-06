"use client";

import { AdaptiveThemeProvider } from "adaptive-material-ui/theme/adaptiveThemeProvider";
import React from "react";
import { Provider } from "react-redux";

import { store } from "@/app/redux/store";
import { theme } from "@/app/theme";

export function AppWrapper({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <AdaptiveThemeProvider theme={theme}>{children}</AdaptiveThemeProvider>
    </Provider>
  );
}
