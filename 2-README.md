<div align="center">

# ⚡ WasmLab IDE

**Write code. Run it anywhere. Right in your browser tab.**

A single-file, zero-install coding workspace for **Python 3, C++20, Java and JavaScript**, with standard input, a synced editor and a layout that works on phones, tablets and desktops.

[**▶ Open the live site**](https://tanmay-thedev.github.io/wasmlab-ide/) · ![HTML](https://img.shields.io/badge/single_file-HTML%2FCSS%2FJS-e34f26) ![Runs](https://img.shields.io/badge/runs-100%25_in_browser-3fb950) ![Backend](https://img.shields.io/badge/backend-none-8957e5) ![Vibe coded](https://img.shields.io/badge/vibe-coded-ff69b4)

</div>

---

## 🎧 Vibe coded, honestly

This site is **vibe coded**. I described what I wanted to an AI assistant, tested it, pasted the errors back, and kept iterating until it worked on my phone and my laptop. The code was generated and revised with AI help (Gemini) and published as is. Expect rough edges, and treat it as a fun experiment, not a production compiler.

## ✨ Features

- 🐍 **Four languages** in one tab: Python 3, C++20, Java, JavaScript
- ⌨️ **Standard input** for every language (`input()`, `std::cin`, `Scanner(System.in)`, `readline()`)
- 🖥️ **Editor with line-number gutter and syntax highlighting**, scroll-synced
- 📱 **Responsive layout** for mobile, tablet and desktop
- 💾 **Autosave** to your browser's `localStorage`
- 🔒 **Private**: your code never leaves your device. No server, no accounts, no tracking
- 📦 **One file**: the whole app is `index.html`

## 🧪 Language support

| Language | Engine | What is supported |
|---|---|---|
| **Python 3** | In-browser engine | f-strings, comprehensions, slicing, unpacking, classes, recursion, exceptions, and modules `math`, `random`, `collections`, `itertools`, `functools`, `heapq`, `bisect`, `re`, `json`, `statistics` |
| **C++20** | In-browser compiler + STL | `iostream` (`cin`, `cout`, `getline`), `printf`/`scanf`, `iomanip`, structs, classes, lambdas, templates, `vector`, `string`, `map`, `unordered_map`, `set`, `priority_queue`, `stack`, `queue`, `pair`, `algorithm`, `cmath` |
| **Java** | In-browser compiler + JDK subset | classes, records, enums, lambdas, `System.out`, `Scanner`, `BufferedReader`, `StringTokenizer`, `StringBuilder`, `Arrays`, `Collections`, `ArrayList`, `HashMap`, `TreeMap`, `HashSet`, `TreeSet`, `PriorityQueue`, `BigInteger` |
| **JavaScript** | Isolated worker / sandbox | ES2024+, async/await, `input()`/`prompt()`/`readline()` on stdin, console formatting, loop timeout protection |

> These are lightweight in-browser implementations, so they cover common learning and practice programs, not every library or edge case of the real toolchains.

## 🛠️ Specs

| | |
|---|---|
| Type | Static single-page web app |
| Files | `index.html` (about 230 KB, HTML + CSS + JS inline) |
| Dependencies | None to install. No build step. No framework |
| Backend | None |
| Storage | Browser `localStorage` |
| Hosting | GitHub Pages |
| Layout | Fits `100dvh`, 3-column desktop toolbar, stacked mobile layout |
| Origin | Generated with AI (Gemini), tested and fixed over several chat rounds |

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
- Big or long-running programs can be slow in a browser tab
- Vibe coded, so bugs are likely. Issues and ideas are welcome

## 🙏 Credits

- Built with AI assistance (Gemini) and a lot of "bro, fix this" prompts
- Links inside the app: [TeaVM javac](https://github.com/konsoletyper/teavm-javac), [REA](https://github.com/morluto/rea)

## ⭐ Like it?

If this was fun or useful, **drop a star** on the repo. It helps more people find it.
