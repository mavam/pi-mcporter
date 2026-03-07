export function raceAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error("Cancelled."));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new Error("Cancelled."));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function textContent(text: string): { type: "text"; text: string }[] {
  return [{ type: "text", text }];
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function cleanSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function cleanParagraph(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function safeStringify(value: unknown, space = 2): string {
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(
      value,
      (_key, currentValue) => {
        if (typeof currentValue === "bigint") {
          return currentValue.toString();
        }
        if (typeof currentValue === "object" && currentValue !== null) {
          if (seen.has(currentValue)) {
            return "[Circular]";
          }
          seen.add(currentValue);
        }
        return currentValue;
      },
      space,
    );
    return json ?? "null";
  } catch {
    return String(value);
  }
}
