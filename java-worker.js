/* WasmLab real Java engine worker.
   Runs a genuine OpenJDK 17 JVM (CheerpJ, WebAssembly) plus the Eclipse
   Compiler for Java (ECJ) to compile and run real Java in the browser. */
"use strict";

let __cjInitPromise = null;

function __cjEnsure() {
  if (!__cjInitPromise) {
    __cjInitPromise = (async () => {
      importScripts("https://cjrtnc.leaningtech.com/4.3/loader.js");
      await cheerpjInit({ version: 17, status: "none" });
    })();
    __cjInitPromise.catch(() => { __cjInitPromise = null; });
  }
  return __cjInitPromise;
}

async function __cjRead(path) {
  try {
    const blob = await cjFileBlob(path);
    return await blob.text();
  } catch (e) {
    return null;
  }
}

self.onmessage = async (ev) => {
  const d = ev.data || {};
  if (d.cmd !== "run") return;
  const id = d.id;
  const outBase = "/files/run" + id;
  try {
    postMessage({ id, type: "status", stage: "boot", text: "boot" });
    await __cjEnsure();
    postMessage({ id, type: "status", stage: "compile", text: "compile" });


    // /str/ is a flat filesystem, so pack stdin + all sources into one file;
    // the Java Runner unpacks it into its own /files/ workspace.
    const stdin = d.stdin || "";
    let pack = String(stdin.length) + "\n" + stdin + String(d.sources.length) + "\n";
    for (const s of d.sources) {
      pack += s.name + "\n" + String(s.content.length) + "\n" + s.content;
    }
    const packPath = "/str/run" + id + ".pack";
    cheerpOSAddStringFile(packPath, pack);

    // Stream output while the program runs.
    let streaming = true;
    let streamed = 0;
    const poller = (async () => {
      while (streaming) {
        await new Promise((r) => setTimeout(r, 400));
        if (!streaming) break;
        try {
          const txt = await __cjRead(outBase + "/output.txt");
          if (txt && txt.length > streamed) {
            postMessage({ id, type: "stdout-delta", text: txt.slice(streamed) });
            streamed = txt.length;
          }
        } catch (_) {}
      }
    })();

    let exitCode = -1;
    let runError = null;
    try {
      exitCode = await cheerpjRunMain(
        "Runner",
        "/app" + self.location.pathname.replace(/[^/]*$/, "") + "jrunner.jar:/app" + self.location.pathname.replace(/[^/]*$/, "") + "9-ecj342.jar",
        packPath,
        String(d.preferred || ""),
        outBase
      );
    } catch (e) {
      runError = String((e && e.message) || e);
    }
    streaming = false;
    try { await poller; } catch (_) {}

    const status = await __cjRead(outBase + "/status.txt");
    const output = await __cjRead(outBase + "/output.txt");
    const report = await __cjRead(outBase + "/compile-report.txt");
    const runnerError = await __cjRead(outBase + "/runner-error.txt");
    postMessage({
      id, type: "done", status, output, report, runnerError, runError, exitCode,
      alreadyStreamed: streamed
    });
  } catch (e) {
    postMessage({ id, type: "fatal", message: String((e && e.message) || e) });
  }
};
