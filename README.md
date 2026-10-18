<div align="center">

# ⚡ WasmLab IDE

**Write code. Run it anywhere. Right in your browser tab.**

A single-file, zero-install coding workspace for **Python 3, C++20, Java, JavaScript and HTML/CSS**, with multiple files, a live GUI preview, a free AI helper for errors, and a layout that works on phones, tablets and desktops.

[**▶ Open the live site**](https://tanmay-thedev.github.io/wasmlab-ide/) · ![HTML](https://img.shields.io/badge/single_file-HTML%2FCSS%2FJS-e34f26) ![Runs](https://img.shields.io/badge/runs-100%25_in_browser-3fb950) ![Backend](https://img.shields.io/badge/backend-none-8957e5) ![AI Help](https://img.shields.io/badge/AI_Help-free_%26_keyless-a58aff) ![Vibe coded](https://img.shields.io/badge/vibe-coded-ff69b4)

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
| **Python 3** | In-browser engine | f-strings, comprehensions, slicing, unpacking, classes, recursion, exceptions, and modules `math`, `random`, `collections`, `itertools`, `functools`, `heapq`, `bisect`, `re`, `json`, `statistics` |
| **C++20** | In-browser compiler + STL | `iostream` (`cin`, `cout`, `getline`), `printf`/`scanf`, `iomanip`, structs, classes, lambdas, templates, `vector`, `string`, `map`, `unordered_map`, `set`, `priority_queue`, `stack`, `queue`, `pair`, `algorithm`, `cmath` |
| **Java** | In-browser compiler + JDK subset | classes, records, enums, lambdas, `System.out`, `Scanner`, `BufferedReader`, `StringTokenizer`, `StringBuilder`, `Arrays`, `Collections`, `ArrayList`, `HashMap`, `TreeMap`, `HashSet`, `TreeSet`, `PriorityQueue`, `BigInteger` |
| **JavaScript** | Isolated worker / sandbox | ES2024+, async/await, `input()`/`prompt()`/`readline()` on stdin, console formatting, loop timeout protection |
| **HTML / CSS** | Sandboxed iframe preview | `index.html` plus your open `.css` / `.js` files, DOM and `<canvas id="canvas">`. Desktop GUI toolkits (tkinter, Qt, Swing, JavaFX) cannot open windows in a browser, so the app shows a note instead |

> These are lightweight in-browser implementations, so they cover common learning and practice programs, not every library or edge case of the real toolchains.

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

**Online:** https://tanmay-thedev.github.io/wasmlab-ide/

**Locally:**

```bash
git clone https://github.com/Tanmay-TheDev/wasmlab-ide.git
cd wasmlab-ide
# open index.html in any modern browser
```

## 🐞 Known limits

- Not a full compiler or interpreter for each language
- Multi-file projects: Run executes the active file. HTML preview inlines open `.css` and `.js` files by name; Python, C++ and Java do not import your other files
- AI Help depends on free third-party services and their rate limits
- Big or long-running programs can be slow in a browser tab
- Vibe coded, so bugs are likely. Issues and ideas are welcome

## ⭐ Like it?

If this was fun or useful, **drop a star** on the repo. It helps more people find it.
