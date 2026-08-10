type McporterStdioLoggingModule = {
  setStdioLogMode?: (mode: "silent") => unknown;
};

/**
 * MCPorter buffers stdio server diagnostics, but its default "auto" mode
 * writes them directly to stdout when a compatibility probe exits. Direct
 * stdout writes corrupt Pi's interactive display, so SDK use must stay quiet.
 * MCPORTER_STDIO_LOGS=1 still takes precedence inside MCPorter.
 */
export async function silenceMcporterStdioLogs(): Promise<void> {
  try {
    // MCPorter does not currently export this control from its package root.
    // Resolve the installed entry point so this also works when Pi installs the
    // extension in its package store instead of loading the source checkout.
    const entrypoint = import.meta.resolve("mcporter");
    const loggingUrl = new URL("./sdk-stdio-logging.js", entrypoint);
    const logging = (await import(
      loggingUrl.href
    )) as McporterStdioLoggingModule;
    logging.setStdioLogMode?.("silent");
  } catch {
    // Logging control is best-effort across MCPorter versions. Runtime creation
    // must remain available if the internal helper moves in a future release.
  }
}
