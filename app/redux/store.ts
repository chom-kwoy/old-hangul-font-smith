import { configureStore } from "@reduxjs/toolkit";

import fontReducer from "@/app/redux/features/font/font-slice";

export const store = configureStore({
  reducer: {
    font: fontReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

export type AppDispatch = typeof store.dispatch;
export type RootState = ReturnType<typeof store.getState>;
