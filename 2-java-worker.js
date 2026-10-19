/* WasmBrew real Java engine worker.
   Runs a genuine OpenJDK 17 JVM (CheerpJ, WebAssembly) plus the Eclipse
   Compiler for Java (ECJ) to compile and run real Java in the browser.
   The worker (and its JVM) stays alive between runs so repeat runs skip
   the whole JVM boot; the page only kills it on Stop or a fatal error. */
"use strict";

let __cjInitPromise = null;
let __warmedUp = false;

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

/* Tiny program used by background warmup: forces the JVM to load the runtime
   classes real programs use most (String, System.out, ArrayList, Scanner),
   so the lazy downloads happen before the user presses Run. */
const WARMUP_SOURCE = [
  "import java.util.ArrayList;",
  "import java.util.Scanner;",
  "public class Warmup {",
  "  public static void main(String[] args) {",
  "    ArrayList<String> list = new ArrayList<>();",
  "    list.add(\"java-ready\");",
  "    Scanner sc = new Scanner(\"1\");",
  "    System.out.println(list.get(0) + sc.nextInt());",
  "  }",
  "}"
].join("\n");

async function __runJava(id, d) {
  const t0 = Date.now();
  const outBase = "/files/run" + id;
  postMessage({ id, type: "status", stage: "boot", text: "boot" });
  await __cjEnsure();
  const tBoot = Date.now();
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

  // Heartbeat: proves the engine is alive while long downloads/compiles would
  // otherwise look frozen, and carries the elapsed time for the status line.
  const heartbeat = setInterval(() => {
    postMessage({ id, type: "heartbeat", elapsedMs: Date.now() - t0 });
  }, 2000);

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
  const appBase = "/app" + self.location.pathname.replace(/[^/]*$/, "");
  try {
    exitCode = await cheerpjRunMain(
      "Runner",
      appBase + "jrunner.jar:" + appBase + "9-ecj342.jar",
      packPath,
      String(d.preferred || ""),
      outBase
    );
  } catch (e) {
    runError = String((e && e.message) || e);
  }
  streaming = false;
  clearInterval(heartbeat);
  try { await poller; } catch (_) {}

  const tEnd = Date.now();
  const status = await __cjRead(outBase + "/status.txt");
  const output = await __cjRead(outBase + "/output.txt");
  const report = await __cjRead(outBase + "/compile-report.txt");
  const runnerError = await __cjRead(outBase + "/runner-error.txt");
  postMessage({
    id, type: "done", status, output, report, runnerError, runError, exitCode,
    alreadyStreamed: streamed,
    bootMs: tBoot - t0, execMs: tEnd - tBoot, totalMs: tEnd - t0
  });
}

self.onmessage = async (ev) => {
  const d = ev.data || {};
  const id = d.id;
  try {
    if (d.cmd === "warmup") {
      // Full boot + a tiny compile/run so lazy runtime downloads finish early.
      if (__warmedUp) { postMessage({ id, type: "warmup-done", already: true }); return; }
      await __runJava(id, { stdin: "", sources: [{ name: "Warmup.java", content: WARMUP_SOURCE }], preferred: "Warmup" });
      __warmedUp = true;
      postMessage({ id, type: "warmup-done" });
      return;
    }
    if (d.cmd === "run") {
      await __runJava(id, d);
      return;
    }
  } catch (e) {
    postMessage({ id, type: "fatal", message: String((e && e.message) || e) });
  }
};
