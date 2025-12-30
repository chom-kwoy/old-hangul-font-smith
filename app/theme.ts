"use client";

import { createTheme } from "@mui/material";
import { amber } from "@mui/material/colors";

export const theme = createTheme({
  palette: {
    primary: amber,
    secondary: {
      main: "#E0C2FF",
      light: "#F5EBFF",
      // dark: will be calculated from palette.secondary.main,
      contrastText: "#47008F",
    },
  },
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
