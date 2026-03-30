import { DBSchema, openDB } from "idb";

import { SavedState } from "@/app/utils/types";

interface FontSmithDB extends DBSchema {
  "saved-fonts": {
    key: number;
    value: SavedState;
  };
}

function getDB() {
  return openDB<FontSmithDB>("font-smith", 1, {
    upgrade(db) {
      db.createObjectStore("saved-fonts", {
        keyPath: "id",
        autoIncrement: true,
      });
    },
  });
}

export async function getAllSavedFonts(): Promise<SavedState[]> {
  const db = await getDB();
  return db.getAll("saved-fonts");
}

export async function addSavedFont(
  font: Omit<SavedState, "id">,
): Promise<number> {
  const db = await getDB();
  return (await db.add("saved-fonts", font as SavedState)) as number;
}

export async function updateSavedFont(font: SavedState): Promise<void> {
  const db = await getDB();
  await db.put("saved-fonts", font);
}

export async function deleteSavedFont(id: number): Promise<void> {
  const db = await getDB();
  await db.delete("saved-fonts", id);
}
