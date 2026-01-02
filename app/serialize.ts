export function replacer<T>(key: string, value: T) {
  if (value instanceof Map) {
    return {
      dataType: "Map",
      value: Array.from(value.entries()), // or with spread: value: [...value]
    };
  } else {
    return value;
  }
}
export function reviver<T>(key: string, value: T) {
  if (typeof value === "object" && value !== null) {
    if ("dataType" in value && value.dataType === "Map") {
      // @ts-expect-error value should exist
      return new Map(value.value);
    }
  }
  return value;
}
