<div align="center">

# ⚡ WasmBrew IDE

**Write code. Run it anywhere. Right in your browser tab.**

A single-file, zero-install coding workspace for **Python 3, C++20, Java, JavaScript and HTML/CSS**, with multiple files, a live GUI preview, a free AI helper for errors, and a layout that works on phones, tablets and desktops.

[**▶ Open the live site**](https://tanmay-thedev.github.io/wasmbrew/) · ![HTML](https://img.shields.io/badge/single_file-HTML%2FCSS%2FJS-e34f26) ![Runs](https://img.shields.io/badge/runs-100%25_in_browser-3fb950) ![Backend](https://img.shields.io/badge/backend-none-8957e5) ![AI Help](https://img.shields.io/badge/AI_Help-free_%26_keyless-a58aff) ![Vibe coded](https://img.shields.io/badge/vibe-coded-ff69b4)

</div>

---

## 🎧 Vibe coded, honestly

This is a **vibe-coded project**: an experimental browser IDE built through rapid iteration. Expect rough edges, and treat it as a learning tool rather than a production compiler.

## ✨ Features

- 🐍 **Four languages** in one tab: Python 3, C++20, Java, JavaScript, plus **HTML/CSS** for GUI work
- 📁 **Multiple files**: the **+** button in the explorer or the tab bar creates a file (`main.py`, `Utils.java`, `app.js`, `index.html`, ...). The extension picks the language and a starter template. Rename, delete, close tabs, right-click a file for more
- 📂 **Open / import from your device**: *Open file* button, or drag and drop files onto the editor (`.py .cpp .cc .c .h .java .js .html .css .txt .json .md`). Uses the File System Access API where the browser has it, a normal file picker everywhere else
- 💾 **Save / download** the active file, and **autosave** of the whole project to your browser's `localStorage`
- 🖼️ **GUI support (live preview)**: `index.html` with your open `.css` and `.js` files renders in a sandboxed iframe. JavaScript files can draw on a ready-made `<canvas id="canvas">`. Preview sits next to the terminal on desktop (**Split GUI**) and gets its own tab on mobile
- 🤖 **AI Help**: a chat panel that explains compile errors, tells you why code is not running, and suggests fixes. Replies type out live. After a failed run, an **Ask AI about this error** button sends the error for you
- ⌨️ **Standard input** for every language (`input()`, `std::cin`, `Scanner(System.in)`, `readline()`)
- 🖥️ **VS Code style layout** with activity bar, explorer, tabs, status bar, and a **Full Screen** mode (F11)
- 📱 **Responsive layout** for mobile, tablet and desktop, with a symbol key row for phones
- 📦 **One file**: the whole app is `index.html`

## 🤖 About AI Help

AI Help needs **no account, no login and no API key**. It calls two free public chat endpoints straight from your browser:

| Order | Service | Endpoint |
|---|---|---|
| 1st | LLM7 | `https://api.llm7.io/v1/chat/completions` (model `codestral-latest`, retries with `default`) |
| Fallback | Pollinations | `https://text.pollinations.ai/openai` (model `openai`) |

Please know the limits:

- **Free does not mean unlimited.** Both services rate-limit anonymous use. LLM7 may answer `429` after a few quick messages, and Pollinations allows roughly one reply every 30 seconds per IP. The app shows a countdown and retries on the other service. Replies can be slow or fail when they are busy
- **Privacy:** when you send a message, your question, the **code of the active file** (first ~6000 characters) and the last run output go to those third-party services. Do not paste secrets. The app shows this notice inside the panel
- The AI can be wrong. Treat answers as hints
- Nothing is sent until you press **Send** or use a quick action. Running code never calls the network

## 🧪 Language support

| Language | Engine | What is supported |
|---|---|---|
| **Python 3** | **Real CPython 3.13 interpreter (Pyodide / WebAssembly)** | a genuine Python interpreter runs your code: f-strings, comprehensions, slicing, unpacking, classes/OOP, inheritance, recursion, exceptions with real tracebacks, generators, decorators, lambdas, and the full standard library (`math`, `random`, `collections`, `itertools`, `functools`, `heapq`, `bisect`, `re`, `json`, `statistics`, `datetime`, and more) |
| **C++20** | In-browser compiler + STL | `iostream` (`cin`, `cout`, `getline`), `printf`/`scanf`, `iomanip`, structs, classes, inheritance, lambdas, templates, `vector`, `string`, `map`, `unordered_map`, `set`, `priority_queue`, `stack`, `queue`, `pair`, `algorithm`, `cmath` |
| **Java** | **Real OpenJDK JVM (CheerpJ / WebAssembly) + Eclipse Compiler (ECJ)** | a genuine JVM runs your code: classes, inheritance, interfaces, abstract classes, method overloading/overriding, generics, exception handling (try/catch/finally, custom exceptions, try-with-resources), threads, lambdas, streams, enums, `System.out`, `Scanner`, `BufferedReader`, `StringTokenizer`, `StringBuilder`, `Arrays`, `Collections`, `ArrayList`, `HashMap`, `TreeMap`, `HashSet`, `TreeSet`, `PriorityQueue`, `BigInteger`, `java.time`, regex, and the rest of the JDK class library |
| **JavaScript** | Isolated worker / sandbox | ES2024+, async/await, `input()`/`prompt()`/`readline()` on stdin, console formatting, loop timeout protection |
| **HTML / CSS** | Sandboxed iframe preview | `index.html` plus your open `.css` / `.js` files, DOM and `<canvas id="canvas">`. Desktop GUI toolkits (tkinter, Qt, Swing, JavaFX) cannot open windows in a browser, so the app shows a note instead |

> C++ and JavaScript are lightweight in-browser implementations, so they cover common learning and practice programs, not every library or edge case of the real toolchains. Known C++ gaps: passing by reference does not mutate the caller's variable, a class cannot have two constructors (use one constructor with default values), and `friend`/operator overloading are not supported. **Python and Java are different: they run on a real CPython interpreter and a real JVM** (see below).

## ⚡ Java engine choice: Real JVM or Quick mode

Java has two engines, picked in the **Java engine** menu above the output (Auto / Real JVM / Quick mode):

- **Real JVM**: exact OpenJDK Java (see below). Needs a ~25 MB first download and a fair amount of memory, so it can be very slow or never finish on low-end phones and weak connections.
- **Quick mode**: a lightweight Java-to-JavaScript engine that starts instantly. Best for simple learning programs (loops, methods, classes, `Scanner`, collections). It is **not exact Java**: for example integer division, integer overflow and some library details can differ. This is a known limitation.
- **Auto** (default): Real JVM on desktop, Quick mode on phones and low-memory devices. If the Real JVM does not start within 45 seconds, that run switches to Quick mode, says so in the output, and shows buttons to switch engine or retry. Every run prints which engine ran it.

Not tested on real low-end phones by the author; a phone-sized emulated browser was used.

## ☕ Real Java in the browser

Java is not simulated. When you press Run on a `.java` file:

1. Your open Java tabs are compiled by the **Eclipse Compiler for Java (ECJ)** — the same compiler Eclipse uses — running inside the page.
2. The compiled bytecode executes on a **genuine, unmodified OpenJDK JVM** compiled to WebAssembly (**[CheerpJ](https://cheerpj.com/)** by [Leaning Technologies](https://leaningtech.com/)).

So overloading, inheritance, interfaces, generics, exceptions, threads, collections and the JDK library behave exactly like desktop Java.

What to know:

- **First Java run downloads the JVM once (about 25 MB)**, then your browser caches it. Every later run takes a few seconds: roughly 5–20 seconds to compile + run, depending on your device (phones are slower). Other languages stay instant.
- **Language level: Java 8** source (lambdas, streams, default methods all work). `records`, `var`, text blocks and switch expressions do **not** compile yet. The runtime itself is a modern OpenJDK.
- All **open** `.java` tabs are compiled together as one project, so multi-file programs work. A `public class` must live in a file with the same name (real `javac` rule).
- Compile errors show the real ECJ messages with line numbers in the **Problems** tab and feed the **AI Help** button.
- `Scanner` / `BufferedReader` read from the **Standard Input** box (all input is read up front, like pasting input into an online judge).
- Infinite loops are killed by the 60-second time limit or the **Stop** button (the JVM runs in a Web Worker).
- Swing/AWT windows cannot pop up in a web page. No file access to your real disk, no sockets.
- Engine credit: **CheerpJ** © Leaning Technologies, used under the free [CheerpJ Community License](https://cheerpj.com/docs/licensing) (personal projects). **ECJ** © Eclipse Foundation, [EPL-2.0](https://www.eclipse.org/legal/epl-2.0/).

## 🐍 Real Python in the browser

Python is not simulated either. When you press Run on a `.py` file, your code executes on a **genuine CPython 3.13 interpreter** compiled to WebAssembly (**[Pyodide](https://pyodide.org/)**, the official port by the Pyodide project / Mozilla-provenance, used under the [MPL-2.0](https://www.mozilla.org/en-US/MPL/2.0/) license).

What to know:

- **First Python run downloads the interpreter once (about 12 MB)**, then your browser caches it. Later runs take a few seconds.
- The **full Python standard library** works: `math`, `random`, `datetime`, `json`, `re`, `collections`, `itertools`, `functools`, `heapq`, `bisect`, `statistics` and the rest.
- Errors are the **real CPython tracebacks**, with the true line number shown in the **Problems** tab and fed to **AI Help**.
- `input()` and `sys.stdin` read from the **Standard Input** box (all input is read up front, like pasting input into an online judge).
- All **open** `.py` tabs are importable, so `from helper import triple` works across your files.
- Infinite loops are killed by the 60-second time limit or the **Stop** button (the interpreter runs in a Web Worker).
- tkinter/PyQt windows cannot open in a web page, and third-party pip packages are not installed.

## 🛠️ Specs

| | |
|---|---|
| Type | Static single-page web app |
| Files | `index.html` (about 300 KB, HTML + CSS + JS inline) |
| Dependencies | None to install. No build step. No framework |
| Backend | None |
| Storage | Browser `localStorage` (all project files) |
| Network | None for running code. Only AI Help, when you send a message, calls LLM7 / Pollinations |
| Hosting | GitHub Pages |
| Layout | Fits `100dvh`, 3-column desktop toolbar, stacked mobile layout |
| Origin | Vibe-coded browser IDE, iterated and tested across devices |

## 🚀 Run it

**Online:** https://tanmay-thedev.github.io/wasmbrew/

**Locally:**

```bash
git clone https://github.com/Tanmay-TheDev/wasmbrew.git
cd wasmbrew
# open index.html in any modern browser
```

## 🐞 Known limits

- Not a full compiler or interpreter for each language
- Multi-file projects: Run executes the active file. Java compiles all open `.java` tabs together and Python can `import` your other open `.py` tabs. HTML preview inlines open `.css` and `.js` files by name; C++ runs the active file only
- AI Help depends on free third-party services and their rate limits
- Big or long-running programs can be slow in a browser tab
- Vibe coded, so bugs are likely. Issues and ideas are welcome

## ⭐ Like it?

If this was fun or useful, **drop a star** on the repo. It helps more people find it.
