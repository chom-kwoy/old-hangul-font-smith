"use client";

import { AdaptiveThemeProvider } from "adaptive-material-ui/theme/adaptiveThemeProvider";
import React from "react";

import { theme } from "@/app/theme";

export function AppWrapper({ children }: { children: React.ReactNode }) {
  return (
    <AdaptiveThemeProvider theme={theme}>{children}</AdaptiveThemeProvider>
  );
}
