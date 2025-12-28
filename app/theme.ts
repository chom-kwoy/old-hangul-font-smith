"use client";

import { createTheme } from "@mui/material";

export const theme = createTheme({
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          transition: "none !important",
        },
      },
    },
  },
});
