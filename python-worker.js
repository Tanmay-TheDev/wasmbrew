/* WasmLab real Python engine worker.
   Runs genuine CPython 3 compiled to WebAssembly (Pyodide) in the browser. */
"use strict";

const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/";

let __pyodidePromise = null;

function __pyEnsure() {
  if (!__pyodidePromise) {
    __pyodidePromise = (async () => {
      importScripts(PYODIDE_BASE + "pyodide.js");
      return await loadPyodide({ indexURL: PYODIDE_BASE });
    })();
    __pyodidePromise.catch(() => { __pyodidePromise = null; });
  }
  return __pyodidePromise;
}

self.onmessage = async (ev) => {
  const d = ev.data || {};
  if (d.cmd !== "run") return;
  const id = d.id;
  const entry = d.entry || "main.py";
  try {
    postMessage({ id, type: "status", stage: "boot", text: "boot" });
    const pyodide = await __pyEnsure();
    postMessage({ id, type: "status", stage: "run", text: "run" });

    // Feed the Standard Input box to input() / sys.stdin, one char at a time.
    const stdinText = d.stdin || "";
    let stdinPos = 0;
    pyodide.setStdin({
      stdin: () => {
        if (stdinPos >= stdinText.length) return null; // EOF -> input() raises EOFError, like real Python
        const ch = stdinText.charCodeAt(stdinPos++);
        return ch;
      },
    });
    pyodide.setStdout({ batched: (s) => postMessage({ id, type: "stdout-delta", stream: "stdout", text: s + "\n" }) });
    pyodide.setStderr({ batched: (s) => postMessage({ id, type: "stdout-delta", stream: "stderr", text: s + "\n" }) });

    // Make every open .py tab importable, then run the active one.
    try {
      const cwd = pyodide.FS.cwd();
      for (const s of d.sources || []) {
        if (s.name !== entry) pyodide.FS.writeFile(cwd + "/" + s.name, s.content);
      }
      pyodide.runPython("import sys\nif '' not in sys.path: sys.path.insert(0, '')");
    } catch (_) {}

    const code = (d.sources || []).find((s) => s.name === entry)?.content ?? d.code ?? "";
    try {
      await pyodide.runPythonAsync(code);
      postMessage({ id, type: "done", status: "ok" });
    } catch (err) {
      postMessage({ id, type: "done", status: "exception", error: String((err && err.message) || err) });
    }
  } catch (e) {
    postMessage({ id, type: "fatal", message: String((e && e.message) || e) });
  }
};
