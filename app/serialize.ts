import paper from "paper";

// Initialize paper.js context
paper.setup([100, 100]);

export function replacer<T>(key: string, value: T) {
  if (value instanceof Map) {
    return {
      dataType: "Map",
      value: Array.from(value.entries()), // or with spread: value: [...value]
    };
  }
  return value;
}

export function reviver<T>(key: string, value: T) {
  if (Array.isArray(value) && value[0] === "CompoundPath") {
    return new paper.CompoundPath("").importJSON(JSON.stringify(value));
  }
  if (typeof value === "object" && value !== null) {
    if ("dataType" in value) {
      if (value.dataType === "Map") {
        // @ts-expect-error value should exist
        return new Map(value.value);
      } else if (value.dataType === "CompoundPath") {
        // @ts-expect-error value should exist
        return new paper.CompoundPath("").importJSON(value.value);
      }
    }
  }
  return value;
}
