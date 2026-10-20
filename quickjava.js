(function(){
/* ===== WasmBrew Quick-mode Java engine: lexer + parser ===== */
class JErr extends Error { constructor(msg, line) { super(msg); this.jline = line || 1; this.isCompile = true; } }
const KW = new Set("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null".split(" "));
const PRIMS = new Set(["int", "long", "double", "float", "char", "byte", "short", "boolean", "void"]);
const OPS3 = ["<<=", "...", "->", "::", "++", "--", "&&", "||", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<"];
function lex(src) {
  const toks = []; let i = 0, line = 1; const n = src.length;
  const push = (t, v, extra) => toks.push(Object.assign({ t, v, line, pos: i }, extra || {}));
  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === " " || c === "\t" || c === "\r" || c === "\f") { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line++; i++; } if (i >= n) throw new JErr("unterminated comment", line); i += 2; continue; }
    if (/[A-Za-z_$\u00c0-\uffff]/.test(c)) { let j = i + 1; while (j < n && /[A-Za-z0-9_$\u00c0-\uffff]/.test(src[j])) j++; const w = src.slice(i, j); const st = i; i = j; toks.push({ t: KW.has(w) ? "kw" : "id", v: w, line, pos: st }); continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
      let j = i, isF = false, text;
      if (c === "0" && /[xX]/.test(src[i + 1] || "")) { j = i + 2; while (j < n && /[0-9a-fA-F_]/.test(src[j])) j++; text = src.slice(i, j).replace(/_/g, ""); }
      else if (c === "0" && /[bB]/.test(src[i + 1] || "")) { j = i + 2; while (j < n && /[01_]/.test(src[j])) j++; text = src.slice(i, j).replace(/_/g, ""); }
      else {
        while (j < n && /[0-9_]/.test(src[j])) j++;
        if (src[j] === "." && /[0-9]/.test(src[j + 1] || "") ) { isF = true; j++; while (j < n && /[0-9_]/.test(src[j])) j++; }
        else if (src[j] === "." && !/[A-Za-z_.]/.test(src[j + 1] || "")) { isF = true; j++; }
        if (/[eE]/.test(src[j] || "") && /[0-9+\-]/.test(src[j + 1] || "")) { isF = true; j++; if (/[+\-]/.test(src[j])) j++; while (j < n && /[0-9]/.test(src[j])) j++; }
        text = src.slice(i, j).replace(/_/g, "");
      }
      const suf = src[j]; const st = i;
      if (/[lL]/.test(suf || "")) { j++; i = j; toks.push({ t: "num", k: "long", v: text, line, pos: st }); continue; }
      if (/[fF]/.test(suf || "") && !/^0[xX]/.test(text)) { j++; i = j; toks.push({ t: "num", k: "float", v: text, line, pos: st }); continue; }
      if (/[dD]/.test(suf || "") && !/^0[xX]/.test(text)) { j++; i = j; toks.push({ t: "num", k: "double", v: text, line, pos: st }); continue; }
      i = j; toks.push({ t: "num", k: isF ? "double" : "int", v: text, line, pos: st }); continue;
    }
    if (c === '"') {
      if (src.startsWith('"""', i)) {
        let j = i + 3; while (src[j] !== "\n" && j < n) j++; j++; const sl = line; line++;
        let raw = ""; while (j < n && !src.startsWith('"""', j)) { if (src[j] === "\\") { raw += src[j] + src[j + 1]; j += 2; continue; } if (src[j] === "\n") line++; raw += src[j++]; }
        if (j >= n) throw new JErr("unclosed text block", sl);
        const lines = raw.split("\n"); let ind = Infinity; lines.forEach((l, k) => { if (l.trim() || k === lines.length - 1) ind = Math.min(ind, l.match(/^[ \t]*/)[0].length); });
        let txt = lines.map((l) => l.slice(Math.min(ind, l.length)).replace(/[ \t]+$/, "")).join("\n");
        toks.push({ t: "str", v: unesc(txt, sl), line: sl, pos: i }); i = j + 3; continue;
      }
      let j = i + 1, s = "";
      while (j < n && src[j] !== '"') { if (src[j] === "\n") throw new JErr("unclosed string literal", line); if (src[j] === "\\") { s += src[j] + src[j + 1]; j += 2; } else s += src[j++]; }
      if (j >= n) throw new JErr("unclosed string literal", line);
      toks.push({ t: "str", v: unesc(s, line), line, pos: i }); i = j + 1; continue;
    }
    if (c === "'") {
      let j = i + 1, s = ""; while (j < n && src[j] !== "'") { if (src[j] === "\n") throw new JErr("unclosed character literal", line); if (src[j] === "\\") { s += src[j] + src[j + 1]; j += 2; } else s += src[j++]; }
      const u = unesc(s, line); if (u.length !== 1) throw new JErr(u.length === 0 ? "empty character literal" : "unclosed character literal", line);
      toks.push({ t: "chr", v: u.charCodeAt(0), line, pos: i }); i = j + 1; continue;
    }
    let op = null;
    for (const o of OPS3) if (src.startsWith(o, i)) { op = o; break; }
    if (!op) op = c;
    if (!/[{}()\[\];,.@?:=<>!~+\-*\/&|^%]/.test(op[0])) throw new JErr("illegal character: '" + c + "'", line);
    toks.push({ t: "op", v: op, line, pos: i }); i += op.length;
  }
  toks.push({ t: "eof", v: "<EOF>", line, pos: n });
  return toks;
}
function unesc(s, line) {
  return s.replace(/\\(u+[0-9a-fA-F]{4}|[0-7]{1,3}|[\s\S])/g, (m, e) => {
    if (e[0] === "u") return String.fromCharCode(parseInt(e.replace(/^u+/, ""), 16));
    if (/^[0-7]/.test(e)) return String.fromCharCode(parseInt(e, 8));
    switch (e) { case "n": return "\n"; case "t": return "\t"; case "r": return "\r"; case "b": return "\b"; case "f": return "\f"; case "s": return " "; case "0": return "\0"; case "\\": return "\\"; case "'": return "'"; case '"': return '"'; case "\n": return ""; }
    throw new JErr("illegal escape character", line);
  });
}
const MODS = new Set(["public", "private", "protected", "static", "final", "abstract", "native", "synchronized", "transient", "volatile", "strictfp", "default", "sealed", "non-sealed"]);
class Parser {
  constructor(toks) { this.t = toks; this.p = 0; }
  get cur() { return this.t[this.p]; }
  peek(k = 1) { return this.t[Math.min(this.p + k, this.t.length - 1)]; }
  is(v) { const c = this.cur; return (c.t === "op" || c.t === "kw") && c.v === v; }
  isId(v) { return this.cur.t === "id" && (v === undefined || this.cur.v === v); }
  eat(v) { if (this.is(v)) { this.p++; return true; } return false; }
  err(msg, tok) { throw new JErr(msg, (tok || this.cur).line); }
  expect(v) {
    if (this.is(v)) return this.t[this.p++];
    // javac reports a missing ; at the end of the previous line
    const prev = this.t[this.p - 1];
    if ((v === ";" || v === ")" || v === "]") && prev) throw new JErr("'" + v + "' expected", prev.line);
    throw new JErr("'" + v + "' expected", this.cur.line);
  }
  ident() { if (this.cur.t !== "id") this.err("<identifier> expected"); return this.t[this.p++].v; }
  try(fn) { const s = this.p; try { return fn(); } catch (e) { if (e instanceof JErr) { this.p = s; return null; } throw e; } }
  // ---------- types ----------
  isPrimTok() { return this.cur.t === "kw" && PRIMS.has(this.cur.v); }
  skipAnnots() { while (this.is("@") && !(this.peek().v === "interface")) { this.p++; this.ident(); while (this.eat(".")) this.ident(); if (this.is("(")) { let d = 0; do { if (this.is("(")) d++; if (this.is(")")) d--; this.p++; } while (d > 0 && this.cur.t !== "eof"); } } }
  parseType(allowVoid) {
    this.skipAnnots();
    let ty;
    if (this.isPrimTok()) { const v = this.t[this.p++].v; if (v === "void" && !allowVoid) this.err("illegal start of type"); ty = { n: v }; }
    else if (this.cur.t === "id") {
      let name = this.ident(), args = null;
      for (;;) {
        if (this.is("<")) args = this.parseTArgs();
        if (this.is(".") && this.peek().t === "id") { this.p++; name = name + "." + this.ident(); args = null; continue; }
        break;
      }
      ty = { n: name, a: args };
    } else if (this.is("?")) { this.p++; if (this.eat("extends") || this.eat("super")) { return this.parseType(); } return { n: "Object" }; }
    else this.err("illegal start of type");
    while (this.is("[") && this.peek().v === "]") { this.p += 2; ty = { arr: ty }; }
    return ty;
  }
  parseTArgs() {
    this.expect("<"); const a = [];
    if (this.eat(">")) return a;
    do { a.push(this.parseType()); } while (this.eat(","));
    this.expect(">"); return a;
  }
  parseTParams() {
    if (!this.is("<")) return [];
    this.p++; const r = [];
    do { this.skipAnnots(); const n = this.ident(); let b = null; if (this.eat("extends")) { b = this.parseType(); while (this.eat("&")) this.parseType(); } r.push({ n, b }); } while (this.eat(","));
    this.expect(">"); return r;
  }
  // ---------- declarations ----------
  parseUnit() {
    const types = [];
    while (this.cur.t !== "eof") {
      if (this.is("package") || this.is("import")) { while (!this.is(";") && this.cur.t !== "eof") this.p++; this.expect(";"); continue; }
      if (this.eat(";")) continue;
      types.push(this.parseTypeDecl());
    }
    return types;
  }
  parseMods() {
    const m = new Set();
    for (;;) {
      this.skipAnnots();
      if (this.cur.t === "kw" && MODS.has(this.cur.v) && !(this.cur.v === "default" && (this.peek().v === ":" || this.peek().v === "->"))) { m.add(this.t[this.p++].v); continue; }
      if (this.cur.t === "id" && (this.cur.v === "sealed") && (this.peek().t === "kw" || this.peek().t === "id")) { this.p++; continue; }
      if (this.cur.t === "id" && this.cur.v === "non" && this.peek().v === "-" ) { this.p += 3; continue; }
      break;
    }
    return m;
  }
  isTypeDeclStart() { return this.is("class") || this.is("interface") || this.is("enum") || (this.is("@") && this.peek().v === "interface") || (this.isId("record") && this.peek().t === "id" && (this.peek(2).v === "(" || this.peek(2).v === "<")); }
  parseTypeDecl(mods) {
    mods = mods || this.parseMods(); const line = this.cur.line;
    let kind;
    if (this.eat("class")) kind = "class"; else if (this.eat("interface")) kind = "interface"; else if (this.eat("enum")) kind = "enum";
    else if (this.is("@")) { this.p += 2; kind = "interface"; }
    else if (this.isId("record")) { this.p++; kind = "record"; }
    else this.err("class, interface, enum, or record expected");
    const d = { k: "class", kind, name: this.ident(), mods, line, ext: null, impls: [], members: [], consts: [], tparams: [] };
    d.tparams = this.parseTParams();
    if (kind === "record") {
      this.expect("("); d.rec = [];
      if (!this.is(")")) do { this.skipAnnots(); const type = this.parseType(); d.rec.push({ type, name: this.ident() }); } while (this.eat(","));
      this.expect(")");
    }
    if (this.eat("extends")) { if (kind === "interface") { do d.impls.push(this.parseType()); while (this.eat(",")); } else d.ext = this.parseType(); }
    if (this.eat("implements")) do d.impls.push(this.parseType()); while (this.eat(","));
    if (this.isId("permits")) { this.p++; do this.parseType(); while (this.eat(",")); }
    this.parseClassBody(d);
    return d;
  }
  parseClassBody(d) {
    this.expect("{");
    if (d.kind === "enum") {
      while (!this.is(";") && !this.is("}")) {
        this.skipAnnots(); const line = this.cur.line; const name = this.ident(); let args = [], body = null;
        if (this.is("(")) args = this.parseArgs();
        if (this.is("{")) { body = { k: "class", kind: "class", name: d.name + "$" + name, mods: new Set(), line, ext: null, impls: [], members: [], consts: [], tparams: [], anon: true }; this.parseClassBody(body); }
        d.consts.push({ name, args, body, line });
        if (!this.eat(",")) break;
      }
      this.eat(";");
    }
    while (!this.is("}")) {
      if (this.cur.t === "eof") this.err("reached end of file while parsing");
      if (this.eat(";")) continue;
      this.parseMember(d);
    }
    this.expect("}");
  }
  parseMember(d) {
    const line = this.cur.line;
    if (this.is("{")) { d.members.push({ k: "init", static: false, body: this.parseBlock(), line }); return; }
    if (this.is("static") && this.peek().v === "{") { this.p++; d.members.push({ k: "init", static: true, body: this.parseBlock(), line }); return; }
    const mods = this.parseMods();
    if (this.isTypeDeclStart()) { const c = this.parseTypeDecl(mods); d.members.push(c); return; }
    const tparams = this.parseTParams();
    // constructor
    if (this.cur.t === "id" && this.cur.v === d.name && (this.peek().v === "(" || (d.kind === "record" && this.peek().v === "{"))) {
      this.p++; let params = [];
      if (this.is("(")) params = this.parseParams(); else params = null; // compact record ctor
      if (this.eat("throws")) do this.parseType(); while (this.eat(","));
      const body = this.parseBlock();
      d.members.push({ k: "ctor", mods, params, body, line, compact: params === null }); return;
    }
    const type = this.parseType(true);
    const name = this.ident();
    if (this.is("(")) {
      const params = this.parseParams();
      let ty = type; while (this.is("[") && this.peek().v === "]") { this.p += 2; ty = { arr: ty }; }
      if (this.eat("throws")) do this.parseType(); while (this.eat(","));
      let body = null;
      if (this.is("{")) body = this.parseBlock();
      else { if (this.is("default")) { this.p++; this.parseExpr(); } this.expect(";"); }
      if (d.kind === "interface" && !body) mods.add("abstract");
      d.members.push({ k: "method", name, ret: ty, params, body, mods, tparams, line });
      return;
    }
    // field(s)
    let nm = name; const decls = [];
    for (;;) {
      let ty = type; while (this.is("[") && this.peek().v === "]") { this.p += 2; ty = { arr: ty }; }
      let init = null; if (this.eat("=")) init = this.is("{") ? this.parseArrayInit() : this.parseExpr();
      decls.push({ name: nm, type: ty, init, line: this.cur.line });
      if (this.eat(",")) { nm = this.ident(); continue; } break;
    }
    this.expect(";");
    if (d.kind === "interface") { mods.add("static"); mods.add("final"); }
    for (const x of decls) d.members.push({ k: "field", mods, name: x.name, type: x.type, init: x.init, line });
  }
  parseParams() {
    this.expect("("); const ps = [];
    if (!this.is(")")) do {
      this.parseMods(); const type = this.parseType(); let va = false;
      if (this.eat("...")) va = true;
      let name = this.ident(); let ty = type; while (this.is("[") && this.peek().v === "]") { this.p += 2; ty = { arr: ty }; }
      if (va) ty = { arr: ty };
      ps.push({ type: ty, name, varargs: va });
    } while (this.eat(","));
    this.expect(")"); return ps;
  }
  // ---------- statements ----------
  parseBlock() {
    const line = this.cur.line; this.expect("{"); const stmts = [];
    while (!this.is("}")) { if (this.cur.t === "eof") this.err("reached end of file while parsing"); stmts.push(this.parseStmt()); }
    const end = this.cur.line; this.expect("}"); return { k: "block", stmts, line, end };
  }
  isLocalDeclStart() {
    if (this.isPrimTok() && this.peek().v !== ".") return true;
    if (this.is("final")) return true;
    if (this.cur.t !== "id") return false;
    if (this.cur.v === "var" && this.peek().t === "id") return true;
    const s = this.p;
    try { this.parseType(); const ok = this.cur.t === "id" && (this.peek().v === "=" || this.peek().v === ";" || this.peek().v === "," || this.peek().v === ":" || this.peek().v === "[" || this.peek().t === "eof" || true); return ok; } catch (e) { if (e instanceof JErr) return false; throw e; } finally { this.p = s; }
  }
  parseLocalDecl(noSemi) {
    const line = this.cur.line; const lmods = this.parseMods();
    let type; if (this.isId("var") && this.peek().t === "id") { this.p++; type = { n: "var" }; } else type = this.parseType();
    const decls = [];
    do {
      const name = this.ident(); let ty = type; while (this.is("[") && this.peek().v === "]") { this.p += 2; ty = { arr: ty }; }
      let init = null; if (this.eat("=")) init = this.is("{") ? this.parseArrayInit() : this.parseExpr();
      decls.push({ name, type: ty, init, line: this.cur.line });
    } while (this.eat(","));
    if (!noSemi) this.expect(";");
    return { k: "local", decls, line, fin: !!(lmods && lmods.has && lmods.has("final")) };
  }
  parseStmt() {
    const c = this.cur, line = c.line;
    if (c.t === "op") {
      if (c.v === "{") return this.parseBlock();
      if (c.v === ";") { this.p++; return { k: "empty", line }; }
      if (c.v === "@") { this.skipAnnots(); return this.parseStmt(); }
    }
    if (c.t === "id" && this.peek().v === ":" && this.peek(2).v !== ":") { this.p += 2; return { k: "label", name: c.v, body: this.parseStmt(), line }; }
    if (c.t === "kw") {
      switch (c.v) {
        case "if": { this.p++; this.expect("("); const cond = this.parseExpr(); this.expect(")"); const th = this.parseStmt(); let el = null; if (this.eat("else")) el = this.parseStmt(); return { k: "if", cond, th, el, line }; }
        case "while": { this.p++; this.expect("("); const cond = this.parseExpr(); this.expect(")"); return { k: "while", cond, body: this.parseStmt(), line }; }
        case "do": { this.p++; const body = this.parseStmt(); this.expect("while"); this.expect("("); const cond = this.parseExpr(); this.expect(")"); this.expect(";"); return { k: "do", cond, body, line }; }
        case "for": return this.parseFor();
        case "return": { this.p++; let e = null; if (!this.is(";")) e = this.parseExpr(); this.expect(";"); return { k: "return", e, line }; }
        case "break": { this.p++; let l = null; if (this.cur.t === "id") l = this.ident(); this.expect(";"); return { k: "break", label: l, line }; }
        case "continue": { this.p++; let l = null; if (this.cur.t === "id") l = this.ident(); this.expect(";"); return { k: "continue", label: l, line }; }
        case "throw": { this.p++; const e = this.parseExpr(); this.expect(";"); return { k: "throw", e, line }; }
        case "try": return this.parseTry();
        case "switch": { const sw = this.parseSwitch(false); if (sw.arrow || !this.is(";")) return sw; this.p++; return sw; }
        case "synchronized": { this.p++; this.expect("("); this.parseExpr(); this.expect(")"); return this.parseBlock(); }
        case "assert": { this.p++; const cond = this.parseExpr(); let msg = null; if (this.eat(":")) msg = this.parseExpr(); this.expect(";"); return { k: "assert", cond, msg, line }; }
        case "class": case "interface": case "enum": case "abstract": case "static": { const d = this.parseTypeDecl(); return { k: "localclass", decl: d, line }; }
        case "final": { const s = this.p; this.parseMods(); if (this.isTypeDeclStart()) { this.p = s; return { k: "localclass", decl: this.parseTypeDecl(), line }; } this.p = s; break; }
        case "else": this.err("illegal start of statement"); break;
        case "case": case "default": this.err("orphaned " + c.v); break;
        case "catch": this.err("'catch' without 'try'"); break;
        case "finally": this.err("'finally' without 'try'"); break;
      }
    }
    if (this.isId("record") && this.peek().t === "id" && this.peek(2).v === "(") return { k: "localclass", decl: this.parseTypeDecl(), line };
    if (this.isId("yield") && this.peek().v !== "=" && this.peek().v !== "." && this.peek().v !== "(") { this.p++; const e = this.parseExpr(); this.expect(";"); return { k: "yield", e, line }; }
    if (this.isLocalDeclStart()) return this.parseLocalDecl();
    const e = this.parseExpr();
    if (!["assign", "pre", "post", "call", "new", "ctorcall"].includes(e.k)) throw new JErr("not a statement", line);
    this.expect(";");
    return { k: "expr", e, line };
  }
  parseFor() {
    const line = this.cur.line; this.p++; this.expect("(");
    if (this.isLocalDeclStart()) {
      const s = this.p;
      this.parseMods(); let type; if (this.isId("var") && this.peek().t === "id") { this.p++; type = { n: "var" }; } else type = this.parseType();
      if (this.cur.t === "id" && this.peek().v === ":") {
        const name = this.ident(); this.p++; const it = this.parseExpr(); this.expect(")");
        return { k: "foreach", type, name, it, body: this.parseStmt(), line };
      }
      this.p = s;
    }
    let init = [];
    if (!this.is(";")) { if (this.isLocalDeclStart()) init = [this.parseLocalDecl(true)]; else { do init.push({ k: "expr", e: this.parseExpr(), line }); while (this.eat(",")); } }
    this.expect(";");
    let cond = null; if (!this.is(";")) cond = this.parseExpr(); this.expect(";");
    const upd = []; if (!this.is(")")) do upd.push(this.parseExpr()); while (this.eat(","));
    this.expect(")");
    return { k: "for", init, cond, upd, body: this.parseStmt(), line };
  }
  parseTry() {
    const line = this.cur.line; this.p++; const res = [];
    if (this.eat("(")) {
      while (!this.is(")")) { if (this.isLocalDeclStart()) { const l = this.parseLocalDecl(true); res.push(l); } else res.push({ k: "expr", e: this.parseExpr() }); if (!this.eat(";")) break; }
      this.expect(")");
    }
    const block = this.parseBlock(); const catches = []; let fin = null;
    while (this.is("catch")) {
      const l = this.cur.line; this.p++; this.expect("("); this.parseMods(); const types = [this.parseType()]; while (this.eat("|")) types.push(this.parseType());
      const name = this.ident(); this.expect(")"); catches.push({ types, name, block: this.parseBlock(), line: l });
    }
    if (this.eat("finally")) fin = this.parseBlock();
    if (!catches.length && !fin && !res.length) throw new JErr("'try' without 'catch', 'finally' or resource declarations", line);
    return { k: "try", res, block, catches, fin, line };
  }
  parseSwitch(isExpr) {
    const line = this.cur.line; this.expect("switch"); this.expect("("); const sel = this.parseExpr(); this.expect(")"); this.expect("{");
    const cases = []; let arrow = false;
    while (!this.is("}")) {
      if (this.cur.t === "eof") this.err("reached end of file while parsing");
      const cl = this.cur.line; const labels = []; let isDefault = false;
      if (this.eat("default")) isDefault = true;
      else {
        this.expect("case");
        do {
          if (this.is("default")) { this.p++; isDefault = true; continue; }
          if (this.is("null")) { this.p++; labels.push({ k: "lit", kind: "null", line: cl }); continue; }
          // type pattern?
          if (this.cur.t === "id" && this.peek().t === "id" && (this.peek(2).v === "->" || this.peek(2).v === ":" || this.peek(2).v === "&&" )) { const type = this.parseType(); const bind = this.ident(); labels.push({ k: "tpat", type, bind, line: cl }); continue; }
          labels.push(this.parseTernary());
        } while (this.eat(","));
        if (this.isId("when")) { this.p++; labels.guard = this.parseExpr(); }
      }
      let body;
      if (this.eat("->")) {
        arrow = true;
        if (this.is("{")) body = this.parseBlock();
        else if (this.is("throw")) body = this.parseStmt();
        else { const e = this.parseExpr(); this.expect(";"); body = { k: "arrowexpr", e, line: cl }; }
      } else {
        this.expect(":"); const stmts = [];
        while (!this.is("case") && !this.is("default") && !this.is("}")) stmts.push(this.parseStmt());
        body = { k: "block", stmts, line: cl, noscope: true };
      }
      cases.push({ labels, isDefault, body, line: cl });
    }
    this.expect("}");
    return { k: isExpr ? "switchx" : "switch", sel, cases, arrow, line };
  }
  // ---------- expressions ----------
  parseArgs() { this.expect("("); const a = []; if (!this.is(")")) do a.push(this.parseExpr()); while (this.eat(",")); this.expect(")"); return a; }
  parseArrayInit() {
    const line = this.cur.line; this.expect("{"); const el = [];
    while (!this.is("}")) { el.push(this.is("{") ? this.parseArrayInit() : this.parseExpr()); if (!this.eat(",")) break; }
    this.expect("}"); return { k: "arrinit", el, line };
  }
  parseExpr() { return this.parseAssign(); }
  tryLambda() {
    const c = this.cur, line = c.line;
    if (c.t === "id" && this.peek().v === "->") { this.p += 2; return { k: "lambda", params: [{ name: c.v, type: null }], body: this.lamBody(), line }; }
    if (c.v === "(" && c.t === "op") {
      // scan to matching paren and check for ->
      let d = 0, j = this.p; for (; j < this.t.length; j++) { const v = this.t[j]; if (v.t === "op" && v.v === "(") d++; else if (v.t === "op" && v.v === ")") { d--; if (d === 0) break; } }
      if (!(this.t[j + 1] && this.t[j + 1].v === "->" && this.t[j+1].t === "op")) return null;
      this.p++; const params = [];
      if (!this.is(")")) do {
        this.parseMods();
        if (this.cur.t === "id" && (this.peek().v === "," || this.peek().v === ")")) params.push({ name: this.ident(), type: null });
        else { let ty; if (this.isId("var")) { this.p++; ty = null; } else ty = this.parseType(); params.push({ name: this.ident(), type: ty }); }
      } while (this.eat(","));
      this.expect(")"); this.expect("->"); return { k: "lambda", params, body: this.lamBody(), line };
    }
    return null;
  }
  lamBody() { return this.is("{") ? this.parseBlock() : this.parseExpr(); }
  parseAssign() {
    const lam = this.tryLambda(); if (lam) return lam;
    const l = this.parseTernary(); const c = this.cur;
    if (c.t === "op") {
      if (["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<="].includes(c.v)) {
        if (!["name", "field", "idx"].includes(l.k)) throw new JErr("unexpected type\n  required: variable\n  found:    value", c.line);
        this.p++; return { k: "assign", op: c.v, l, r: this.is("{") && c.v === "=" ? this.parseArrayInit() : this.parseAssign(), line: c.line };
      }
      // >>= and >>>= : '>' '>' '>=' adjacent
      if (c.v === ">" && this.peek().v === ">" && this.peek().pos === c.pos + 1) {
        if (this.peek(2).v === ">=" && this.peek(2).pos === c.pos + 2) { this.p += 3; return { k: "assign", op: ">>>=", l, r: this.parseAssign(), line: c.line }; }
        if (this.peek(2).v === ">=" ) { /* fallthrough */ }
      }
      if (c.v === ">" && this.peek().v === ">=" && this.peek().pos === c.pos + 1) { this.p += 2; return { k: "assign", op: ">>=", l, r: this.parseAssign(), line: c.line }; }
    }
    return l;
  }
  parseTernary() {
    const c = this.parseBin(0);
    if (this.is("?")) { const line = this.cur.line; this.p++; const a = this.is("(") || true ? this.parseTernaryBranch() : null; this.expect(":"); const b = this.parseTernaryBranch(); return { k: "cond", c, a, b, line }; }
    return c;
  }
  parseTernaryBranch() { const lam = this.tryLambda(); if (lam) return lam; const e = this.parseTernary(); return e; }
  binOp() {
    const c = this.cur; if (c.t !== "op" && !(c.t === "kw" && c.v === "instanceof")) return null;
    const v = c.v;
    if (v === ">") {
      const n1 = this.peek();
      if (n1.v === ">" && n1.pos === c.pos + 1) { const n2 = this.peek(2); if (n2.v === ">" && n2.pos === c.pos + 2) { if (this.peek(3).v === ">=" && this.peek(3).pos === c.pos + 3) return null; return { op: ">>>", len: 3 }; } if (n2.v === ">=" && n2.pos === c.pos + 2) return null; return { op: ">>", len: 2 }; }
      if (n1.v === ">=" && n1.pos === c.pos + 1) return null;
    }
    return { op: v, len: 1 };
  }
  parseBin(minPrec) {
    let l = this.parseUnary();
    for (;;) {
      const o = this.binOp(); if (!o) break;
      const prec = PREC[o.op]; if (prec === undefined || prec < minPrec) break;
      const line = this.cur.line; this.p += o.len;
      if (o.op === "instanceof") {
        this.eat("final"); const type = this.parseType(); let bind = null; if (this.cur.t === "id" && !this.isId("when")) bind = this.ident(); else if (this.isId("when") && this.peek().v !== "(" && false) bind = null;
        l = { k: "inst", e: l, type, bind, line }; continue;
      }
      const r = this.parseBin(prec + 1);
      l = { k: "bin", op: o.op, l, r, line };
    }
    return l;
  }
  parseUnary() {
    const c = this.cur, line = c.line;
    if (c.t === "op") {
      if (c.v === "+" || c.v === "-") {
        this.p++;
        if (c.v === "-" && this.cur.t === "num" && !this.cur.neg) { const t = this.cur; if (t.k === "int" || t.k === "long") { this.p++; return this.parsePostfix({ k: "lit", kind: t.k, v: "-" + t.v, line }); } }
        return { k: "un", op: c.v, e: this.parseUnary(), line };
      }
      if (c.v === "!" || c.v === "~") { this.p++; return { k: "un", op: c.v, e: this.parseUnary(), line }; }
      if (c.v === "++" || c.v === "--") { this.p++; return { k: "pre", op: c.v, e: this.parseUnary(), line }; }
      if (c.v === "(") {
        // cast?
        const s = this.p; this.p++;
        if (this.isPrimTok() ) {
          const ty = this.parseType(); if (this.is(")")) { this.p++; return { k: "cast", type: ty, e: this.parseUnary(), line }; }
        } else if (this.cur.t === "id") {
          const ty = this.try(() => { const t = this.parseType(); while (this.eat("&")) this.parseType(); return this.is(")") ? t : (() => { throw new JErr("x"); })(); });
          if (ty) { this.p++; const n = this.cur; if (n.t === "id" || n.t === "str" || n.t === "chr" || n.t === "num" || (n.t === "kw" && ["this", "new", "super", "true", "false", "null", "switch"].includes(n.v) || (n.t === "kw" && PRIMS.has(n.v))) || (n.t === "op" && (n.v === "(" || n.v === "!" || n.v === "~"))) { const lam = this.tryLambda(); return { k: "cast", type: ty, e: lam || this.parseUnary(), line }; } }
        }
        this.p = s;
      }
    }
    return this.parsePostfix(this.parsePrimary());
  }
  parsePostfix(e) {
    for (;;) {
      const c = this.cur, line = c.line;
      if (c.t === "op" && c.v === ".") {
        this.p++;
        if (this.is("<")) this.parseTArgs();
        if (this.is("new")) { this.p++; const type = this.parseType(); const args = this.parseArgs(); let body = null; if (this.is("{")) { body = { k: "class", kind: "class", name: "", mods: new Set(), line, ext: null, impls: [], members: [], consts: [], tparams: [], anon: true }; this.parseClassBody(body); } e = { k: "new", type, args, body, outer: e, line }; continue; }
        if (this.is("this")) { this.p++; e = { k: "this", qual: e, line }; continue; }
        if (this.is("class")) { this.p++; e = { k: "classlit", e, line }; continue; }
        const name = this.cur.t === "kw" && this.cur.v === "super" ? (this.p++, "super") : this.ident();
        if (this.is("(")) e = { k: "call", obj: e, name, args: this.parseArgs(), line };
        else e = { k: "field", obj: e, name, line };
        continue;
      }
      if (c.t === "op" && c.v === "[") { this.p++; const i = this.parseExpr(); this.expect("]"); e = { k: "idx", arr: e, i, line }; continue; }
      if (c.t === "op" && (c.v === "++" || c.v === "--")) { this.p++; e = { k: "post", op: c.v, e, line }; continue; }
      if (c.t === "op" && c.v === "::") { this.p++; const name = this.is("new") ? (this.p++, "new") : this.ident(); e = { k: "mref", obj: e, name, line }; continue; }
      break;
    }
    return e;
  }
  parsePrimary() {
    const c = this.cur, line = c.line;
    switch (c.t) {
      case "num": this.p++; return { k: "lit", kind: c.k, v: c.v, line };
      case "str": this.p++; return { k: "lit", kind: "string", v: c.v, line };
      case "chr": this.p++; return { k: "lit", kind: "char", v: c.v, line };
      case "id": {
        this.p++;
        if (this.is("(")) return { k: "call", obj: null, name: c.v, args: this.parseArgs(), line };
        // generic type method ref e.g. ArrayList<String>::new , or array type String[]::new
        if (this.is("[") && this.peek().v === "]") { const s = this.p; this.p--; const ty = this.try(() => this.parseType()); if (ty && this.is("::")) { this.p++; const name = this.is("new") ? (this.p++, "new") : this.ident(); return { k: "mref", type: ty, name, line }; } if (ty && this.is(".") && this.peek().v === "class") { this.p += 2; return { k: "classlit", type: ty, line }; } this.p = s; }
        if (this.is("<")) { const s = this.p; this.p--; const ty = this.try(() => this.parseType()); if (ty && this.is("::")) { this.p++; const name = this.is("new") ? (this.p++, "new") : this.ident(); return { k: "mref", type: ty, name, line }; } this.p = s; }
        return { k: "name", id: c.v, line };
      }
      case "kw":
        switch (c.v) {
          case "true": this.p++; return { k: "lit", kind: "boolean", v: true, line };
          case "false": this.p++; return { k: "lit", kind: "boolean", v: false, line };
          case "null": this.p++; return { k: "lit", kind: "null", line };
          case "this": this.p++; if (this.is("(")) return { k: "ctorcall", which: "this", args: this.parseArgs(), line }; return { k: "this", line };
          case "super": {
            this.p++;
            if (this.is("(")) return { k: "ctorcall", which: "super", args: this.parseArgs(), line };
            if (this.eat("::")) { return { k: "mref", obj: { k: "super", line }, name: this.ident(), line }; }
            this.expect("."); const name = this.ident();
            if (this.is("(")) return { k: "call", obj: { k: "super", line }, name, args: this.parseArgs(), line };
            return { k: "field", obj: { k: "this", line, asSuper: true }, name, line };
          }
          case "new": return this.parseNew();
          case "switch": return this.parseSwitch(true);
          default:
            if (PRIMS.has(c.v)) { const ty = this.parseType(true); if (this.is("::")) { this.p++; this.expect("new"); return { k: "mref", type: ty, name: "new", line }; } if (this.is(".") && this.peek().v === "class") { this.p += 2; return { k: "classlit", type: ty, line }; } this.err("'.class' expected"); }
        }
        break;
      case "op":
        if (c.v === "(") { this.p++; const e = this.parseExpr(); this.expect(")"); return { k: "paren", e, line }; }
        break;
    }
    if (c.t === "eof") this.err("reached end of file while parsing");
    this.err("illegal start of expression");
  }
  parseNew() {
    const line = this.cur.line; this.expect("new"); this.skipAnnots();
    let base;
    if (this.isPrimTok()) base = { n: this.t[this.p++].v };
    else { let name = this.ident(), args = null; for (;;) { if (this.is("<")) args = this.parseTArgs(); if (this.is(".") && this.peek().t === "id") { this.p++; name += "." + this.ident(); continue; } break; } base = { n: name, a: args }; }
    if (this.is("[")) {
      const dims = []; let extra = 0;
      while (this.is("[")) { this.p++; if (this.is("]")) { this.p++; extra++; } else { if (extra) this.err("']' expected"); dims.push(this.parseExpr()); this.expect("]"); } }
      let init = null; if (this.is("{")) init = this.parseArrayInit();
      if (!dims.length && !init) this.err("array dimension missing");
      return { k: "newarr", elem: base, dims, extra, init, line };
    }
    if (!this.is("(")) this.err("'(' or '[' expected");
    const args = this.parseArgs(); let body = null;
    if (this.is("{")) { body = { k: "class", kind: "class", name: "", mods: new Set(), line, ext: null, impls: [], members: [], consts: [], tparams: [], anon: true }; this.parseClassBody(body); }
    return { k: "new", type: base, args, body, line };
  }
}
const PREC = { "||": 1, "&&": 2, "|": 3, "^": 4, "&": 5, "==": 6, "!=": 6, "<": 7, ">": 7, "<=": 7, ">=": 7, "instanceof": 7, "<<": 8, ">>": 8, ">>>": 8, "+": 9, "-": 9, "*": 10, "/": 10, "%": 10 };
function parseJava(src) { const toks = lex(src); return new Parser(toks).parseUnit(); }

/* ===== runtime core ===== */
const R = {};
let __out = (k, s) => {}; // set by host
let __hashSeq = 0x1b6d3586;
const __jcache = new Map();
class JObject {
  toString() { return (this.constructor.$full || this.constructor.$name) + "@" + this.hashCode().toString(16); }
  equals(o) { return this === o; }
  hashCode() { if (this.$h === undefined) { __hashSeq = (Math.imul(__hashSeq, 1103515245) + 12345) & 0x7fffffff; this.$h = __hashSeq; } return this.$h; }
  getClass() { let j = __jcache.get(this.constructor); if (!j) { j = new JClass(this.constructor); __jcache.set(this.constructor, j); } return j; }
}
JObject.$name = "Object"; JObject.$all = new Set([JObject]);
class JClass extends JObject { constructor(c) { super(); this.c = c; } getSimpleName() { return String(this.c.$name).split(/[.$]/).pop(); } getName() { return this.c.$full || this.c.$name; } toString() { return (this.c.$isIface ? "interface " : "class ") + this.getName(); } equals(o) { return o instanceof JClass && o.c === this.c; } hashCode() { return 7; } }
// boxes
class JDouble extends JObject { constructor(v) { super(); this.v = v; } toString() { return dstr(this.v); } equals(o) { return o instanceof JDouble && (o.v === this.v || (o.v !== o.v && this.v !== this.v)); } hashCode() { return dhash(this.v); } compareTo(o) { return dcmp(this.v, o.v); } doubleValue() { return this.v; } intValue() { return d2i(this.v); } longValue() { return d2l(this.v); } floatValue() { return Math.fround(this.v); } isNaN() { return this.v !== this.v; } isInfinite() { return !isFinite(this.v) && this.v === this.v; } }
JDouble.$name = "Double"; JDouble.$full = "java.lang.Double";
class JFloat extends JObject { constructor(v) { super(); this.v = v; } toString() { return fstr(this.v); } equals(o) { return o instanceof JFloat && o.v === this.v; } hashCode() { return f32bits(this.v); } compareTo(o) { return dcmp(this.v, o.v); } doubleValue() { return this.v; } intValue() { return d2i(this.v); } floatValue() { return this.v; } longValue() { return d2l(this.v); } }
JFloat.$name = "Float"; JFloat.$full = "java.lang.Float";
class JChar extends JObject { constructor(v) { super(); this.v = v; } toString() { return String.fromCharCode(this.v); } equals(o) { return o instanceof JChar && o.v === this.v; } hashCode() { return this.v; } compareTo(o) { return this.v - o.v; } charValue() { return this.v; } }
JChar.$name = "Character"; JChar.$full = "java.lang.Character";
const ccache = []; for (let i = 0; i < 256; i++) ccache.push(new JChar(i));
const bc = (v) => v < 256 ? ccache[v] : new JChar(v);
const bd = (v) => new JDouble(v), bf = (v) => new JFloat(v);
// exceptions
const $LNS = { l: 0, map: {} };
class Throwable extends JObject {
  constructor() { super(); this.$ln = $LNS.l; this.msg = null; this.cause = null; this.supp = []; }
  $c(a, b) { if (a instanceof Throwable) { this.cause = a; this.msg = a.toString(); } else { this.msg = a === undefined ? null : a; if (b instanceof Throwable) this.cause = b; } return this; }
  getMessage() { return this.msg; } getLocalizedMessage() { return this.msg; } getCause() { return this.cause; }
  initCause(c) { this.cause = c; return this; } addSuppressed(e) { this.supp.push(e); } getSuppressed() { return this.supp.slice(); }
  fillInStackTrace() { return this; } getStackTrace() { return []; } setStackTrace() {}
  toString() { const n = this.constructor.$full || this.constructor.$name; const m = this.getLocalizedMessage(); return m !== null && m !== undefined ? n + ": " + m : n; }
  printStackTrace() { __out("stderr", this.toString() + "\n\tat " + "Main.main(Main.java)\n" + (this.cause ? "Caused by: " + this.cause.toString() + "\n" : "")); }
}
Throwable.$name = "Throwable"; Throwable.$full = "java.lang.Throwable"; Throwable.$all = new Set([JObject, Throwable]);
const EXC = {};
function defExc(name, sup, pkg) {
  const S = sup ? EXC[sup] : Throwable;
  const C = ({ [name]: class extends S {} })[name];
  C.$name = name; C.$full = (pkg || "java.lang") + "." + name; C.$all = new Set([...S.$all, C]); EXC[name] = C; return C;
}
defExc("Exception", null); defExc("Error", null); defExc("RuntimeException", "Exception");
for (const n of ["IllegalArgumentException", "IllegalStateException", "ArithmeticException", "NullPointerException", "ClassCastException", "IndexOutOfBoundsException", "NegativeArraySizeException", "UnsupportedOperationException", "ArrayStoreException", "SecurityException"]) defExc(n, "RuntimeException");
defExc("NumberFormatException", "IllegalArgumentException"); defExc("ArrayIndexOutOfBoundsException", "IndexOutOfBoundsException"); defExc("StringIndexOutOfBoundsException", "IndexOutOfBoundsException");
defExc("InterruptedException", "Exception"); defExc("CloneNotSupportedException", "Exception"); defExc("ReflectiveOperationException", "Exception"); defExc("ClassNotFoundException", "ReflectiveOperationException");
defExc("NoSuchElementException", "RuntimeException", "java.util"); defExc("InputMismatchException", "NoSuchElementException", "java.util"); defExc("ConcurrentModificationException", "RuntimeException", "java.util"); defExc("EmptyStackException", "RuntimeException", "java.util");
defExc("IOException", "Exception", "java.io"); defExc("FileNotFoundException", "IOException", "java.io"); defExc("UncheckedIOException", "RuntimeException", "java.io"); defExc("TimeoutException", "Exception", "java.util.concurrent"); defExc("DateTimeException", "RuntimeException", "java.time");
defExc("StackOverflowError", "Error"); defExc("OutOfMemoryError", "Error"); defExc("AssertionError", "Error");
Object.assign(EXC, { Throwable });
const mk = (cls, msg) => new EXC[cls]().$c(msg);
const npe = (m) => { throw mk("NullPointerException", m === undefined ? null : m); };
function wrapEx(e) {
  if (e instanceof Throwable) return e;
  if (e && e.$exit) throw e;
  if (e instanceof RangeError) { if (/call stack/i.test(e.message)) return mk("StackOverflowError", null); if (/Invalid array length|Array buffer allocation|Invalid typed array length/i.test(e.message)) return mk("OutOfMemoryError", "Java heap space"); return mk("RuntimeException", e.message); }
  if (e instanceof TypeError) { if (/BigInt/.test(e.message)) return mk("ClassCastException", e.message); return mk("NullPointerException", null); }
  if (e instanceof JErr) throw e;
  if (e && e.message) return mk("RuntimeException", String(e.message));
  return mk("RuntimeException", String(e));
}
// numbers
function d2i(x) { if (x !== x) return 0; if (x >= 2147483647) return 2147483647; if (x <= -2147483648) return -2147483648; return x < 0 ? Math.ceil(x) | 0 : Math.floor(x) | 0; }
const L_MAX = 9223372036854775807n, L_MIN = -9223372036854775808n;
function d2l(x) { if (x !== x) return 0n; if (x >= 9223372036854775807) return L_MAX; if (x <= -9223372036854775808) return L_MIN; return BigInt(Math.trunc(x)); }
const idiv = (a, b) => { if (b === 0) throw mk("ArithmeticException", "/ by zero"); return (a / b) | 0; };
const imod = (a, b) => { if (b === 0) throw mk("ArithmeticException", "/ by zero"); return (a % b) | 0; };
const L = (x) => BigInt.asIntN(64, x);
const ldiv = (a, b) => { if (b === 0n) throw mk("ArithmeticException", "/ by zero"); return BigInt.asIntN(64, a / b); };
const lmod = (a, b) => { if (b === 0n) throw mk("ArithmeticException", "/ by zero"); return a % b; };
const lshl = (a, n) => BigInt.asIntN(64, a << BigInt(Number(n) & 63));
const lshr = (a, n) => a >> BigInt(Number(n) & 63);
const lushr = (a, n) => BigInt.asIntN(64, BigInt.asUintN(64, a) >> BigInt(Number(n) & 63));
const dmod = (a, b) => a % b;
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const f32bits = (x) => { f32[0] = x; return u32[0] | 0; };
const f64 = new Float64Array(1), u64 = new BigUint64Array(f64.buffer);
const dhash = (x) => { if (x !== x) return 0x7ff80000; f64[0] = x; const b = u64[0]; return Number(BigInt.asIntN(32, b ^ (b >> 32n))); };
const dcmp = (a, b) => a < b ? -1 : a > b ? 1 : (a === b ? (a === 0 ? (1 / a < 1 / b ? -1 : 1 / a > 1 / b ? 1 : 0) : 0) : (a !== a ? (b !== b ? 0 : 1) : -1));
function digitsOf(x) { // shortest digits and exponent: x>0 finite
  const s = x.toExponential(); const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  return { d: m[1] + (m[2] || ""), e: parseInt(m[3], 10) };
}
function fmtDigits(neg, d, e) {
  let r;
  if (e >= -3 && e < 7) {
    if (e >= 0) { const ip = d.length > e + 1 ? d.slice(0, e + 1) : d + "0".repeat(e + 1 - d.length); const fp = d.length > e + 1 ? d.slice(e + 1) : "0"; r = ip + "." + fp; }
    else r = "0." + "0".repeat(-e - 1) + d;
  } else r = d[0] + "." + (d.length > 1 ? d.slice(1) : "0") + "E" + e;
  return neg ? "-" + r : r;
}
function dstr(x) {
  if (x !== x) return "NaN"; if (x === Infinity) return "Infinity"; if (x === -Infinity) return "-Infinity";
  if (x === 0) return 1 / x < 0 ? "-0.0" : "0.0";
  if (x === 5e-324) return "4.9E-324"; if (x === -5e-324) return "-4.9E-324";
  const { d, e } = digitsOf(Math.abs(x)); return fmtDigits(x < 0, d, e);
}
function fstr(x) {
  if (x !== x) return "NaN"; if (x === Infinity) return "Infinity"; if (x === -Infinity) return "-Infinity";
  if (x === 0) return 1 / x < 0 ? "-0.0" : "0.0";
  const a = Math.abs(x); let best = null;
  for (let p = 1; p <= 9; p++) { const s = a.toExponential(p - 1); if (Math.fround(parseFloat(s)) === a) { best = s; break; } }
  if (!best) best = a.toExponential(8);
  const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(best); let d = m[1] + (m[2] || ""); d = d.replace(/0+$/, "") || "0";
  return fmtDigits(x < 0, d, parseInt(m[3], 10));
}
// string conversion
function str(v) {
  if (v === null || v === undefined) return "null";
  switch (typeof v) {
    case "string": return v; case "number": return String(v); case "boolean": return v ? "true" : "false"; case "bigint": return v.toString();
    case "function": return "Main$$Lambda@" + (v.name || "1b6d3586");
  }
  if (v instanceof Uint16Array || v instanceof Int32Array || v instanceof Float64Array || Array.isArray(v) || ArrayBuffer.isView(v)) return arrTypeName(v) + "@" + (hashOfObj(v)).toString(16);
  return v.toString();
}
const idMap = new WeakMap();
function hashOfObj(o) { let h = idMap.get(o); if (h === undefined) { __hashSeq = (Math.imul(__hashSeq, 1103515245) + 12345) & 0x7fffffff; h = __hashSeq; idMap.set(o, h); } return h; }
function arrTypeName(v) { if (v instanceof Int32Array) return "[I"; if (v instanceof Float64Array) return "[D"; if (v instanceof Uint16Array) return "[C"; if (v instanceof BigInt64Array) return "[J"; if (v instanceof Int8Array) return "[B"; if (v instanceof Int16Array) return "[S"; if (v instanceof Float32Array) return "[F"; return "[Ljava.lang.Object;"; }
const sstr = (s) => s === null || s === undefined ? "null" : s;
const cstr = (c) => String.fromCharCode(c);
const charsToStr = (a) => { if (a === null) npe(); let s = ""; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return s; };
const unb = (v) => v instanceof JDouble || v instanceof JFloat || v instanceof JChar ? v.v : v;
// unboxing conversions
const ui = (v) => { if (typeof v === "number") return v; if (v === null || v === undefined) npe(); if (typeof v === "bigint") return Number(BigInt.asIntN(32, v)); return v.v | 0; };
const ul = (v) => { if (typeof v === "bigint") return v; if (v === null || v === undefined) npe(); return BigInt(typeof v === "number" ? v : v.v); };
const ud = (v) => { if (typeof v === "number") return v; if (v === null || v === undefined) npe(); if (typeof v === "bigint") return Number(v); return v.v; };
const uf = (v) => Math.fround(ud(v));
const uc = (v) => { if (typeof v === "number") return v; if (v === null || v === undefined) npe(); return v.v; };
const ub = (v) => { if (v === null || v === undefined) npe(); return v; };
const nn = (v) => { if (v === null || v === undefined) npe(); return v; };
// dynamic arithmetic (operands are boxed/dynamic)
function numKind(v) { if (typeof v === "number") return 0; if (typeof v === "bigint") return 1; if (v instanceof JFloat) return 2; if (v instanceof JDouble) return 3; if (v instanceof JChar) return 0; if (v === null || v === undefined) npe(); return -1; }
function dyn(op, a, b) {
  if (op === "+" && (typeof a === "string" || typeof b === "string" || (numKind(a) < 0 && a !== null && typeof a !== "boolean") || (numKind(b) < 0 && b !== null && typeof b !== "boolean"))) return str(a) + str(b);
  if (op === "==" || op === "!=") { let r; const ka = typeof a === "object" && a !== null && !(a instanceof JDouble || a instanceof JChar || a instanceof JFloat), kb = typeof b === "object" && b !== null && !(b instanceof JDouble || b instanceof JChar || b instanceof JFloat); if (ka || kb || a === null || b === null || typeof a === "string" || typeof a === "boolean") r = a === b; else r = ud(a) == ud(b); return op === "==" ? r : !r; }
  if (typeof a === "boolean" && typeof b === "boolean") { switch (op) { case "&": return a && b; case "|": return a || b; case "^": return a !== b; } }
  const k = Math.max(numKind(a), numKind(b)); if (k < 0) throw mk("ClassCastException", "bad operand types for " + op);
  if (op === "<<" || op === ">>" || op === ">>>") { const ka = numKind(a); if (ka === 1) { const s = ul(b); return op === "<<" ? lshl(a, s) : op === ">>" ? lshr(a, s) : lushr(a, s); } const x = ui(a), s = ui(b); return op === "<<" ? x << s : op === ">>" ? x >> s : (x >>> s) | 0; }
  if (k === 0) { const x = ui(a), y = ui(b); switch (op) { case "+": return (x + y) | 0; case "-": return (x - y) | 0; case "*": return Math.imul(x, y); case "/": return idiv(x, y); case "%": return imod(x, y); case "<": return x < y; case ">": return x > y; case "<=": return x <= y; case ">=": return x >= y; case "&": return x & y; case "|": return x | y; case "^": return x ^ y; } }
  if (k === 1) { const x = ul(a), y = ul(b); switch (op) { case "+": return L(x + y); case "-": return L(x - y); case "*": return L(x * y); case "/": return ldiv(x, y); case "%": return lmod(x, y); case "<": return x < y; case ">": return x > y; case "<=": return x <= y; case ">=": return x >= y; case "&": return x & y; case "|": return x | y; case "^": return x ^ y; } }
  const x = ud(a), y = ud(b); let r;
  switch (op) { case "+": r = x + y; break; case "-": r = x - y; break; case "*": r = x * y; break; case "/": r = x / y; break; case "%": r = x % y; break; case "<": return x < y; case ">": return x > y; case "<=": return x <= y; case ">=": return x >= y; }
  return k === 2 ? new JFloat(Math.fround(r)) : new JDouble(r);
}
const dynneg = (a) => { const k = numKind(a); if (k === 0) return -ui(a) | 0; if (k === 1) return L(-a); return k === 2 ? new JFloat(-a.v) : new JDouble(-a.v); };
// arrays
function ci(a, i) { if (i >>> 0 >= a.length) { if (a === null) npe(); throw mk("ArrayIndexOutOfBoundsException", "Index " + i + " out of bounds for length " + a.length); } return i; }
function newArr(kind, n) { if (n < 0) throw mk("NegativeArraySizeException", String(n)); switch (kind) { case "int": return new Int32Array(n); case "double": return new Float64Array(n); case "char": return new Uint16Array(n); case "long": return new BigInt64Array(n); case "byte": return new Int8Array(n); case "short": return new Int16Array(n); case "float": return new Float32Array(n); case "boolean": return new Array(n).fill(false); } return new Array(n).fill(null); }
function newMulti(kind, dims, k) { // dims: array of sizes, trailing missing dims -> null
  const n = dims[k]; if (k === dims.length - 1) return newArr(kind, n);
  if (n < 0) throw mk("NegativeArraySizeException", String(n));
  const a = new Array(n); for (let i = 0; i < n; i++) a[i] = newMulti(kind, dims, k + 1); return a;
}
function mkArr(kind, vals) { switch (kind) { case "int": return Int32Array.from(vals); case "double": return Float64Array.from(vals); case "char": return Uint16Array.from(vals); case "long": return BigInt64Array.from(vals); case "byte": return Int8Array.from(vals); case "short": return Int16Array.from(vals); case "float": return Float32Array.from(vals); } return vals; }
const isArr = (v) => Array.isArray(v) || ArrayBuffer.isView(v);
function arrStr(a) { if (a === null) return "null"; const kind = a instanceof Float64Array ? 1 : a instanceof Uint16Array ? 2 : a instanceof Float32Array ? 3 : 0; const r = new Array(a.length); for (let i = 0; i < a.length; i++) { const v = a[i]; r[i] = kind === 1 ? dstr(v) : kind === 2 ? String.fromCharCode(v) : kind === 3 ? fstr(v) : str(v); } return "[" + r.join(", ") + "]"; }
function deepStr(a) { if (a === null) return "null"; if (!Array.isArray(a)) return arrStr(a); return "[" + a.map((x) => isArr(x) ? deepStr(x) : str(x)).join(", ") + "]"; }
// string hash / compare
function shash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h; }
function hash(v) {
  if (v === null || v === undefined) return 0;
  switch (typeof v) { case "string": return shash(v); case "number": return v; case "boolean": return v ? 1231 : 1237; case "bigint": return Number(BigInt.asIntN(32, v ^ (v >> 32n))); case "function": return 7; }
  if (isArr(v)) return hashOfObj(v);
  return v.hashCode();
}
function eq(a, b) {
  if (a === b) return true; if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === "object" && typeof a.equals === "function") return a.equals(b);
  return false;
}
function cmp(a, b) {
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "string" && typeof b === "string") return scmp(a, b);
  if (typeof a === "bigint" && typeof b === "bigint") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "boolean") return a === b ? 0 : a ? 1 : -1;
  if (a === null || b === null) npe();
  if (typeof a.compareTo !== "function") throw mk("ClassCastException", "class " + (a.constructor.$name || "Object") + " cannot be cast to class java.lang.Comparable");
  return a.compareTo(b);
}
function scmp(a, b) { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) { const d = a.charCodeAt(i) - b.charCodeAt(i); if (d) return d; } return a.length - b.length; }

/* ===== runtime: strings, format, boxed statics, Math ===== */
const oob = (cls, m) => { throw mk(cls, m); };
const S = {
  length: (s) => s.length, isEmpty: (s) => s.length === 0, isBlank: (s) => s.trim().length === 0,
  charAt: (s, i) => { if (i >>> 0 >= s.length) { if (s === null) npe(); oob("StringIndexOutOfBoundsException", "index " + i + ", length " + s.length); } return s.charCodeAt(i); },
  codePointAt: (s, i) => S.charAt(s, i),
  substring: (s, a, b) => { if (b === undefined) b = s.length; if (a < 0 || b > s.length || a > b) oob("StringIndexOutOfBoundsException", "begin " + a + ", end " + b + ", length " + s.length); return s.substring(a, b); },
  subSequence: (s, a, b) => S.substring(s, a, b),
  indexOf: (s, x, from) => s.indexOf(typeof x === "number" ? String.fromCharCode(x) : x, from === undefined ? 0 : Math.max(0, from)),
  lastIndexOf: (s, x, from) => from === undefined ? s.lastIndexOf(typeof x === "number" ? String.fromCharCode(x) : x) : s.lastIndexOf(typeof x === "number" ? String.fromCharCode(x) : x, from),
  contains: (s, x) => s.includes(str(x)), startsWith: (s, x, o) => s.startsWith(x, o || 0), endsWith: (s, x) => s.endsWith(x),
  equals: (s, o) => { if (s === null) npe(); return s === o; }, equalsIgnoreCase: (s, o) => o !== null && s.toLowerCase() === o.toLowerCase(),
  compareTo: (s, o) => { if (o === null) npe(); return scmp(s, o); }, compareToIgnoreCase: (s, o) => scmp(s.toLowerCase(), o.toLowerCase()),
  toUpperCase: (s) => s.toUpperCase(), toLowerCase: (s) => s.toLowerCase(), trim: (s) => s.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, ""), strip: (s) => s.trim(),
  stripLeading: (s) => s.trimStart(), stripTrailing: (s) => s.trimEnd(),
  concat: (s, o) => s + o, hashCode: (s) => shash(s), toString: (s) => s, intern: (s) => s,
  replace: (s, a, b) => { a = typeof a === "number" ? String.fromCharCode(a) : str(a); b = typeof b === "number" ? String.fromCharCode(b) : str(b); return s.split(a).join(b); },
  replaceAll: (s, re, r) => s.replace(jre(re, "g"), jrepl(r)), replaceFirst: (s, re, r) => s.replace(jre(re, ""), jrepl(r)),
  matches: (s, re) => jre("^(?:" + re + ")$", "").test(s),
  split: (s, re, lim) => {
    lim = lim === undefined ? 0 : lim; let parts;
    if (s === "") return [""];
    const rx = jre(re, "g");
    if (lim > 0) { parts = []; let last = 0, m; rx.lastIndex = 0; while (parts.length < lim - 1 && (m = rx.exec(s))) { if (m[0].length === 0) { if (m.index >= s.length) break; if (m.index === 0) { rx.lastIndex++; continue; } } if (m.index === 0 && m[0].length > 0 && false) continue; parts.push(s.slice(last, m.index)); last = m.index + m[0].length; if (m[0].length === 0) rx.lastIndex++; } parts.push(s.slice(last)); return parts; }
    parts = []; let last = 0, m; rx.lastIndex = 0;
    while ((m = rx.exec(s))) {
      if (m[0].length === 0) { if (m.index >= s.length) break; if (m.index === 0) { rx.lastIndex++; continue; } }
      if (m.index === 0 && m[0].length > 0 && last === 0) { parts.push(""); last = m[0].length; /* leading empty string kept */ if (m[0].length === 0) rx.lastIndex++; continue; }
      parts.push(s.slice(last, m.index)); last = m.index + m[0].length; if (m[0].length === 0) rx.lastIndex++;
    }
    parts.push(s.slice(last));
    if (lim === 0) while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
    if (parts.length === 1 && parts[0] === "" && s !== "") return s.length ? [] : [""];
    return parts;
  },
  toCharArray: (s) => { const a = new Uint16Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; },
  chars: (s) => new JStream(Array.from({ length: s.length }, (_, i) => s.charCodeAt(i)), "int"),
  repeat: (s, n) => { if (n < 0) throw mk("IllegalArgumentException", "count is negative: " + n); return s.repeat(n); },
  format: (s, ...a) => fmt(s, a), formatted: (s, ...a) => fmt(s, a),
  lines: (s) => new JStream(s.split(/\r?\n/), "obj"),
  getClass: (s) => new JClass({ $name: "String", $full: "java.lang.String" }),
  describeConstable: (s) => s,
};
function jre(re, flags) {
  let src = re.replace(/\\p\{Alpha\}/g, "[A-Za-z]").replace(/\\p\{Punct\}/g, "[!-\\/:-@\\[-`{-~]").replace(/\\p\{Upper\}/g, "[A-Z]").replace(/\\p\{Lower\}/g, "[a-z]").replace(/\\p\{Digit\}/g, "[0-9]").replace(/\\p\{Alnum\}/g, "[A-Za-z0-9]").replace(/\\p\{L\}/g, "\\p{L}").replace(/\(\?i\)/g, () => { flags += "i"; return ""; }).replace(/\\h/g, "[ \\t]").replace(/\\Z/g, "$").replace(/\\A/g, "^").replace(/\*\+|\+\+|\?\+/g, (m) => m[0]);
  if (/\\p\{/.test(src)) flags += "u";
  try { return new RegExp(src, flags); } catch (e) { throw mk("PatternSyntaxException", e.message); }
}
function jrepl(r) { return r.replace(/\$(\d)/g, "$$$1").replace(/\\(.)/g, (m, c) => c === "$" ? "$$" : c); }
defExc("PatternSyntaxException", "IllegalArgumentException", "java.util.regex");
defExc("IllegalFormatException", "IllegalArgumentException", "java.util");
defExc("IllegalFormatConversionException", "IllegalFormatException", "java.util"); defExc("MissingFormatArgumentException", "IllegalFormatException", "java.util"); defExc("UnknownFormatConversionException", "IllegalFormatException", "java.util");
function clsName(v) { if (typeof v === "number") return "java.lang.Integer"; if (typeof v === "bigint") return "java.lang.Long"; if (typeof v === "string") return "java.lang.String"; if (typeof v === "boolean") return "java.lang.Boolean"; if (v instanceof JDouble) return "java.lang.Double"; if (v instanceof JFloat) return "java.lang.Float"; if (v instanceof JChar) return "java.lang.Character"; return (v && v.constructor && (v.constructor.$full || v.constructor.$name)) || "java.lang.Object"; }
function groupDigits(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function fixedStr(x, prec) {
  if (x !== x) return "NaN"; if (!isFinite(x)) return x < 0 ? "-Infinity" : "Infinity";
  const neg = x < 0 || (x === 0 && 1 / x < 0); const a = Math.abs(x);
  let ip, fp;
  if (a === 0) { ip = "0"; fp = ""; }
  else { const { d, e } = digitsOf(a); if (e >= 0) { ip = d.length > e + 1 ? d.slice(0, e + 1) : d + "0".repeat(e + 1 - d.length); fp = d.length > e + 1 ? d.slice(e + 1) : ""; } else { ip = "0"; fp = "0".repeat(-e - 1) + d; } }
  if (fp.length > prec) {
    const up = fp.charCodeAt(prec) >= 53; fp = fp.slice(0, prec);
    if (up) { let digs = (ip + fp).split(""), i = digs.length - 1; while (i >= 0) { if (digs[i] === "9") { digs[i] = "0"; i--; } else { digs[i] = String.fromCharCode(digs[i].charCodeAt(0) + 1); break; } } let all = digs.join(""); if (i < 0) all = "1" + all; ip = all.slice(0, all.length - prec); fp = all.slice(all.length - prec); }
  } else fp = fp.padEnd(prec, "0");
  return (neg ? "-" : "") + ip + (prec > 0 ? "." + fp : "");
}
function sciStr(x, prec, upper) {
  if (x !== x) return "NaN"; if (!isFinite(x)) return x < 0 ? "-Infinity" : "Infinity";
  let s; if (x === 0) s = "0".repeat(1) + (prec > 0 ? "." + "0".repeat(prec) : "") + "e+00";
  else { const a = Math.abs(x); const { d, e } = digitsOf(a); let dd = d; let ee = e; if (dd.length > prec + 1) { const up = dd.charCodeAt(prec + 1) >= 53; dd = dd.slice(0, prec + 1); if (up) { let n = (BigInt(dd) + 1n).toString(); if (n.length > dd.length) { n = n.slice(0, dd.length); ee++; } dd = n; } } else dd = dd.padEnd(prec + 1, "0"); s = dd[0] + (prec > 0 ? "." + dd.slice(1) : "") + "e" + (ee < 0 ? "-" : "+") + String(Math.abs(ee)).padStart(2, "0"); if (x < 0) s = "-" + s; }
  return upper ? s.toUpperCase() : s;
}
function fmt(f, args) {
  if (f === null) npe(); let ai = 0, out = "";
  const re = /%(\d+\$)?([-#+ 0,(]*)(\d+)?(\.\d+)?([a-zA-Z%])/g; let last = 0, m;
  while ((m = re.exec(f))) {
    out += f.slice(last, m.index); last = re.lastIndex;
    const flags = m[2] || "", width = m[3] ? parseInt(m[3], 10) : 0, prec = m[4] ? parseInt(m[4].slice(1), 10) : -1; let conv = m[5];
    if (conv === "n") { out += "\n"; continue; } if (conv === "%") { out += "%".padStart(width, " "); continue; }
    let arg;
    if (m[1]) { arg = args[parseInt(m[1], 10) - 1]; } else { if (ai >= args.length) throw mk("MissingFormatArgumentException", "Format specifier '" + m[0] + "'"); arg = args[ai++]; }
    let s; const left = flags.includes("-"), zero = flags.includes("0");
    const lc = conv.toLowerCase(); const upper = conv !== lc;
    const bad = () => { throw mk("IllegalFormatConversionException", conv + " != " + clsName(arg)); };
    if (lc === "d") {
      if (arg === null) s = "null"; else { if (typeof arg !== "number" && typeof arg !== "bigint") bad(); let neg = arg < 0, a = (neg ? -BigInt(arg) : BigInt(arg)).toString(); if (flags.includes(",")) a = groupDigits(a); s = a; const sign = neg ? (flags.includes("(") ? "(" : "-") : flags.includes("+") ? "+" : flags.includes(" ") ? " " : ""; if (zero && !left) s = s.padStart(width - sign.length - (neg && flags.includes("(") ? 1 : 0), "0"); s = sign + s + (neg && flags.includes("(") ? ")" : ""); }
    } else if (lc === "f" || lc === "e" || lc === "g") {
      if (arg === null) s = "null"; else { if (!(arg instanceof JDouble || arg instanceof JFloat)) { if (arg && arg.constructor && arg.constructor.$name === "BigDecimal") arg = new JDouble(Number(arg.toString())); else bad(); } let v = arg.v; if (arg instanceof JFloat) v = parseFloat(fstr(v)); const p = prec < 0 ? 6 : prec; let a;
        if (lc === "f") a = fixedStr(v, p); else if (lc === "e") a = sciStr(v, p, upper); else { const ab = Math.abs(v); a = (ab !== 0 && (ab < 1e-4 || ab >= Math.pow(10, p === 0 ? 1 : p))) ? sciStr(v, (p === 0 ? 1 : p) - 1, upper) : fixedStr(v, Math.max(0, (p === 0 ? 1 : p) - (ab === 0 ? 1 : Math.floor(Math.log10(ab)) + 1))); }
        let neg = a[0] === "-"; if (neg) a = a.slice(1);
        if (flags.includes(",") && lc === "f") { const k = a.indexOf("."); a = k < 0 ? groupDigits(a) : groupDigits(a.slice(0, k)) + a.slice(k); }
        const sign = neg ? (flags.includes("(") ? "(" : "-") : flags.includes("+") ? "+" : flags.includes(" ") ? " " : "";
        if (!isFinite(v) || v !== v) s = sign + a; else { if (zero && !left) a = a.padStart(width - sign.length, "0"); s = sign + a + (neg && flags.includes("(") ? ")" : ""); } }
    } else if (lc === "s") { s = arg !== null && typeof arg === "object" && arg.formatTo ? "" : str(arg); if (prec >= 0) s = s.slice(0, prec); if (upper) s = s.toUpperCase(); }
    else if (lc === "c") { if (arg === null) s = "null"; else if (arg instanceof JChar) s = String.fromCharCode(arg.v); else if (typeof arg === "number") s = String.fromCodePoint(arg); else bad(); if (upper) s = s.toUpperCase(); }
    else if (lc === "b") { s = arg === null ? "false" : typeof arg === "boolean" ? String(arg) : "true"; if (upper) s = s.toUpperCase(); }
    else if (lc === "x" || lc === "o") { if (arg === null) s = "null"; else { if (typeof arg !== "number" && typeof arg !== "bigint") bad(); const bits = typeof arg === "bigint" ? 64n : 32n; let u = BigInt.asUintN(Number(bits), BigInt(arg)); s = u.toString(lc === "x" ? 16 : 8); if (flags.includes("#")) s = (lc === "x" ? "0x" : "0") + s; if (zero && !left) s = s.padStart(width, "0"); if (upper) s = s.toUpperCase(); } }
    else if (lc === "h") { s = (hash(arg) >>> 0).toString(16); }
    else throw mk("UnknownFormatConversionException", "Conversion = '" + m[5] + "'");
    if (s.length < width) s = left ? s.padEnd(width, " ") : s.padStart(width, " ");
    out += s;
  }
  out += f.slice(last);
  const stray = out.indexOf("%"); // unmatched % specifier check
  if (/%[^%]*$/.test(f.slice(last)) && /%(?![\d\-#+ 0,(.]*[a-zA-Z%])/.test(f.slice(last))) throw mk("UnknownFormatConversionException", "Conversion = '%'");
  return out;
}
// Character / Integer / Long / Double / Boolean statics
const nfe = (s) => mk("NumberFormatException", s === null ? "Cannot parse null string" : 'For input string: "' + s + '"');
function parseIntR(s, radix, bits) {
  radix = radix || 10; if (s === null) throw mk("NumberFormatException", "null"); 
  const re = radix === 10 ? /^[+-]?\d+$/ : null; if (re ? !re.test(s) : !s.length || !/^[+-]?[0-9a-zA-Z]+$/.test(s)) throw nfe(s);
  let neg = s[0] === "-", body = s.replace(/^[+-]/, ""), v = 0n; const rb = BigInt(radix);
  for (const ch of body) { const d = parseInt(ch, 36); if (isNaN(d) || d >= radix) throw nfe(s); v = v * rb + BigInt(d); }
  if (neg) v = -v; const lim = bits === 32 ? 2147483647n : L_MAX; if (v > lim || v < -lim - 1n) throw mk("NumberFormatException", 'For input string: "' + s + '"' + (radix !== 10 ? " under radix " + radix : ""));
  return bits === 32 ? Number(v) : v;
}
const isLetter = (c) => /\p{L}/u.test(String.fromCharCode(c)), isDigit = (c) => /\p{Nd}/u.test(String.fromCharCode(c));
const Character = {
  isDigit, isLetter, isLetterOrDigit: (c) => isLetter(c) || isDigit(c), isAlphabetic: isLetter,
  isUpperCase: (c) => { const s = String.fromCharCode(c); return s !== s.toLowerCase() && s === s.toUpperCase(); }, isLowerCase: (c) => { const s = String.fromCharCode(c); return s !== s.toUpperCase() && s === s.toLowerCase(); },
  isWhitespace: (c) => c === 32 || (c >= 9 && c <= 13) || (c >= 28 && c <= 31), isSpaceChar: (c) => c === 32 || c === 160,
  toUpperCase: (c) => { const s = String.fromCharCode(c).toUpperCase(); return s.length === 1 ? s.charCodeAt(0) : c; }, toLowerCase: (c) => { const s = String.fromCharCode(c).toLowerCase(); return s.length === 1 ? s.charCodeAt(0) : c; },
  getNumericValue: (c) => { const d = parseInt(String.fromCharCode(c), 36); return isNaN(d) ? -1 : d; }, digit: (c, r) => { const d = parseInt(String.fromCharCode(c), 36); return isNaN(d) || d >= r ? -1 : d; },
  forDigit: (d, r) => d < 0 || d >= r ? 0 : "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt(d),
  toString: (c) => String.fromCharCode(c), valueOf: (c) => bc(c), compare: (a, b) => a - b, hashCode: (c) => c, toChars: (c) => Uint16Array.of(c), isSurrogate: () => false,
  MAX_VALUE: 65535, MIN_VALUE: 0,
};
const bitCount32 = (n) => { n = n - ((n >>> 1) & 0x55555555); n = (n & 0x33333333) + ((n >>> 2) & 0x33333333); return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
const Integer = {
  MAX_VALUE: 2147483647, MIN_VALUE: -2147483648, SIZE: 32, BYTES: 4,
  parseInt: (s, r) => parseIntR(s, r, 32), valueOf: (s, r) => typeof s === "string" ? parseIntR(s, r, 32) : s, decode: (s) => /^[+-]?0[xX]/.test(s) ? parseIntR(s.replace(/0[xX]/, ""), 16, 32) : parseIntR(s, 10, 32),
  toString: (i, r) => r ? i.toString(r) : String(i), toBinaryString: (i) => (i >>> 0).toString(2), toHexString: (i) => (i >>> 0).toString(16), toOctalString: (i) => (i >>> 0).toString(8),
  compare: (a, b) => a < b ? -1 : a > b ? 1 : 0, sum: (a, b) => (a + b) | 0, max: Math.max, min: Math.min, signum: (a) => a > 0 ? 1 : a < 0 ? -1 : 0, hashCode: (a) => a,
  bitCount: bitCount32, reverse: (n) => { let r = 0; for (let i = 0; i < 32; i++) { r = (r << 1) | (n & 1); n >>>= 1; } return r | 0; },
  highestOneBit: (n) => n === 0 ? 0 : (1 << (31 - Math.clz32(n))) | 0, lowestOneBit: (n) => n & -n, numberOfLeadingZeros: Math.clz32, numberOfTrailingZeros: (n) => n === 0 ? 32 : 31 - Math.clz32(n & -n),
  divideUnsigned: (a, b) => ((a >>> 0) / (b >>> 0)) | 0, remainderUnsigned: (a, b) => ((a >>> 0) % (b >>> 0)) | 0, parseUnsignedInt: (s) => Number(BigInt.asIntN(32, BigInt(s))), toUnsignedString: (i) => String(i >>> 0), rotateLeft: (i, d) => (i << d) | (i >>> (32 - d)), rotateRight: (i, d) => (i >>> d) | (i << (32 - d)), abs: (a) => Math.abs(a) | 0,
};
const Long = {
  MAX_VALUE: L_MAX, MIN_VALUE: L_MIN, SIZE: 64, BYTES: 8,
  parseLong: (s, r) => parseIntR(s, r, 64), valueOf: (s) => typeof s === "string" ? parseIntR(s, 10, 64) : BigInt(s), toString: (i, r) => r ? i.toString(r) : String(i),
  toBinaryString: (i) => BigInt.asUintN(64, i).toString(2), toHexString: (i) => BigInt.asUintN(64, i).toString(16), toOctalString: (i) => BigInt.asUintN(64, i).toString(8),
  compare: (a, b) => a < b ? -1 : a > b ? 1 : 0, sum: (a, b) => L(a + b), max: (a, b) => a > b ? a : b, min: (a, b) => a < b ? a : b, signum: (a) => a > 0n ? 1 : a < 0n ? -1 : 0, hashCode: (v) => hash(v),
  bitCount: (v) => { let c = 0; v = BigInt.asUintN(64, v); while (v) { c += Number(v & 1n); v >>= 1n; } return c; }, numberOfTrailingZeros: (v) => { if (v === 0n) return 64; let c = 0; while (!(v & 1n)) { v >>= 1n; c++; } return c; },
  numberOfLeadingZeros: (v) => { v = BigInt.asUintN(64, v); return v === 0n ? 64 : 64 - v.toString(2).length; }, abs: (a) => a < 0n ? L(-a) : a,
};
const parseD = (s) => { if (s === null) npe(); const t = s.trim(); if (!/^[+-]?(NaN|Infinity|((\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)[fFdD]?)$/.test(t)) throw mk("NumberFormatException", t === "" ? "empty String" : 'For input string: "' + s + '"'); return parseFloat(t.replace(/[fFdD]$/, "")); };
const Double = {
  MAX_VALUE: Number.MAX_VALUE, MIN_VALUE: 5e-324, POSITIVE_INFINITY: Infinity, NEGATIVE_INFINITY: -Infinity, NaN: NaN,
  parseDouble: parseD, valueOf: (s) => new JDouble(typeof s === "string" ? parseD(s) : s), toString: (d) => dstr(d), compare: dcmp, isNaN: (d) => d !== d, isInfinite: (d) => d === Infinity || d === -Infinity, isFinite: (d) => isFinite(d),
  sum: (a, b) => a + b, max: Math.max, min: Math.min, hashCode: dhash, doubleToLongBits: (d) => { f64[0] = d; return BigInt.asIntN(64, u64[0]); },
};
const Float = { MAX_VALUE: 3.4028234663852886e38, MIN_VALUE: 1.401298464324817e-45, parseFloat: (s) => Math.fround(parseD(s)), valueOf: (s) => new JFloat(typeof s === "string" ? Math.fround(parseD(s)) : s), toString: (f) => fstr(f), compare: dcmp, isNaN: (d) => d !== d, sum: (a, b) => Math.fround(a + b), max: Math.max, min: Math.min };
const Short = { MAX_VALUE: 32767, MIN_VALUE: -32768, parseShort: (s) => { const v = parseIntR(s, 10, 32); if (v > 32767 || v < -32768) throw mk("NumberFormatException", 'Value out of range. Value:"' + s + '" Radix:10'); return v; }, valueOf: (s) => typeof s === "string" ? Short.parseShort(s) : s, toString: String, compare: (a, b) => a - b };
const Byte = { MAX_VALUE: 127, MIN_VALUE: -128, parseByte: (s) => { const v = parseIntR(s, 10, 32); if (v > 127 || v < -128) throw mk("NumberFormatException", 'Value out of range. Value:"' + s + '" Radix:10'); return v; }, valueOf: (s) => typeof s === "string" ? Byte.parseByte(s) : s, toString: String, compare: (a, b) => a - b };
const Boolean_ = { TRUE: true, FALSE: false, parseBoolean: (s) => s !== null && s.toLowerCase() === "true", valueOf: (s) => typeof s === "string" ? s.toLowerCase() === "true" : s, toString: (b) => String(b), compare: (a, b) => a === b ? 0 : a ? 1 : -1, logicalAnd: (a, b) => a && b, logicalOr: (a, b) => a || b, logicalXor: (a, b) => a !== b, hashCode: (b) => b ? 1231 : 1237 };
const exactChk = (v, bits) => { if (bits === 32 ? (v > 2147483647 || v < -2147483648) : (v > L_MAX || v < L_MIN)) throw mk("ArithmeticException", (bits === 32 ? "integer" : "long") + " overflow"); return v; };
const Math_ = {
  PI: Math.PI, E: Math.E, sqrt: Math.sqrt, cbrt: Math.cbrt, pow: (a, b) => Math.pow(a, b), floor: Math.floor, ceil: Math.ceil, rint: (x) => { const r = Math.round(x); return (Math.abs(x % 1) === 0.5 && r % 2 !== 0) ? r - 1 : r; },
  random: Math.random, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, log: Math.log, log10: Math.log10, log1p: Math.log1p, expm1: Math.expm1, hypot: Math.hypot,
  toRadians: (d) => d / 180 * Math.PI, toDegrees: (r) => r * 180 / Math.PI, signum: (x) => x > 0 ? 1 : x < 0 ? -1 : x,
  absI: (a) => (a < 0 ? -a : a) | 0, absL: (a) => a < 0n ? L(-a) : a, absD: Math.abs,
  maxI: (a, b) => a > b ? a : b, minI: (a, b) => a < b ? a : b, maxL: (a, b) => a > b ? a : b, minL: (a, b) => a < b ? a : b,
  maxD: (a, b) => a !== a || b !== b ? NaN : Math.max(a, b), minD: (a, b) => a !== a || b !== b ? NaN : Math.min(a, b),
  roundD: (x) => { if (x !== x) return 0n; const r = Math.floor(x); return d2l(x - r >= 0.5 ? r + 1 : r); }, roundF: (x) => { if (x !== x) return 0; const r = Math.floor(x); return d2i(x - r >= 0.5 ? r + 1 : r); },
  floorDivI: (a, b) => { if (b === 0) throw mk("ArithmeticException", "/ by zero"); return Math.floor(a / b) | 0; }, floorModI: (a, b) => { if (b === 0) throw mk("ArithmeticException", "/ by zero"); return ((a % b) + b) % b | 0; },
  floorDivL: (a, b) => { if (b === 0n) throw mk("ArithmeticException", "/ by zero"); let q = a / b; if ((a % b !== 0n) && ((a < 0n) !== (b < 0n))) q--; return q; }, floorModL: (a, b) => { if (b === 0n) throw mk("ArithmeticException", "/ by zero"); return ((a % b) + b) % b; },
  addExactI: (a, b) => exactChk(a + b, 32), subtractExactI: (a, b) => exactChk(a - b, 32), multiplyExactI: (a, b) => exactChk(a * b, 32), addExactL: (a, b) => exactChk(a + b, 64), subtractExactL: (a, b) => exactChk(a - b, 64), multiplyExactL: (a, b) => exactChk(a * b, 64),
  toIntExact: (a) => { if (a > 2147483647n || a < -2147483648n) throw mk("ArithmeticException", "integer overflow"); return Number(a); }, negateExact: (a) => exactChk(-a, 32), incrementExactI: (a) => exactChk(a + 1, 32), decrementExactI: (a) => exactChk(a - 1, 32),
  clampI: (v, lo, hi) => Math.min(hi, Math.max(lo, v)), ulp: (x) => Math.abs(x) * 2.220446049250313e-16,
};
const SYSOUT = (kind) => ({
  print: (s) => __out(kind, s), println: (s) => __out(kind, (s === undefined ? "" : s) + "\n"), printf: (f, ...a) => { __out(kind, fmt(f, a.length === 1 && Array.isArray(a[0]) ? a[0] : a)); return null; }, format: (f, ...a) => { __out(kind, fmt(f, a)); return null; }, flush: () => {}, write: (c) => __out(kind, String.fromCharCode(c)), close: () => {}, checkError: () => false,
});
let __stdin = "", __stdinPos = 0;
const JIn = { $isIn: true, read() { return __stdinPos < __stdin.length ? __stdin.charCodeAt(__stdinPos++) : -1; }, available() { return __stdin.length - __stdinPos; }, close() {} };
const Sys = {
  out: SYSOUT("stdout"), err: SYSOUT("stderr"), in: JIn,
  currentTimeMillis: () => BigInt(Date.now()), nanoTime: () => BigInt(Math.round(performance.now() * 1e6)),
  exit: (c) => { throw { $exit: true, code: c }; }, lineSeparator: () => "\n", getProperty: (k) => ({ "line.separator": "\n", "java.version": "11.0.30", "os.name": "Linux", "user.dir": "/home", "file.separator": "/" }[k] ?? null), getenv: () => null, identityHashCode: (o) => o === null ? 0 : hashOfObj(o), gc: () => {}, setOut: () => {},
  arraycopy: (src, sp, dst, dp, n) => {
    if (src === null || dst === null) npe();
    if (sp < 0 || dp < 0 || n < 0 || sp + n > src.length || dp + n > dst.length) throw mk("ArrayIndexOutOfBoundsException", "arraycopy: last source index " + (sp + n) + " out of bounds for length " + src.length);
    if (src === dst && sp < dp) for (let i = n - 1; i >= 0; i--) dst[dp + i] = src[sp + i]; else for (let i = 0; i < n; i++) dst[dp + i] = src[sp + i];
  },
};

/* ===== runtime: functional helpers, collections ===== */
const FN_NAMES = ["apply", "accept", "test", "get", "run", "compare", "call", "applyAsInt", "applyAsLong", "applyAsDouble", "getAsInt", "getAsDouble", "getAsLong", "getAsBoolean"];
function fn(f) {
  if (typeof f === "function") return f; if (f === null || f === undefined) npe();
  for (const n of FN_NAMES) if (typeof f[n] === "function") return (...a) => f[n](...a);
  throw mk("ClassCastException", "not a functional object");
}
const cmpFn = (c) => c === null || c === undefined ? cmp : fn(c);
function callf(o, name, args) {
  if (o === null || o === undefined) npe();
  if (typeof o === "function") {
    switch (name) {
      case "reversed": return (a, b) => o(b, a);
      case "thenComparing": { const k = args[0]; if (args.length === 2) { const c2 = fn(args[1]), kf = fn(k); return (a, b) => o(a, b) || c2(kf(a), kf(b)); } const g = fn(k); if (g.length === 2) return (a, b) => o(a, b) || g(a, b); return (a, b) => o(a, b) || cmp(g(a), g(b)); }
      case "thenComparingInt": case "thenComparingDouble": case "thenComparingLong": { const g = fn(args[0]); return (a, b) => o(a, b) || cmp(g(a), g(b)); }
      case "andThen": { const g = fn(args[0]); return (...a) => { const r = o(...a); return r === undefined ? g(...a) : g(r); }; }
      case "compose": { const g = fn(args[0]); return (x) => o(g(x)); }
      case "negate": return (...a) => !o(...a);
      case "and": { const g = fn(args[0]); return (...a) => o(...a) && g(...a); } case "or": { const g = fn(args[0]); return (...a) => o(...a) || g(...a); }
      case "equals": return o === args[0]; case "hashCode": return hashOfObj(o); case "toString": return str(o);
      case "getClass": return new JClass({ $name: "Main$$Lambda" });
      default: return o(...args);
    }
  }
  return o[name](...args);
}
const Comparator = {
  naturalOrder: () => cmp, reverseOrder: () => (a, b) => cmp(b, a),
  comparing: (f, c) => { const g = fn(f); if (c !== undefined) { const c2 = fn(c); return (a, b) => c2(g(a), g(b)); } return (a, b) => cmp(g(a), g(b)); },
  comparingInt: (f) => { const g = fn(f); return (a, b) => cmp(g(a), g(b)); }, comparingDouble: (f) => { const g = fn(f); return (a, b) => cmp(g(a), g(b)); }, comparingLong: (f) => { const g = fn(f); return (a, b) => cmp(g(a), g(b)); },
  nullsFirst: (c) => (a, b) => a === null ? (b === null ? 0 : -1) : b === null ? 1 : fn(c)(a, b), nullsLast: (c) => (a, b) => a === null ? (b === null ? 0 : 1) : b === null ? -1 : fn(c)(a, b),
};
const Function_ = { identity: () => (x) => x }; const UnaryOperator = Function_;
const cme = () => mk("ConcurrentModificationException", null);
class JIter extends JObject {
  constructor(arr, rm) { super(); this.a = arr; this.i = 0; this.rm = rm; this.last = null; this.has = false; }
  hasNext() { return this.i < this.a.length; } next() { if (this.i >= this.a.length) throw mk("NoSuchElementException", null); this.last = this.a[this.i++]; this.has = true; return this.last; }
  remove() { if (!this.has) throw mk("IllegalStateException", null); this.has = false; this.rm(this.last); }
  forEachRemaining(f) { f = fn(f); while (this.hasNext()) f(this.next()); }
  [Symbol.iterator]() { const s = this; return { next: () => s.hasNext() ? { value: s.next(), done: false } : { done: true, value: undefined } }; }
}
class JColl extends JObject {
  constructor() { super(); this.mc = 0; }
  isEmpty() { return this.size() === 0; }
  toArray(a) { const r = this._arr(); if (a !== undefined && a !== null && Array.isArray(a)) return r; return r; }
  toString() { return "[" + this._arr().map((x) => x === this ? "(this Collection)" : str(x)).join(", ") + "]"; }
  forEach(f) { f = fn(f); const mc = this.mc; for (const x of this._arr()) { f(x); if (this.mc !== mc) throw cme(); } }
  stream() { return new JStream(this._arr(), "obj"); } parallelStream() { return this.stream(); }
  contains(x) { for (const y of this._arr()) if (eq(x, y)) return true; return false; }
  containsAll(c) { for (const x of iter(c)) if (!this.contains(x)) return false; return true; }
  addAll(c) { let ch = false; for (const x of Array.from(iter(c))) if (this.add(x)) ch = true; return ch; }
  removeAll(c) { const o = c instanceof JColl ? c : new ArrayList().$c(c); return this.removeIf((x) => o.contains(x)); }
  retainAll(c) { const o = c instanceof JColl ? c : new ArrayList().$c(c); return this.removeIf((x) => !o.contains(x)); }
  iterator() { return new JIter(this._arr(), (x) => this.remove(x)); }
  [Symbol.iterator]() { const arr = this._arr(), self = this, mc = this.mc; let i = 0; return { next() { if (i >= arr.length) return { done: true, value: undefined }; if (self.mc !== mc) throw cme(); return { value: arr[i++], done: false }; } }; }
  equals(o) { return this === o; } hashCode() { return super.hashCode(); }
  removeIf(f) { f = fn(f); let ch = false; for (const x of this._arr()) if (f(x)) { this.remove(x); ch = true; } return ch; }
}
function iter(c) {
  if (c === null || c === undefined) npe();
  if (c instanceof JColl || Array.isArray(c) || ArrayBuffer.isView(c)) return c;
  if (c instanceof JStream) return c.a;
  if (typeof c.iterator === "function") { const it = c.iterator(); return { [Symbol.iterator]() { return { next() { return it.hasNext() ? { value: it.next(), done: false } : { done: true, value: undefined }; } }; } }; }
  if (typeof c[Symbol.iterator] === "function") return c;
  throw mk("ClassCastException", "not iterable");
}
const ioob = (i, n) => mk("IndexOutOfBoundsException", "Index " + i + " out of bounds for length " + n);
class ArrayList extends JColl {
  constructor(x) { super(); this.a = []; this.fixed = false; this.imm = false; if (x !== undefined && typeof x !== "number") this.a = Array.from(iter(x)); else if (typeof x === "number" && x < 0) throw mk("IllegalArgumentException", "Illegal Capacity: " + x); }
  $c(x) { if (x !== undefined && typeof x !== "number") this.a = Array.from(iter(x)); return this; }
  _arr() { return this.a; } size() { return this.a.length; }
  _mut() { if (this.imm || this.fixed) throw mk("UnsupportedOperationException", null); this.mc++; }
  add(i, x) { this._mut(); if (arguments.length === 1) { this.a.push(i); return true; } if (i < 0 || i > this.a.length) throw ioob(i, this.a.length); this.a.splice(i, 0, x); }
  addAll(i, c) { this._mut(); if (arguments.length === 1) { const arr = Array.from(iter(i)); for (const x of arr) this.a.push(x); return arr.length > 0; } const arr = Array.from(iter(c)); this.a.splice(i, 0, ...arr); return arr.length > 0; }
  get(i) { if (i >>> 0 >= this.a.length) throw ioob(i, this.a.length); return this.a[i]; }
  set(i, x) { if (this.imm) throw mk("UnsupportedOperationException", null); if (i >>> 0 >= this.a.length) throw ioob(i, this.a.length); const o = this.a[i]; this.a[i] = x; return o; }
  removeAt(i) { this._mut(); if (i >>> 0 >= this.a.length) throw ioob(i, this.a.length); return this.a.splice(i, 1)[0]; }
  remove(x) { if (arguments.length === 0) return this.removeFirst(); this._mut(); const i = this.indexOf(x); if (i < 0) { this.mc--; return false; } this.a.splice(i, 1); return true; }
  removeIf(f) { f = fn(f); this._mut(); const n = this.a.length; this.a = this.a.filter((x) => !f(x)); if (this.a.length === n) this.mc--; return this.a.length !== n; }
  indexOf(x) { for (let i = 0; i < this.a.length; i++) if (eq(x, this.a[i])) return i; return -1; }
  lastIndexOf(x) { for (let i = this.a.length - 1; i >= 0; i--) if (eq(x, this.a[i])) return i; return -1; }
  contains(x) { return this.indexOf(x) >= 0; } clear() { this._mut(); this.a = []; }
  sort(c) { if (this.imm) throw mk("UnsupportedOperationException", null); const f = cmpFn(c); this.mc++; msort(this.a, f); }
  replaceAll(f) { f = fn(f); for (let i = 0; i < this.a.length; i++) this.a[i] = f(this.a[i]); }
  subList(a, b) { if (a < 0 || b > this.a.length || a > b) throw mk("IndexOutOfBoundsException", "fromIndex: " + a + ", toIndex: " + b + ", size: " + this.a.length); const r = new ArrayList(); r.a = this.a.slice(a, b); return r; }
  toArray(a) { return this.a.slice(); } ensureCapacity() {} trimToSize() {}
  equals(o) { if (o === this) return true; if (!(o instanceof ArrayList) || o.a.length !== this.a.length) return false; for (let i = 0; i < this.a.length; i++) if (!eq(this.a[i], o.a[i])) return false; return true; }
  hashCode() { let h = 1; for (const x of this.a) h = (Math.imul(h, 31) + hash(x)) | 0; return h; }
  iterator() { const l = this; let cur = 0, last = -1, mc = l.mc; const it = new JObject(); it.hasNext = () => cur !== l.a.length; it.next = () => { if (l.mc !== mc) throw cme(); if (cur >= l.a.length) throw mk("NoSuchElementException", null); last = cur; return l.a[cur++]; }; it.remove = () => { if (last < 0) throw mk("IllegalStateException", null); if (l.mc !== mc) throw cme(); l.a.splice(last, 1); cur = last; last = -1; l.mc++; mc = l.mc; }; it.forEachRemaining = (f) => { f = fn(f); while (it.hasNext()) f(it.next()); }; it.hasPrevious = () => cur > 0; it.previous = () => { cur--; last = cur; return l.a[cur]; }; it.set = (x) => { l.a[last] = x; }; it.add = (x) => { l.a.splice(cur++, 0, x); l.mc++; mc = l.mc; last = -1; }; it[Symbol.iterator] = JIter.prototype[Symbol.iterator]; return it; }
  listIterator() { return this.iterator(); }
  [Symbol.iterator]() { const self = this, mc = this.mc; let i = 0; return { next() { if (i === self.a.length) return { done: true, value: undefined }; if (self.mc !== mc) throw cme(); return { value: self.a[i++], done: false }; } }; }
  forEach(f) { f = fn(f); const mc = this.mc; for (let i = 0; i < this.a.length; i++) { f(this.a[i]); if (this.mc !== mc) throw cme(); } }
  // deque-ish / list extras
  getFirst() { if (!this.a.length) throw mk("NoSuchElementException", null); return this.a[0]; } getLast() { if (!this.a.length) throw mk("NoSuchElementException", null); return this.a[this.a.length - 1]; }
  addFirst(x) { this._mut(); this.a.unshift(x); } addLast(x) { this._mut(); this.a.push(x); }
  removeFirst() { if (!this.a.length) throw mk("NoSuchElementException", null); this.mc++; return this.a.shift(); } removeLast() { if (!this.a.length) throw mk("NoSuchElementException", null); this.mc++; return this.a.pop(); }
  offerFirst(x) { this.addFirst(x); return true; } offerLast(x) { this.addLast(x); return true; } offer(x) { this.addLast(x); return true; }
  peekFirst() { return this.a.length ? this.a[0] : null; } peekLast() { return this.a.length ? this.a[this.a.length - 1] : null; } peek() { return this.peekFirst(); } element() { return this.getFirst(); }
  pollFirst() { if (!this.a.length) return null; this.mc++; return this.a.shift(); } pollLast() { if (!this.a.length) return null; this.mc++; return this.a.pop(); } poll() { return this.pollFirst(); }
  push(x) { this.addFirst(x); } pop() { return this.removeFirst(); }
  removeFirstOccurrence(x) { return this.remove(x); } descendingIterator() { return new JIter(this.a.slice().reverse(), (x) => this.remove(x)); }
  reversed() { const r = new ArrayList(); r.a = this.a.slice().reverse(); return r; }
  // Vector / Stack-ish helpers
  elementAt(i) { return this.get(i); } addElement(x) { this.add(x); } firstElement() { return this.getFirst(); } lastElement() { return this.getLast(); } removeAllElements() { this.clear(); } insertElementAt(x, i) { this.add(i, x); }
  clone() { const r = new this.constructor(); r.a = this.a.slice(); return r; }
}
ArrayList.$name = "ArrayList"; ArrayList.$full = "java.util.ArrayList";
function msort(a, f) { // stable merge sort (Java's List.sort is stable); uses native stable sort
  a.sort((x, y) => f(x, y));
}
const sub = (name, base, ext) => { const C = ({ [name]: class extends base {} })[name]; C.$name = name; C.$full = "java.util." + name; Object.assign(C.prototype, ext || {}); return C; };
const LinkedList = sub("LinkedList", ArrayList);
const Vector = sub("Vector", ArrayList);
const ArrayDeque = sub("ArrayDeque", ArrayList, { add(x) { if (x === null) npe(); this._mut(); this.a.push(x); return true; }, addFirst(x) { if (x === null) npe(); this._mut(); this.a.unshift(x); }, addLast(x) { if (x === null) npe(); this._mut(); this.a.push(x); }, get() { throw mk("UnsupportedOperationException", null); } });
const CopyOnWriteArrayList = sub("CopyOnWriteArrayList", ArrayList, { [Symbol.iterator]() { return this.a.slice()[Symbol.iterator](); } });
const Stack = sub("Stack", ArrayList, {
  push(x) { this.a.push(x); this.mc++; return x; }, pop() { if (!this.a.length) throw mk("EmptyStackException", null); this.mc++; return this.a.pop(); },
  peek() { if (!this.a.length) throw mk("EmptyStackException", null); return this.a[this.a.length - 1]; }, empty() { return this.a.length === 0; },
  search(x) { const i = this.lastIndexOf(x); return i < 0 ? -1 : this.a.length - i; },
});
class ImmList extends ArrayList { constructor(a) { super(); this.a = a; this.imm = true; } }
ImmList.$name = "ImmutableCollections.ListN"; ImmList.$full = "java.util.ImmutableCollections$ListN";
// ---- hash maps ----
const NULLK = "\u0000N";
function nk(k) {
  switch (typeof k) { case "string": case "number": case "bigint": case "boolean": return k; }
  if (k === null) return NULLK;
  if (k instanceof JDouble) return "\u0000D" + k.v; if (k instanceof JChar) return "\u0000C" + k.v; if (k instanceof JFloat) return "\u0000F" + k.v;
  if (isArr(k)) return k;
  if (k.hashCode !== JObject.prototype.hashCode) return "\u0000O" + k.hashCode();
  return k;
}
class Entry extends JObject {
  constructor(k, v) { super(); this.k = k; this.v = v; this.h = 0; this.seq = 0; this.nx = null; }
  getKey() { return this.k; } getValue() { return this.v; } setValue(v) { const o = this.v; this.v = v; return o; }
  toString() { return str(this.k) + "=" + str(this.v); } equals(o) { return o instanceof Entry && eq(this.k, o.k) && eq(this.v, o.v); } hashCode() { return hash(this.k) ^ hash(this.v); }
}
Entry.$name = "Entry";
const spread = (h) => h ^ (h >>> 16);
const tsf = (n) => { let c = 1; while (c < n) c <<= 1; return Math.max(c, 1); };
class HashMap extends JObject {
  constructor(a, b, c) { super(); this.m = new Map(); this.all = new Map(); this.cap = 16; this.seqn = 0; this.mc = 0; this.access = false; this.kind = this.kind || "hash"; this.imm = false; this._oc = -1;
    if (typeof a === "number") { if (a < 0) throw mk("IllegalArgumentException", "Illegal initial capacity: " + a); this.cap = tsf(a); if (c === true) this.access = true; }
    else if (a instanceof HashMap || (a && a.entrySet)) { this._initFrom(a); } }
  $c(a, b, c) { if (typeof a === "number") { this.cap = tsf(a); if (c === true) this.access = true; } else if (a && a.entrySet) this._initFrom(a); return this; }
  _initFrom(o) { const n = o.size(); if (this.kind === "hash") this.cap = Math.max(16, tsf(Math.floor(n / 0.75 + 1))); for (const e of o.entrySet()._arr()) this.put(e.k, e.v); }
  size() { return this.all.size; } isEmpty() { return this.all.size === 0; }
  _find(k) { const e = this.m.get(nk(k)); if (e === undefined) return undefined; if (e.nx === null && !(typeof k === "object" && k !== null && k.hashCode !== JObject.prototype.hashCode && !(k instanceof JDouble || k instanceof JChar || k instanceof JFloat))) return e; for (let x = e; x; x = x.nx) if (eq(k, x.k)) return x; return undefined; }
  _chk() { if (this.imm) throw mk("UnsupportedOperationException", null); }
  _touch(e) { if (this.access) { this.all.delete(e.seq); e.seq = ++this.seqn; this.all.set(e.seq, e); this.mc++; } }
  get(k) { const e = this._find(k); if (e === undefined) return null; this._touch(e); return e.v; }
  getOrDefault(k, d) { const e = this._find(k); if (e === undefined) return d; this._touch(e); return e.v; }
  containsKey(k) { return this._find(k) !== undefined; }
  containsValue(v) { for (const e of this.all.values()) if (eq(v, e.v)) return true; return false; }
  put(k, v) {
    this._chk(); const e = this._find(k);
    if (e !== undefined) { const o = e.v; e.v = v; this._touch(e); return o; }
    const ne = new Entry(k, v); ne.h = spread(hash(k)); ne.seq = ++this.seqn; const key = nk(k); const h = this.m.get(key);
    if (h === undefined) this.m.set(key, ne); else { let x = h; while (x.nx) x = x.nx; x.nx = ne; }
    this.all.set(ne.seq, ne); this.mc++; if (this.all.size > this.cap * 0.75) this.cap *= 2;
    if (this.removeEldestEntry && this.all.size > 0) { const first = this.all.values().next().value; if (this.removeEldestEntry(first)) this.remove(first.k); }
    return null;
  }
  remove(k, v) {
    this._chk(); const key = nk(k); const h = this.m.get(key); if (h === undefined) return arguments.length === 2 ? false : null;
    let prev = null, x = h; while (x && !eq(k, x.k)) { prev = x; x = x.nx; } if (!x) return arguments.length === 2 ? false : null;
    if (arguments.length === 2 && !eq(v, x.v)) return false;
    if (prev) prev.nx = x.nx; else if (x.nx) this.m.set(key, x.nx); else this.m.delete(key);
    this.all.delete(x.seq); this.mc++; return arguments.length === 2 ? true : x.v;
  }
  clear() { this._chk(); this.m.clear(); this.all.clear(); this.mc++; }
  _entries() {
    if (this.kind === "linked") return Array.from(this.all.values());
    if (this._oc === this.mc && this._ocap === this.cap) return this._cache;
    const arr = Array.from(this.all.values()); const mask = this.cap - 1; for (const e of arr) e.bi = e.h & mask; arr.sort((a, b) => a.bi - b.bi);
    this._cache = arr; this._oc = this.mc; this._ocap = this.cap; return arr;
  }
  keySet() { const s = new LinkedHashSet(); const es = this._entries(); for (const e of es) s.m.put(e.k, true); s.src = this; return s; }
  values() { const l = new ArrayList(); l.a = this._entries().map((e) => e.v); return l; }
  entrySet() { const s = new JEntrySet(this._entries(), this); return s; }
  putIfAbsent(k, v) { const e = this._find(k); if (e !== undefined && e.v !== null) return e.v; this.put(k, v); return null; }
  computeIfAbsent(k, f) { const e = this._find(k); if (e !== undefined && e.v !== null) return e.v; const v = fn(f)(k); if (v !== null) this.put(k, v); return v; }
  computeIfPresent(k, f) { const e = this._find(k); if (e === undefined || e.v === null) return null; const v = fn(f)(k, e.v); if (v === null) this.remove(k); else e.v = v; return v; }
  compute(k, f) { const e = this._find(k); const v = fn(f)(k, e === undefined ? null : e.v); if (v === null) { if (e !== undefined) this.remove(k); } else if (e !== undefined) e.v = v; else this.put(k, v); return v; }
  merge(k, v, f) { const e = this._find(k); if (e === undefined || e.v === null) { this.put(k, v); return v; } const nv = fn(f)(e.v, v); if (nv === null) this.remove(k); else e.v = nv; return nv; }
  putAll(o) { for (const e of o._entries()) this.put(e.k, e.v); }
  forEach(f) { f = fn(f); const mc = this.mc; for (const e of this._entries()) { f(e.k, e.v); if (this.mc !== mc) throw cme(); } }
  replaceAll(f) { f = fn(f); for (const e of this._entries()) e.v = f(e.k, e.v); }
  replace(k, v) { const e = this._find(k); if (e === undefined) return null; const o = e.v; e.v = v; return o; }
  toString() { return "{" + this._entries().map((e) => (e.k === this ? "(this Map)" : str(e.k)) + "=" + (e.v === this ? "(this Map)" : str(e.v))).join(", ") + "}"; }
  equals(o) { if (o === this) return true; if (!(o instanceof HashMap) || o.size() !== this.size()) return false; for (const e of this.all.values()) { const x = o._find(e.k); if (x === undefined || !eq(e.v, x.v)) return false; } return true; }
  hashCode() { let h = 0; for (const e of this.all.values()) h = (h + (hash(e.k) ^ hash(e.v))) | 0; return h; }
  clone() { const r = new this.constructor(); r.putAll(this); return r; }
  // sequenced / navigable defaults overridden by TreeMap
}
HashMap.$name = "HashMap"; HashMap.$full = "java.util.HashMap";
class JEntrySet extends JColl { constructor(arr, map) { super(); this.arr = arr; this.map = map; } _arr() { return this.arr; } size() { return this.arr.length; } remove(e) { this.map.remove(e.k); this.arr = this.arr.filter((x) => x !== e); return true; } add() { throw mk("UnsupportedOperationException", null); } contains(e) { return e instanceof Entry && this.arr.some((x) => eq(x.k, e.k) && eq(x.v, e.v)); } }
const LinkedHashMap = sub("LinkedHashMap", HashMap, {}); LinkedHashMap.prototype.kind = "linked";
const Hashtable = sub("Hashtable", HashMap); const ConcurrentHashMap = sub("ConcurrentHashMap", HashMap);
class TreeMap extends HashMap {
  constructor(a) { super(); this.kind = "tree"; this.arr = []; this.cf = cmp; if (typeof a === "function" || (a && typeof a === "object" && !a.entrySet && !(a instanceof HashMap))) this.cf = fn(a); else if (a && a.entrySet) { if (a instanceof TreeMap) this.cf = a.cf; for (const e of a._entries()) this.put(e.k, e.v); } }
  $c(a) { if (a !== undefined) { if (typeof a === "function" || (a && !a.entrySet)) this.cf = fn(a); else if (a.entrySet) for (const e of a._entries()) this.put(e.k, e.v); } return this; }
  _bs(k) { if (k === null && this.cf === cmp) npe(); let lo = 0, hi = this.arr.length - 1; while (lo <= hi) { const mid = (lo + hi) >>> 1; const c = this.cf(this.arr[mid].k, k); if (c < 0) lo = mid + 1; else if (c > 0) hi = mid - 1; else return mid; } return -(lo + 1); }
  size() { return this.arr.length; } isEmpty() { return this.arr.length === 0; }
  _find(k) { if (this.arr.length === 0) { if (k === null) npe(); this.cf(k, k); return undefined; } const i = this._bs(k); return i >= 0 ? this.arr[i] : undefined; }
  get(k) { const e = this._find(k); return e === undefined ? null : e.v; } getOrDefault(k, d) { const e = this._find(k); return e === undefined ? d : e.v; }
  put(k, v) { const i = this.arr.length === 0 ? (this.cf(k, k), -1) : this._bs(k); if (i >= 0) { const o = this.arr[i].v; this.arr[i].v = v; return o; } const e = new Entry(k, v); this.arr.splice(-(i + 1), 0, e); this.mc++; return null; }
  remove(k) { const i = this._bs(k); if (i < 0) return null; const e = this.arr.splice(i, 1)[0]; this.mc++; return e.v; }
  clear() { this.arr = []; this.mc++; } _entries() { return this.arr.slice(); }
  get all() { return { size: this.arr.length, values: () => this.arr.values() }; } set all(v) {}
  containsValue(v) { return this.arr.some((e) => eq(v, e.v)); }
  _k(e) { return e === undefined || e === null ? null : e.k; }
  firstKey() { if (!this.arr.length) throw mk("NoSuchElementException", null); return this.arr[0].k; } lastKey() { if (!this.arr.length) throw mk("NoSuchElementException", null); return this.arr[this.arr.length - 1].k; }
  firstEntry() { return this.arr[0] || null; } lastEntry() { return this.arr[this.arr.length - 1] || null; }
  pollFirstEntry() { if (!this.arr.length) return null; this.mc++; return this.arr.shift(); } pollLastEntry() { if (!this.arr.length) return null; this.mc++; return this.arr.pop(); }
  _idx(k, mode) { const i = this._bs(k); if (i >= 0) { if (mode === "floor" || mode === "ceiling") return i; return mode === "higher" ? i + 1 : i - 1; } const ins = -(i + 1); return mode === "floor" || mode === "lower" ? ins - 1 : ins; }
  floorEntry(k) { return this.arr[this._idx(k, "floor")] || null; } ceilingEntry(k) { return this.arr[this._idx(k, "ceiling")] || null; } higherEntry(k) { return this.arr[this._idx(k, "higher")] || null; } lowerEntry(k) { return this.arr[this._idx(k, "lower")] || null; }
  floorKey(k) { return this._k(this.floorEntry(k)); } ceilingKey(k) { return this._k(this.ceilingEntry(k)); } higherKey(k) { return this._k(this.higherEntry(k)); } lowerKey(k) { return this._k(this.lowerEntry(k)); }
  headMap(k, inc) { const r = new TreeMap(); r.cf = this.cf; for (const e of this.arr) { const c = this.cf(e.k, k); if (c < 0 || (inc === true && c === 0)) r.arr.push(new Entry(e.k, e.v)); } return r; }
  tailMap(k, inc) { const r = new TreeMap(); r.cf = this.cf; for (const e of this.arr) { const c = this.cf(e.k, k); if (c > 0 || ((inc === undefined || inc === true) && c === 0)) r.arr.push(new Entry(e.k, e.v)); } return r; }
  subMap(a, b, c, d) { const lo = arguments.length === 4 ? a : a, hi = arguments.length === 4 ? c : b, li = arguments.length === 4 ? b : true, hiInc = arguments.length === 4 ? d : false; const r = new TreeMap(); r.cf = this.cf; for (const e of this.arr) { const c1 = this.cf(e.k, lo), c2 = this.cf(e.k, hi); if ((c1 > 0 || (li && c1 === 0)) && (c2 < 0 || (hiInc && c2 === 0))) r.arr.push(new Entry(e.k, e.v)); } return r; }
  descendingMap() { const r = new LinkedHashMap(); for (let i = this.arr.length - 1; i >= 0; i--) r.put(this.arr[i].k, this.arr[i].v); return r; }
  descendingKeySet() { const r = new LinkedHashSet(); for (let i = this.arr.length - 1; i >= 0; i--) r.add(this.arr[i].k); return r; }
  navigableKeySet() { return this.keySet(); }
  keySet() { const s = new TreeSet(); s.m.cf = this.cf; for (const e of this.arr) s.m.arr.push(new Entry(e.k, true)); s.src = this; return s; }
  comparator() { return this.cf === cmp ? null : this.cf; }
}
TreeMap.$name = "TreeMap"; TreeMap.$full = "java.util.TreeMap";
class HashSet extends JColl {
  constructor(a) { super(); this.m = this._mkmap(); this.src = null; if (typeof a === "number") { this.m.cap = tsf(a); } else if (a !== undefined && a !== null) this._init(a); }
  $c(a) { if (a !== undefined) { if (typeof a === "number") this.m.cap = tsf(a); else this._init(a); } return this; }
  _mkmap() { return new HashMap(); }
  _init(c) { const arr = Array.from(iter(c)); if (this.m.kind === "hash") this.m.cap = Math.max(16, tsf(Math.floor(arr.length / 0.75 + 1))); for (const x of arr) this.m.put(x, true); }
  _arr() { return this.m._entries().map((e) => e.k); } size() { return this.m.size(); } get mc() { return this.m.mc; } set mc(v) {}
  add(x) { if (this.m.imm) throw mk("UnsupportedOperationException", null); if (this.m._find(x) !== undefined) return false; this.m.put(x, true); return true; }
  remove(x) { if (this.m.imm) throw mk("UnsupportedOperationException", null); if (this.m._find(x) === undefined) return false; this.m.remove(x); if (this.src) this.src.remove(x); return true; }
  contains(x) { return this.m._find(x) !== undefined; } clear() { if (this.m.imm) throw mk("UnsupportedOperationException", null); this.m.clear(); if (this.src) this.src.clear(); }
  equals(o) { if (o === this) return true; if (!(o instanceof HashSet) || o.size() !== this.size()) return false; for (const x of this._arr()) if (!o.contains(x)) return false; return true; }
  hashCode() { let h = 0; for (const x of this._arr()) h = (h + hash(x)) | 0; return h; }
  removeIf(f) { f = fn(f); let ch = false; for (const x of this._arr()) if (f(x)) { this.remove(x); ch = true; } return ch; }
  clone() { const r = new this.constructor(); for (const x of this._arr()) r.add(x); return r; }
}
HashSet.$name = "HashSet"; HashSet.$full = "java.util.HashSet";
class LinkedHashSet extends HashSet { _mkmap() { const m = new LinkedHashMap(); return m; } }
LinkedHashSet.$name = "LinkedHashSet"; LinkedHashSet.$full = "java.util.LinkedHashSet";
class TreeSet extends HashSet {
  constructor(a) { super(); if (typeof a === "function" || (a && typeof a === "object" && !(a instanceof JColl) && !Array.isArray(a))) this.m.cf = fn(a); else if (a !== undefined && a !== null) { if (a instanceof TreeSet) this.m.cf = a.m.cf; for (const x of iter(a)) this.m.put(x, true); } }
  $c(a) { if (a !== undefined) { if (typeof a === "function" || (a && !(a instanceof JColl))) this.m.cf = fn(a); else for (const x of iter(a)) this.m.put(x, true); } return this; }
  _mkmap() { return new TreeMap(); }
  first() { return this.m.firstKey(); } last() { return this.m.lastKey(); } getFirst() { return this.first(); } getLast() { return this.last(); }
  floor(k) { return this.m.floorKey(k); } ceiling(k) { return this.m.ceilingKey(k); } higher(k) { return this.m.higherKey(k); } lower(k) { return this.m.lowerKey(k); }
  pollFirst() { const e = this.m.pollFirstEntry(); return e ? e.k : null; } pollLast() { const e = this.m.pollLastEntry(); return e ? e.k : null; }
  _wrap(m) { const s = new TreeSet(); s.m = m; return s; }
  headSet(k, inc) { return this._wrap(this.m.headMap(k, inc)); } tailSet(k, inc) { return this._wrap(this.m.tailMap(k, inc)); } subSet(a, b, c, d) { return this._wrap(arguments.length === 4 ? this.m.subMap(a, b, c, d) : this.m.subMap(a, b)); }
  descendingSet() { const r = new LinkedHashSet(); for (let i = this.m.arr.length - 1; i >= 0; i--) r.add(this.m.arr[i].k); return r; } descendingIterator() { return new JIter(this._arr().reverse(), (x) => this.remove(x)); }
  comparator() { return this.m.comparator(); }
}
TreeSet.$name = "TreeSet"; TreeSet.$full = "java.util.TreeSet";
class PriorityQueue extends JColl {
  constructor(a, b) { super(); this.q = []; this.cf = cmp; this._a(a, b); }
  $c(a, b) { this._a(a, b); return this; }
  _a(a, b) { if (typeof a === "function" || (a && typeof a === "object" && !(a instanceof JColl) && !Array.isArray(a) && !(a instanceof JStream))) this.cf = fn(a); else if (typeof b === "function" || (b && typeof b === "object")) this.cf = fn(b); else if (a !== undefined && a !== null && typeof a !== "number") { if (a instanceof PriorityQueue) { this.cf = a.cf; this.q = a.q.slice(); } else { this.q = Array.from(iter(a)); for (let i = (this.q.length >>> 1) - 1; i >= 0; i--) this._down(i, this.q[i]); } } }
  _arr() { return this.q; } size() { return this.q.length; }
  _up(k, x) { const q = this.q; while (k > 0) { const p = (k - 1) >>> 1, e = q[p]; if (this.cf(x, e) >= 0) break; q[k] = e; k = p; } q[k] = x; }
  _down(k, x) { const q = this.q, n = q.length, half = n >>> 1; while (k < half) { let c = 2 * k + 1, o = q[c]; const r = c + 1; if (r < n && this.cf(o, q[r]) > 0) o = q[c = r]; if (this.cf(x, o) <= 0) break; q[k] = o; k = c; } q[k] = x; }
  add(x) { return this.offer(x); } offer(x) { if (x === null) npe(); this.mc++; this.q.push(x); this._up(this.q.length - 1, x); return true; }
  peek() { return this.q.length ? this.q[0] : null; } element() { if (!this.q.length) throw mk("NoSuchElementException", null); return this.q[0]; }
  poll() { if (!this.q.length) return null; this.mc++; const r = this.q[0], x = this.q.pop(); if (this.q.length) this._down(0, x); return r; }
  remove(x) { if (arguments.length === 0) { if (!this.q.length) throw mk("NoSuchElementException", null); return this.poll(); } const i = this.q.findIndex((y) => eq(x, y)); if (i < 0) return false; this.mc++; const s = this.q.length - 1; if (s === i) this.q.pop(); else { const moved = this.q.pop(); this._down(i, moved); if (this.q[i] === moved) this._up(i, moved); } return true; }
  clear() { this.q = []; this.mc++; } comparator() { return this.cf === cmp ? null : this.cf; }
  iterator() { return new JIter(this.q.slice(), (x) => this.remove(x)); }
}
PriorityQueue.$name = "PriorityQueue"; PriorityQueue.$full = "java.util.PriorityQueue";
// immutable factories
const immList = (a) => { for (const x of a) if (x === null) npe(); return new ImmList(a); };
const List = { of: (...a) => immList(a.length === 1 && Array.isArray(a[0]) ? a[0].slice() : a), copyOf: (c) => immList(Array.from(iter(c))) };
const Set_ = { of: (...a) => { const s = new LinkedHashSet(); for (const x of a.length === 1 && Array.isArray(a[0]) ? a[0] : a) { if (!s.add(x)) throw mk("IllegalArgumentException", "duplicate element: " + str(x)); } s.m.imm = true; return s; }, copyOf: (c) => { const s = new LinkedHashSet(); for (const x of iter(c)) s.add(x); s.m.imm = true; return s; } };
const Map_ = { of: (...a) => { const m = new LinkedHashMap(); for (let i = 0; i < a.length; i += 2) { if (m._find(a[i]) !== undefined) throw mk("IllegalArgumentException", "duplicate key: " + str(a[i])); m.put(a[i], a[i + 1]); } m.imm = true; return m; }, entry: (k, v) => new Entry(k, v), ofEntries: (...es) => { const m = new LinkedHashMap(); for (const e of es.length === 1 && Array.isArray(es[0]) ? es[0] : es) m.put(e.k, e.v); m.imm = true; return m; }, copyOf: (o) => { const m = new LinkedHashMap(); m.putAll(o); m.imm = true; return m; } };
const AbstractMap = { SimpleEntry: Entry }; Entry.prototype.$c = function (k, v) { this.k = k; this.v = v; return this; };

/* ===== runtime: StringBuilder, IO, Random, Arrays, Collections, streams, misc ===== */
class StringBuilder extends JObject {
  constructor(x) { super(); this.s = typeof x === "string" ? x : ""; if (x === null) npe(); }
  $c(x) { this.s = typeof x === "string" ? x : ""; return this; }
  append(x) { this.s += x; return this; } appendS(x) { this.s += x; return this; }
  length() { return this.s.length; } toString() { return this.s; } isEmpty() { return this.s.length === 0; } capacity() { return Math.max(16, this.s.length); }
  charAt(i) { if (i >>> 0 >= this.s.length) throw mk("StringIndexOutOfBoundsException", "index " + i + ",length " + this.s.length); return this.s.charCodeAt(i); }
  reverse() { this.s = Array.from(this.s).reverse().join(""); return this; }
  insert(i, x) { if (i < 0 || i > this.s.length) throw mk("StringIndexOutOfBoundsException", "offset " + i + ", length " + this.s.length); this.s = this.s.slice(0, i) + x + this.s.slice(i); return this; }
  deleteCharAt(i) { if (i >>> 0 >= this.s.length) throw mk("StringIndexOutOfBoundsException", "index " + i + ",length " + this.s.length); this.s = this.s.slice(0, i) + this.s.slice(i + 1); return this; }
  delete(a, b) { if (b > this.s.length) b = this.s.length; if (a < 0 || a > b) throw mk("StringIndexOutOfBoundsException", "start " + a + ", end " + b + ", length " + this.s.length); this.s = this.s.slice(0, a) + this.s.slice(b); return this; }
  replace(a, b, x) { if (b > this.s.length) b = this.s.length; this.s = this.s.slice(0, a) + x + this.s.slice(b); return this; }
  setCharAt(i, c) { if (i >>> 0 >= this.s.length) throw mk("StringIndexOutOfBoundsException", "index " + i + ",length " + this.s.length); this.s = this.s.slice(0, i) + String.fromCharCode(c) + this.s.slice(i + 1); }
  setLength(n) { if (n <= this.s.length) this.s = this.s.slice(0, n); else this.s += "\0".repeat(n - this.s.length); }
  indexOf(x, f) { return this.s.indexOf(x, f); } lastIndexOf(x) { return this.s.lastIndexOf(x); } substring(a, b) { return S.substring(this.s, a, b); } subSequence(a, b) { return S.substring(this.s, a, b); }
  compareTo(o) { return scmp(this.s, o.s); } equals(o) { return this === o; } chars() { return S.chars(this.s); } ensureCapacity() {} trimToSize() {}
}
StringBuilder.$name = "StringBuilder"; StringBuilder.$full = "java.lang.StringBuilder";
const StringBuffer = StringBuilder;
class JScanner extends JObject {
  constructor(src) { super(); if (src && src.$isIn) { this.text = null; } else { this.text = String(src); this.pos = 0; } this.closed = false; }
  _t() { return this.text === null ? __stdin : this.text; }
  get p() { return this.text === null ? __stdinPos : this.pos; } set p(v) { if (this.text === null) __stdinPos = v; else this.pos = v; }
  _skip() { const t = this._t(); let p = this.p; while (p < t.length && /\s/.test(t[p])) p++; return p; }
  _peekTok() { const t = this._t(); let p = this._skip(); if (p >= t.length) return null; let e = p; while (e < t.length && !/\s/.test(t[e])) e++; return { s: t.slice(p, e), end: e }; }
  hasNext() { return this._peekTok() !== null; }
  next() { if (this.closed) throw mk("IllegalStateException", "Scanner closed"); const k = this._peekTok(); if (!k) throw mk("NoSuchElementException", null); this.p = k.end; return k.s; }
  hasNextInt() { const k = this._peekTok(); return k !== null && /^[+-]?\d+$/.test(k.s) && Math.abs(Number(k.s)) <= 2147483648; }
  hasNextLong() { const k = this._peekTok(); return k !== null && /^[+-]?\d+$/.test(k.s); } hasNextDouble() { const k = this._peekTok(); return k !== null && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(k.s); }
  hasNextBoolean() { const k = this._peekTok(); return k !== null && /^(true|false)$/i.test(k.s); }
  hasNextLine() { return this.p < this._t().length; }
  _num(re, conv) { const k = this._peekTok(); if (!k) throw mk("NoSuchElementException", null); if (!re.test(k.s)) throw mk("InputMismatchException", 'For input string: "' + k.s + '"'); this.p = k.end; return conv(k.s); }
  nextInt() { return this._num(/^[+-]?\d+$/, (s) => { const v = Number(s); if (v > 2147483647 || v < -2147483648) throw mk("InputMismatchException", 'For input string: "' + s + '"'); return v; }); }
  nextLong() { return this._num(/^[+-]?\d+$/, (s) => BigInt(s)); } nextShort() { return this.nextInt(); } nextByte() { return this.nextInt(); }
  nextDouble() { return this._num(/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/, parseFloat); } nextFloat() { return Math.fround(this.nextDouble()); }
  nextBoolean() { return this._num(/^(true|false)$/i, (s) => s.toLowerCase() === "true"); }
  nextBigInteger() { return this._num(/^[+-]?\d+$/, (s) => new BigInteger(BigInt(s))); }
  nextLine() { const t = this._t(); let p = this.p; if (p >= t.length) throw mk("NoSuchElementException", "No line found"); let e = t.indexOf("\n", p); let line; if (e < 0) { line = t.slice(p); this.p = t.length; } else { line = t.slice(p, e); this.p = e + 1; } return line.replace(/\r$/, ""); }
  close() { this.closed = true; }
}
JScanner.$name = "Scanner";
class BufferedReader extends JObject {
  constructor(src) { super(); this.sc = src instanceof StringReader ? new JScanner(src.s) : new JScanner(JIn); }
  readLine() { return this.sc.hasNextLine() ? this.sc.nextLine() : null; }
  read() { if (this.sc.text === null) return JIn.read(); const t = this.sc.text; return this.sc.pos < t.length ? t.charCodeAt(this.sc.pos++) : -1; }
  ready() { return this.sc.hasNextLine(); } close() {} lines() { const a = []; let l; while ((l = this.readLine()) !== null) a.push(l); return new JStream(a, "obj"); }
}
class StringReader extends JObject { constructor(s) { super(); this.s = s; } }
class InputStreamReader extends JObject { constructor() { super(); } }
class StringTokenizer extends JObject {
  constructor(s, d, ret) { super(); if (s === null) npe(); this.toks = []; d = d === undefined ? " \t\n\r\f" : d; let cur = ""; for (const ch of s) { if (d.includes(ch)) { if (cur) { this.toks.push(cur); cur = ""; } if (ret === true) this.toks.push(ch); } else cur += ch; } if (cur) this.toks.push(cur); this.i = 0; }
  hasMoreTokens() { return this.i < this.toks.length; } hasMoreElements() { return this.hasMoreTokens(); } nextToken() { if (this.i >= this.toks.length) throw mk("NoSuchElementException", null); return this.toks[this.i++]; } nextElement() { return this.nextToken(); } countTokens() { return this.toks.length - this.i; }
}
class PrintWriter extends JObject { constructor(o) { super(); this.o = o && o.print ? o : Sys.out; } print(s) { this.o.print(s); } println(s) { this.o.println(s); } printf(f, ...a) { this.o.printf(f, ...a); return this; } format(f, ...a) { return this.printf(f, ...a); } flush() {} close() {} write(s) { this.o.print(typeof s === "number" ? String.fromCharCode(s) : s); } }
class BufferedWriter extends PrintWriter { newLine() { this.o.print("\n"); } write(s) { this.o.print(typeof s === "number" ? String.fromCharCode(s) : s); } append(s) { this.write(s); return this; } }
class OutputStreamWriter extends PrintWriter {}
class Random extends JObject {
  constructor(seed) { super(); this.setSeed(seed === undefined ? BigInt(Math.floor(Math.random() * 2 ** 48)) : BigInt(seed)); this.hg = false; }
  $c(seed) { this.setSeed(seed === undefined ? BigInt(Math.floor(Math.random() * 2 ** 48)) : BigInt(seed)); return this; }
  setSeed(s) { this.seed = (BigInt(s) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n); this.hg = false; }
  next(bits) { this.seed = (this.seed * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits))); }
  nextInt(a, b) {
    if (a === undefined) return this.next(32);
    if (b !== undefined) { if (a >= b) throw mk("IllegalArgumentException", "bound must be greater than origin"); const n = b - a; if (n > 0) return a + this.nextInt(n); let r; do r = this.next(32); while (r < a || r >= b); return r; }
    const bound = a; if (bound <= 0) throw mk("IllegalArgumentException", "bound must be positive");
    let r = this.next(31); const m = bound - 1;
    if ((bound & m) === 0) return Number((BigInt(bound) * BigInt(r)) >> 31n);
    for (let u = r; u - (r = u % bound) + m > 2147483647; u = this.next(31));
    return r;
  }
  nextLong() { return BigInt.asIntN(64, (BigInt(this.next(32)) << 32n) + BigInt(this.next(32))); }
  nextDouble() { return Number((BigInt(this.next(26)) << 27n) + BigInt(this.next(27))) * 1.1102230246251565e-16; }
  nextFloat() { return this.next(24) / 16777216; } nextBoolean() { return this.next(1) !== 0; }
  nextGaussian() { if (this.hg) { this.hg = false; return this.ng; } let v1, v2, s; do { v1 = 2 * this.nextDouble() - 1; v2 = 2 * this.nextDouble() - 1; s = v1 * v1 + v2 * v2; } while (s >= 1 || s === 0); const m = Math.sqrt(-2 * Math.log(s) / s); this.ng = v2 * m; this.hg = true; return v1 * m; }
  ints(n, a, b) { const r = []; for (let i = 0; i < n; i++) r.push(a === undefined ? this.nextInt() : this.nextInt(a, b)); return new JStream(r, "int"); }
  doubles(n) { const r = []; for (let i = 0; i < n; i++) r.push(new JDouble(this.nextDouble())); return new JStream(r, "double"); }
}
const __rnd = new Random();
Math_.random = () => __rnd.nextDouble();
const Thread = class Thread extends JObject {
  constructor(r, n) { super(); this.r = r instanceof Thread || typeof r === "string" ? null : (r === undefined ? null : r); this.nm = typeof r === "string" ? r : (n || "Thread-" + (Thread.cnt++)); }
  $c(r, n) { this.r = typeof r === "string" ? null : (r === undefined ? null : r); this.nm = typeof r === "string" ? r : (n || "Thread-" + (Thread.cnt++)); return this; }
  start() { this.run(); } run() { if (this.r) fn(this.r)(); } join() {} interrupt() {} isAlive() { return false; } setDaemon() {} getName() { return this.nm; } setName(n) { this.nm = n; } isInterrupted() { return false; } setPriority() {} getId() { return 1n; } threadId() { return 1n; }
  static sleep(ms) { ms = Number(ms); if (ms > 0) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) { const t = Date.now() + ms; while (Date.now() < t); } } } static currentThread() { return Thread.main; } static yield() {} static onSpinWait() {}
};
Thread.cnt = 0; Thread.$name = "Thread"; Thread.main = new Thread(); Thread.main.nm = "main";
class AtomicInteger extends JObject { constructor(v) { super(); this.v = v === undefined ? 0 : v; } get() { return this.v; } set(v) { this.v = v; } incrementAndGet() { return this.v = (this.v + 1) | 0; } decrementAndGet() { return this.v = (this.v - 1) | 0; } getAndIncrement() { const o = this.v; this.v = (this.v + 1) | 0; return o; } getAndDecrement() { const o = this.v; this.v = (this.v - 1) | 0; return o; } addAndGet(d) { return this.v = (this.v + d) | 0; } getAndAdd(d) { const o = this.v; this.v = (this.v + d) | 0; return o; } getAndSet(n) { const o = this.v; this.v = n; return o; } compareAndSet(e, n) { if (this.v === e) { this.v = n; return true; } return false; } updateAndGet(f) { return this.v = fn(f)(this.v); } accumulateAndGet(x, f) { return this.v = fn(f)(this.v, x); } intValue() { return this.v; } toString() { return String(this.v); } }
AtomicInteger.$name = "AtomicInteger";
class AtomicLong extends JObject { constructor(v) { super(); this.v = v === undefined ? 0n : BigInt(v); } get() { return this.v; } set(v) { this.v = v; } incrementAndGet() { return this.v = L(this.v + 1n); } decrementAndGet() { return this.v = L(this.v - 1n); } getAndIncrement() { const o = this.v; this.v = L(o + 1n); return o; } addAndGet(d) { return this.v = L(this.v + BigInt(d)); } getAndAdd(d) { const o = this.v; this.v = L(o + BigInt(d)); return o; } toString() { return String(this.v); } longValue() { return this.v; } }
AtomicLong.$name = "AtomicLong";
class AtomicBoolean extends JObject { constructor(v) { super(); this.v = !!v; } get() { return this.v; } set(v) { this.v = v; } compareAndSet(e, n) { if (this.v === e) { this.v = n; return true; } return false; } getAndSet(n) { const o = this.v; this.v = n; return o; } toString() { return String(this.v); } }
class AtomicReference extends JObject { constructor(v) { super(); this.v = v === undefined ? null : v; } get() { return this.v; } set(v) { this.v = v; } getAndSet(n) { const o = this.v; this.v = n; return o; } compareAndSet(e, n) { if (this.v === e) { this.v = n; return true; } return false; } updateAndGet(f) { return this.v = fn(f)(this.v); } toString() { return str(this.v); } }
class Optional extends JObject {
  constructor(v, t) { super(); this.v = v === undefined ? null : v; this.t = t || "obj"; }
  isPresent() { return this.v !== null; } isEmpty() { return this.v === null; }
  get() { if (this.v === null) throw mk("NoSuchElementException", "No value present"); return this.v; } getAsInt() { return this.get(); } getAsDouble() { return ud(this.get()); } getAsLong() { return this.get(); } orElseThrow(f) { if (this.v === null) { if (f === undefined) throw mk("NoSuchElementException", "No value present"); throw fn(f)(); } return this.v; }
  orElse(d) { return this.v === null ? d : this.v; } orElseGet(f) { return this.v === null ? fn(f)() : this.v; }
  ifPresent(f) { if (this.v !== null) fn(f)(this.v); } ifPresentOrElse(f, g) { if (this.v !== null) fn(f)(this.v); else fn(g)(); }
  map(f) { return this.v === null ? this : new Optional(fn(f)(this.v)); } flatMap(f) { return this.v === null ? this : fn(f)(this.v); } filter(f) { return this.v !== null && fn(f)(this.v) ? this : new Optional(null); }
  or(f) { return this.v === null ? fn(f)() : this; } stream() { return new JStream(this.v === null ? [] : [this.v], "obj"); }
  toString() { const n = this.t === "int" ? "OptionalInt" : this.t === "double" ? "OptionalDouble" : this.t === "long" ? "OptionalLong" : "Optional"; return this.v === null ? n + ".empty" : n + "[" + str(this.v) + "]"; }
  equals(o) { return o instanceof Optional && eq(this.v, o.v); } hashCode() { return hash(this.v); }
}
Optional.$name = "Optional";
Optional.of = (v) => { if (v === null) npe(); return new Optional(v); }; Optional.ofNullable = (v) => new Optional(v); Optional.empty = () => new Optional(null);
const OptionalInt = { of: (v) => new Optional(v, "int"), empty: () => new Optional(null, "int") }, OptionalDouble = { of: (v) => new Optional(new JDouble(v), "double"), empty: () => new Optional(null, "double") };
const Objects = {
  equals: eq, hash: (...a) => { if (a.length === 1 && Array.isArray(a[0])) a = a[0]; let h = 1; for (const x of a) h = (Math.imul(h, 31) + hash(x)) | 0; return h; }, hashCode: (o) => hash(o), toString: (o, d) => o === null && d !== undefined ? d : str(o),
  requireNonNull: (o, m) => { if (o === null || o === undefined) npe(typeof m === "function" ? m() : (m === undefined ? null : m)); return o; }, isNull: (o) => o === null, nonNull: (o) => o !== null,
  requireNonNullElse: (o, d) => o !== null ? o : d, compare: (a, b, c) => a === b ? 0 : fn(c)(a, b), checkIndex: (i, n) => { if (i < 0 || i >= n) throw ioob(i, n); return i; },
};
const sortRange = (a, from, to, f) => { if (from > to) throw mk("IllegalArgumentException", "fromIndex(" + from + ") > toIndex(" + to + ")"); if (from < 0 || to > a.length) throw mk("ArrayIndexOutOfBoundsException", "Array index out of range: " + (from < 0 ? from : to)); if (ArrayBuffer.isView(a)) a.subarray(from, to).sort(); else { const t = a.slice(from, to); t.sort(f); for (let i = 0; i < t.length; i++) a[from + i] = t[i]; } };
const Arrays = {
  toString: (a) => arrStr(a), deepToString: (a) => deepStr(a),
  sort: (a, x, y, z) => { if (a === null) npe(); if (x === undefined) { if (ArrayBuffer.isView(a)) a.sort(); else a.sort(cmp); } else if (typeof x === "number") sortRange(a, x, y, z === undefined ? cmp : fn(z)); else a.sort(fn(x)); },
  parallelSort: (a) => Arrays.sort(a),
  fill: (a, x, y, z) => { if (arguments.length === 2 || y === undefined) a.fill(x); else a.fill(z, x, y); },
  copyOf: (a, n) => { if (n < 0) throw mk("NegativeArraySizeException", String(n)); if (ArrayBuffer.isView(a)) { const r = new a.constructor(n); r.set(n < a.length ? a.subarray(0, n) : a); return r; } const r = a.slice(0, n); const pad = a.length && typeof a[0] === "boolean" ? false : null; while (r.length < n) r.push(pad); return r; },
  copyOfRange: (a, f, t) => { if (f > t) throw mk("IllegalArgumentException", f + " > " + t); if (f < 0 || f > a.length) throw mk("ArrayIndexOutOfBoundsException", "Array index out of range: " + f); if (ArrayBuffer.isView(a)) { const r = new a.constructor(t - f); r.set(a.subarray(f, Math.min(t, a.length))); return r; } const r = a.slice(f, t); const pad = a.length && typeof a[0] === "boolean" ? false : null; while (r.length < t - f) r.push(pad); return r; },
  equals: (a, b) => { if (a === b) return true; if (a === null || b === null || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i]) && !(typeof a[i] === "number" && a[i] === b[i])) return false; return true; },
  deepEquals: (a, b) => { const d = (x, y) => { if (isArr(x) && isArr(y)) { if (x.length !== y.length) return false; for (let i = 0; i < x.length; i++) if (!d(x[i], y[i])) return false; return true; } return x === y || eq(x, y); }; return d(a, b); },
  hashCode: (a) => { if (a === null) return 0; let h = 1; for (const x of a) h = (Math.imul(h, 31) + (typeof x === "number" ? (a instanceof Float64Array ? dhash(x) : x) : hash(x))) | 0; return h; },
  asList: (...a) => { const l = new ArrayList(); l.a = a.length === 1 && Array.isArray(a[0]) ? a[0] : a; l.fixed = true; return l; },
  stream: (a, f, t) => { let arr = Array.from(a); if (f !== undefined) arr = arr.slice(f, t); if (a instanceof Float64Array) return new JStream(arr.map(bd), "double"); if (a instanceof Int32Array || a instanceof Uint16Array) return new JStream(arr, "int"); if (a instanceof BigInt64Array) return new JStream(arr, "long"); return new JStream(arr, "obj"); },
  binarySearch: (a, x, y, z) => { let lo = 0, hi = a.length - 1, key = x, c = cmp; if (y !== undefined && typeof y === "number") { lo = x; hi = y - 1; key = z; } else if (y !== undefined) c = fn(y); while (lo <= hi) { const m = (lo + hi) >>> 1, r = c(a[m], key); if (r < 0) lo = m + 1; else if (r > 0) hi = m - 1; else return m; } return -(lo + 1); },
  setAll: (a, f) => { f = fn(f); for (let i = 0; i < a.length; i++) a[i] = unb(f(i)); },
};
Arrays.fill = (a, x, y, z) => { if (z === undefined) a.fill(x); else a.fill(z, x, y); };
const Collections = {
  sort: (l, c) => l.sort(c), reverse: (l) => { l.a.reverse(); }, shuffle: (l, r) => { r = r || __rnd; for (let i = l.a.length; i > 1; i--) { const j = r.nextInt(i), t = l.a[i - 1]; l.a[i - 1] = l.a[j]; l.a[j] = t; } },
  max: (c, f) => { const cf = cmpFn(f); let best, first = true; for (const x of iter(c)) { if (first || cf(x, best) > 0) best = x; first = false; } if (first) throw mk("NoSuchElementException", null); return best; },
  min: (c, f) => { const cf = cmpFn(f); let best, first = true; for (const x of iter(c)) { if (first || cf(x, best) < 0) best = x; first = false; } if (first) throw mk("NoSuchElementException", null); return best; },
  swap: (l, i, j) => { const t = l.get(i); l.set(i, l.get(j)); l.set(j, t); }, frequency: (c, x) => { let n = 0; for (const y of iter(c)) if (eq(x, y)) n++; return n; },
  unmodifiableList: (l) => { const r = new ImmList(l.a); return r; }, unmodifiableSet: (s) => { const r = s.clone(); r.m.imm = true; return r; }, unmodifiableMap: (m) => { const r = new LinkedHashMap(); r.putAll(m); r.imm = true; return r; }, unmodifiableCollection: (l) => new ImmList(l._arr().slice()),
  synchronizedList: (l) => l, synchronizedMap: (m) => m, synchronizedSet: (s) => s,
  emptyList: () => new ImmList([]), emptyMap: () => { const m = new HashMap(); m.imm = true; return m; }, emptySet: () => { const s = new HashSet(); s.m.imm = true; return s; },
  singletonList: (x) => new ImmList([x]), singleton: (x) => Set_.of(x), singletonMap: (k, v) => Map_.of(k, v), nCopies: (n, x) => new ImmList(new Array(n).fill(x)),
  addAll: (c, ...xs) => { let ch = false; for (const x of xs.length === 1 && Array.isArray(xs[0]) ? xs[0] : xs) if (c.add(x)) ch = true; return ch; },
  reverseOrder: (c) => c === undefined ? (a, b) => cmp(b, a) : (a, b) => fn(c)(b, a), binarySearch: (l, k, c) => Arrays.binarySearch(l.a, k, c), fill: (l, x) => { l.a.fill(x); }, disjoint: (a, b) => { for (const x of iter(a)) if (b.contains(x)) return false; return true; },
  rotate: (l, d) => { const n = l.a.length; if (!n) return; d = ((d % n) + n) % n; l.a = l.a.slice(n - d).concat(l.a.slice(0, n - d)); },
};
// ---- streams ----
class JStream extends JObject {
  constructor(a, t) { super(); this.a = a; this.t = t; }
  _n(a, t) { return new JStream(a, t || this.t); }
  filter(f) { f = fn(f); return this._n(this.a.filter((x) => f(x))); }
  map(f) { f = fn(f); if (this.t === "int") return this._n(this.a.map((x) => ui(f(x)))); if (this.t === "double") return this._n(this.a.map((x) => bd(ud(f(x))))); if (this.t === "long") return this._n(this.a.map((x) => ul(f(x)))); return this._n(this.a.map((x) => f(x))); }
  mapToInt(f) { f = fn(f); return this._n(this.a.map((x) => ui(f(x))), "int"); } mapToLong(f) { f = fn(f); return this._n(this.a.map((x) => ul(f(x))), "long"); } mapToDouble(f) { f = fn(f); return this._n(this.a.map((x) => bd(ud(f(x)))), "double"); }
  mapToObj(f) { f = fn(f); return this._n(this.a.map((x) => f(x)), "obj"); } asDoubleStream() { return this._n(this.a.map((x) => bd(Number(x))), "double"); } asLongStream() { return this._n(this.a.map((x) => BigInt(x)), "long"); }
  boxed() { return this._n(this.a.map((x) => x), "obj"); }
  flatMap(f) { f = fn(f); const r = []; for (const x of this.a) r.push(...f(x).a); return this._n(r); }
  distinct() { const s = new LinkedHashSet(); for (const x of this.a) s.add(x); return this._n(s._arr()); }
  sorted(c) { const r = this.a.slice(); r.sort(cmpFn(c)); return this._n(r); }
  limit(n) { return this._n(this.a.slice(0, Number(n))); } skip(n) { return this._n(this.a.slice(Number(n))); } peek(f) { f = fn(f); this.a.forEach((x) => f(x)); return this; }
  takeWhile(f) { f = fn(f); const r = []; for (const x of this.a) { if (!f(x)) break; r.push(x); } return this._n(r); } dropWhile(f) { f = fn(f); let i = 0; while (i < this.a.length && f(this.a[i])) i++; return this._n(this.a.slice(i)); }
  forEach(f) { f = fn(f); for (const x of this.a) f(x); } forEachOrdered(f) { this.forEach(f); }
  collect(c) { return c.fin(this.a.reduce((acc, x) => (c.acc(acc, x), acc), c.sup())); }
  toList() { return new ImmList(this.a.slice()); } toArray() { return this.t === "int" ? Int32Array.from(this.a) : this.t === "double" ? Float64Array.from(this.a.map(ud)) : this.t === "long" ? BigInt64Array.from(this.a) : this.a.slice(); }
  count() { return BigInt(this.a.length); }
  sum() { if (this.t === "int") { let s = 0; for (const x of this.a) s = (s + x) | 0; return s; } if (this.t === "long") { let s = 0n; for (const x of this.a) s = L(s + x); return s; } let s = 0; for (const x of this.a) s += ud(x); return s; }
  average() { if (!this.a.length) return OptionalDouble.empty(); let s = 0; for (const x of this.a) s += Number(ud(x)); return OptionalDouble.of(s / this.a.length); }
  max(c) { if (!this.a.length) return new Optional(null, this.t); const f = cmpFn(c); let b = this.a[0]; for (const x of this.a) if (f(x, b) > 0) b = x; return new Optional(b, this.t); }
  min(c) { if (!this.a.length) return new Optional(null, this.t); const f = cmpFn(c); let b = this.a[0]; for (const x of this.a) if (f(x, b) < 0) b = x; return new Optional(b, this.t); }
  reduce(a, b, c) { if (b === undefined) { const f = fn(a); if (!this.a.length) return new Optional(null, this.t); let r = this.a[0]; for (let i = 1; i < this.a.length; i++) r = f(r, this.a[i]); return new Optional(this.t === "double" ? bd(ud(r)) : r, this.t); } const f = fn(b); let r = a; for (const x of this.a) r = f(r, x); return this.t === "int" ? ui(r) : this.t === "double" ? ud(r) : r; }
  anyMatch(f) { f = fn(f); return this.a.some((x) => f(x)); } allMatch(f) { f = fn(f); return this.a.every((x) => f(x)); } noneMatch(f) { f = fn(f); return !this.a.some((x) => f(x)); }
  findFirst() { return new Optional(this.a.length ? this.a[0] : null, this.t); } findAny() { return this.findFirst(); }
  summaryStatistics() { const a = this.a.map((x) => Number(ud(x))); const o = new JObject(); o.getMin = () => this.t === "double" ? Math.min(...a) : Math.min(...a) | 0; o.getMax = () => this.t === "double" ? Math.max(...a) : Math.max(...a) | 0; o.getAverage = () => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; o.getSum = () => this.t === "int" ? BigInt(a.reduce((x, y) => x + y, 0)) : a.reduce((x, y) => x + y, 0); o.getCount = () => BigInt(a.length); return o; }
  iterator() { return new JIter(this.a.slice(), () => {}); } parallel() { return this; } sequential() { return this; } unordered() { return this; } onClose() { return this; } close() {}
  [Symbol.iterator]() { return this.a[Symbol.iterator](); }
}
JStream.$name = "Stream";
const mkRange = (a, b) => { const r = []; for (let i = a; i < b; i++) r.push(i); return new JStream(r, "int"); };
const IntStream = { range: mkRange, rangeClosed: (a, b) => mkRange(a, b + 1), of: (...a) => new JStream(a.length === 1 && ArrayBuffer.isView(a[0]) ? Array.from(a[0]) : a, "int"), empty: () => new JStream([], "int"), iterate: (s, f, g) => { const r = []; if (g !== undefined) { f = fn(f); g = fn(g); for (let x = s; f(x); x = g(x)) r.push(x); return new JStream(r, "int"); } return new LazyStream(s, fn(f), "int"); }, generate: (f) => new LazyStream(undefined, fn(f), "int", true) };
const LongStream = { range: (a, b) => { const r = []; for (let i = BigInt(a); i < b; i++) r.push(i); return new JStream(r, "long"); }, rangeClosed: (a, b) => { const r = []; for (let i = BigInt(a); i <= b; i++) r.push(i); return new JStream(r, "long"); }, of: (...a) => new JStream(a, "long") };
const DoubleStream = { of: (...a) => new JStream(a.length === 1 && ArrayBuffer.isView(a[0]) ? Array.from(a[0]).map(bd) : a.map(bd), "double") };
class LazyStream extends JStream { constructor(seed, f, t, gen) { super([], t); this.seed = seed; this.f = f; this.gen = gen; this.t = t; }
  limit(n) { n = Number(n); const r = []; let x = this.seed; for (let i = 0; i < n; i++) { if (this.gen) r.push(this.f()); else { r.push(x); x = this.f(x); } } return new JStream(r, this.t); }
  map(f) { const g = fn(f), s = this; const l = new LazyStream(undefined, null, this.t, true); let x = s.seed, first = true; l.f = () => { if (s.gen) return g(s.f()); const v = x; x = s.f(x); return g(v); }; return l; }
  filter(f) { f = fn(f); const s = this; const l = new LazyStream(undefined, null, this.t, true); let x = s.seed; l.f = () => { for (;;) { const v = s.gen ? s.f() : x; if (!s.gen) x = s.f(x); if (f(v)) return v; } }; return l; }
  peek() { return this; } boxed() { const l = new LazyStream(this.seed, this.f, "obj", this.gen); return l; } mapToObj(f) { return this.map(f); } }
const Stream = { of: (...a) => new JStream(a.length === 1 && Array.isArray(a[0]) ? a[0].slice() : a, "obj"), empty: () => new JStream([], "obj"), iterate: (s, f, g) => { if (g !== undefined) { f = fn(f); g = fn(g); const r = []; for (let x = s; f(x); x = g(x)) r.push(x); return new JStream(r, "obj"); } return new LazyStream(s, fn(f), "obj"); }, generate: (f) => new LazyStream(undefined, fn(f), "obj", true), concat: (a, b) => new JStream(a.a.concat(b.a), a.t) };
const mkColl = (sup, acc, fin) => ({ sup, acc, fin: fin || ((x) => x) });
const Collectors = {
  toList: () => mkColl(() => new ArrayList(), (l, x) => l.a.push(x)), toUnmodifiableList: () => mkColl(() => new ArrayList(), (l, x) => l.a.push(x), (l) => new ImmList(l.a)), toSet: () => mkColl(() => new HashSet(), (s, x) => s.add(x)), toUnmodifiableSet: () => mkColl(() => new HashSet(), (s, x) => s.add(x)),
  toCollection: (f) => mkColl(() => fn(f)(), (c, x) => c.add(x)),
  joining: (sep, pre, suf) => mkColl(() => [], (a, x) => a.push(str(x)), (a) => (pre || "") + a.join(sep === undefined ? "" : sep) + (suf || "")),
  counting: () => mkColl(() => [0n], (a) => { a[0]++; }, (a) => a[0]),
  summingInt: (f) => { f = fn(f); return mkColl(() => [0], (a, x) => { a[0] = (a[0] + ui(f(x))) | 0; }, (a) => a[0]); }, summingLong: (f) => { f = fn(f); return mkColl(() => [0n], (a, x) => { a[0] += ul(f(x)); }, (a) => a[0]); }, summingDouble: (f) => { f = fn(f); return mkColl(() => [0], (a, x) => { a[0] += ud(f(x)); }, (a) => bd(a[0])); },
  averagingInt: (f) => { f = fn(f); return mkColl(() => [0, 0], (a, x) => { a[0] += ud(f(x)); a[1]++; }, (a) => bd(a[1] ? a[0] / a[1] : 0)); }, averagingDouble: (f) => Collectors.averagingInt(f),
  mapping: (f, d) => { f = fn(f); return mkColl(d.sup, (a, x) => d.acc(a, f(x)), d.fin); }, filtering: (f, d) => { f = fn(f); return mkColl(d.sup, (a, x) => { if (f(x)) d.acc(a, x); }, d.fin); },
  collectingAndThen: (d, g) => mkColl(d.sup, d.acc, (a) => fn(g)(d.fin(a))),
  minBy: (c) => mkColl(() => [null], (a, x) => { if (a[0] === null || fn(c)(x, a[0]) < 0) a[0] = x; }, (a) => new Optional(a[0])), maxBy: (c) => mkColl(() => [null], (a, x) => { if (a[0] === null || fn(c)(x, a[0]) > 0) a[0] = x; }, (a) => new Optional(a[0])),
  reducing: (id, op) => mkColl(() => [id], (a, x) => { a[0] = fn(op)(a[0], x); }, (a) => a[0]),
  groupingBy: (f, a2, a3) => { f = fn(f); let mf = () => new HashMap(), d = Collectors.toList(); if (a3 !== undefined) { mf = fn(a2); d = a3; } else if (a2 !== undefined) d = a2; return mkColl(mf, (m, x) => { const k = f(x); let e = m._find(k); if (e === undefined) { m.put(k, d.sup()); e = m._find(k); } d.acc(e.v, x); }, (m) => { for (const e of m._entries()) e.v = d.fin(e.v); return m; }); },
  partitioningBy: (f, d) => { f = fn(f); d = d || Collectors.toList(); return mkColl(() => { const m = new LinkedHashMap(); m.put(false, d.sup()); m.put(true, d.sup()); return m; }, (m, x) => d.acc(m._find(!!f(x)).v, x), (m) => { for (const e of m._entries()) e.v = d.fin(e.v); return m; }); },
  toMap: (kf, vf, mg, sup) => { kf = fn(kf); vf = fn(vf); return mkColl(() => sup ? fn(sup)() : new HashMap(), (m, x) => { const k = kf(x), v = vf(x); const e = m._find(k); if (e !== undefined) { if (mg === undefined) throw mk("IllegalStateException", "Duplicate key " + str(k) + " (attempted merging values " + str(e.v) + " and " + str(v) + ")"); e.v = fn(mg)(e.v, v); } else m.put(k, v); }); },
};
class BigInteger extends JObject {
  constructor(v) { super(); this.v = typeof v === "bigint" ? v : BigInt(v === undefined ? 0 : (() => { if (typeof v === "string" && !/^[+-]?\d+$/.test(v.trim())) throw mk("NumberFormatException", 'For input string: "' + v + '"'); return typeof v === "string" ? v.trim() : v; })()); }
  $c(v) { this.v = typeof v === "bigint" ? v : BigInt(v); return this; }
  static valueOf(x) { return new BigInteger(BigInt(x)); }
  add(o) { return new BigInteger(this.v + o.v); } subtract(o) { return new BigInteger(this.v - o.v); } multiply(o) { return new BigInteger(this.v * o.v); }
  divide(o) { if (o.v === 0n) throw mk("ArithmeticException", "BigInteger divide by zero"); return new BigInteger(this.v / o.v); } mod(o) { if (o.v <= 0n) throw mk("ArithmeticException", "BigInteger: modulus not positive"); return new BigInteger(((this.v % o.v) + o.v) % o.v); } remainder(o) { if (o.v === 0n) throw mk("ArithmeticException", "BigInteger divide by zero"); return new BigInteger(this.v % o.v); }
  pow(e) { if (e < 0) throw mk("ArithmeticException", "Negative exponent"); return new BigInteger(this.v ** BigInt(e)); } abs() { return new BigInteger(this.v < 0n ? -this.v : this.v); } negate() { return new BigInteger(-this.v); }
  gcd(o) { let a = this.v < 0n ? -this.v : this.v, b = o.v < 0n ? -o.v : o.v; while (b) { [a, b] = [b, a % b]; } return new BigInteger(a); }
  modPow(e, m) { let r = 1n, b = ((this.v % m.v) + m.v) % m.v, x = e.v; while (x > 0n) { if (x & 1n) r = r * b % m.v; b = b * b % m.v; x >>= 1n; } return new BigInteger(r); } modInverse(m) { let [a, b, x, y] = [((this.v % m.v) + m.v) % m.v, m.v, 1n, 0n]; while (b) { const q = a / b; [a, b] = [b, a - q * b]; [x, y] = [y, x - q * y]; } return new BigInteger(((x % m.v) + m.v) % m.v); }
  compareTo(o) { return this.v < o.v ? -1 : this.v > o.v ? 1 : 0; } equals(o) { return o instanceof BigInteger && o.v === this.v; } hashCode() { return hash(this.v); } signum() { return this.v > 0n ? 1 : this.v < 0n ? -1 : 0; }
  max(o) { return this.v >= o.v ? this : o; } min(o) { return this.v <= o.v ? this : o; } sqrt() { if (this.v < 2n) return this; let x = BigInt(Math.floor(Math.sqrt(Number(this.v)))); while (x * x > this.v) x--; while ((x + 1n) * (x + 1n) <= this.v) x++; return new BigInteger(x); }
  intValue() { return Number(BigInt.asIntN(32, this.v)); } longValue() { return BigInt.asIntN(64, this.v); } doubleValue() { return Number(this.v); } toString(r) { return this.v.toString(r || 10); } bitLength() { return (this.v < 0n ? ~this.v : this.v).toString(2).replace(/^0$/, "").length; } testBit(n) { return ((this.v >> BigInt(n)) & 1n) === 1n; } isProbablePrime() { const n = this.v; if (n < 2n) return false; for (let i = 2n; i * i <= n && i < 100000n; i++) if (n % i === 0n) return false; return true; } shiftLeft(n) { return new BigInteger(this.v << BigInt(n)); } shiftRight(n) { return new BigInteger(this.v >> BigInt(n)); } and(o) { return new BigInteger(this.v & o.v); } or(o) { return new BigInteger(this.v | o.v); } xor(o) { return new BigInteger(this.v ^ o.v); } intValueExact() { if (this.v > 2147483647n || this.v < -2147483648n) throw mk("ArithmeticException", "BigInteger out of int range"); return Number(this.v); } longValueExact() { return this.v; }
}
BigInteger.$name = "BigInteger"; BigInteger.ZERO = new BigInteger(0n); BigInteger.ONE = new BigInteger(1n); BigInteger.TWO = new BigInteger(2n); BigInteger.TEN = new BigInteger(10n);
class BigDecimal extends JObject { // simplified: unscaled BigInt + scale
  constructor(v, sc) { super(); if (typeof v === "bigint") { this.u = v; this.sc = sc || 0; } else if (v instanceof JDouble) { const p = BigDecimal._p(dstr(v.v)); this.u = p.u; this.sc = p.sc; } else if (typeof v === "number") { this.u = BigInt(v); this.sc = 0; } else { const p = BigDecimal._p(String(v)); this.u = p.u; this.sc = p.sc; } }
  static _p(s) { const m = /^([+-]?)(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?$/.exec(s.trim()); if (!m || (m[2] === "" && m[3] === "")) throw mk("NumberFormatException", "Character array is missing \"exponent\" mark 'e' or 'E'."); let sc = m[3].length - (m[4] ? parseInt(m[4], 10) : 0); let u = BigInt((m[2] + m[3]) || "0"); if (m[1] === "-") u = -u; if (sc < 0) { u *= 10n ** BigInt(-sc); sc = 0; } return { u, sc }; }
  static valueOf(x, s) { if (typeof x === "bigint") return new BigDecimal(x, s || 0); if (x instanceof JDouble) return new BigDecimal(dstr(x.v)); return new BigDecimal(typeof x === "number" ? dstr(x) : String(x)); }
  _al(o) { const sc = Math.max(this.sc, o.sc); return [this.u * 10n ** BigInt(sc - this.sc), o.u * 10n ** BigInt(sc - o.sc), sc]; }
  add(o) { const [a, b, s] = this._al(o); return new BigDecimal(a + b, s); } subtract(o) { const [a, b, s] = this._al(o); return new BigDecimal(a - b, s); } multiply(o) { return new BigDecimal(this.u * o.u, this.sc + o.sc); }
  divide(o, a, b) { if (o.u === 0n) throw mk("ArithmeticException", this.u === 0n ? "Division undefined" : "Division by zero"); let scale, rm = "HALF_UP"; if (b !== undefined) { scale = a; rm = b; } else if (a !== undefined && typeof a === "number") { scale = a; } else if (a !== undefined) { rm = a; scale = this.sc; } else { const pref = this.sc - o.sc; for (let s = Math.max(pref, 0); s < 400; s++) { const num = this.u * 10n ** BigInt(s + o.sc - this.sc + 0), r = num % o.u; if (s + o.sc - this.sc >= 0 && r === 0n) { return new BigDecimal(num / o.u, s); } } throw mk("ArithmeticException", "Non-terminating decimal expansion; no exact representable decimal result."); } return this._div(o, scale, rm); }
  _div(o, scale, rm) { const e = scale + o.sc - this.sc; let n = this.u, d = o.u; if (e >= 0) n *= 10n ** BigInt(e); else d *= 10n ** BigInt(-e); const q = n / d, r = n % d; return new BigDecimal(BigDecimal._rnd(q, r, d, rm), scale); }
  static _rnd(q, r, d, rm) { if (r === 0n) return q; const neg = (r < 0n) !== (d < 0n); const ar = r < 0n ? -r : r, ad = d < 0n ? -d : d; const twice = ar * 2n; let up; switch (String(rm)) { case "UP": up = true; break; case "DOWN": up = false; break; case "CEILING": up = !neg; break; case "FLOOR": up = neg; break; case "HALF_UP": up = twice >= ad; break; case "HALF_DOWN": up = twice > ad; break; case "HALF_EVEN": up = twice > ad || (twice === ad && (q & 1n) !== 0n); break; default: up = twice >= ad; } return up ? q + (neg ? -1n : 1n) : q; }
  setScale(s, rm) { if (s >= this.sc) return new BigDecimal(this.u * 10n ** BigInt(s - this.sc), s); return this._div(new BigDecimal(1n, 0), s, rm === undefined ? "UNNECESSARY" : rm); }
  negate() { return new BigDecimal(-this.u, this.sc); } abs() { return new BigDecimal(this.u < 0n ? -this.u : this.u, this.sc); } signum() { return this.u > 0n ? 1 : this.u < 0n ? -1 : 0; } scale() { return this.sc; }
  compareTo(o) { const [a, b] = this._al(o); return a < b ? -1 : a > b ? 1 : 0; } equals(o) { return o instanceof BigDecimal && o.u === this.u && o.sc === this.sc; } hashCode() { return (31 * hash(this.u) + this.sc) | 0; }
  max(o) { return this.compareTo(o) >= 0 ? this : o; } min(o) { return this.compareTo(o) <= 0 ? this : o; } pow(n) { return new BigDecimal(this.u ** BigInt(n), this.sc * n); }
  doubleValue() { return parseFloat(this.toString()); } intValue() { return Number(BigInt.asIntN(32, this.u / 10n ** BigInt(this.sc))); } longValue() { return this.u / 10n ** BigInt(this.sc); }
  toString() { const neg = this.u < 0n; let s = (neg ? -this.u : this.u).toString(); if (this.sc > 0) { s = s.padStart(this.sc + 1, "0"); s = s.slice(0, s.length - this.sc) + "." + s.slice(s.length - this.sc); } return (neg ? "-" : "") + s; } toPlainString() { return this.toString(); } stripTrailingZeros() { let u = this.u, sc = this.sc; while (sc > 0 && u % 10n === 0n) { u /= 10n; sc--; } return new BigDecimal(u, sc); }
}
BigDecimal.$name = "BigDecimal"; BigDecimal.ZERO = new BigDecimal(0n, 0); BigDecimal.ONE = new BigDecimal(1n, 0); BigDecimal.TEN = new BigDecimal(10n, 0);
const RoundingMode = { UP: "UP", DOWN: "DOWN", CEILING: "CEILING", FLOOR: "FLOOR", HALF_UP: "HALF_UP", HALF_DOWN: "HALF_DOWN", HALF_EVEN: "HALF_EVEN" };
const TimeUnit = { SECONDS: { sleep(n) { Thread.sleep(Number(n) * 1000); } }, MILLISECONDS: { sleep(n) { Thread.sleep(n); } } };
class Iterator_ {} 

/* ===== compiler: types, lib signatures ===== */
const P = (n) => ({ n });
const tInt = P("int"), tLong = P("long"), tDouble = P("double"), tFloat = P("float"), tChar = P("char"), tByte = P("byte"), tShort = P("short"), tBool = P("boolean"), tVoid = P("void");
const tStr = { n: "String" }, tObj = { n: "Object" }, UNK = { n: "?" }, NUL = { n: "null" };
const PRIMSET = new Set(["int", "long", "double", "float", "char", "byte", "short", "boolean"]);
const PRIMT = { int: tInt, long: tLong, double: tDouble, float: tFloat, char: tChar, byte: tByte, short: tShort, boolean: tBool, void: tVoid };
const BOXOF = { Integer: "int", Long: "long", Double: "double", Float: "float", Character: "char", Boolean: "boolean", Short: "short", Byte: "byte" };
const BOXNAME = { int: "Integer", long: "Long", double: "Double", float: "Float", char: "Character", boolean: "Boolean", short: "Short", byte: "Byte" };
const RANK = { byte: 1, short: 2, char: 2, int: 3, long: 4, float: 5, double: 6 };
const isPrim = (t) => !!t && !t.arr && PRIMSET.has(t.n);
const isUnk = (t) => !t || t.n === "?" || t.tv === true;
const isNumP = (t) => isPrim(t) && t.n !== "boolean";
const isArrT = (t) => !!t && !!t.arr;
const unboxT = (t) => { if (!t || t.arr) return t; if (BOXOF[t.n]) return PRIMT[BOXOF[t.n]]; return t; };
const boxT = (t) => isPrim(t) ? { n: BOXNAME[t.n] } : t;
const tName = (t) => !t ? "?" : t.arr ? tName(t.arr) + "[]" : t.n + (t.a && t.a.length ? "<" + t.a.map(tName).join(",") + ">" : "");
const promote = (a, b) => { const r = Math.max(RANK[a.n] || 3, RANK[b.n] || 3); return r >= 6 ? tDouble : r === 5 ? tFloat : r === 4 ? tLong : tInt; };
const elemKind = (t) => t.arr && !t.arr.arr && isPrim(t.arr) ? t.arr.n : "obj";
// lib class table: name -> { tp, sup, m: {method: retSpec}, fi?: {params, ret} }
const LIB = {};
function parseSpec(s, tps) {
  let i = 0;
  const go = () => {
    let n = ""; while (i < s.length && /[A-Za-z0-9_.?]/.test(s[i])) n += s[i++];
    let t; if (PRIMT[n]) t = PRIMT[n]; else if (n === "?") t = UNK; else { t = { n }; if (tps && tps.includes(n)) t = { n, tv: true, p: true }; }
    if (s[i] === "<") { i++; const a = []; do { a.push(go()); if (s[i] === ",") i++; else break; } while (true); i++; t = { n: t.n, a }; }
    while (s[i] === "[" && s[i + 1] === "]") { i += 2; t = { arr: t }; }
    return t;
  };
  return go();
}
function defLib(head, sups, methods) {
  const m = /^(\w+)(?:<(.*)>)?$/.exec(head); const name = m[1]; const tp = m[2] ? m[2].split(",") : [];
  const meths = {}; for (const part of methods.split(/\s+/).filter(Boolean)) { const k = part.indexOf(":"); meths[part.slice(0, k)] = parseSpec(part.slice(k + 1), tp); }
  LIB[name] = { tp, sup: sups ? sups.split(";").map((x) => parseSpec(x, tp)) : [], m: meths };
}
defLib("Object", "", "toString:String equals:boolean hashCode:int getClass:Class");
defLib("Class", "", "getSimpleName:String getName:String");
defLib("Comparable<T>", "", "compareTo:int");
defLib("CharSequence", "", "length:int charAt:char toString:String");
defLib("String", "Comparable<String>", "length:int charAt:char substring:String indexOf:int lastIndexOf:int contains:boolean startsWith:boolean endsWith:boolean equals:boolean equalsIgnoreCase:boolean compareTo:int compareToIgnoreCase:int toUpperCase:String toLowerCase:String trim:String strip:String stripLeading:String stripTrailing:String concat:String hashCode:int replace:String replaceAll:String replaceFirst:String matches:boolean split:String[] toCharArray:char[] isEmpty:boolean isBlank:boolean repeat:String format:String formatted:String intern:String chars:IntStream lines:Stream<String> codePointAt:int subSequence:String toString:String");
defLib("StringBuilder", "CharSequence", "append:StringBuilder insert:StringBuilder reverse:StringBuilder deleteCharAt:StringBuilder delete:StringBuilder replace:StringBuilder length:int charAt:char toString:String indexOf:int lastIndexOf:int substring:String setLength:void setCharAt:void isEmpty:boolean capacity:int compareTo:int chars:IntStream");
LIB.StringBuffer = LIB.StringBuilder;
defLib("Iterator<E>", "", "hasNext:boolean next:E remove:void");
defLib("ListIterator<E>", "Iterator<E>", "hasPrevious:boolean previous:E");
defLib("Iterable<E>", "", "iterator:Iterator<E> forEach:void");
defLib("Collection<E>", "Iterable<E>", "size:int isEmpty:boolean contains:boolean add:boolean remove:boolean addAll:boolean removeAll:boolean retainAll:boolean containsAll:boolean clear:void stream:Stream<E> parallelStream:Stream<E> toArray:Object[] removeIf:boolean iterator:Iterator<E>");
defLib("List<E>", "Collection<E>", "get:E set:E removeAt:E indexOf:int lastIndexOf:int subList:List<E> sort:void replaceAll:void listIterator:ListIterator<E> getFirst:E getLast:E removeFirst:E removeLast:E addFirst:void addLast:void reversed:List<E>");
defLib("Queue<E>", "Collection<E>", "peek:E poll:E offer:boolean element:E remove:boolean");
defLib("Deque<E>", "Queue<E>", "push:void pop:E peekFirst:E peekLast:E pollFirst:E pollLast:E offerFirst:boolean offerLast:boolean addFirst:void addLast:void removeFirst:E removeLast:E getFirst:E getLast:E descendingIterator:Iterator<E>");
defLib("ArrayList<E>", "List<E>", "ensureCapacity:void trimToSize:void clone:Object");
defLib("LinkedList<E>", "List<E>;Deque<E>", "");
defLib("Vector<E>", "List<E>", "elementAt:E addElement:void firstElement:E lastElement:E");
defLib("Stack<E>", "Vector<E>", "push:E pop:E peek:E empty:boolean search:int");
defLib("ArrayDeque<E>", "Deque<E>", "");
defLib("PriorityQueue<E>", "Queue<E>", "comparator:Comparator<E>");
defLib("Set<E>", "Collection<E>", "");
defLib("HashSet<E>", "Set<E>", ""); defLib("LinkedHashSet<E>", "Set<E>", "");
defLib("SortedSet<E>", "Set<E>", "first:E last:E headSet:SortedSet<E> tailSet:SortedSet<E> subSet:SortedSet<E>");
defLib("TreeSet<E>", "SortedSet<E>", "floor:E ceiling:E higher:E lower:E pollFirst:E pollLast:E descendingSet:TreeSet<E> descendingIterator:Iterator<E> getFirst:E getLast:E");
defLib("Entry<K,V>", "", "getKey:K getValue:V setValue:V");
defLib("Map<K,V>", "", "size:int isEmpty:boolean get:V put:V remove:V containsKey:boolean containsValue:boolean getOrDefault:V putIfAbsent:V computeIfAbsent:V computeIfPresent:V compute:V merge:V keySet:Set<K> values:Collection<V> entrySet:Set<Entry<K,V>> putAll:void clear:void forEach:void replaceAll:void replace:V");
defLib("HashMap<K,V>", "Map<K,V>", ""); defLib("LinkedHashMap<K,V>", "Map<K,V>", ""); defLib("Hashtable<K,V>", "Map<K,V>", ""); defLib("ConcurrentHashMap<K,V>", "Map<K,V>", "");
defLib("TreeMap<K,V>", "Map<K,V>", "firstKey:K lastKey:K floorKey:K ceilingKey:K higherKey:K lowerKey:K firstEntry:Entry<K,V> lastEntry:Entry<K,V> floorEntry:Entry<K,V> ceilingEntry:Entry<K,V> higherEntry:Entry<K,V> lowerEntry:Entry<K,V> pollFirstEntry:Entry<K,V> pollLastEntry:Entry<K,V> headMap:TreeMap<K,V> tailMap:TreeMap<K,V> subMap:TreeMap<K,V> descendingMap:Map<K,V> descendingKeySet:Set<K> navigableKeySet:Set<K>");
LIB.SortedMap = LIB.TreeMap; LIB.NavigableMap = LIB.TreeMap; LIB.NavigableSet = LIB.TreeSet; LIB.EnumMap = LIB.TreeMap;
defLib("Optional<T>", "", "isPresent:boolean isEmpty:boolean get:T orElse:T orElseGet:T orElseThrow:T ifPresent:void map:Optional<?> filter:Optional<T> flatMap:Optional<?>");
defLib("OptionalInt", "", "isPresent:boolean getAsInt:int orElse:int isEmpty:boolean ifPresent:void orElseThrow:int");
defLib("OptionalDouble", "", "isPresent:boolean getAsDouble:double orElse:double isEmpty:boolean ifPresent:void orElseThrow:double");
defLib("Stream<T>", "", "filter:Stream<T> map:Stream<?> mapToInt:IntStream mapToDouble:DoubleStream mapToLong:LongStream flatMap:Stream<?> distinct:Stream<T> sorted:Stream<T> limit:Stream<T> skip:Stream<T> peek:Stream<T> forEach:void collect:? toList:List<T> count:long anyMatch:boolean allMatch:boolean noneMatch:boolean findFirst:Optional<T> findAny:Optional<T> min:Optional<T> max:Optional<T> reduce:? toArray:Object[] takeWhile:Stream<T> dropWhile:Stream<T> iterator:Iterator<T> boxed:Stream<T>");
defLib("IntStream", "", "filter:IntStream map:IntStream mapToObj:Stream<?> mapToDouble:DoubleStream mapToLong:LongStream boxed:Stream<Integer> sum:int count:long average:OptionalDouble min:OptionalInt max:OptionalInt toArray:int[] distinct:IntStream sorted:IntStream limit:IntStream skip:IntStream forEach:void anyMatch:boolean allMatch:boolean noneMatch:boolean findFirst:OptionalInt findAny:OptionalInt reduce:? peek:IntStream asDoubleStream:DoubleStream asLongStream:LongStream summaryStatistics:IntSummaryStatistics");
defLib("DoubleStream", "", "filter:DoubleStream map:DoubleStream mapToObj:Stream<?> mapToInt:IntStream boxed:Stream<Double> sum:double count:long average:OptionalDouble min:OptionalDouble max:OptionalDouble toArray:double[] distinct:DoubleStream sorted:DoubleStream limit:DoubleStream skip:DoubleStream forEach:void anyMatch:boolean allMatch:boolean noneMatch:boolean findFirst:OptionalDouble reduce:? peek:DoubleStream summaryStatistics:IntSummaryStatistics");
defLib("LongStream", "", "filter:LongStream map:LongStream mapToObj:Stream<?> boxed:Stream<Long> sum:long count:long average:OptionalDouble min:OptionalLong max:OptionalLong toArray:long[] limit:LongStream forEach:void reduce:? ");
defLib("IntSummaryStatistics", "", "getMin:int getMax:int getAverage:double getSum:long getCount:long");
defLib("Scanner", "", "next:String nextInt:int nextLong:long nextDouble:double nextFloat:float nextBoolean:boolean nextLine:String hasNext:boolean hasNextInt:boolean hasNextLong:boolean hasNextDouble:boolean hasNextLine:boolean hasNextBoolean:boolean close:void nextShort:short nextByte:byte nextBigInteger:BigInteger");
defLib("BufferedReader", "", "readLine:String read:int ready:boolean close:void lines:Stream<String>");
defLib("StringTokenizer", "", "hasMoreTokens:boolean nextToken:String countTokens:int hasMoreElements:boolean nextElement:Object");
defLib("Random", "", "nextInt:int nextDouble:double nextBoolean:boolean nextLong:long nextGaussian:double nextFloat:float setSeed:void ints:IntStream");
defLib("AtomicInteger", "", "get:int set:void incrementAndGet:int decrementAndGet:int getAndIncrement:int getAndDecrement:int addAndGet:int getAndAdd:int compareAndSet:boolean intValue:int updateAndGet:int getAndSet:int accumulateAndGet:int");
defLib("AtomicLong", "", "get:long set:void incrementAndGet:long decrementAndGet:long getAndIncrement:long addAndGet:long getAndAdd:long longValue:long");
defLib("AtomicBoolean", "", "get:boolean set:void compareAndSet:boolean getAndSet:boolean");
defLib("BigInteger", "Comparable<BigInteger>", "add:BigInteger subtract:BigInteger multiply:BigInteger divide:BigInteger mod:BigInteger remainder:BigInteger pow:BigInteger abs:BigInteger negate:BigInteger gcd:BigInteger modPow:BigInteger modInverse:BigInteger compareTo:int signum:int max:BigInteger min:BigInteger sqrt:BigInteger intValue:int longValue:long doubleValue:double bitLength:int testBit:boolean isProbablePrime:boolean shiftLeft:BigInteger shiftRight:BigInteger and:BigInteger or:BigInteger xor:BigInteger intValueExact:int longValueExact:long toString:String equals:boolean");
defLib("BigDecimal", "Comparable<BigDecimal>", "add:BigDecimal subtract:BigDecimal multiply:BigDecimal divide:BigDecimal setScale:BigDecimal negate:BigDecimal abs:BigDecimal signum:int scale:int compareTo:int max:BigDecimal min:BigDecimal pow:BigDecimal doubleValue:double intValue:int longValue:long toPlainString:String stripTrailingZeros:BigDecimal toString:String");
defLib("Integer", "Number;Comparable<Integer>", "intValue:int longValue:long doubleValue:double floatValue:float compareTo:int equals:boolean hashCode:int toString:String shortValue:short byteValue:byte");
defLib("Long", "Number;Comparable<Long>", "intValue:int longValue:long doubleValue:double compareTo:int equals:boolean hashCode:int toString:String");
defLib("Double", "Number;Comparable<Double>", "intValue:int longValue:long doubleValue:double floatValue:float compareTo:int equals:boolean hashCode:int toString:String isNaN:boolean isInfinite:boolean");
defLib("Float", "Number;Comparable<Float>", "intValue:int longValue:long doubleValue:double floatValue:float compareTo:int equals:boolean hashCode:int toString:String");
defLib("Number", "", "intValue:int longValue:long doubleValue:double floatValue:float");
defLib("Character", "Comparable<Character>", "charValue:char compareTo:int equals:boolean hashCode:int toString:String");
defLib("Boolean", "Comparable<Boolean>", "booleanValue:boolean compareTo:int equals:boolean hashCode:int toString:String");
defLib("Thread", "", "start:void join:void getName:String setName:void interrupt:void isAlive:boolean run:void setDaemon:void");
defLib("Throwable", "", "getMessage:String getLocalizedMessage:String getCause:Throwable printStackTrace:void toString:String getStackTrace:StackTraceElement[] addSuppressed:void initCause:Throwable getSuppressed:Throwable[]");
defLib("PrintStream", "", "println:void print:void printf:PrintStream format:PrintStream flush:void write:void");
defLib("PrintWriter", "", "println:void print:void printf:PrintWriter flush:void close:void write:void");
// functional interfaces: params and return as spec using tp names; null return = void
const FI = {
  Function: { tp: ["T", "R"], p: ["T"], r: "R", m: "apply" }, BiFunction: { tp: ["T", "U", "R"], p: ["T", "U"], r: "R", m: "apply" }, UnaryOperator: { tp: ["T"], p: ["T"], r: "T", m: "apply" }, BinaryOperator: { tp: ["T"], p: ["T", "T"], r: "T", m: "apply" },
  Supplier: { tp: ["T"], p: [], r: "T", m: "get" }, Consumer: { tp: ["T"], p: ["T"], r: "void", m: "accept" }, BiConsumer: { tp: ["T", "U"], p: ["T", "U"], r: "void", m: "accept" }, Predicate: { tp: ["T"], p: ["T"], r: "boolean", m: "test" }, BiPredicate: { tp: ["T", "U"], p: ["T", "U"], r: "boolean", m: "test" },
  Comparator: { tp: ["T"], p: ["T", "T"], r: "int", m: "compare" }, Runnable: { tp: [], p: [], r: "void", m: "run" }, Callable: { tp: ["T"], p: [], r: "T", m: "call" },
  IntBinaryOperator: { tp: [], p: ["int", "int"], r: "int", m: "applyAsInt" }, IntUnaryOperator: { tp: [], p: ["int"], r: "int", m: "applyAsInt" }, IntPredicate: { tp: [], p: ["int"], r: "boolean", m: "test" }, IntFunction: { tp: ["R"], p: ["int"], r: "R", m: "apply" }, IntConsumer: { tp: [], p: ["int"], r: "void", m: "accept" }, IntSupplier: { tp: [], p: [], r: "int", m: "getAsInt" }, ToIntFunction: { tp: ["T"], p: ["T"], r: "int", m: "applyAsInt" }, ToDoubleFunction: { tp: ["T"], p: ["T"], r: "double", m: "applyAsDouble" }, ToLongFunction: { tp: ["T"], p: ["T"], r: "long", m: "applyAsLong" }, ToIntBiFunction: { tp: ["T", "U"], p: ["T", "U"], r: "int", m: "applyAsInt" },
  DoubleUnaryOperator: { tp: [], p: ["double"], r: "double", m: "applyAsDouble" }, DoubleBinaryOperator: { tp: [], p: ["double", "double"], r: "double", m: "applyAsDouble" }, DoubleSupplier: { tp: [], p: [], r: "double", m: "getAsDouble" }, BooleanSupplier: { tp: [], p: [], r: "boolean", m: "getAsBoolean" }, LongBinaryOperator: { tp: [], p: ["long", "long"], r: "long", m: "applyAsLong" }, LongUnaryOperator: { tp: [], p: ["long"], r: "long", m: "applyAsLong" }, DoublePredicate: { tp: [], p: ["double"], r: "boolean", m: "test" }, IntToDoubleFunction: { tp: [], p: ["int"], r: "double", m: "applyAsDouble" }, DoubleFunction: { tp: ["R"], p: ["double"], r: "R", m: "apply" }, LongFunction: { tp: ["R"], p: ["long"], r: "R", m: "apply" },
};
for (const [k, v] of Object.entries(FI)) { if (!LIB[k]) LIB[k] = { tp: v.tp, sup: [], m: {}, fi: v }; }
for (const k of ["apply", "accept", "test", "get", "run", "compare", "call", "applyAsInt", "applyAsLong", "applyAsDouble", "getAsInt", "getAsDouble", "getAsLong", "getAsBoolean"]) void k;
// element-type table for lambda params of lib methods: [receiverFamily, method] => list of specs in terms of receiver tparams
const LAMP = {
  Iterable: { forEach: ["E"] }, Collection: { removeIf: ["E"], forEach: ["E"] }, List: { sort: ["E", "E"], replaceAll: ["E"] },
  Map: { forEach: ["K", "V"], computeIfAbsent: ["K"], computeIfPresent: ["K", "V"], compute: ["K", "V"], merge: ["V", "V"], replaceAll: ["K", "V"] },
  Stream: { filter: ["T"], map: ["T"], mapToInt: ["T"], mapToDouble: ["T"], mapToLong: ["T"], flatMap: ["T"], forEach: ["T"], anyMatch: ["T"], allMatch: ["T"], noneMatch: ["T"], peek: ["T"], sorted: ["T", "T"], min: ["T", "T"], max: ["T", "T"], reduce: ["T", "T"], takeWhile: ["T"], dropWhile: ["T"] },
  IntStream: { filter: ["int"], map: ["int"], mapToObj: ["int"], mapToDouble: ["int"], mapToLong: ["int"], forEach: ["int"], anyMatch: ["int"], allMatch: ["int"], noneMatch: ["int"], reduce: ["int", "int"], peek: ["int"] },
  DoubleStream: { filter: ["double"], map: ["double"], mapToObj: ["double"], mapToInt: ["double"], forEach: ["double"], anyMatch: ["double"], allMatch: ["double"], reduce: ["double", "double"] },
  LongStream: { filter: ["long"], map: ["long"], mapToObj: ["long"], forEach: ["long"], reduce: ["long", "long"] },
  Optional: { ifPresent: ["T"], map: ["T"], filter: ["T"], flatMap: ["T"] },
};
function libParents(name) { const out = []; const seen = new Set(); const go = (n) => { if (seen.has(n)) return; seen.add(n); out.push(n); const L = LIB[n]; if (L) for (const s of L.sup) go(s.n); }; go(name); return out; }
// look up a lib method return type given receiver type; returns spec type substituted or undefined
function subst(t, map) {
  if (!t) return t; if (t.arr) return { arr: subst(t.arr, map) };
  if (t.tv && t.p) return map && map[t.n] ? map[t.n] : UNK;
  if (t.tv && map && map[t.n]) return map[t.n];
  if (t.a) return { n: t.n, a: t.a.map((x) => subst(x, map)) };
  return t;
}
function libMember(rt, name) {
  // returns {t: retType, owner}
  const seen = new Set();
  const go = (type) => {
    const L = LIB[type.n]; if (!L || seen.has(type.n)) return undefined; seen.add(type.n);
    const map = {}; L.tp.forEach((p, i) => { map[p] = type.a && type.a[i] ? type.a[i] : UNK; });
    if (Object.prototype.hasOwnProperty.call(L.m, name)) return { t: subst(L.m[name], map), owner: type.n, map };
    for (const s of L.sup) { const r = go(subst(s, map)); if (r) return r; }
    return undefined;
  };
  return go(rt);
}
function libFamilyMap(rt) { // type-arg map for a receiver in terms of the generic names of its ancestors
  const maps = {}; const seen = new Set();
  const go = (type) => { const L = LIB[type.n]; if (!L || seen.has(type.n)) return; seen.add(type.n); const map = {}; L.tp.forEach((p, i) => { map[p] = type.a && type.a[i] ? type.a[i] : UNK; }); maps[type.n] = map; for (const s of L.sup) go(subst(s, map)); };
  go(rt); return maps;
}
function lampTypes(rt, method) {
  const maps = libFamilyMap(rt);
  for (const fam of Object.keys(LAMP)) { if (maps[fam] && LAMP[fam][method]) return LAMP[fam][method].map((s) => (PRIMT[s] || (maps[fam][s] || UNK))); }
  return null;
}

/* ===== compiler: expressions ===== */
const JSRES = new Set("arguments await async break case catch class const continue debugger default delete do else enum eval export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield undefined NaN Infinity Object Array String Number Boolean Math Map Set Symbol BigInt Date Error JSON RegExp Promise Proxy Reflect globalThis name length".split(" "));
JSRES.delete("name"); JSRES.delete("length");
const jsId = (n) => (JSRES.has(n) ? n + "$" : n);
const RAWSTATIC = new Set(["Integer", "Long", "Double", "Float", "Short", "Byte", "Character", "Boolean", "Math", "System", "Thread", "IntStream", "LongStream", "DoubleStream", "Arrays", "Character", "TimeUnit"]);
const STATIC_RET = {
  Integer: "parseInt:int valueOf:Integer toString:String toBinaryString:String toHexString:String toOctalString:String compare:int sum:int max:int min:int signum:int bitCount:int reverse:int highestOneBit:int lowestOneBit:int numberOfTrailingZeros:int numberOfLeadingZeros:int hashCode:int decode:int parseUnsignedInt:int divideUnsigned:int remainderUnsigned:int rotateLeft:int rotateRight:int toUnsignedString:String abs:int",
  Long: "parseLong:long valueOf:Long toString:String toBinaryString:String toHexString:String toOctalString:String compare:int sum:long max:long min:long signum:int bitCount:int hashCode:int numberOfTrailingZeros:int numberOfLeadingZeros:int abs:long",
  Double: "parseDouble:double valueOf:Double toString:String compare:int isNaN:boolean isInfinite:boolean isFinite:boolean sum:double max:double min:double hashCode:int doubleToLongBits:long",
  Float: "parseFloat:float valueOf:Float toString:String compare:int isNaN:boolean sum:float max:float min:float", Short: "parseShort:short valueOf:Short toString:String compare:int", Byte: "parseByte:byte valueOf:Byte toString:String compare:int",
  Boolean: "parseBoolean:boolean valueOf:Boolean toString:String compare:int logicalAnd:boolean logicalOr:boolean logicalXor:boolean hashCode:int",
  Character: "isDigit:boolean isLetter:boolean isLetterOrDigit:boolean isAlphabetic:boolean isUpperCase:boolean isLowerCase:boolean isWhitespace:boolean isSpaceChar:boolean toUpperCase:char toLowerCase:char getNumericValue:int digit:int forDigit:char toString:String valueOf:Character compare:int hashCode:int toChars:char[]",
  String: "valueOf:String format:String join:String copyValueOf:String",
  Arrays: "toString:String deepToString:String sort:void parallelSort:void fill:void equals:boolean deepEquals:boolean hashCode:int binarySearch:int setAll:void",
  Collections: "sort:void reverse:void shuffle:void swap:void frequency:int addAll:boolean fill:void disjoint:boolean rotate:void binarySearch:int",
  Objects: "equals:boolean hash:int hashCode:int toString:String isNull:boolean nonNull:boolean checkIndex:int compare:int",
  System: "currentTimeMillis:long nanoTime:long exit:void arraycopy:void lineSeparator:String getProperty:String identityHashCode:int getenv:String gc:void",
  Thread: "sleep:void currentThread:Thread", IntStream: "range:IntStream rangeClosed:IntStream of:IntStream iterate:IntStream generate:IntStream empty:IntStream", LongStream: "range:LongStream rangeClosed:LongStream of:LongStream", DoubleStream: "of:DoubleStream",
  Optional: "empty:Optional<?>", BigInteger: "valueOf:BigInteger", BigDecimal: "valueOf:BigDecimal", Stream: "empty:Stream<?> concat:Stream<?>", Entry: "", Map: "entry:Entry<?,?>",
};
const STATIC_RET_T = {}; for (const [c, s] of Object.entries(STATIC_RET)) { STATIC_RET_T[c] = {}; for (const p of s.split(/\s+/).filter(Boolean)) { const k = p.indexOf(":"); STATIC_RET_T[c][p.slice(0, k)] = parseSpec(p.slice(k + 1), []); } }
const STATIC_FIELDS = { String: { CASE_INSENSITIVE_ORDER: { n: "Comparator", a: [tStr] } }, Integer: { MAX_VALUE: tInt, MIN_VALUE: tInt, SIZE: tInt, BYTES: tInt }, Long: { MAX_VALUE: tLong, MIN_VALUE: tLong, SIZE: tInt, BYTES: tInt }, Double: { MAX_VALUE: tDouble, MIN_VALUE: tDouble, POSITIVE_INFINITY: tDouble, NEGATIVE_INFINITY: tDouble, NaN: tDouble }, Float: { MAX_VALUE: tFloat, MIN_VALUE: tFloat }, Short: { MAX_VALUE: tShort, MIN_VALUE: tShort }, Byte: { MAX_VALUE: tByte, MIN_VALUE: tByte }, Character: { MAX_VALUE: tChar, MIN_VALUE: tChar }, Math: { PI: tDouble, E: tDouble }, Boolean: { TRUE: tBool, FALSE: tBool }, BigInteger: { ZERO: { n: "BigInteger" }, ONE: { n: "BigInteger" }, TWO: { n: "BigInteger" }, TEN: { n: "BigInteger" } }, BigDecimal: { ZERO: { n: "BigDecimal" }, ONE: { n: "BigDecimal" }, TEN: { n: "BigDecimal" } }, System: { out: { n: "PrintStream" }, err: { n: "PrintStream" }, in: { n: "InputStream" } }, RoundingMode: { UP: UNK, DOWN: UNK, HALF_UP: UNK, HALF_DOWN: UNK, HALF_EVEN: UNK, FLOOR: UNK, CEILING: UNK } };
const LIBCLASSES = new Set(["Integer", "Long", "Double", "Float", "Short", "Byte", "Character", "Boolean", "Math", "System", "String", "Arrays", "Collections", "Objects", "List", "Set", "Map", "Optional", "OptionalInt", "OptionalDouble", "Collectors", "IntStream", "LongStream", "DoubleStream", "Stream", "Thread", "BigInteger", "BigDecimal", "RoundingMode", "Comparator", "Function", "UnaryOperator", "TimeUnit", "Entry", "AbstractMap", "ThreadLocalRandom", "Executors", "LocalDate", "EnumSet", "Pattern", "Duration", "Instant", "StandardCharsets"]);
const NEWCLASSES = new Set(["ArrayList", "LinkedList", "Vector", "Stack", "ArrayDeque", "PriorityQueue", "HashSet", "LinkedHashSet", "TreeSet", "HashMap", "LinkedHashMap", "TreeMap", "Hashtable", "ConcurrentHashMap", "EnumMap", "StringBuilder", "StringBuffer", "Scanner", "BufferedReader", "InputStreamReader", "StringTokenizer", "Random", "Thread", "AtomicInteger", "AtomicLong", "AtomicBoolean", "AtomicReference", "BigInteger", "BigDecimal", "Object", "PrintWriter", "BufferedWriter", "OutputStreamWriter", "StringReader", "CopyOnWriteArrayList", "SimpleEntry", "AbstractMap.SimpleEntry", "Integer", "Double", "Long", "String", "Boolean", "Character", "Scanner"]);
const isKnownType = (n, comp) => !!(LIB[n] || FI[n] || BOXOF[n] || n === "String" || n === "Object" || comp.classes.has(n) || EXCNAMES.has(n) || NEWCLASSES.has(n));
const EXCNAMES = new Set(Object.keys(EXC));
class Compiler {
  constructor(units) {
    this.units = units; this.classes = new Map(); this.errors = []; this.order = []; this.idc = 0; this.anonc = 0; this.tmpc = 0; this.out = [];
    this.mnames = new Map(); this.lamc = 0;
  }
  err(line, msg) { this.errors.push({ line, msg }); }
  // ---------- class table ----------
  declare(d, outer, ctx) {
    const ci = { name: d.name, js: "J_" + d.name.replace(/[^\w$]/g, "_"), decl: d, kind: d.kind, outer: outer || null, id: ++this.idc, fields: new Map(), methods: new Map(), ctors: [], tparams: (d.tparams || []).map((t) => t.n), anon: !!d.anon, local: !!ctx, abstract: d.mods.has("abstract") || d.kind === "interface", isStatic: !outer || d.mods.has("static") || d.kind !== "class" || (outer && outer.kind === "interface"), sup: null, supName: null, supType: null, ifaces: [], enumConsts: d.consts || [], members: [] };
    if (d.kind === "interface") ci.isIface = true;
    if (!d.anon) { if (this.classes.has(d.name) && !ctx) this.err(d.line, "duplicate class: " + d.name); this.classes.set(d.name, ci); } else { ci.js += "_" + ci.id; }
    if (ci.local && !ci.isStatic) ci.isStatic = true; // local classes capture via closure, not $outer
    this.order.push(ci);
    for (const m of d.members) if (m.k === "class") this.declare(m, ci, null);
    return ci;
  }
  tpScope(ci, mtp) { const s = new Set(mtp || []); for (let c = ci; c; c = c.outer) c.tparams.forEach((t) => s.add(t)); return s; }
  rt(t, ci, mtp, ctx) { // resolve AST type to semantic type
    if (!t) return UNK;
    if (t.arr) return { arr: this.rt(t.arr, ci, mtp, ctx) };
    if (PRIMT[t.n]) return PRIMT[t.n];
    let n = t.n; if (n.includes(".")) { const p = n.split("."); n = p[p.length - 1]; if (p[p.length - 2] === "Map" && n === "Entry") n = "Entry"; }
    if (this.curTP && this.curTP.has(n)) return { n, tv: true };
    if (ctx && ctx.tps && ctx.tps.has(n)) return { n, tv: true };
    const r = { n }; if (t.a) r.a = t.a.map((x) => this.rt(x, ci, mtp, ctx));
    return r;
  }
  resolveClass(ci) {
    if (ci.resolved) return; ci.resolved = true; const d = ci.decl; this.curTP = this.tpScope(ci);
    if (d.ext) { const st = this.rt(d.ext, ci); ci.supType = st; if (this.classes.has(st.n)) { ci.sup = this.classes.get(st.n); this.resolveClass(ci.sup); } else ci.supName = st.n; }
    for (const i of d.impls) { const it = this.rt(i, ci); ci.ifaces.push(it); }
    if (d.kind === "enum") { ci.supName = "$Enum"; }
    if (d.kind === "record") ci.supName = "$Record";
    if (d.anon && d.ext === null && d.impls.length === 0) {}
    this.curTP = this.tpScope(ci);
    const addMethod = (m) => { if (!ci.methods.has(m.name)) ci.methods.set(m.name, []); ci.methods.get(m.name).push(m); };
    if (d.kind === "record") for (const rc of d.rec) { const t = this.rt(rc.type, ci); ci.fields.set(rc.name, { t, static: false, js: "_" + rc.name, owner: ci, final: true }); if (!d.members.some((m) => m.k === "method" && m.name === rc.name && m.params.length === 0)) addMethod({ name: rc.name, params: [], pnames: [], ret: t, static: false, abstract: false, cls: ci, accessor: rc.name, tparams: [], line: d.line }); }
    for (const c of d.enumConsts || d.consts || []) ci.fields.set(c.name, { t: { n: ci.name }, static: true, js: c.name, owner: ci, enumConst: true });
    for (const m of d.members) {
      if (m.k === "field") { const t = this.rt(m.type, ci); ci.fields.set(m.name, { t, static: m.mods.has("static"), js: "_" + m.name + (!m.mods.has("static") && (() => { for (let s = ci.sup; s; s = s.sup) { const f = s.fields.get(m.name); if (f && !f.static) return true; } return false; })() ? "$" + ci.id : ""), owner: ci, final: m.mods.has("final"), decl: m }); }
      else if (m.k === "method") {
        const mtp = (m.tparams || []).map((t) => t.n); const save = this.curTP; this.curTP = this.tpScope(ci, mtp);
        const params = m.params.map((p) => this.rt(p.type, ci, mtp)); const ret = this.rt(m.ret, ci, mtp); this.curTP = save;
        addMethod({ name: m.name, params, pnames: m.params.map((p) => p.name), ret, static: m.mods.has("static"), abstract: !m.body, cls: ci, decl: m, varargs: m.params.length > 0 && m.params[m.params.length - 1].varargs, tparams: mtp, line: m.line, isDefault: d.kind === "interface" && !!m.body });
      } else if (m.k === "ctor") {
        const params = m.params === null ? d.rec.map((r) => this.rt(r.type, ci)) : m.params.map((p) => this.rt(p.type, ci)); ci.ctors.push({ params, pnames: m.params === null ? d.rec.map((r) => r.name) : m.params.map((p) => p.name), decl: m, varargs: m.params && m.params.length > 0 && m.params[m.params.length - 1].varargs, cls: ci, line: m.line });
      }
    }
    if (d.kind === "enum") { ci.methods.set("values", [{ name: "values", params: [], pnames: [], ret: { arr: { n: ci.name } }, static: true, cls: ci, tparams: [], builtin: true }]); ci.methods.set("valueOf", [{ name: "valueOf", params: [tStr], pnames: ["s"], ret: { n: ci.name }, static: true, cls: ci, tparams: [], builtin: true }]); }
    if (d.kind === "enum") for (const [nm, rt0, ps] of [["ordinal", tInt, []], ["name", tStr, []], ["compareTo", tInt, [{ n: ci.name }]], ["getDeclaringClass", UNK, []]]) { if (!ci.methods.has(nm)) addMethod({ name: nm, params: ps, pnames: ps.map((_, i) => "o" + i), ret: rt0, static: false, cls: ci, tparams: [], decl: null, line: d.line }); }
    if (!ci.ctors.length && d.kind === "record") ci.ctors.push({ params: d.rec.map((r) => this.rt(r.type, ci)), pnames: d.rec.map((r) => r.name), decl: null, auto: true, cls: ci, line: d.line });
    ci.ctors.forEach((c, i) => { c.idx = i; });
  }
  // mangling
  computeMangling() {
    const byName = new Map();
    for (const ci of this.order) for (const [n, ms] of ci.methods) for (const m of ms) { if (m.builtin) continue; if (!byName.has(n)) byName.set(n, []); byName.get(n).push(m); }
    const CANON = new Set(["toString/0", "equals/1", "hashCode/0", "compareTo/1", "compare/2", "run/0", "call/0", "get/0", "apply/1", "apply/2", "accept/1", "accept/2", "test/1", "test/2", "iterator/0", "hasNext/0", "next/0", "close/0", "getMessage/0", "length/0", "charAt/1", "size/0", "applyAsInt/1", "applyAsInt/2", "applyAsDouble/1", "getAsInt/0", "remove/0", "clone/0", "removeEldestEntry/1"]);
    const sig = (m) => m.params.map((p) => tName(isUnk(p) ? tObj : (p.a ? { n: p.n } : p))).join(",");
    for (const [n, ms] of byName) {
      const arities = new Set(ms.map((m) => m.params.length)); 
      const typeOver = new Set(); // arities with true overloading in a single class
      for (const ci of this.order) { const own = (ci.methods.get(n) || []).filter((m) => !m.builtin); const seen = new Map(); for (const m of own) { const a = m.params.length; if (!seen.has(a)) seen.set(a, new Set()); seen.get(a).add(sig(m)); } for (const [a, s] of seen) if (s.size > 1) typeOver.add(a); }
      for (const m of ms) {
        const a = m.params.length; let js = n;
        if (typeOver.has(a)) { const s = sig(m); const isObjSig = m.params.every((p) => isUnk(p) || p.n === "Object"); js = CANON.has(n + "/" + a) && isObjSig ? n : n + "$" + m.params.map((p) => tName(isUnk(p) ? tObj : (p.a ? { n: p.n } : p)).replace(/[\[\]]/g, "A")).join("$"); }
        else if (arities.size > 1 && !CANON.has(n + "/" + a)) js = n + "$" + a;
        m.js = JSRES.has(js) || /^(constructor)$/.test(js) ? js + "$" : js;
        if (m.static && /^(name|length)$/.test(m.js)) m.js += "$";
      }
    }
  }
  isSubClass(a, b) { // user classes
    for (let c = a; c; c = c.sup) { if (c === b) return true; if (this.implementsI(c, b)) return true; }
    return false;
  }
  implementsI(c, b) { for (const it of c.ifaces) { const ic = this.classes.get(it.n); if (ic) { if (ic === b || this.implementsI(ic, b)) return true; } } return false; }
  // type relations (for overload scoring)
  typeSub(from, to) { // can ref `from` be assigned to `to`; true/false/null(unknown)
    if (isUnk(to) || isUnk(from) || to.n === "Object") return true;
    if (from.n === "null") return true;
    if (from.arr || to.arr) { if (from.arr && to.arr) return this.typeSub(from.arr, to.arr) !== false || (isPrim(from.arr) && isPrim(to.arr) && from.arr.n === to.arr.n); return false; }
    if (from.n === to.n) return true;
    const fc = this.classes.get(from.n), tc = this.classes.get(to.n);
    if (fc && tc) return this.isSubClass(fc, tc);
    if (fc && !tc) { for (let c = fc; c; c = c.sup) { if (c.supName === to.n) return true; if (c.supName && libParents(c.supName).includes(to.n)) return true; for (const it of c.ifaces) if (it.n === to.n || libParents(it.n).includes(to.n) ) return true; if (c.supName && EXC[c.supName] && EXC[to.n]) return EXC[c.supName].$all.has(EXC[to.n]); } return to.n === "Object" ? true : (LIB[to.n] || FI[to.n] || EXC[to.n]) ? false : null; }
    if (!fc && tc) return false;
    if (EXC[from.n] && EXC[to.n]) return EXC[from.n].$all.has(EXC[to.n]);
    if (libParents(from.n).includes(to.n)) return true;
    if (to.n === "Number" && BOXOF[from.n] && from.n !== "Character" && from.n !== "Boolean") return true;
    if (to.n === "Comparable" && (BOXOF[from.n] || from.n === "String")) return true;
    if (to.n === "CharSequence" && (from.n === "String" || from.n === "StringBuilder")) return true;
    if ((LIB[from.n] || BOXOF[from.n] || from.n === "String") && (LIB[to.n] || BOXOF[to.n] || to.n === "String")) return false;
    return null;
  }
  score(from, to) { // -1 not applicable
    if (from === "lambda") return isUnk(to) || to.n === "Object" ? 6 : (FI[to.n] || this.classes.get(to.n) || LIB[to.n] ? 1 : -1);
    if (isUnk(to)) return isPrim(from) ? 5 : 3; if (isUnk(from)) return 4;
    if (isPrim(to)) {
      if (isPrim(from)) { if (from.n === to.n) return 0; if (from.n === "boolean" || to.n === "boolean") return -1; const rf = RANK[from.n], rt = RANK[to.n]; if (to.n === "char") return -1; if (from.n === "char" && rt >= 3) return 1 + rt - 3; if (from.n === "char") return -1; if (rt > rf) return rt - rf; return -1; }
      const u = unboxT(from); if (isPrim(u)) { const s = this.score(u, to); return s < 0 ? -1 : s + 10; } if (from.n === "Object" || from.n === "Number" || from.n === "Comparable") return -1; return -1;
    }
    if (isPrim(from)) { const b = boxT(from); if (b.n === to.n) return 10; if (to.n === "Object" || to.n === "Number" && from.n !== "boolean" && from.n !== "char" || to.n === "Comparable") return 12; if (BOXOF[to.n]) return -1; return -1; }
    const r = this.typeSub(from, to); return r === true ? (from.n === to.n ? 0 : 1) : r === null ? 8 : -1;
  }
  findMethods(ci, name, out, seen) {
    out = out || []; seen = seen || new Set(); if (!ci || seen.has(ci)) return out; seen.add(ci); this.resolveClass(ci);
    for (const m of ci.methods.get(name) || []) out.push(m);
    if (ci.sup) this.findMethods(ci.sup, name, out, seen);
    for (const it of ci.ifaces) { const ic = this.classes.get(it.n); if (ic) this.findMethods(ic, name, out, seen); }
    if (ci.kind === "interface" || ci.abstract) {}
    return out;
  }
  pickMethod(cands, argTypes) {
    let best = null, bestS = Infinity;
    for (const m of cands) {
      const n = m.params.length; let total = 0, ok = true;
      if (m.varargs) {
        if (argTypes.length < n - 1) continue;
        // try fixed-arity match first when lengths equal and last arg is array
        let ok1 = argTypes.length === n; let t1 = 0;
        if (ok1) { for (let i = 0; i < n; i++) { const s = this.score(argTypes[i], m.params[i]); if (s < 0) { ok1 = false; break; } t1 += s; } }
        if (ok1) { total = t1; } else {
          for (let i = 0; i < n - 1; i++) { const s = this.score(argTypes[i], m.params[i]); if (s < 0) { ok = false; break; } total += s; }
          if (ok) { const et = m.params[n - 1].arr; for (let i = n - 1; i < argTypes.length; i++) { const s = this.score(argTypes[i], et); if (s < 0) { ok = false; break; } total += s; } total += 20; }
          if (!ok) continue;
        }
      } else {
        if (n !== argTypes.length) continue;
        for (let i = 0; i < n; i++) { const s = this.score(argTypes[i], m.params[i]); if (s < 0) { ok = false; break; } total += s; }
        if (!ok) continue;
      }
      if (total < bestS) { best = m; bestS = total; }
    }
    return best;
  }

  // ---------- conversions ----------
  boxCode(c, t) { if (!isPrim(t)) return c; switch (t.n) { case "double": return "$bd(" + c + ")"; case "float": return "$bf(" + c + ")"; case "char": return "$bc(" + c + ")"; } return c; }
  unboxCode(c, from, to) { // from ref/unk to primitive `to`
    const k = to.n; const u = unboxT(from);
    if (isPrim(u) && u.n === k && from.n !== "Object") { return (k === "double" || k === "float") ? "$nn(" + c + ").v" : k === "char" ? "$nn(" + c + ").v" : "$nn(" + c + ")"; }
    switch (k) { case "int": case "short": case "byte": return "$ui(" + c + ")"; case "long": return "$ul(" + c + ")"; case "double": return "$ud(" + c + ")"; case "float": return "$uf(" + c + ")"; case "char": return "$uc(" + c + ")"; case "boolean": return "$ub(" + c + ")"; }
    return c;
  }
  primConv(c, f, t, cv) { // prim -> prim (widening or cast-narrowing), f,t type names
    if (f === t) return c;
    const fi = f === "int" || f === "short" || f === "byte" || f === "char";
    switch (t) {
      case "double": return f === "long" ? "Number(" + c + ")" : c;
      case "float": return f === "long" ? "Math.fround(Number(" + c + "))" : f === "double" ? "Math.fround(" + c + ")" : fi ? "Math.fround(" + c + ")" : c;
      case "long": return f === "double" || f === "float" ? "$d2l(" + c + ")" : (cv !== undefined && /^-?\d+$/.test(c) ? c + "n" : "BigInt(" + c + ")");
      case "int": return f === "long" ? "Number(BigInt.asIntN(32," + c + "))" : f === "double" || f === "float" ? "$d2i(" + c + ")" : c;
      case "char": return f === "long" ? "Number(BigInt.asUintN(16," + c + "))" : f === "double" || f === "float" ? "($d2i(" + c + ") & 65535)" : "((" + c + ") & 65535)";
      case "short": return f === "long" ? "Number(BigInt.asIntN(16," + c + "))" : f === "double" || f === "float" ? "($d2i(" + c + ") << 16 >> 16)" : "((" + c + ") << 16 >> 16)";
      case "byte": return f === "long" ? "Number(BigInt.asIntN(8," + c + "))" : f === "double" || f === "float" ? "($d2i(" + c + ") << 24 >> 24)" : "((" + c + ") << 24 >> 24)";
    }
    return c;
  }
  conv(e, to, line, how) { // e: {c,t,cv}; returns code. how: 'assign'|'arg'|'return'|'cast'
    const from = e.t; const c = e.c; if (!to || to.n === "void") return c;
    if (from === "lambda") return c;
    if (isPrim(to)) {
      if (isPrim(from)) {
        if (from.n === to.n) return c;
        if (from.n === "boolean" || to.n === "boolean") { this.err(line, "incompatible types: " + from.n + " cannot be converted to " + to.n); return c; }
        if (how !== "cast") {
          const narrowing = RANK[to.n] < RANK[from.n] || (to.n === "char" && from.n !== "char") || (from.n === "char" && (to.n === "short" || to.n === "byte")) || (to.n === "short" && from.n === "byte" && false);
          if (narrowing) { if (e.cv !== undefined && (from.n === "int" || from.n === "short" || from.n === "char" || from.n === "byte") && typeof e.cv === "number" && ((to.n === "byte" && e.cv >= -128 && e.cv <= 127) || (to.n === "short" && e.cv >= -32768 && e.cv <= 32767) || (to.n === "char" && e.cv >= 0 && e.cv <= 65535))) return c; this.err(line, "incompatible types: possible lossy conversion from " + from.n + " to " + to.n); return c; }
          if (to.n === "float" && from.n === "double") { this.err(line, "incompatible types: possible lossy conversion from double to float"); return c; }
        }
        return this.primConv(c, from.n, to.n, e.cv);
      }
      if (from.n === "String" || (this.classes.has(from.n) && !from.tv) || from.arr) { this.err(line, "incompatible types: " + tName(from) + " cannot be converted to " + to.n); return c; }
      if (from.n === "null") { this.err(line, "incompatible types: <null> cannot be converted to " + to.n); return c; }
      const u = unboxT(from);
      if (isPrim(u) && !isUnk(from)) { const k = this.unboxCode(c, from, u); return u.n === to.n ? k : this.primConv(k, u.n, to.n); }
      return this.unboxCode(c, from, to);
    }
    // to reference
    if (isPrim(from)) {
      if (to.n === "String" && !to.tv) { this.err(line, "incompatible types: " + from.n + " cannot be converted to String"); return c; }
      const bt = BOXOF[to.n];
      if (bt && bt !== from.n && how !== "cast") { if (e.cv !== undefined && typeof e.cv === "number" && (bt === "byte" || bt === "short" || bt === "char")) return c; this.err(line, "incompatible types: " + from.n + " cannot be converted to " + to.n); return c; }
      if (bt === "long") return c; if (bt === "double" && from.n !== "double") return this.boxCode(this.primConv(c, from.n, "double"), tDouble);
      if (this.classes.has(to.n) && !to.tv) { this.err(line, "incompatible types: " + from.n + " cannot be converted to " + to.n); return c; }
      return this.boxCode(c, from);
    }
    if (to.n === "String" && !to.tv && !isUnk(from) && from.n !== "null" && from.n !== "String" && from.n !== "Object" && (BOXOF[from.n] || this.classes.has(from.n)) && !from.tv) this.err(line, "incompatible types: " + tName(from) + " cannot be converted to String");
    else if (!isUnk(from) && !isUnk(to) && from.n !== "null" && how !== "cast" && this.typeSub(from, to) === false && !(from.arr && !to.arr && to.n === "Object")) { if ((this.classes.has(from.n) || this.classes.has(to.n) || from.n === "String" || to.n === "String" || BOXOF[from.n] || BOXOF[to.n]) && !from.arr && !to.arr) this.err(line, "incompatible types: " + tName(from) + " cannot be converted to " + tName(to)); }
    return c;
  }
  strOf(e) { // string conversion of expression for concat
    const t = e.t; if (t === "lambda") return "$str(" + e.c + ")";
    if (t.arr && !t.arr.arr && t.arr.n === "char") return "$str(" + e.c + ")";
    if (isPrim(t)) { switch (t.n) { case "char": return e.cv !== undefined && typeof e.cv === "number" ? JSON.stringify(String.fromCharCode(e.cv)) : "$cstr(" + e.c + ")"; case "double": return "$dstr(" + e.c + ")"; case "float": return "$fstr(" + e.c + ")"; case "boolean": case "int": case "long": case "short": case "byte": return "String(" + e.c + ")"; } }
    if (t.n === "String" && !t.tv) return e.k === "lit" ? e.c : "$sstr(" + e.c + ")";
    return "$str(" + e.c + ")";
  }
  boxE(e) { return isPrim(e.t) ? this.boxCode(e.c, e.t) : e.c; }
  // ---------- scopes ----------
  lookupVar(ctx, name) {
    for (let i = ctx.frames.length - 1; i >= 0; i--) {
      const f = ctx.frames[i];
      if (f.locals) { const v = f.locals.get(name); if (v) return { kind: "local", v }; }
      else if (f.ci) { const r = this.findField(f.ci, name); if (r) return { kind: "field", f: r, frame: f, idx: i }; }
    }
    return null;
  }
  findField(ci, name, seen) {
    seen = seen || new Set(); if (!ci || seen.has(ci)) return null; seen.add(ci); this.resolveClass(ci);
    if (ci.fields.has(name)) return ci.fields.get(name);
    if (ci.sup) { const r = this.findField(ci.sup, name, seen); if (r) return r; }
    for (const it of ci.ifaces) { const ic = this.classes.get(it.n); if (ic) { const r = this.findField(ic, name, seen); if (r) return r; } }
    return null;
  }
  newTmp(ctx) { const n = "$t" + (++ctx.fr.tmp); ctx.fr.tmps.add(n); return n; }
  classRef(ci, ctx) { return ci.js; }
  needInit(ci) { return ci.needInit; }
  initPrefix(ci, ctx) { // code to ensure class initialized when accessed from outside
    if (!ci.needInit) return ""; for (let i = ctx.frames.length - 1; i >= 0; i--) { const f = ctx.frames[i]; if (f.ci && (f.ci === ci || (!ci.isIface && this.isSubClass(f.ci, ci)))) return ""; }
    return ci.js + ".$ci(), ";
  }
  // ---------- expressions ----------
  ex(n, ctx, expect) {
    const r = this.ex0(n, ctx, expect);
    if (!r.t) r.t = UNK; return r;
  }
  ex0(n, ctx, expect) {
    switch (n.k) {
      case "lit": return this.lit(n);
      case "paren": { const r = this.ex(n.e, ctx, expect); return { c: "(" + r.c + ")", t: r.t, cv: r.cv }; }
      case "name": return this.name(n, ctx);
      case "this": {
        if (n.qual) { const q = this.ex(n.qual, ctx); const ci = q.cls; if (ci) { for (let i = ctx.frames.length - 1; i >= 0; i--) { const f = ctx.frames[i]; if (f.ci === ci) return { c: this.frameThis(f, ctx), t: { n: ci.name } }; } } return { c: "this", t: UNK }; }
        const f = this.curClassFrame(ctx); if (!f || f.static) { this.err(n.line, "non-static variable this cannot be referenced from a static context"); return { c: "null", t: UNK }; }
        return { c: "this", t: this.selfType(f.ci) };
      }
      case "field": return this.field(n, ctx);
      case "idx": {
        const a = this.ex(n.arr, ctx), i = this.ex(n.i, ctx); const it = this.indexConv(i, n.line);
        if (!a.t.arr && !isUnk(a.t)) { this.err(n.line, "array required, but " + tName(a.t) + " found"); return { c: "null", t: UNK }; }
        const et = a.t.arr || UNK;
        if (/^[\w$.]+$/.test(a.c) && /^[\w$.]+$/.test(it)) return { c: a.c + "[$ci(" + a.c + "," + it + ")]", t: et };
        return { c: "$ai(" + a.c + "," + it + ")", t: et };
      }
      case "bin": return this.binary(n, ctx);
      case "un": return this.unary(n, ctx);
      case "pre": case "post": return this.incdec(n, ctx, false);
      case "assign": return this.assign(n, ctx, false);
      case "cond": return this.cond(n, ctx, expect);
      case "cast": return this.cast(n, ctx);
      case "inst": return this.instanceOf(n, ctx);
      case "call": return this.call(n, ctx, expect);
      case "new": return this.newObj(n, ctx, expect);
      case "newarr": return this.newArr(n, ctx);
      case "arrinit": return this.arrInit(n, ctx, expect && expect.arr ? expect : { arr: UNK });
      case "lambda": return this.lambda(n, ctx, expect);
      case "mref": return this.mref(n, ctx, expect);
      case "switchx": return this.switchExpr(n, ctx, expect);
      case "classlit": return { c: "$cls(" + JSON.stringify(n.e ? (n.e.id || "Object") : tName(this.rt(n.type, null))) + ")", t: { n: "Class" } };
      case "ctorcall": this.err(n.line, "call to " + n.which + " must be first statement in constructor"); return { c: "null", t: UNK };
    }
    this.err(n.line, "unsupported expression"); return { c: "null", t: UNK };
  }
  indexConv(i, line) { const t = i.t; if (isPrim(t)) { if (t.n === "long" || t.n === "double" || t.n === "float" || t.n === "boolean") { this.err(line, "incompatible types: possible lossy conversion from " + t.n + " to int"); } return i.c; } return this.unboxCode(i.c, t, tInt); }
  selfType(ci) { return { n: ci.name, a: ci.tparams.length ? ci.tparams.map((p) => ({ n: p, tv: true })) : undefined }; }
  curClassFrame(ctx) { for (let i = ctx.frames.length - 1; i >= 0; i--) if (ctx.frames[i].ci) return ctx.frames[i]; return null; }
  frameThis(f, ctx) { return f.thisExpr; }
  lit(n) {
    switch (n.kind) {
      case "int": { let s = n.v, v; if (/^-?0[xX]/.test(s)) { v = Number(BigInt.asIntN(32, BigInt(s.replace("-", "")))); if (s[0] === "-") v = -v | 0; } else if (/^-?0[bB]/.test(s)) { v = Number(BigInt.asIntN(32, BigInt(s.replace("-", "")))); if (s[0] === "-") v = -v | 0; } else if (/^-?0\d+$/.test(s)) v = parseInt(s, 8) * (s[0] === "-" ? 1 : 1); else { v = Number(s); if (v > 2147483647 || v < -2147483648) { this.err(n.line, "integer number too large"); v = 0; } } return { c: v < 0 ? "(" + v + ")" : String(v), t: tInt, cv: v, k: "lit" }; }
      case "long": { let s = n.v.replace(/^-/, ""); const neg = n.v[0] === "-"; let v = BigInt(/^0\d+$/.test(s) ? "0o" + s.slice(1) : s); if (neg) v = -v; if (/^0[xXbB]/.test(s)) v = BigInt.asIntN(64, v); return { c: "(" + v + "n)", t: tLong, cv: v, k: "lit" }; }
      case "double": { const v = parseFloat(n.v); return { c: v < 0 ? "(" + String(v) + ")" : (Object.is(v, Infinity) ? "Infinity" : String(v)), t: tDouble, cv: v, k: "lit" }; }
      case "float": { const v = Math.fround(parseFloat(n.v)); return { c: String(v), t: tFloat, cv: v, k: "lit" }; }
      case "char": return { c: String(n.v), t: tChar, cv: n.v, k: "lit" };
      case "string": return { c: JSON.stringify(n.v).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"), t: tStr, cv: n.v, k: "lit" };
      case "boolean": return { c: String(n.v), t: tBool, cv: n.v, k: "lit" };
      case "null": return { c: "null", t: NUL, k: "lit" };
    }
  }
  name(n, ctx) {
    const r = this.lookupVar(ctx, n.id);
    if (r) {
      if (r.kind === "local") return { c: r.v.js, t: r.v.t, cv: r.v.cv };
      const f = r.f, fr = r.frame;
      if (f.static) { return { c: this.initPrefix(f.owner, ctx) ? "(" + this.initPrefix(f.owner, ctx) + f.owner.js + "." + f.js + ")" : f.owner.js + "." + f.js, t: this.fieldType(f, null), cv: f.cv }; }
      if (fr.static) { this.err(n.line, "non-static variable " + n.id + " cannot be referenced from a static context"); return { c: "null", t: UNK }; }
      return { c: this.frameThis(fr, ctx) + "." + f.js, t: this.fieldType(f, null) };
    }
    // class name?
    const ci = this.classes.get(n.id); if (ci) return { c: ci.js, t: UNK, cls: ci };
    if (LIBCLASSES.has(n.id) || LIB[n.id] || EXC[n.id] || NEWCLASSES.has(n.id) || FI[n.id]) return { c: "$L." + n.id, t: UNK, lib: n.id };
    this.err(n.line, "cannot find symbol\n  symbol:   variable " + n.id); return { c: "null", t: UNK };
  }
  fieldType(f, recvT) { let t = f.t; if (recvT && recvT.a && f.owner.tparams.length) { const map = {}; f.owner.tparams.forEach((p, i) => { map[p] = recvT.a[i] || UNK; }); t = this.substU(t, map); } return t; }
  substU(t, map) { if (!t) return t; if (t.arr) return { arr: this.substU(t.arr, map) }; if (t.tv) return map[t.n] || UNK; if (t.a) return { n: t.n, a: t.a.map((x) => this.substU(x, map)) }; return t; }
  field(n, ctx) {
    const o = n.obj;
    // qualified names like System.out, Outer.Inner
    const r = this.ex(o, ctx);
    if (o.asSuper) { const cf = this.curClassFrame(ctx); const sf = cf && cf.ci.sup ? this.findField(cf.ci.sup, n.name) : null; if (sf && !sf.static) return { c: r.c + "." + sf.js, t: this.fieldType(sf, null) }; }
    if (r.cls) {
      const ci = r.cls; this.resolveClass(ci); const f = this.findField(ci, n.name);
      if (f) { if (f.enumConst) return { c: (this.initPrefix(f.owner, ctx) ? "(" + this.initPrefix(f.owner, ctx) : "(") + (f.owner.js + "." + f.js) + ")", t: { n: f.owner.name } }; if (!f.static) { this.err(n.line, "non-static variable " + n.name + " cannot be referenced from a static context"); } return { c: "(" + this.initPrefix(f.owner, ctx) + f.owner.js + "." + f.js + ")", t: f.t, cv: f.cv }; }
      const inner = this.classes.get(n.name); if (inner && inner.outer === ci) return { c: inner.js, t: UNK, cls: inner };
      if (n.name === "length") {}
      this.err(n.line, "cannot find symbol\n  symbol:   variable " + n.name + "\n  location: class " + ci.name); return { c: "null", t: UNK };
    }
    if (r.lib) {
      const sf = STATIC_FIELDS[r.lib] && STATIC_FIELDS[r.lib][n.name];
      if (sf) { let c = "$L." + r.lib + "." + n.name; if (r.lib === "System" && n.name === "in") c = "$L.System.in"; return { c, t: sf }; }
      if (r.lib === "Map" && n.name === "Entry" || r.lib === "AbstractMap") return { c: "$L." + (n.name === "Entry" ? "Entry" : n.name), t: UNK, lib: n.name };
      if (LIB[n.name] || NEWCLASSES.has(n.name)) return { c: "$L." + n.name, t: UNK, lib: n.name };
      this.err(n.line, "cannot find symbol\n  symbol:   variable " + n.name + "\n  location: class " + r.lib); return { c: "null", t: UNK };
    }
    if (r.t.arr) { if (n.name === "length") return { c: r.c + ".length", t: tInt }; this.err(n.line, "cannot find symbol\n  symbol:   variable " + n.name); return { c: "null", t: UNK }; }
    if (isPrim(r.t)) { this.err(n.line, r.t.n + " cannot be dereferenced"); return { c: "null", t: UNK }; }
    const ci = this.classes.get(r.t.n);
    if (ci && !r.t.tv) { const f = this.findField(ci, n.name); if (f) return { c: (f.static ? f.owner.js : r.c) + "." + f.js, t: this.fieldType(f, r.t) }; this.err(n.line, "cannot find symbol\n  symbol:   variable " + n.name + "\n  location: variable of type " + ci.name); return { c: "null", t: UNK }; }
    if (n.name === "length" && isUnk(r.t)) return { c: "$len(" + r.c + ")", t: tInt };
    // unknown receiver: dynamic field access on a user object
    const cands = []; for (const c of this.order) { const f = c.fields && this.findField(c, n.name); if (f && !f.static && !cands.includes(f)) cands.push(f); }
    if (cands.length) return { c: r.c + "." + cands[0].js, t: cands[0].t.tv ? UNK : cands[0].t };
    this.err(n.line, "cannot find symbol\n  symbol:   variable " + n.name); return { c: "null", t: UNK };
  }
  // ---------- operators ----------
  numOperand(e, line, op) {
    const t = e.t; if (isPrim(t)) return e; const u = unboxT(t);
    if (isPrim(u) && !isUnk(t)) return { c: this.unboxCode(e.c, t, u), t: u };
    return null;
  }
  binary(n, ctx) {
    const op = n.op;
    if (op === "&&" || op === "||") { const a = this.ex(n.l, ctx), b = this.ex(n.r, ctx); this.needBool(a, n.line, op, b); return { c: "(" + this.boolC(a) + " " + op + " " + this.boolC(b) + ")", t: tBool }; }
    const a = this.ex(n.l, ctx), b = this.ex(n.r, ctx);
    return this.binop(op, a, b, n.line);
  }
  boolC(e) { return isPrim(e.t) ? e.c : (e.t.n === "Boolean" ? "$nn(" + e.c + ")" : e.c); }
  needBool(a, line, op, b) { for (const e of [a, b]) if (isPrim(e.t) && e.t.n !== "boolean" || e.t.n === "String") { this.err(line, "bad operand types for binary operator '" + op + "'\n  first type:  " + tName(a.t) + "\n  second type: " + tName(b.t)); return; } }
  binop(op, a, b, line) {
    const bad = () => { this.err(line, "bad operand types for binary operator '" + op + "'\n  first type:  " + tName(a.t) + "\n  second type: " + tName(b.t)); return { c: "null", t: UNK }; };
    if (op === "+" && ((a.t.n === "String" && !a.t.tv) || (b.t.n === "String" && !b.t.tv))) {
      if (a.t === tVoid || b.t === tVoid) return bad();
      const cv = a.cv !== undefined && b.cv !== undefined && !isNaN(1) && (typeof a.cv === "string" || typeof b.cv === "string") && (a.k === "lit" && b.k === "lit") ? undefined : undefined;
      return { c: "(" + this.strOf(a) + " + " + this.strOf(b) + ")", t: tStr };
    }
    if (op === "==" || op === "!=") return this.equality(op, a, b, line);
    const A = this.numOperand(a, line, op), B = this.numOperand(b, line, op);
    if (op === "&" || op === "|" || op === "^") {
      if (A && B && A.t.n === "boolean" && B.t.n === "boolean") return { c: op === "^" ? "(" + A.c + " !== " + B.c + ")" : "!!(" + A.c + " " + op + " " + B.c + ")", t: tBool };
    }
    if (A && B) {
      if (A.t.n === "boolean" || B.t.n === "boolean") return bad();
      const pt = promote(A.t, B.t);
      const isShift = op === "<<" || op === ">>" || op === ">>>";
      if (isShift) {
        const lt = A.t.n === "long" ? tLong : tInt; if (A.t.n === "double" || A.t.n === "float" || B.t.n === "double" || B.t.n === "float") return bad();
        const cnt = B.t.n === "long" ? "Number(" + B.c + ")" : B.c;
        if (lt === tLong) return { c: (op === "<<" ? "$lshl(" : op === ">>" ? "$lshr(" : "$lushr(") + A.c + "," + cnt + ")", t: tLong };
        return { c: op === ">>>" ? "((" + A.c + " >>> " + cnt + ") | 0)" : "(" + A.c + " " + op + " " + cnt + ")", t: tInt };
      }
      const cc = (e) => (pt.n === "long" ? this.primConv(e.c, e.t.n, "long", e.cv) : pt.n === "float" ? this.primConv(e.c, e.t.n, "float") : e.t.n === "long" && pt.n === "double" ? "Number(" + e.c + ")" : e.c);
      const x = cc(A), y = cc(B);
      let cv; const fold = A.cv !== undefined && B.cv !== undefined && typeof A.cv === "number" && typeof B.cv === "number";
      switch (op) {
        case "+": case "-": case "*": {
          if (pt.n === "int") { const r = op === "*" ? "Math.imul(" + x + ", " + y + ")" : "((" + x + " " + op + " " + y + ") | 0)"; if (fold) cv = op === "*" ? Math.imul(A.cv, B.cv) : op === "+" ? (A.cv + B.cv) | 0 : (A.cv - B.cv) | 0; return { c: r, t: tInt, cv }; }
          if (pt.n === "long") return { c: "$LW(" + x + " " + op + " " + y + ")", t: tLong };
          if (pt.n === "float") return { c: "Math.fround(" + x + " " + op + " " + y + ")", t: tFloat };
          return { c: "(" + x + " " + op + " " + y + ")", t: tDouble, cv: fold && A.t.n !== "int" ? undefined : undefined };
        }
        case "/": if (pt.n === "int") { if (B.cv === 0) return { c: "$idiv(" + x + "," + y + ")", t: tInt }; return { c: B.cv !== undefined && B.cv !== 0 ? "((" + x + " / " + y + ") | 0)" : "$idiv(" + x + "," + y + ")", t: tInt }; } if (pt.n === "long") return { c: "$ldiv(" + x + "," + y + ")", t: tLong }; if (pt.n === "float") return { c: "Math.fround(" + x + " / " + y + ")", t: tFloat }; return { c: "(" + x + " / " + y + ")", t: tDouble };
        case "%": if (pt.n === "int") return { c: B.cv !== undefined && B.cv !== 0 ? "((" + x + " % " + y + ") | 0)" : "$imod(" + x + "," + y + ")", t: tInt }; if (pt.n === "long") return { c: "$lmod(" + x + "," + y + ")", t: tLong }; return { c: pt.n === "float" ? "Math.fround(" + x + " % " + y + ")" : "(" + x + " % " + y + ")", t: pt };
        case "<": case ">": case "<=": case ">=": return { c: "(" + A.c + " " + op + " " + B.c + ")", t: tBool };
        case "&": case "|": case "^": if (pt.n === "double" || pt.n === "float") return bad(); return { c: "(" + x + " " + op + " " + y + ")", t: pt, cv: fold && pt.n === "int" ? (op === "&" ? A.cv & B.cv : op === "|" ? A.cv | B.cv : A.cv ^ B.cv) : undefined };
      }
      return bad();
    }
    // dynamic path (unknown / boxed generic operands)
    if ((A || isUnk(a.t) || a.t.n === "Object" || a.t.n === "Number" || a.t.n === "Comparable") && (B || isUnk(b.t) || b.t.n === "Object" || b.t.n === "Number" || b.t.n === "Comparable")) {
      const r = "$dyn(" + JSON.stringify(op) + "," + this.boxE(a) + "," + this.boxE(b) + ")";
      return { c: r, t: ["<", ">", "<=", ">="].includes(op) ? tBool : UNK };
    }
    if (op === "+" && (a.t.n === "Object" || b.t.n === "Object")) return bad();
    return bad();
  }
  equality(op, a, b, line) {
    const neg = op === "!=";
    const ta = a.t, tb = b.t;
    if (ta === tVoid || tb === tVoid) { this.err(line, "'void' type not allowed here"); return { c: "false", t: tBool }; }
    const bothPrim = isPrim(ta) && isPrim(tb);
    if (bothPrim) {
      if ((ta.n === "boolean") !== (tb.n === "boolean")) { this.err(line, "incomparable types: " + ta.n + " and " + tb.n); return { c: "false", t: tBool }; }
      const mixedLong = (ta.n === "long") !== (tb.n === "long") && ta.n !== "boolean";
      if (mixedLong) return { c: "(" + a.c + (neg ? " != " : " == ") + b.c + ")", t: tBool };
      return { c: "(" + a.c + (neg ? " !== " : " === ") + b.c + ")", t: tBool };
    }
    if (isPrim(ta) || isPrim(tb)) {
      const p = isPrim(ta) ? a : b, r = isPrim(ta) ? b : a;
      if (r.t.n === "null") { this.err(line, "bad operand types for binary operator '" + op + "'\n  first type:  " + tName(a.t) + "\n  second type: " + tName(b.t)); return { c: "false", t: tBool }; }
      if (r.t.n === "String" || (this.classes.has(r.t.n) && !r.t.tv)) { this.err(line, "bad operand types for binary operator '" + op + "'\n  first type:  " + tName(a.t) + "\n  second type: " + tName(b.t)); return { c: "false", t: tBool }; }
      const u = unboxT(r.t);
      if (isPrim(u) && !isUnk(r.t)) return { c: "(" + (isPrim(ta) ? a.c : this.unboxCode(a.c, ta, u)) + (neg ? " != " : " == ") + (isPrim(tb) ? b.c : this.unboxCode(b.c, tb, u)) + ")", t: tBool };
      return { c: (neg ? "!" : "") + "$dyn(\"==\"," + this.boxE(a) + "," + this.boxE(b) + ")", t: tBool };
    }
    // refs
    if (ta.n === "null" || tb.n === "null") return { c: "(" + a.c + (neg ? " != " : " == ") + b.c + ")", t: tBool };
    const ua = unboxT(ta), ub = unboxT(tb);
    if ((BOXOF[ta.n] && BOXOF[tb.n]) || isUnk(ta) || isUnk(tb)) { return { c: (neg ? "!" : "") + "$refeq(" + a.c + "," + b.c + ")", t: tBool }; }
    if (!isUnk(ta) && !isUnk(tb) && this.typeSub(ta, tb) === false && this.typeSub(tb, ta) === false && !LIB[ta.n] && !LIB[tb.n] ) { if ((this.classes.has(ta.n) && !this.classes.get(ta.n).isIface && this.classes.has(tb.n) && !this.classes.get(tb.n).isIface) || ta.n === "String" && this.classes.has(tb.n) || tb.n === "String" && this.classes.has(ta.n)) this.err(line, "incomparable types: " + tName(ta) + " and " + tName(tb)); }
    return { c: "(" + a.c + (neg ? " !== " : " === ") + b.c + ")", t: tBool };
  }
  unary(n, ctx) {
    const e = this.ex(n.e, ctx); const op = n.op;
    if (op === "!") { if ((isPrim(e.t) && e.t.n !== "boolean") || e.t.n === "String") { this.err(n.line, "bad operand type " + tName(e.t) + " for unary operator '!'"); return { c: "false", t: tBool }; } return { c: "(!" + this.boolC(e) + ")", t: tBool }; }
    const A = this.numOperand(e, n.line, op);
    if (!A) { if (isUnk(e.t)) return { c: op === "-" ? "$dynneg(" + e.c + ")" : e.c, t: UNK }; this.err(n.line, "bad operand type " + tName(e.t) + " for unary operator '" + op + "'"); return { c: "0", t: UNK }; }
    if (A.t.n === "boolean") { this.err(n.line, "bad operand type boolean for unary operator '" + op + "'"); return { c: "0", t: UNK }; }
    const pt = promote(A.t, tInt);
    const c = A.t.n === "int" || A.t.n === "long" || A.t.n === "double" || A.t.n === "float" ? A.c : A.c;
    if (op === "+") return { c: "(+" + c + ")", t: pt, cv: A.cv };
    if (op === "-") { if (pt.n === "int") return { c: "(-" + c + " | 0)", t: tInt, cv: A.cv !== undefined ? -A.cv | 0 : undefined }; if (pt.n === "long") return { c: "$LW(-" + c + ")", t: tLong }; return { c: "(-" + c + ")", t: pt, cv: A.cv !== undefined ? -A.cv : undefined }; }
    if (op === "~") { if (pt.n === "double" || pt.n === "float") { this.err(n.line, "bad operand type " + pt.n + " for unary operator '~'"); return { c: "0", t: UNK }; } return { c: "(~" + c + ")", t: pt, cv: A.cv !== undefined && pt.n === "int" ? ~A.cv : undefined }; }
  }
  // lvalues
  lvalue(n, ctx) {
    if (n.k === "paren") return this.lvalue(n.e, ctx);
    if (n.k === "name") {
      const r = this.lvalue_name(n, ctx); return r;
    }
    if (n.k === "field") {
      const o = this.ex(n.obj, ctx);
      if (o.cls || o.lib) { const e = this.field(n, ctx); const code = e.c.replace(/^\((?:[^()]*, )?([\w$.]+)\)$/, "$1"); return { get: e.c, set: (v) => "(" + this.initPrefix(o.cls || { needInit: false }, ctx) + code + " = " + v + ")", t: e.t, pre: "", cls: o.cls, fin: e.fin }; }
      const ci = this.classes.get(o.t.n); let f = ci && !o.t.tv ? this.findField(ci, n.name) : null;
      if (o.t.arr && n.name === "length") { this.err(n.line, "cannot assign a value to final variable length"); }
      if (!f) { const e = this.field(n, ctx); return { get: e.c, set: (v) => "(" + e.c + " = " + v + ")", t: e.t, pre: "" }; }
      let objc = o.c, pre = "";
      if (!/^[\w$]+$/.test(objc) && objc !== "this") { const t = this.newTmp(ctx); pre = t + " = " + objc + ", "; objc = t; }
      const base = (f.static ? f.owner.js : objc) + "." + f.js;
      return { get: base, set: (v) => "(" + base + " = " + v + ")", t: this.fieldType(f, o.t), pre, fieldInfo: f };
    }
    if (n.k === "idx") {
      const a = this.ex(n.arr, ctx), i = this.ex(n.i, ctx); const it = this.indexConv(i, n.line); const et = a.t.arr || UNK;
      if (!a.t.arr && !isUnk(a.t)) this.err(n.line, "array required, but " + tName(a.t) + " found");
      const ta = this.newTmp(ctx), ti = this.newTmp(ctx);
      return { get: ta + "[" + ti + "]", set: (v) => "(" + ta + "[" + ti + "] = " + v + ")", t: et, pre: ta + " = " + a.c + ", " + ti + " = $ci(" + ta + "," + it + "), ", arrElem: true };
    }
    this.err(n.line, "unexpected type\n  required: variable\n  found:    value"); return { get: "null", set: (v) => v, t: UNK, pre: "" };
  }
  lvalue_name(n, ctx) {
    const r = this.lookupVar(ctx, n.id);
    if (!r) { this.err(n.line, "cannot find symbol\n  symbol:   variable " + n.id); return { get: "null", set: (v) => v, t: UNK, pre: "" }; }
    if (r.kind === "local") { if (r.v.final && r.v.assigned) this.err(n.line, "cannot assign a value to final variable " + n.id); if (r.v.cap) {} return { get: r.v.js, set: (v) => "(" + r.v.js + " = " + v + ")", t: r.v.t, pre: "", local: r.v }; }
    const f = r.f, fr = r.frame;
    if (f.static) { const base = f.owner.js + "." + f.js; return { get: base, set: (v) => "(" + this.initPrefix(f.owner, ctx) + base + " = " + v + ")", t: f.t, pre: "", fieldInfo: f }; }
    if (fr.static) { this.err(n.line, "non-static variable " + n.id + " cannot be referenced from a static context"); return { get: "null", set: (v) => v, t: UNK, pre: "" }; }
    const base = this.frameThis(fr, ctx) + "." + f.js; return { get: base, set: (v) => "(" + base + " = " + v + ")", t: f.t, pre: "", fieldInfo: f };
  }
  wrapOp(t, c) { switch (t.n) { case "int": return "((" + c + ") | 0)"; case "char": return "((" + c + ") & 65535)"; case "byte": return "((" + c + ") << 24 >> 24)"; case "short": return "((" + c + ") << 16 >> 16)"; case "long": return "$LW(" + c + ")"; case "float": return "Math.fround(" + c + ")"; } return c; }
  incdec(n, ctx, unused) {
    const lv = this.lvalue(n.e, ctx); const t = unboxT(lv.t);
    if (!isNumP(t) && !isUnk(lv.t)) { this.err(n.line, "bad operand type " + tName(lv.t) + " for unary operator '" + n.op + "'"); return { c: "0", t: UNK }; }
    if (lv.fieldInfo && lv.fieldInfo.final && !ctx.inCtor) this.err(n.line, "cannot assign a value to final variable " + (lv.fieldInfo.name || ""));
    const one = t.n === "long" ? "1n" : "1"; const sign = n.op === "++" ? "+" : "-";
    const boxed = !isPrim(lv.t); const getU = boxed ? this.unboxCode(lv.get, lv.t, t) : lv.get;
    const mkNew = (g) => { const w = this.wrapOp(t, g + " " + sign + " " + one); return boxed ? this.boxCode(w, t) : w; };
    if (n.k === "pre" || unused) return { c: "(" + lv.pre + lv.set(mkNew(getU)) + ")", t: lv.t };
    const tv = this.newTmp(ctx);
    return { c: "(" + lv.pre + tv + " = " + lv.get + ", " + lv.set(mkNew(boxed ? this.unboxCode(tv, lv.t, t) : tv)) + ", " + tv + ")", t: lv.t };
  }
  assign(n, ctx, unused) {
    const lv = this.lvalue(n.l, ctx);
    if (lv.local && lv.local.final) { if (lv.local.assigned) this.err(n.line, "cannot assign a value to final variable " + n.l.id); lv.local.assigned = true; }
    if (lv.fieldInfo && lv.fieldInfo.final && lv.fieldInfo.decl && lv.fieldInfo.decl.init && !ctx.inCtor) this.err(n.line, "cannot assign a value to final variable " + n.l.name);
    if (lv.fieldInfo && lv.fieldInfo.final && !lv.fieldInfo.decl) { if (!ctx.inCtor) this.err(n.line, "cannot assign a value to final variable " + (n.l.name || n.l.id)); }
    if (n.op === "=") {
      const r = this.ex(n.r, ctx, lv.t);
      return { c: "(" + lv.pre + lv.set(this.conv(r, lv.t, n.line, "assign")) + ")", t: lv.t };
    }
    const op = n.op.slice(0, -1); const r = this.ex(n.r, ctx);
    const cur = { c: lv.get, t: lv.t };
    if (op === "+" && lv.t.n === "String" && !lv.t.tv) return { c: "(" + lv.pre + lv.set("(" + this.strOf(cur) + " + " + this.strOf(r) + ")") + ")", t: lv.t };
    const res = this.binop(op, cur, r, n.line);
    // implicit narrowing cast back to lvalue type
    const target = unboxT(lv.t);
    let code = res.c;
    if (isPrim(res.t) && isPrim(target)) code = this.primConv(res.c, res.t.n, target.n);
    else if (isUnk(lv.t)) code = res.c;
    else if (isPrim(res.t) && !isPrim(target)) { code = res.c; }
    if (!isPrim(lv.t) && isPrim(target) && isPrim(res.t)) code = this.boxCode(code, target);
    else if (!isPrim(lv.t) && !isUnk(lv.t) && isPrim(res.t)) code = this.boxCode(code, res.t);
    else if (isUnk(lv.t) && isPrim(res.t)) code = this.boxCode(code, res.t);
    if (lv.t.n === "boolean" && (op === "&" || op === "|" || op === "^")) code = res.c;
    return { c: "(" + lv.pre + lv.set(code) + ")", t: lv.t };
  }
  cond(n, ctx, expect) {
    const c = this.ex(n.c, ctx); if ((isPrim(c.t) && c.t.n !== "boolean") || c.t.n === "String") this.err(n.line, "incompatible types: " + tName(c.t) + " cannot be converted to boolean");
    const a = this.ex(n.a, ctx, expect), b = this.ex(n.b, ctx, expect);
    let t, ac = a.c, bc = b.c;
    const ua = unboxT(a.t), ub = unboxT(b.t);
    if (a.t === "lambda" || b.t === "lambda") t = expect || UNK;
    else if (isPrim(a.t) && isPrim(b.t)) { if (a.t.n === b.t.n) t = a.t; else if (a.t.n === "boolean" || b.t.n === "boolean") { t = tObj; ac = this.boxE(a); bc = this.boxE(b); } else { t = promote(a.t, b.t); if ((a.t.n === "char" && b.cv !== undefined && typeof b.cv === "number" && b.t.n === "int") ) t = tChar; else if (b.t.n === "char" && a.cv !== undefined && a.t.n === "int") t = tChar; ac = this.primConv(a.c, a.t.n, t.n, a.cv); bc = this.primConv(b.c, b.t.n, t.n, b.cv); } }
    else if (isPrim(ua) && isPrim(ub) && (isPrim(a.t) || isPrim(b.t)) && !isUnk(a.t) && !isUnk(b.t)) { t = ua.n === ub.n ? ua : promote(ua, ub); ac = isPrim(a.t) ? a.c : this.unboxCode(a.c, a.t, ua); bc = isPrim(b.t) ? b.c : this.unboxCode(b.c, b.t, ub); ac = this.primConv(ac, ua.n, t.n); bc = this.primConv(bc, ub.n, t.n); }
    else if (a.t.n === "null") t = isPrim(b.t) ? boxT(b.t) : b.t;
    else if (b.t.n === "null") t = isPrim(a.t) ? boxT(a.t) : a.t;
    else { ac = this.boxE(a); bc = this.boxE(b); t = a.t.n === b.t.n && !a.t.tv ? (isPrim(a.t) ? boxT(a.t) : a.t) : (isUnk(a.t) ? b.t : isUnk(b.t) ? a.t : this.lub(a.t, b.t)); }
    return { c: "(" + this.boolC(c) + " ? " + ac + " : " + bc + ")", t };
  }
  lub(a, b) { if (this.typeSub(a, b) === true) return b; if (this.typeSub(b, a) === true) return a; const ca = this.classes.get(a.n), cb = this.classes.get(b.n); if (ca && cb) { for (let c = ca.sup; c; c = c.sup) if (this.isSubClass(cb, c)) return { n: c.name }; } return a.n === "String" || b.n === "String" ? tObj : UNK; }
  cast(n, ctx) {
    const to = this.rt(n.type, ctx.ci, null, ctx); const e = this.ex(n.e, ctx, to);
    if (e.t === "lambda") return { c: e.c, t: to };
    if (isPrim(to)) {
      if (isPrim(e.t)) { if ((to.n === "boolean") !== (e.t.n === "boolean")) { this.err(n.line, "incompatible types: " + e.t.n + " cannot be converted to " + to.n); return { c: e.c, t: to }; } return { c: this.primConv(e.c, e.t.n, to.n, e.cv), t: to, cv: e.cv !== undefined && typeof e.cv === "number" && e.t.n !== "long" && e.t.n !== "double" && e.t.n !== "float" && (to.n === "int" || to.n === "char" || to.n === "short" || to.n === "byte") ? this.foldCast(e.cv, to.n) : undefined }; }
      if (e.t.n === "String" || e.t.arr) { this.err(n.line, "incompatible types: " + tName(e.t) + " cannot be converted to " + to.n); return { c: e.c, t: to }; }
      const u = unboxT(e.t); if (isPrim(u) && !isUnk(e.t)) return { c: this.primConv(this.unboxCode(e.c, e.t, u), u.n, to.n), t: to };
      return { c: this.unboxCode(e.c, e.t, to), t: to };
    }
    if (isPrim(e.t)) { const bt = BOXOF[to.n]; if (bt && bt !== e.t.n && (e.t.n !== "int" || true)) { if (bt === e.t.n) return { c: this.boxE(e), t: to }; this.err(n.line, "incompatible types: " + e.t.n + " cannot be converted to " + to.n); return { c: e.c, t: to }; } return { c: this.boxE(e), t: to }; }
    const ci = this.classes.get(to.n);
    if (ci && !to.tv) { if (!isUnk(e.t) && e.t.n !== "Object" && this.typeSub(e.t, to) === false && this.typeSub(to, e.t) === false && this.classes.has(e.t.n) && !this.classes.get(e.t.n).isIface && !ci.isIface) this.err(n.line, "incompatible types: " + tName(e.t) + " cannot be converted to " + tName(to)); return { c: "$cast(" + e.c + ", " + ci.js + ")", t: to }; }
    if (to.n === "String" && !to.tv) { if (!isUnk(e.t) && e.t.n !== "Object" && e.t.n !== "String" && (this.classes.has(e.t.n) || BOXOF[e.t.n])) this.err(n.line, "incompatible types: " + tName(e.t) + " cannot be converted to String"); return { c: "$castS(" + e.c + ")", t: to }; }
    if (BOXOF[to.n] && !to.tv) return { c: "$castB(" + e.c + "," + JSON.stringify(to.n) + ")", t: to };
    return { c: e.c, t: to };
  }
  foldCast(v, k) { switch (k) { case "int": return v | 0; case "char": return v & 65535; case "short": return v << 16 >> 16; case "byte": return v << 24 >> 24; } return v; }
  instTest(code, t) { // JS boolean test for runtime type t
    if (t.arr) return "$isArr(" + code + ")";
    const ci = this.classes.get(t.n); if (ci && !t.tv) return ci.isIface ? "$isI(" + code + "," + ci.js + ")" : "(" + code + " instanceof " + ci.js + ")";
    return "$instLib(" + code + "," + JSON.stringify(t.n) + ")";
  }
  instanceOf(n, ctx) {
    const e = this.ex(n.e, ctx); const t = this.rt(n.type, ctx.ci, null, ctx);
    if (isPrim(e.t)) { this.err(n.line, "unexpected type\n  required: reference\n  found:    " + e.t.n); return { c: "false", t: tBool }; }
    if (!isUnk(e.t) && !isUnk(t) && this.typeSub(e.t, t) === false && this.typeSub(t, e.t) === false && (this.classes.has(e.t.n) && !this.classes.get(e.t.n).isIface && this.classes.has(t.n) && !this.classes.get(t.n).isIface || (e.t.n === "String" && this.classes.has(t.n)) || (t.n === "String" && this.classes.has(e.t.n) && !this.classes.get(e.t.n).isIface))) this.err(n.line, "incompatible types: " + tName(e.t) + " cannot be converted to " + tName(t));
    if (!n.bind) return { c: this.instTest(e.c, t), t: tBool };
    const js = this.declareLocal(ctx, n.bind, t, n.line, true); const tmp = js;
    return { c: "(" + this.instTest("(" + js + " = " + e.c + ")", t).replace("(" + js + " = " + e.c + ")", "(" + js + " = " + e.c + ")") + ")", t: tBool };
  }
  declareLocal(ctx, name, t, line, hoist) {
    const frame = ctx.frames[ctx.frames.length - 1];
    // duplicate check across enclosing locals frames within the same function
    for (let i = ctx.frames.length - 1; i >= 0 && i >= ctx.fnBase; i--) { const f = ctx.frames[i]; if (f.locals && f.locals.has(name) && !hoist) { this.err(line, "variable " + name + " is already defined in method " + (ctx.mname || "main") + "(" + (ctx.msig || "String[]") + ")"); break; } if (f.ci) break; }
    let js = jsId(name);
    if (hoist) { js = js; ctx.fr.hoist.add(js); }
    const v = { t, js, name }; frame.locals.set(name, v); return js;
  }

  // ---------- calls ----------
  argInfos(args, ctx) { return args.map((a) => (a.k === "lambda" || a.k === "mref") ? { lazy: true, n: a, t: "lambda" } : this.ex(a, ctx)); }
  finishArg(a, ctx, expect) { if (a.lazy) { const r = this.ex(a.n, ctx, expect); return r; } return a; }
  retInfer(m, args, recvT) { // return type with substitution
    let map = {}; if (recvT && recvT.a && m.cls.tparams.length) m.cls.tparams.forEach((p, i) => { map[p] = recvT.a[i] || UNK; });
    for (const tp of m.tparams || []) { map[tp] = UNK; m.params.forEach((p, i) => { const a = args[i]; if (!a || a.t === "lambda") return; if (p.tv && p.n === tp && !p.arr) map[tp] = boxT(a.t); else if (p.arr && p.arr.tv && p.arr.n === tp && a.t.arr) map[tp] = boxT(a.t.arr); else if (p.a && a.t.a) p.a.forEach((q, j) => { if (q.tv && q.n === tp && a.t.a[j]) map[tp] = a.t.a[j]; }); }); }
    return this.substU(m.ret, map);
  }
  paramType(m, i, recvT, args) { let p = m.params[i]; if (m.varargs && i >= m.params.length - 1) p = m.params[m.params.length - 1]; let map = {}; if (recvT && recvT.a && m.cls.tparams.length) m.cls.tparams.forEach((q, j) => { map[q] = recvT.a[j] || UNK; }); return this.substU(p, map); }
  buildArgs(m, infos, ctx, recvT, line) {
    const n = m.params.length; const out = [];
    const useVar = m.varargs && !(infos.length === n && infos[n - 1].t !== "lambda" && (infos[n - 1].t.arr || infos[n - 1].t.n === "null") && this.score(infos[n - 1].t, m.params[n - 1]) >= 0);
    const fixed = useVar ? n - 1 : n;
    for (let i = 0; i < fixed; i++) { const pt = this.paramType(m, i, recvT); const a = this.finishArg(infos[i], ctx, pt); out.push(this.conv(a, pt, line, "arg")); }
    if (useVar) { const et = m.params[n - 1].arr; const rest = []; for (let i = n - 1; i < infos.length; i++) { const a = this.finishArg(infos[i], ctx, et); rest.push(this.conv(a, et, line, "arg")); } const k = elemKind(m.params[n - 1]); out.push(k === "obj" ? "[" + rest.join(", ") + "]" : "$mkArr(" + JSON.stringify(k) + ", [" + rest.join(", ") + "])"); }
    return out;
  }
  describeArgs(infos) { return infos.map((a) => a.t === "lambda" ? "lambda" : tName(a.t)).join(","); }
  userCall(n, ctx, ci, cands, recv, recvT, infos, staticOnly, viaSuper) {
    const m = this.pickMethod(cands, infos.map((a) => a.t));
    if (!m) {
      const arityOk = cands.filter((c) => c.params.length === infos.length || c.varargs);
      if (cands.length === 1) this.err(n.line, "method " + n.name + " in class " + cands[0].cls.name + " cannot be applied to given types;\n  required: " + (cands[0].params.length ? cands[0].params.map(tName).join(",") : "no arguments") + "\n  found:    " + (infos.length ? this.describeArgs(infos) : "no arguments") + "\n  reason: " + (cands[0].params.length !== infos.length ? "actual and formal argument lists differ in length" : "argument mismatch"));
      else this.err(n.line, "no suitable method found for " + n.name + "(" + this.describeArgs(infos) + ")");
      return { c: "null", t: UNK };
    }
    if (m.builtin) { const arg = infos[0] ? this.finishArg(infos[0], ctx, tStr).c : ""; return { c: (this.initPrefix(m.cls, ctx) ? "(" + this.initPrefix(m.cls, ctx) : "(") + m.cls.js + "." + (m.name === "values" ? "$values()" : "$valueOf(" + arg + ")") + ")", t: m.ret }; }
    const args = this.buildArgs(m, infos, ctx, recvT, n.line); const rt = this.retInfer(m, infos, recvT);
    if (m.accessor) return { c: recv + "." + m.accessor ? recv + "._" + m.accessor : "", t: rt };
    if (m.static) return { c: "(" + this.initPrefix(m.cls, ctx) + m.cls.js + "." + m.js + "(" + args.join(", ") + "))", t: rt };
    if (viaSuper) return { c: "super." + m.js + "(" + args.join(", ") + ")", t: rt };
    if (staticOnly) { this.err(n.line, "non-static method " + n.name + "(" + m.params.map(tName).join(",") + ") cannot be referenced from a static context"); return { c: "null", t: rt }; }
    if (m.abstract && viaSuper) {}
    return { c: recv + "." + m.js + "(" + args.join(", ") + ")", t: rt };
  }
  call(n, ctx, expect) {
    const name = n.name;
    if (!n.obj) {
      const infos = this.argInfos(n.args, ctx);
      for (let i = ctx.frames.length - 1; i >= 0; i--) {
        const f = ctx.frames[i]; if (!f.ci) continue; const cands = this.findMethods(f.ci, name);
        if (cands.length) { const st = f.static; const m0 = this.pickMethod(cands, infos.map((a) => a.t)); const needInst = m0 && !m0.static; return this.userCall(n, ctx, f.ci, cands, this.frameThis(f, ctx), this.selfType(f.ci), infos, st && needInst); }
        // inherited from lib superclass (e.g. getMessage())
        if (this.libSuperHas(f.ci, name)) { const rt = (libMember({ n: "Throwable" }, name) || {}).t || UNK; return { c: this.frameThis(f, ctx) + "." + name + "(" + infos.map((a) => this.boxE(this.finishArg(a, ctx))).join(", ") + ")", t: rt }; }
      }
      if (["getClass", "hashCode", "toString", "equals"].includes(name)) { const f = this.curClassFrame(ctx); return { c: "this." + name + "(" + infos.map((a) => this.boxE(a)).join(", ") + ")", t: name === "getClass" ? { n: "Class" } : name === "toString" ? tStr : name === "equals" ? tBool : tInt }; }
      this.err(n.line, "cannot find symbol\n  symbol:   method " + name + "(" + this.describeArgs(infos) + ")"); return { c: "null", t: UNK };
    }
    if (n.obj.k === "super") {
      const f = this.curClassFrame(ctx); const ci = f.ci; const infos = this.argInfos(n.args, ctx);
      if (ci.sup) { const cands = this.findMethods(ci.sup, name); if (cands.length) return this.userCall(n, ctx, ci.sup, cands, "super", this.selfType(ci.sup), infos, false, true); }
      for (const it of ci.ifaces) { const ic = this.classes.get(it.n); if (ic) { const cands = this.findMethods(ic, name); if (cands.length) return this.userCall(n, ctx, ic, cands, "super", this.selfType(ic), infos, false, true); } }
      const rt = (libMember({ n: ci.supName === "$Enum" ? "Object" : ci.supName && LIB[ci.supName] ? ci.supName : "Throwable" }, name) || libMember({ n: "Object" }, name) || {}).t || UNK;
      return { c: "super." + name + "(" + infos.map((a) => this.boxE(a)).join(", ") + ")", t: rt };
    }
    const r = this.ex(n.obj, ctx);
    const infos = this.argInfos(n.args, ctx);
    if (r.cls) {
      const ci = r.cls; const cands = this.findMethods(ci, name);
      if (cands.length) return this.userCall(n, ctx, ci, cands, ci.js, null, infos, false);
      if (ci.supName && LIB[ci.supName]) {}
      this.err(n.line, "cannot find symbol\n  symbol:   method " + name + "(" + this.describeArgs(infos) + ")\n  location: class " + ci.name); return { c: "null", t: UNK };
    }
    if (r.lib) return this.staticLib(n, ctx, r.lib, infos);
    return this.instCall(n, ctx, r, infos, expect);
  }
  libSuperHas(ci, name) { for (let c = ci; c; c = c.sup) { if (c.supName && c.supName !== "$Enum" && c.supName !== "$Record") { const L = libMember({ n: LIB[c.supName] ? c.supName : "Throwable" }, name); if (L) return true; } } return false; }
  convAllBoxed(infos, ctx) { return infos.map((a) => this.boxE(this.finishArg(a, ctx))); }
  instCall(n, ctx, r, infos, expect) {
    const name = n.name; const t = r.t; const line = n.line;
    if (isPrim(t)) { this.err(line, t.n + " cannot be dereferenced"); return { c: "null", t: UNK }; }
    if (t.arr) { if (name === "clone") return { c: "$cloneArr(" + r.c + ")", t }; if (name === "length") { this.err(line, "cannot find symbol\n  symbol:   method length()\n  location: class " + tName(t)); return { c: "0", t: tInt }; } if (name === "equals") return { c: "(" + r.c + " === " + this.boxE(this.finishArg(infos[0], ctx)) + ")", t: tBool }; if (name === "hashCode") return { c: "$hash(" + r.c + ")", t: tInt }; if (name === "getClass") return { c: "$cls('Array')", t: { n: "Class" } }; this.err(line, "cannot find symbol\n  symbol:   method " + name + "(" + this.describeArgs(infos) + ")"); return { c: "null", t: UNK }; }
    const ci = this.classes.get(t.n);
    if (ci && !t.tv) {
      const cands = this.findMethods(ci, name);
      if (cands.length) return this.userCall(n, ctx, ci, cands, r.c, t, infos, false);
      // functional interface / lib super
      if (this.libSuperHas(ci, name) || ["getClass", "hashCode", "toString", "equals", "compareTo", "name", "ordinal", "getMessage", "getDeclaringClass", "values"].includes(name) || ci.kind === "enum" || ci.kind === "record") {
        const L = libMember(this.libTypeOf(ci), name) || libMember({ n: "Object" }, name); let rt = L ? L.t : UNK;
        if (name === "name") rt = tStr; if (name === "ordinal") rt = tInt; if (name === "compareTo") rt = tInt; if (name === "equals") rt = tBool; if (name === "hashCode") rt = tInt; if (name === "toString") rt = tStr; if (name === "getDeclaringClass") rt = { n: "Class" };
        return { c: r.c + "." + name + "(" + this.convAllBoxed(infos, ctx).join(", ") + ")", t: rt };
      }
      // implements lib interface (Comparable, Runnable, Iterator...)
      for (let c = ci; c; c = c.sup) for (const it of c.ifaces) { if (!this.classes.has(it.n) && (LIB[it.n] || FI[it.n])) { const L = libMember(it, name); if (L) return { c: r.c + "." + name + "(" + this.convAllBoxed(infos, ctx).join(", ") + ")", t: L.t }; } }
      this.err(line, "cannot find symbol\n  symbol:   method " + name + "(" + this.describeArgs(infos) + ")\n  location: variable of type " + ci.name); return { c: "null", t: UNK };
    }
    return this.libInst(n, ctx, r, infos, expect);
  }
  libTypeOf(ci) { for (let c = ci; c; c = c.sup) if (c.supName && LIB[c.supName]) return { n: c.supName }; return { n: "Throwable" }; }
  lamArgs(infos, ctx, ptypes) { // finish args given lambda param types: returns codes (boxed), with lambda typed by FI-less expectation
    return infos.map((a) => this.boxE(a.lazy ? this.ex(a.n, ctx, { n: "$lam", lp: ptypes }) : a));
  }
  libInst(n, ctx, r, infos, expect) {
    const name = n.name, t = r.t, line = n.line; const tn = t.n;
    // function-typed receivers
    if (FI[tn] && !LIB[tn].m[name] || (FI[tn] && FI[tn].m === name)) {
      const f = FI[tn]; if (f.m === name) { const map = {}; f.tp.forEach((p, i) => { map[p] = t.a && t.a[i] ? t.a[i] : UNK; }); const ps = f.p.map((s) => PRIMT[s] || map[s] || UNK); const args = infos.map((a, i) => this.conv(this.finishArg(a, ctx, ps[i]), ps[i], line, "arg")); const rt = f.r === "void" ? tVoid : (PRIMT[f.r] || map[f.r] || UNK); return { c: "$fn(" + r.c + ")(" + args.join(", ") + ")", t: rt }; }
      const args = infos.map((a) => this.boxE(this.finishArg(a, ctx, tn === "Comparator" ? { n: "Comparator", a: t.a } : UNK)));
      let rt = UNK; if (tn === "Comparator" && /^(reversed|thenComparing|thenComparingInt|thenComparingDouble)$/.test(name)) rt = t; else if (/^(andThen|compose|negate|and|or)$/.test(name)) rt = name === "negate" || name === "and" || name === "or" ? t : UNK;
      return { c: "$callf(" + r.c + ", " + JSON.stringify(name) + ", [" + args.join(", ") + "])", t: rt };
    }
    if (tn === "String" && !t.tv) return this.stringCall(n, ctx, r, infos);
    if (tn === "StringBuilder" || tn === "StringBuffer") {
      if (name === "append") { if (infos.length === 3) { return { c: r.c + ".appendS(" + this.strOf(this.finishArg(infos[0], ctx)) + ".substring(" + this.finishArg(infos[1], ctx).c + "," + this.finishArg(infos[2], ctx).c + "))", t }; } if (infos.length !== 1) { this.err(line, "no suitable method found for append"); return { c: "null", t }; } { const fa = this.finishArg(infos[0], ctx); if (fa.t.arr && fa.t.arr.n === "char") return { c: r.c + ".appendS($charsToStr(" + fa.c + "))", t }; return { c: r.c + ".appendS(" + this.strOf(fa) + ")", t }; } }
      if (name === "insert") return { c: r.c + ".insert(" + this.finishArg(infos[0], ctx).c + ", " + this.strOf(this.finishArg(infos[1], ctx)) + ")", t };
      if (name === "equals") return { c: "(" + r.c + " === " + this.boxE(this.finishArg(infos[0], ctx)) + ")", t: tBool };
      const L = libMember(t, name); if (!L) { this.err(line, "cannot find symbol\n  symbol:   method " + name + "(" + this.describeArgs(infos) + ")\n  location: class StringBuilder"); return { c: "null", t: UNK }; }
      return { c: r.c + "." + name + "(" + infos.map((a) => this.finishArg(a, ctx).c).join(", ") + ")", t: L.t };
    }
    if (tn === "PrintStream" || tn === "PrintWriter") {
      if (name === "println" || name === "print") { if (infos.length === 0) return { c: r.c + "." + name + "()", t: tVoid }; const a = this.finishArg(infos[0], ctx); if (a.t === tVoid) { this.err(line, "'void' type not allowed here"); } return { c: r.c + "." + name + "(" + this.strOf(a) + ")", t: tVoid }; }
      if (name === "printf" || name === "format") { const f = this.finishArg(infos[0], ctx); const rest = infos.slice(1).map((a) => this.finishArg(a, ctx)); const spread = rest.length === 1 && rest[0].t.arr && !isPrim(rest[0].t.arr) ? "..." + rest[0].c : rest.map((a) => this.boxE(a)).join(", "); return { c: r.c + ".printf(" + f.c + (rest.length ? ", " + spread : "") + ")", t }; }
    }
    const L = libMember(t, name);
    // list.remove(int) vs remove(Object)
    let jsName = name; const fam = LIB[tn] ? libParents(tn) : [];
    let ptypes = lampTypes(t, name);
    const isList = fam.includes("List");
    let codes;
    if (isList && name === "remove" && infos.length === 1) { const a = infos[0]; if (a.t !== "lambda" && isPrim(a.t) && a.t.n !== "boolean" && a.t.n !== "long" && a.t.n !== "double" && a.t.n !== "float") jsName = "removeAt"; }
    const rawIdx = isList && /^(get|set|add|addAll|subList|listIterator|removeAt)$/.test(jsName) || jsName === "removeAt" || (fam.includes("Collection") && /^(toArray)$/.test(name));
    codes = infos.map((a, i) => {
      if (a.lazy) return this.boxE(this.ex(a.n, ctx, ptypes ? { n: "$lam", lp: ptypes } : UNK));
      if (rawIdx && i === 0 && isPrim(a.t) && a.t.n !== "double" && a.t.n !== "float" && (infos.length === 1 || jsName !== "add" && jsName !== "addAll" || infos.length === 2) && !(jsName === "add" && infos.length === 1) && !(jsName === "addAll" && infos.length === 1)) return a.c;
      if (rawIdx && i === 1 && (jsName === "subList") && isPrim(a.t)) return a.c;
      if (tn === "Optional" || tn.startsWith("Optional") && false) return this.boxE(a);
      if (/^(IntStream|DoubleStream|LongStream)$/.test(tn) && isPrim(a.t) && (name === "limit" || name === "skip")) return tn === "x" ? a.c : (a.t.n === "int" ? a.c : "Number(" + a.c + ")");
      if (/^(Stream)$/.test(tn) && (name === "limit" || name === "skip") && isPrim(a.t)) return a.t.n === "long" ? "Number(" + a.c + ")" : a.c;
      if (tn === "Random" || tn === "Scanner" || tn === "BufferedReader" || tn === "AtomicInteger" || tn === "AtomicLong" || tn === "BigInteger" || tn === "BigDecimal" || tn === "Thread" || tn === "StringTokenizer" || tn === "Throwable") return this.rawArg(a, tn, name, i);
      return this.boxE(a);
    });
    if (tn === "Optional" || tn === "OptionalDouble" || tn === "OptionalInt") { }
    // identity: equals/hashCode/toString/compareTo on known boxes
    if (BOXOF[tn] || tn === "Number" || tn === "Comparable" || tn === "Object") {
      if (name === "equals" || name === "hashCode" || name === "toString" || name === "compareTo" || name === "getClass" || /Value$/.test(name)) {
        const rc = isPrim(t) ? this.boxCode(r.c, t) : r.c; const bt = BOXOF[tn];
        let rt = (libMember(t, name) || libMember({ n: "Object" }, name) || {}).t || UNK;
        if (/Value$/.test(name) && L) rt = L.t;
        return { c: "$inv(" + rc + ", " + JSON.stringify(name) + ", [" + codes.join(", ") + "])", t: rt };
      }
    }
    if (!L && (isUnk(t) || tn === "Object" || tn === "Comparable" || tn === "Number" || tn === "Iterable" || tn === "CharSequence" || !LIB[tn])) {
      // dynamic call; try nominal user-method guess for unknown receivers
      return this.dynCall(n, ctx, r, infos, codes);
    }
    if (!L && name === "hashCode" && infos.length === 0) return { c: "$hash(" + r.c + ")", t: tInt };
    if (!L && name === "equals" && infos.length === 1) return { c: "$eq(" + r.c + ", " + this.boxE(this.finishArg(infos[0], ctx)) + ")", t: tBool };
    if (!L && name === "toString" && infos.length === 0) return { c: "$str(" + r.c + ")", t: tStr };
    if (!L) { this.err(line, "cannot find symbol\n  symbol:   method " + name + "(" + this.describeArgs(infos) + ")\n  location: variable of type " + tName(t)); return { c: "null", t: UNK }; }
    let rt = L.t;
    // result type refinements
    if ((name === "map" || name === "flatMap" || name === "mapToObj") && infos[0] && infos[0].lazy && /^(Stream|IntStream|DoubleStream|LongStream|Optional)$/.test(tn)) { const lam = this.lastLambdaRet; rt = null; }
    const callCode = r.c + "." + jsName + "(" + codes.join(", ") + ")";
    if ((name === "map" || name === "flatMap" || name === "mapToObj") && /^(Stream|IntStream|DoubleStream|LongStream|Optional)$/.test(tn)) { const lt = this.lastLamRet; if (lt && lt.n && name !== "flatMap") rt = { n: tn === "Optional" ? "Optional" : "Stream", a: [boxT(lt)] }; else rt = { n: tn === "Optional" ? "Optional" : "Stream", a: [UNK] }; }
    if (name === "collect" && tn === "Stream") rt = this.collectType || UNK;
    if (name === "reduce" && /^(IntStream)$/.test(tn)) rt = infos.length === 2 ? tInt : { n: "OptionalInt" };
    if (name === "reduce" && /^(DoubleStream)$/.test(tn)) rt = infos.length === 2 ? tDouble : { n: "OptionalDouble" };
    if (name === "reduce" && /^(LongStream)$/.test(tn)) rt = infos.length === 2 ? tLong : { n: "OptionalLong" };
    if (name === "reduce" && tn === "Stream") rt = infos.length === 1 ? { n: "Optional", a: [t.a && t.a[0] || UNK] } : (t.a && t.a[0] || UNK);
    if (name === "toArray" && tn === "Stream") rt = { arr: UNK };
    if (name === "toArray" && fam.includes("Collection") && infos.length === 1 && infos[0].t && infos[0].t.arr) rt = infos[0].t;
    if ((name === "getOrDefault" || name === "orElse") && rt && isUnk(rt) && infos[0]) { }
    if (/^(sum|min|max)$/.test(name) && tn === "Stream") rt = UNK;
    if ((name === "stream" && /^(Arrays)$/.test(tn))) {}
    return { c: callCode, t: rt, lib: undefined };
  }
  rawArg(a, tn, name, i) { // args to lib classes taking primitives: raw, with long handling
    if (!isPrim(a.t)) return a.c;
    if (tn === "AtomicLong" && a.t.n !== "long") return "BigInt(" + a.c + ")";
    if (tn === "BigInteger" && name === "valueOf") return a.c;
    if (tn === "Random" && name === "setSeed") return a.t.n === "long" ? a.c : "BigInt(" + a.c + ")";
    return a.c;
  }
  dynCall(n, ctx, r, infos, codes) {
    const name = n.name;
    // nominal guess across user classes
    const cands = []; for (const c of this.order) for (const m of this.findMethods(c, name)) if (!m.static && m.params.length === infos.length && !cands.includes(m)) cands.push(m);
    const libMeth = LIB.String.m[name] || LIB.Object.m[name] || LIB.List.m[name] || LIB.Map.m[name] || LIB.Integer.m[name] || LIB.Double.m[name] || LIB.Collection.m[name];
    if (cands.length && (!libMeth || cands.every((c) => c.js === cands[0].js))) {
      const m = cands[0]; const sameRet = cands.every((c) => tName(c.ret) === tName(m.ret));
      const args = infos.map((a, i) => { const pt = m.params[i]; const ptt = pt.tv ? UNK : pt; const aa = this.finishArg(a, ctx, ptt); return isPrim(ptt) ? this.conv(aa, ptt, n.line, "arg") : this.boxE(aa); });
      let c = "$invu(" + r.c + ", " + JSON.stringify(m.js) + ", " + JSON.stringify(name) + ", [" + args.join(", ") + "])"; let rt = sameRet && !m.ret.tv ? m.ret : UNK; if (isPrim(rt)) c = "$unbx(" + c + "," + JSON.stringify(rt.n) + ")";
      return { c, t: rt };
    }
    let rt = UNK; const L = libMember({ n: "Object" }, name); if (L) rt = L.t; else if (libMeth) rt = libMeth;
    if (/^(equals|hasNext|isEmpty|contains|containsKey|startsWith|endsWith|isPresent)$/.test(name)) rt = tBool; else if (/^(hashCode|size|length|compareTo|intValue|indexOf|ordinal)$/.test(name)) rt = tInt; else if (/^(toString|name|getName|getMessage|toUpperCase|toLowerCase|trim)$/.test(name)) rt = tStr; else if (name === "doubleValue") rt = tDouble; else if (name === "longValue") rt = tLong;
    const c = "$inv(" + r.c + ", " + JSON.stringify(name) + ", [" + codes.join(", ") + "])";
    return { c: isPrim(rt) ? "$unbx(" + c + "," + JSON.stringify(rt.n) + ")" : c, t: rt };
  }
  stringCall(n, ctx, r, infos) {
    const name = n.name, line = n.line; const L = libMember({ n: "String" }, name);
    if (!L) { this.err(line, "cannot find symbol\n  symbol:   method " + name + "(" + this.describeArgs(infos) + ")\n  location: class String"); return { c: "null", t: UNK }; }
    const as = infos.map((a) => this.finishArg(a, ctx));
    if (name === "length" && as.length === 0) return { c: r.c + ".length", t: tInt };
    if (name === "equals") return { c: "$S.equals(" + r.c + ", " + this.boxE(as[0]) + ")", t: tBool };
    if (name === "contains" || name === "concat" || name === "compareTo" || name === "equalsIgnoreCase" || name === "compareToIgnoreCase") { if (as[0] && isPrim(as[0].t)) { this.err(line, "incompatible types: " + as[0].t.n + " cannot be converted to " + (name === "contains" ? "CharSequence" : "String")); } }
    if (name === "formatted") return { c: "$S.format(" + r.c + (as.length ? ", " : "") + as.map((a) => this.boxE(a)).join(", ") + ")", t: tStr };
    if (name === "charAt" && as.length === 1 && isPrim(as[0].t) && (as[0].t.n === "long" || as[0].t.n === "double")) this.err(line, "incompatible types: possible lossy conversion from " + as[0].t.n + " to int");
    const args = as.map((a, i) => { if (name === "indexOf" || name === "lastIndexOf" || name === "replace") return isPrim(a.t) ? a.c : a.c; if (name === "repeat" || name === "substring" || name === "charAt" || name === "split" || name === "startsWith") return a.c; return a.c; });
    return { c: "$S." + name + "(" + [r.c].concat(args).join(", ") + ")", t: L.t };
  }
  staticLib(n, ctx, cls, infos) {
    const name = n.name, line = n.line;
    const raw = RAWSTATIC.has(cls); const as = infos.map((a) => a.lazy ? a : a);
    const argc = (a, i) => this.finishArg(a, ctx);
    if (cls === "Math") return this.mathCall(n, ctx, infos);
    if (cls === "String") {
      if (name === "valueOf" || name === "copyValueOf") { const a = this.finishArg(infos[0], ctx); if (a.t.arr && a.t.arr.n === "char") return { c: "$charsToStr(" + a.c + (infos.length === 3 ? ").substring(" + this.finishArg(infos[1], ctx).c + "," + this.finishArg(infos[1], ctx).c + " + " + this.finishArg(infos[2], ctx).c : "") + ")", t: tStr }; return { c: this.strOf(a), t: tStr }; }
      if (name === "format") { const f = this.finishArg(infos[0], ctx); const rest = infos.slice(1).map((a) => this.finishArg(a, ctx)); const spread = rest.length === 1 && rest[0].t.arr && !isPrim(rest[0].t.arr) ? rest[0].c : "[" + rest.map((a) => this.boxE(a)).join(", ") + "]"; return { c: "$fmt(" + f.c + ", " + spread + ")", t: tStr }; }
      if (name === "join") { const sep = this.finishArg(infos[0], ctx); const rest = infos.slice(1).map((a) => this.finishArg(a, ctx)); if (rest.length === 1 && (rest[0].t.arr || !isPrim(rest[0].t) && rest[0].t.n !== "String")) return { c: "$sjoin(" + sep.c + ", " + rest[0].c + ")", t: tStr }; return { c: "$sjoin(" + sep.c + ", [" + rest.map((a) => this.strOf(a)).join(", ") + "])", t: tStr }; }
    }
    const st = STATIC_RET_T[cls] && STATIC_RET_T[cls][name];
    let rt = st !== undefined ? st : UNK;
    let codes;
    if (RAWSTATIC.has(cls) && cls !== "Arrays") {
      codes = infos.map((a, i) => { const x = this.finishArg(a, ctx); if (!isPrim(x.t)) { if (cls === "Character" || cls === "Integer" || cls === "Long" || cls === "Double" || cls === "Boolean" || cls === "System" || cls === "Thread" || cls === "Short" || cls === "Byte" || cls === "Float") { if (x.t.n === "String" || x.t.arr || cls === "System") return x.c; const u = unboxT(x.t); if (isPrim(u)) return this.unboxCode(x.c, x.t, u); } return x.c; } if (cls === "Long" && x.t.n !== "long" && !((name === "parseLong" || name === "toString" || name === "valueOf") && i === 1)) return this.primConv(x.c, x.t.n, "long", x.cv); if (cls === "Long" && x.t.n === "long") return x.c; if ((cls === "Integer" || cls === "Short" || cls === "Byte") && x.t.n === "long" && !/^(valueOf|toString)$/.test(name)) return x.c; if (cls === "Double" && (x.t.n === "long")) return "Number(" + x.c + ")"; if (cls === "Float" && x.t.n === "double") return x.c; return x.c; });
      if (cls === "Integer" && name === "valueOf" && infos.length === 1) { const x = this.finishArg(infos[0], ctx); if (x.t.n === "String") rt = { n: "Integer" }; }
      if (cls === "Character" && /^(isDigit|isLetter|isLetterOrDigit|isUpperCase|isLowerCase|isWhitespace|isAlphabetic|toUpperCase|toLowerCase|getNumericValue|digit)$/.test(name)) { const x = infos[0] && this.finishArg(infos[0], ctx); if (x && x.t === tInt && /^(toUpperCase|toLowerCase)$/.test(name)) rt = tInt; }
      if (cls === "Character" && name === "valueOf") { return { c: "$bc(" + codes[0] + ")", t: { n: "Character" } }; }
      if (cls === "Double" && name === "valueOf") { const x = this.finishArg(infos[0], ctx); return { c: x.t.n === "String" ? "$L.Double.valueOf(" + x.c + ")" : "$bd(" + this.primConv(x.c, x.t.n, "double") + ")", t: { n: "Double" } }; }
      if (cls === "Long" && name === "valueOf") { const x = this.finishArg(infos[0], ctx); return { c: x.t.n === "String" ? "$L.Long.parseLong(" + x.c + ")" : codes[0], t: { n: "Long" } }; }
      if (cls === "Float" && name === "valueOf") { const x = this.finishArg(infos[0], ctx); return { c: x.t.n === "String" ? "$L.Float.valueOf(" + x.c + ")" : "$bf(" + x.c + ")", t: { n: "Float" } }; }
      if (cls === "Integer" && name === "valueOf") rt = { n: "Integer" };
      if ((cls === "Long" && name === "parseLong") || (cls === "Long" && name === "valueOf")) {}
      if (cls === "Integer" && name === "toString" && infos.length === 1) {}
    } else if (cls === "Arrays") {
      const as2 = infos.map((a) => this.finishArg(a, ctx)); const a0 = as2[0];
      if (name === "asList") { codes = as2.map((a) => this.boxE(a)); const e0 = as2.length === 1 && a0.t.arr && !isPrim(a0.t.arr) ? a0.t.arr : (as2.length ? boxT(a0.t) : UNK); rt = { n: "List", a: [e0] }; if (as2.length === 1 && a0.t.arr && !isPrim(a0.t.arr)) codes = [a0.c]; }
      else if (name === "stream") { codes = as2.map((a) => a.c); const et = a0.t.arr; rt = et && isPrim(et) ? { n: et.n === "int" || et.n === "char" ? "IntStream" : et.n === "double" ? "DoubleStream" : "LongStream" } : { n: "Stream", a: [et || UNK] }; }
      else if (name === "copyOf" || name === "copyOfRange") { codes = as2.map((a) => a.c); rt = a0.t; }
      else if (name === "fill") { const et = a0.t.arr || UNK; codes = as2.map((a, i) => (i === as2.length - 1) ? this.conv(a, et, line, "arg") : a.c); }
      else if (name === "sort" || name === "parallelSort") { codes = infos.map((a, i) => a.lazy ? this.boxE(this.ex(a.n, ctx, { n: "Comparator", a: [a0.t.arr || UNK] })) : a.c); }
      else if (name === "setAll") { codes = [a0.c, this.boxE(this.ex(infos[1].n, ctx, { n: "$lam", lp: [tInt] }))]; }
      else codes = as2.map((a) => (isPrim(a.t) ? a.c : a.c));
      if (name === "equals" || name === "deepEquals" ) {}
    } else {
      // boxed-args static libs
      let ptypes = null; if (cls === "Collections" && (name === "sort" || name === "max" || name === "min")) { const a0 = infos[0].t === "lambda" ? null : infos[0]; ptypes = a0 && a0.t.a ? [a0.t.a[0], a0.t.a[0]] : null; }
      if (cls === "Comparator" || cls === "Collectors") ptypes = null;
      const as2 = infos.map((a) => a.lazy ? this.ex(a.n, ctx, ptypes ? { n: "$lam", lp: ptypes } : (cls === "Comparator" && /^comparing/.test(name) ? { n: "$lam", lp: [UNK] } : UNK)) : a);
      codes = as2.map((a, i) => (cls === "Collections" && name === "nCopies" && i === 0) || (cls === "List" || cls === "Set" || cls === "Map" ? false : false) ? a.c : (cls === "Collections" && (name === "swap" || name === "rotate") && i > 0) ? a.c : (cls === "Stream" && name === "iterate" && false) ? a.c : this.boxE(a));
      if (cls === "Collections") { const a0 = as2[0]; if (/^(max|min|unmodifiable\w*|synchronized\w*)$/.test(name)) rt = name === "max" || name === "min" ? (a0.t.a ? a0.t.a[0] : UNK) : a0.t; else if (name === "emptyList") rt = { n: "List", a: [UNK] }; else if (name === "nCopies") rt = { n: "List", a: [boxT(as2[1].t)] }; else if (name === "singletonList") rt = { n: "List", a: [boxT(a0.t)] }; else if (name === "emptyMap") rt = { n: "Map", a: [UNK, UNK] }; else if (name === "emptySet") rt = { n: "Set", a: [UNK] }; else if (name === "reverseOrder") rt = { n: "Comparator", a: [UNK] }; }
      if (cls === "List" || cls === "Set") { if (name === "of" || name === "copyOf") { const e0 = name === "of" && as2.length ? (as2.length === 1 && as2[0].t.arr ? as2[0].t.arr : boxT(as2[0].t)) : (name === "copyOf" && as2[0].t.a ? as2[0].t.a[0] : UNK); rt = { n: cls, a: [e0] }; if (name === "of" && as2.length === 1 && as2[0].t.arr) codes = [as2[0].c]; } }
      if (cls === "Map") { if (name === "of") rt = { n: "Map", a: [as2[0] ? boxT(as2[0].t) : UNK, as2[1] ? boxT(as2[1].t) : UNK] }; else if (name === "entry") rt = { n: "Entry", a: [boxT(as2[0].t), boxT(as2[1].t)] }; else if (name === "copyOf") rt = as2[0].t; else if (name === "ofEntries") rt = { n: "Map", a: [UNK, UNK] }; }
      if (cls === "Optional" && (name === "of" || name === "ofNullable")) rt = { n: "Optional", a: [boxT(as2[0].t)] };
      if (cls === "Stream" && name === "of") rt = { n: "Stream", a: [as2.length === 1 && as2[0].t.arr ? as2[0].t.arr : (as2.length ? boxT(as2[0].t) : UNK)] };
      if ((cls === "Stream") && (name === "iterate" || name === "generate")) rt = { n: "Stream", a: [as2[0] && name === "iterate" ? boxT(as2[0].t) : UNK] };
      if (cls === "Objects") { if (name === "requireNonNull" || name === "requireNonNullElse") rt = as2[0].t; }
      if (cls === "Collectors") { rt = UNK; }
      if (cls === "Comparator") rt = { n: "Comparator", a: [UNK] };
      if (cls === "Function" && name === "identity" || cls === "UnaryOperator") rt = { n: "Function", a: [UNK, UNK] };
      if (cls === "Entry" || cls === "AbstractMap") rt = UNK;
      if (cls === "BigInteger" && name === "valueOf") { codes = [as2[0].t.n === "long" ? as2[0].c : "BigInt(" + as2[0].c + ")"]; }
      if (cls === "BigDecimal" && name === "valueOf") { codes = [isPrim(as2[0].t) && as2[0].t.n === "double" ? "$bd(" + as2[0].c + ")" : as2[0].c]; }
      if (cls === "EnumSet") rt = { n: "Set", a: [UNK] };
      if (cls === "Pattern" || cls === "LocalDate" || cls === "Executors" || cls === "Duration" || cls === "Instant" || cls === "ThreadLocalRandom") {}
    }
    if (cls === "System" && name === "exit") { return { c: "$L.System.exit(" + codes.join(",") + ")", t: tVoid }; }
    if (!LIBCLASSES.has(cls) && !LIB[cls] && !EXC[cls]) { this.err(line, "cannot find symbol\n  symbol:   variable " + cls); return { c: "null", t: UNK }; }
    return { c: "$L." + cls + "." + name + "(" + codes.join(", ") + ")", t: rt };
  }
  mathCall(n, ctx, infos) {
    const name = n.name, line = n.line; const as = infos.map((a) => this.finishArg(a, ctx));
    const un = (e) => (isPrim(e.t) ? e : (this.numOperand(e, line) || { c: this.unboxCode(e.c, e.t, tDouble), t: tDouble }));
    const U = as.map(un); const D = (e) => this.primConv(e.c, e.t.n, "double");
    for (const e of U) if (e.t.n === "boolean" || (e.t === tStr)) { this.err(line, "incompatible types: " + tName(e.t) + " cannot be converted to double"); }
    const pt2 = U.length >= 2 ? promote(U[0].t, U[1].t) : U[0] ? promote(U[0].t, tInt) : tInt;
    const call = (fnName, args, t) => ({ c: "$L.Math." + fnName + "(" + args.join(", ") + ")", t });
    switch (name) {
      case "abs": { const t = promote(U[0].t, tInt); return call(t.n === "int" ? "absI" : t.n === "long" ? "absL" : "absD", [U[0].c], t.n === "float" ? tFloat : t); }
      case "max": case "min": { const t = pt2; const k = t.n === "int" ? "I" : t.n === "long" ? "L" : "D"; const cv = (e) => (t.n === "long" ? this.primConv(e.c, e.t.n, "long", e.cv) : e.c); return call(name + k, [cv(U[0]), cv(U[1])], t); }
      case "round": return U[0].t.n === "float" ? call("roundF", [U[0].c], tInt) : call("roundD", [D(U[0])], tLong);
      case "floorDiv": case "floorMod": { const t = pt2; const k = t.n === "long" ? "L" : "I"; const cv = (e) => (t.n === "long" ? this.primConv(e.c, e.t.n, "long", e.cv) : e.c); const rt = name === "floorMod" && U[1].t.n === "int" && t.n === "long" ? tInt : t; return call(name + k, [cv(U[0]), cv(U[1])], t.n === "long" && name === "floorMod" && U[1].t.n !== "long" ? tInt : t); }
      case "addExact": case "subtractExact": case "multiplyExact": { const t = pt2; const k = t.n === "long" ? "L" : "I"; const cv = (e) => (t.n === "long" ? this.primConv(e.c, e.t.n, "long", e.cv) : e.c); return call(name + k, [cv(U[0]), cv(U[1])], t); }
      case "incrementExact": case "decrementExact": return call(name.replace("Exact", "ExactI"), [U[0].c], tInt);
      case "negateExact": return call("negateExact", [U[0].c], tInt); case "toIntExact": return call("toIntExact", [U[0].c], tInt);
      case "clamp": return call("clampI", U.map((e) => e.c), tInt);
      case "signum": return call("signum", [D(U[0])], tDouble);
      case "random": return call("random", [], tDouble);
      case "floor": case "ceil": case "rint": case "sqrt": case "cbrt": case "sin": case "cos": case "tan": case "asin": case "acos": case "atan": case "exp": case "log": case "log10": case "toRadians": case "toDegrees": case "sinh": case "cosh": case "tanh": case "log1p": case "expm1": case "ulp": return call(name, [D(U[0])], tDouble);
      case "pow": case "atan2": case "hypot": return call(name, [D(U[0]), D(U[1])], tDouble);
    }
    this.err(line, "cannot find symbol\n  symbol:   method " + name + "(" + this.describeArgs(infos) + ")\n  location: class Math"); return { c: "null", t: UNK };
  }

  // ---------- new / arrays / lambdas ----------
  newArr(n, ctx) {
    const base = this.rt(n.elem, ctx.ci, null, ctx); let t = base; for (let i = 0; i < n.dims.length + n.extra; i++) t = { arr: t };
    if (n.init) return this.arrInit(n.init, ctx, t);
    const dims = n.dims.map((d) => { const e = this.ex(d, ctx); return this.indexConv(e, n.line); });
    // element kind of the innermost allocated dimension
    const innerT = (() => { let x = t; for (let i = 0; i < n.dims.length; i++) x = x.arr; return x; })();
    const kind = n.extra === 0 && isPrim(innerT) ? innerT.n : "obj";
    if (dims.length === 1) return { c: "$newArr(" + JSON.stringify(kind) + ", " + dims[0] + ")", t };
    return { c: "$newMulti(" + JSON.stringify(kind) + ", [" + dims.join(", ") + "], 0)", t };
  }
  arrInit(n, ctx, t) {
    const et = t.arr || UNK; const els = n.el.map((e) => { const r = e.k === "arrinit" ? this.arrInit(e, ctx, et) : this.ex(e, ctx, et); return this.conv(r, et, n.line, "assign"); });
    const k = elemKind(t); return { c: k === "obj" ? "[" + els.join(", ") + "]" : "$mkArr(" + JSON.stringify(k) + ", [" + els.join(", ") + "])", t };
  }
  fiOf(expect) { // functional info {params:[types], ret: type|null(void)|undefined(unknown), user?:{ci,m}}
    if (!expect || isUnk(expect)) return null;
    if (expect.n === "$lam") return { params: expect.lp, ret: undefined };
    const ci = this.classes.get(expect.n);
    if (ci) { const ms = this.abstractMethods(ci); if (ms.length === 1) { const m = ms[0]; const map = {}; ci.tparams.forEach((p, i) => { map[p] = expect.a && expect.a[i] ? expect.a[i] : UNK; }); return { params: m.params.map((p) => this.substU(p, map)), ret: m.ret.n === "void" ? tVoid : this.substU(m.ret, map), user: { ci, m } }; } return null; }
    const f = FI[expect.n]; if (f) { const map = {}; f.tp.forEach((p, i) => { map[p] = expect.a && expect.a[i] ? expect.a[i] : UNK; }); return { params: f.p.map((s) => PRIMT[s] || map[s] || UNK), ret: f.r === "void" ? tVoid : (PRIMT[f.r] || map[f.r] || UNK), lib: expect.n }; }
    if (expect.n === "Comparator") return { params: [UNK, UNK], ret: tInt };
    return null;
  }
  abstractMethods(ci, out, seen) { out = out || []; seen = seen || new Set(); if (seen.has(ci)) return out; seen.add(ci); this.resolveClass(ci); for (const [, ms] of ci.methods) for (const m of ms) if (m.abstract && !m.static) out.push(m); for (const it of ci.ifaces) { const ic = this.classes.get(it.n); if (ic) this.abstractMethods(ic, out, seen); } return out; }
  lambda(n, ctx, expect) {
    const fi = this.fiOf(expect);
    if (expect && !isUnk(expect) && expect.n !== "$lam" && !fi && (this.classes.has(expect.n) || LIB[expect.n] && !FI[expect.n]) && !["Object", "Comparator"].includes(expect.n)) { if (expect.n !== "Object") this.err(n.line, "incompatible types: " + tName(expect) + " is not a functional interface"); }
    const fr = { tmp: 0, tmps: new Set(), hoist: new Set() }; const locals = new Map();
    const sub = Object.assign({}, ctx, { frames: ctx.frames.concat([{ locals }]), fr, fnBase: ctx.frames.length, retType: null, lam: true });
    const pjs = n.params.map((p, i) => { let t = p.type ? this.rt(p.type, ctx.ci, null, ctx) : (fi && fi.params[i] ? fi.params[i] : UNK); if (t === "lambda") t = UNK; const js = jsId(p.name); for (let j = ctx.frames.length - 1; j >= 0; j--) { const f = ctx.frames[j]; if (f.ci) break; if (f.locals && f.locals.has(p.name)) { this.err(n.line, "variable " + p.name + " is already defined in method " + (ctx.mname || "main") + "(" + (ctx.msig || "String[]") + ")"); break; } } locals.set(p.name, { t, js, name: p.name }); return js; });
    const retT = fi ? fi.ret : undefined; let body, bodyT;
    sub.retType = retT === undefined ? "infer" : retT; sub.inferRets = [];
    if (n.body.k === "block") { body = this.block(n.body, sub, true); bodyT = sub.inferRets.length ? sub.inferRets[0] : tVoid; }
    else {
      const isStmtExpr = ["call", "assign", "pre", "post", "new"].includes(n.body.k);
      let e; if (n.body.k === "assign") e = this.assign(n.body, sub, false); else e = this.ex(n.body, sub, retT && retT !== tVoid ? retT : undefined);
      bodyT = e.t;
      if (retT === tVoid) body = "{ " + e.c + "; }";
      else if (retT === undefined || isUnk(retT)) body = "{ return " + this.boxE(e) + "; }";
      else if (e.t === tVoid) { this.err(n.line, "incompatible types: bad return type in lambda expression\n    void cannot be converted to " + tName(retT)); body = "{ return " + e.c + "; }"; }
      else body = "{ return " + this.conv(e, retT, n.line, "return") + "; }";
    }
    this.lastLamRet = bodyT === tVoid ? null : (isPrim(bodyT) ? bodyT : bodyT);
    const decl = fr.tmps.size || fr.hoist.size ? "let " + [...fr.tmps, ...fr.hoist].join(", ") + "; " : "";
    body = decl ? body.replace(/^\{/, "{ " + decl) : body;
    const fn = "((" + pjs.join(", ") + ") => " + body + ")";
    if (fi && fi.user) return { c: "$lam(" + fi.user.ci.js + ", " + JSON.stringify(fi.user.m.js) + ", " + fn + ")", t: expect };
    return { c: fn, t: expect && expect.n !== "$lam" ? expect : UNK };
  }
  mref(n, ctx, expect) {
    const r0 = this.mref0(n, ctx, expect); const fi0 = this.fiOf(expect);
    if (fi0 && fi0.user && r0.c !== "null") return { c: "$lam(" + fi0.user.ci.js + ", " + JSON.stringify(fi0.user.m.js) + ", " + r0.c + ")", t: r0.t };
    return r0;
  }
  mref0(n, ctx, expect) {
    const fi = this.fiOf(expect);
    const boxRet = (code, t) => (fi && fi.ret && isPrim(fi.ret) ? code : this.boxCode(code, t || UNK));
    const unboxArgs = (m, pre) => m.params.map((p, i) => isPrim(p) ? this.unboxCode("a" + i, UNK, p) : "a" + i);
    // user class constructor refs
    if (n.name === "new") {
      if (n.type) { const t = this.rt(n.type, ctx.ci, null, ctx); if (t.arr) return { c: "((n) => $newArr(" + JSON.stringify(elemKind(t)) + ", n))", t: expect || UNK }; const ci = this.classes.get(t.n); if (ci) { return { c: "((...a) => $new(" + ci.js + ", a))", t: expect || UNK }; } return { c: "((...a) => new $L." + t.n + "(...a))", t: expect || UNK }; }
      const r = this.ex(n.obj, ctx); if (r.cls) return { c: "((...a) => $newu(" + r.cls.js + ", a))", t: expect || UNK }; if (r.lib) return { c: "((...a) => new $L." + r.lib + "(...a))", t: expect || UNK };
    }
    if (n.obj && n.obj.k === "super") { const f = this.curClassFrame(ctx); const cands = f.ci.sup ? this.findMethods(f.ci.sup, n.name) : []; const m = cands[0]; return { c: "((...a) => super." + (m ? m.js : n.name) + "(...a))", t: expect || UNK }; }
    const r = n.obj ? this.ex(n.obj, ctx) : { c: "null", t: UNK };
    if (r.cls) {
      const cands = this.findMethods(r.cls, n.name); const m = cands.find((c) => c.static) || cands[0];
      if (!m) { this.err(n.line, "invalid method reference\n  cannot find symbol\n    symbol:   method " + n.name); return { c: "null", t: UNK }; }
      if (m.static) return { c: "((...a) => " + boxRet(r.cls.js + "." + m.js + "(" + m.params.map((p, i) => isPrim(p) ? this.unboxCode("a[" + i + "]", UNK, p) : "a[" + i + "]").join(", ") + ")", m.ret) + ")", t: expect || UNK };
      const objT = fi && fi.params[0] && !isUnk(fi.params[0]) ? fi.params[0] : UNK;
      return { c: "((o, ...a) => " + boxRet("o." + m.js + "(" + m.params.map((p, i) => isPrim(p) ? this.unboxCode("a[" + i + "]", UNK, p) : "a[" + i + "]").join(", ") + ")", m.ret) + ")", t: expect || UNK };
    }
    if (r.lib || n.type) { const cls = r.lib || n.type.n; return { c: "$mref(" + JSON.stringify(cls) + ", " + JSON.stringify(n.name) + ")", t: expect || UNK }; }
    // bound receiver: obj::method
    const ci = this.classes.get(r.t.n);
    if (ci && !r.t.tv) { const cands = this.findMethods(ci, n.name); const m = cands[0]; if (m) { const tmp = this.newTmp(ctx); return { c: "(" + tmp + " = " + r.c + ", (...a) => " + boxRet(tmp + "." + m.js + "(" + m.params.map((p, i) => isPrim(p) ? this.unboxCode("a[" + i + "]", UNK, p) : "a[" + i + "]").join(", ") + ")", m.ret) + ")", t: expect || UNK, tmpCapture: true }; } }
    if (r.t.n === "PrintStream" || (n.obj.k === "field" && n.obj.name === "out")) return { c: "((x) => " + r.c + "." + (n.name === "println" ? "println" : "print") + "($str(x)))", t: expect || UNK };
    const tmp = this.newTmp(ctx);
    return { c: "(" + tmp + " = " + r.c + ", (...a) => $inv(" + tmp + ", " + JSON.stringify(n.name) + ", a))", t: expect || UNK };
  }
  newObj(n, ctx, expect) {
    const line = n.line; let t = this.rt(n.type, ctx.ci, null, ctx);
    if (t.a && t.a.length === 0 && expect && expect.a) t = { n: t.n, a: expect.a }; // diamond
    else if (n.type.a && n.type.a.length === 0 && expect && expect.n !== "$lam") { t = { n: t.n, a: expect.a || undefined }; if (expect.a && LIB[t.n] && LIB[expect.n]) { const maps = libFamilyMap({ n: t.n, a: LIB[t.n].tp.map((p) => ({ n: p, tv: true, p: true })) }); /* map expect args by family */ const tp = LIB[t.n].tp; if (expect.n === t.n) t = { n: t.n, a: expect.a }; else { const L = LIB[expect.n]; const mm = maps[expect.n]; if (L && mm) { const a = tp.map((p) => { for (let i = 0; i < L.tp.length; i++) { const sp = mm[L.tp[i]]; if (sp && sp.n === p) return expect.a[i] || UNK; } return UNK; }); t = { n: t.n, a }; } } } }
    if (t.a && t.a.length === 0) t = { n: t.n };
    const infos = this.argInfos(n.args, ctx);
    if (n.body) return this.anonClass(n, ctx, t, infos);
    const ci = this.classes.get(t.n);
    if (ci && !t.tv) {
      this.resolveClass(ci);
      if (ci.abstract) { this.err(line, ci.name + " is abstract; cannot be instantiated"); return { c: "null", t }; }
      if (ci.kind === "enum") { this.err(line, "enum classes may not be instantiated"); return { c: "null", t }; }
      return this.newUser(n, ctx, ci, t, infos, n.outer ? this.ex(n.outer, ctx).c : undefined);
    }
    if (t.tv) { this.err(line, "unexpected type"); return { c: "null", t: UNK }; }
    const nm = t.n;
    if (EXC[nm] || nm === "Thread" || nm === "Object") {
      if (nm === "Object") return { c: "new $JObject()", t };
      const args = infos.map((a) => this.boxE(this.finishArg(a, ctx))); return { c: "new $L." + nm + "()" + ".$c(" + args.join(", ") + ")", t };
    }
    if (!NEWCLASSES.has(nm) && !LIB[nm]) { this.err(line, "cannot find symbol\n  symbol:   class " + nm); return { c: "null", t: UNK }; }
    if (FI[nm] || (LIB[nm] && ["List", "Map", "Set", "Collection", "Queue", "Deque", "Iterator", "Iterable", "Comparable", "CharSequence"].includes(nm))) { this.err(line, nm + " is abstract; cannot be instantiated"); return { c: "null", t }; }
    const ptypes = nm === "PriorityQueue" || nm === "TreeMap" || nm === "TreeSet" ? [t.a && t.a[0] || UNK, t.a && t.a[0] || UNK] : null;
    const args = infos.map((a) => { if (a.lazy) return this.boxE(this.ex(a.n, ctx, { n: "$lam", lp: nm === "TreeMap" ? [t.a && t.a[0] || UNK, t.a && t.a[0] || UNK] : ptypes || [UNK, UNK] })); if (isPrim(a.t)) { if (nm === "Random" || nm === "AtomicLong") return a.t.n === "long" && nm === "Random" ? a.c : (nm === "AtomicLong" && a.t.n !== "long" ? "BigInt(" + a.c + ")" : a.c); if (nm === "AtomicInteger" || nm === "Integer" || ((/List|Deque|Queue|Map|Set|Vector|Stack/.test(nm)) && a.t.n === "int")) return a.c; if (nm === "StringBuilder" || nm === "StringBuffer") return a.t.n === "int" ? "\"\"" : this.strOf(a); if (nm === "Double") return "$bd(" + a.c + ")"; return a.c; } return a.c; });
    if (nm === "String") { if (!infos.length) return { c: '""', t: tStr }; const a = this.finishArg(infos[0], ctx); return { c: a.t.arr ? "$charsToStr(" + (infos.length === 3 ? "$L.Arrays.copyOfRange(" + a.c + "," + this.finishArg(infos[1], ctx).c + "," + (this.finishArg(infos[1], ctx).c + "+" + this.finishArg(infos[2], ctx).c) + ")" : a.c) + ")" : "String(" + this.strOf(a) + ")", t: tStr }; }
    if (nm === "Integer" || nm === "Long" || nm === "Double" || nm === "Boolean" || nm === "Character") { const a = this.finishArg(infos[0], ctx); const st = { n: nm }; if (nm === "Integer") return { c: a.t.n === "String" ? "$L.Integer.parseInt(" + a.c + ")" : a.c, t: st }; if (nm === "Double") return { c: a.t.n === "String" ? "$L.Double.valueOf(" + a.c + ")" : "$bd(" + a.c + ")", t: st }; if (nm === "Long") return { c: a.t.n === "String" ? "$L.Long.parseLong(" + a.c + ")" : this.primConv(a.c, a.t.n, "long"), t: st }; if (nm === "Character") return { c: "$bc(" + a.c + ")", t: st }; return { c: a.c, t: st }; }
    if (nm === "InputStreamReader") return { c: "new $L.InputStreamReader()", t };
    if (nm === "BufferedReader") return { c: "new $L.BufferedReader(" + (infos[0] ? this.finishArg(infos[0], ctx).c : "") + ")", t };
    if (nm === "Scanner") { const a = infos[0] ? this.finishArg(infos[0], ctx) : null; return { c: "new $L.Scanner(" + (a ? a.c : "") + ")", t }; }
    if (nm === "SimpleEntry" || nm === "AbstractMap.SimpleEntry") return { c: "new $L.Entry().$c(" + args.join(", ") + ")", t: { n: "Entry", a: t.a } };
    if (nm === "EnumMap") return { c: "new $L.TreeMap()", t: { n: "Map", a: t.a } };
    return { c: "new $L." + nm + "(" + args.join(", ") + ")", t };
  }
  newUser(n, ctx, ci, t, infos, outerExpr) {
    const line = n.line; const m = this.pickCtor(ci, infos.map((a) => a.t));
    if (ci.ctors.length === 0 && infos.length) { this.err(line, "constructor " + ci.name + " in class " + ci.name + " cannot be applied to given types;\n  required: no arguments\n  found:    " + this.describeArgs(infos) + "\n  reason: actual and formal argument lists differ in length"); return { c: "null", t }; }
    let idx = 0, args = [];
    if (m) { idx = m.idx; args = this.buildArgs(m, infos, ctx, t, line); }
    else if (ci.ctors.length) {
      if (ci.ctors.length === 1) this.err(line, "constructor " + ci.name + " in class " + ci.name + " cannot be applied to given types;\n  required: " + (ci.ctors[0].params.length ? ci.ctors[0].params.map(tName).join(",") : "no arguments") + "\n  found:    " + (infos.length ? this.describeArgs(infos) : "no arguments") + "\n  reason: " + (ci.ctors[0].params.length !== infos.length ? "actual and formal argument lists differ in length" : "argument mismatch"));
      else this.err(line, "no suitable constructor found for " + ci.name + "(" + this.describeArgs(infos) + ")");
      return { c: "null", t };
    }
    let pre = this.initPrefix(ci, ctx);
    let outer = "";
    if (!ci.isStatic && ci.outer) { const oc = outerExpr || this.outerInstanceFor(ci, ctx, line); outer = oc + (args.length ? ", " : ""); }
    const sup = "$c" + ci.id + "_" + idx;
    return { c: "(" + pre + "new " + ci.js + "()." + sup + "(" + outer + args.join(", ") + "))", t };
  }
  pickCtor(ci, argTypes) { return this.pickMethod(ci.ctors.map((c) => Object.assign(c, { name: "<init>" })), argTypes); }
  outerInstanceFor(ci, ctx, line) { for (let i = ctx.frames.length - 1; i >= 0; i--) { const f = ctx.frames[i]; if (f.ci && (f.ci === ci.outer || this.isSubClass(f.ci, ci.outer))) { if (f.static) { this.err(line, "non-static variable this cannot be referenced from a static context"); return "null"; } return this.frameThis(f, ctx); } } this.err(line, "an enclosing instance that contains " + ci.name + " is required"); return "null"; }
  anonClass(n, ctx, t, infos) {
    const d = n.body; d.name = (ctx.ci ? ctx.ci.name : "Main") + "$" + (++this.anonc); const ci = this.declare(d, ctx.ci, ctx); ci.isStatic = true; ci.anonOf = t;
    const base = this.classes.get(t.n);
    if (base) { if (base.isIface) d.impls = [n.type]; else d.ext = n.type; } else if (FI[t.n] || (LIB[t.n] && !EXC[t.n])) d.impls = [n.type]; else { d.ext = n.type; }
    ci.local = true; ci.ctx = ctx; this.resolveClass(ci); this.computeMangling(); this.prepClass(ci);
    const code = this.emitClass(ci, ctx);
    const args = base && !base.isIface ? (() => { const m = this.pickCtor(base, infos.map((a) => a.t)); return m ? this.buildArgs(m, infos, ctx, t, n.line) : []; })() : (!base ? infos.map((a) => this.boxE(this.finishArg(a, ctx))) : []);
    const sc = base && !base.isIface ? "$c" + base.id + "_" + ((base.ctors.length && this.pickCtor(base, infos.map((a) => a.t)) || { idx: 0 }).idx) : "$c";
    ci.anonSuper = sc;
    return { c: "$anon((() => { " + code + " return " + ci.js + "; })(), " + JSON.stringify(sc) + ", [" + args.join(", ") + "])", t: t.a ? t : t };
  }
  // ---------- switch ----------
  switchCode(n, ctx, isExpr, expect) {
    const sel = this.ex(n.sel, ctx); const st = sel.t; const unb = unboxT(st); const isEnum = this.classes.get(st.n) && this.classes.get(st.n).kind === "enum";
    const hasPat = n.cases.some((c) => c.labels.some((l) => l.k === "tpat") || c.labels.guard);
    const tmp = "$s" + (++this.tmpc); let selC = sel.c;
    const arms = []; let resT = null; const types = [];
    const labelCode = (l) => {
      if (isEnum && l.k === "name") return this.classes.get(st.n).js + "." + l.id;
      if (isEnum && l.k === "field") return this.ex(l, ctx).c;
      const e = this.ex(l, ctx);
      if (isPrim(unb) && unb.n === "char" && e.t.n === "int") return e.c;
      if (st.n === "String" && e.t.n !== "String" && e.t.n !== "null") this.err(l.line, "constant expression required");
      if (isPrim(unb) && e.t.n === "String") this.err(l.line, "incompatible types: String cannot be converted to " + unb.n);
      if (e.cv === undefined && e.t.n !== "null" && !isEnum && !(l.k === "name")) { if (l.k === "name" || l.k === "field") {} }
      return e.c;
    };
    const bodyOf = (c) => {
      const sub = Object.assign({}, ctx, { frames: ctx.frames.concat([{ locals: new Map() }]) });
      if (c.body.k === "arrowexpr") { if (!isExpr) { const e = c.body.e; const k = ["call", "assign", "pre", "post", "new"]; if (!k.includes(e.k)) this.err(c.body.line, "not a statement"); return (e.k === "assign" ? this.assign(e, sub, true).c : e.k === "pre" || e.k === "post" ? this.incdec(e, sub, true).c : this.ex(e, sub).c) + ";"; } const e = this.ex(c.body.e, sub, expect); types.push(e); return "return " + "%%" + (types.length - 1) + "%%" + ";"; }
      if (c.body.k === "throw") return this.stmt(c.body, sub);
      if (c.body.k === "block" && !c.body.noscope) { sub.yieldTypes = types; return this.block(c.body, Object.assign(sub, { inSwitchExpr: isExpr }), true, isExpr ? "yield" : null); }
      const save = ctx.yieldTypes; sub.yieldTypes = types; sub.inSwitchExpr = isExpr; return c.body.stmts.map((s) => this.stmt(s, sub)).join("\n");
    };
    if (hasPat) {
      let out = "const " + tmp + " = " + selC + ";\n"; let first = true; let dflt = null;
      for (const c of n.cases) {
        const sub = Object.assign({}, ctx, { frames: ctx.frames.concat([{ locals: new Map() }]) });
        const conds = c.labels.map((l) => { if (l.k === "tpat") { const t = this.rt(l.type, ctx.ci, null, ctx); const js = this.declareLocal(sub, l.bind, t, l.line, true); return this.instTest("(" + js + " = " + tmp + ")", t); } if (l.k === "lit" && l.kind === "null") return tmp + " === null"; const e = this.ex(l, sub); return isEnum ? "(" + tmp + " === " + (l.k === "name" ? this.classes.get(st.n).js + "." + l.id : e.c) + ")" : "$eq(" + tmp + ", " + this.boxE(e) + ")"; });
        let cond = conds.join(" || ") || "true"; if (c.labels.guard) { const g = this.ex(c.labels.guard, sub); cond = "(" + cond + ") && " + g.c; }
        let body; if (c.body.k === "arrowexpr") { if (!isExpr) body = this.ex(c.body.e, sub).c + ";"; else { const e = this.ex(c.body.e, sub, expect); types.push(e); body = "return %%" + (types.length - 1) + "%%;"; } } else if (c.body.k === "throw") body = this.stmt(c.body, sub); else { sub.yieldTypes = types; sub.inSwitchExpr = isExpr; body = c.body.k === "block" ? this.block(c.body, sub, true, isExpr ? "yield" : null) : this.stmt(c.body, sub); }
        if (c.isDefault && !c.labels.length) { dflt = body; continue; }
        out += (first ? "" : "else ") + "if (" + cond + ") {\n" + body + "\n}\n"; first = false;
      }
      if (dflt !== null) out += (first ? "{" : "else {") + "\n" + dflt + "\n}\n"; else if (isExpr) out += (first ? "" : "else ") + "throw $mkEx('MatchException', null);\n";
      return { code: out, types };
    }
    if (isPrim(st) && (st.n === "long" || st.n === "double" || st.n === "float" || st.n === "boolean")) this.err(n.line, "incompatible types: possible lossy conversion from " + st.n + " to int");
    let sc = isPrim(st) ? selC : (isPrim(unb) && !isUnk(st) ? this.unboxCode(selC, st, unb) : (isEnum || st.n === "String" ? "$nn(" + selC + ")" : selC));
    let out = "switch (" + sc + ") {\n"; const seen = new Set();
    for (const c of n.cases) {
      for (const l of c.labels) { const lc = labelCode(l); if (seen.has(lc)) this.err(l.line, "duplicate case label"); seen.add(lc); out += "case " + lc + ":\n"; }
      if (c.isDefault) out += "default:\n";
      const b = bodyOf(c); out += "{\n" + b + "\n" + (n.arrow && !isExpr ? "break;\n" : "") + "}\n";
      if (n.arrow && isExpr) {} 
    }
    out += "}\n";
    if (isExpr) out += "throw $mkEx('MatchException', null);\n";
    return { code: out, types };
  }
  switchExpr(n, ctx, expect) {
    const fr = ctx.fr;
    const r = this.switchCode(n, ctx, true, expect);
    // unify types
    const ts = r.types.map((e) => e.t); let t;
    if (!ts.length) t = UNK; else if (ts.every((x) => isPrim(x) || BOXOF[x.n])) { const us = ts.map(unboxT); t = us.every((x) => x.n === us[0].n) ? us[0] : (us.every((x) => x.n !== "boolean") ? us.reduce((a, b) => promote(a, b)) : tObj); if (ts.every((x) => !isPrim(x)) && false) t = boxT(t); } else if (ts.every((x) => x.n === "String")) t = tStr; else t = (expect && !isUnk(expect) ? expect : (ts.find((x) => x.n !== "null" && !isUnk(x)) || UNK)); if (!isPrim(t) && ts.some(isPrim)) t = isPrim(t) ? t : boxT(t);
    let code = r.code;
    code = code.replace(/%%(\d+)%%/g, (m, i) => { const e = r.types[+i]; return this.conv(e, t, n.line, "assign"); });
    return { c: "(() => { " + code + " })()", t };
  }

  // ---------- statements ----------
  condCode(e, ctx, line) { const r = this.ex(e, ctx, tBool); return this.conv(r, tBool, line, "assign"); }
  pushFrame(ctx) { return Object.assign({}, ctx, { frames: ctx.frames.concat([{ locals: new Map() }]) }); }
  block(n, ctx, noScope) {
    const sub = noScope ? ctx : this.pushFrame(ctx); const out = []; let dead = false;
    for (const s of n.stmts) {
      if (dead && !this.deadReported) { this.err(s.line, "unreachable statement"); this.deadReported = true; }
      out.push(this.stmt(s, sub));
      if (!this.canComplete(s)) dead = true;
    }
    this.deadReported = false;
    return "{\n" + out.join("\n") + "\n}";
  }
  hasBreak(s, label, depth) { // break that exits statement s (label-targeted or unlabeled at depth 0)
    if (!s || typeof s !== "object") return false;
    if (Array.isArray(s)) return s.some((x) => this.hasBreak(x, label, depth));
    switch (s.k) {
      case "break": return s.label ? s.label === label : depth === 0;
      case "block": return this.hasBreak(s.stmts, label, depth);
      case "if": return this.hasBreak(s.th, label, depth) || this.hasBreak(s.el, label, depth);
      case "while": case "do": case "for": case "foreach": return this.hasBreak(s.body, label, depth + 1);
      case "label": return this.hasBreak(s.body, label, depth);
      case "switch": return s.cases.some((c) => this.hasBreak(c.body.k === "arrowexpr" ? null : c.body, label, depth + 1));
      case "try": return this.hasBreak(s.block, label, depth) || s.catches.some((c) => this.hasBreak(c.block, label, depth)) || this.hasBreak(s.fin, label, depth);
    }
    return false;
  }
  isTrue(e) { while (e && e.k === "paren") e = e.e; return !e || (e.k === "lit" && e.kind === "boolean" && e.v === true); }
  canComplete(s, label) {
    if (!s) return true;
    switch (s.k) {
      case "return": case "throw": case "break": case "continue": return false;
      case "yield": return false;
      case "block": { for (const x of s.stmts) if (!this.canComplete(x)) return false; return true; }
      case "if": return !s.el ? true : (this.canComplete(s.th) || this.canComplete(s.el));
      case "while": return !(this.isTrue(s.cond) && !this.hasBreak(s.body, label, 0));
      case "do": return !(this.isTrue(s.cond) && !this.hasBreak(s.body, label, 0)) && (this.canComplete(s.body) || true);
      case "for": return !(this.isTrue(s.cond) && !this.hasBreak(s.body, label, 0));
      case "label": return this.canComplete(s.body, s.name) || this.hasBreak(s.body, s.name, 99);
      case "switch": {
        const hasDef = s.cases.some((c) => c.isDefault); if (!hasDef) return true;
        if (this.hasBreak(s.cases.map((c) => c.body.k === "arrowexpr" ? null : c.body), label, 0)) return true;
        if (s.arrow) return s.cases.some((c) => c.body.k === "arrowexpr" || this.canComplete(c.body));
        const last = s.cases[s.cases.length - 1]; return this.canComplete(last.body);
      }
      case "try": { if (s.fin && !this.canComplete(s.fin)) return false; return this.canComplete(s.block) || s.catches.some((c) => this.canComplete(c.block)); }
    }
    return true;
  }
  stmt(s, ctx) {
    const r = this.stmt0(s, ctx); const k = s.k;
    if (!s.line || !(k === "expr" || k === "return" || k === "throw" || k === "local")) return r;
    if (!this.lineMap) this.lineMap = {};
    if (this.lineMap[s.line] === undefined) this.lineMap[s.line] = (ctx.ci && ctx.ci.name ? String(ctx.ci.name) : "Main") + "." + (ctx.mname === (ctx.ci && ctx.ci.name) ? "<init>" : (ctx.mname || "main"));
    const pre = "$LN.l = " + s.line;
    if (k === "local") return pre + "; " + r;
    if (/^(let|const|var|if|for|while|do|switch|try|\{|label)/.test(r)) return r;
    if (k === "return" || k === "throw") { const w = k + " "; if (r.startsWith(w) && r.trimEnd().endsWith(";") && r.indexOf("\n") < 0) return w + "(" + pre + ", " + r.trimEnd().slice(w.length, -1) + ");"; return r; }
    return pre + ", " + r;
  }
  stmt0(s, ctx) {
    const line = s.line;
    switch (s.k) {
      case "empty": return ";";
      case "block": return this.block(s, ctx);
      case "local": return this.localDecl(s, ctx);
      case "expr": {
        const e = s.e; const ok = ["call", "assign", "pre", "post", "new", "ctorcall"];
        if (!ok.includes(e.k)) { this.err(line, "not a statement"); return ";"; }
        if (e.k === "assign") return this.assign(e, ctx, true).c + ";";
        if (e.k === "pre" || e.k === "post") return this.incdec(e, ctx, true).c + ";";
        if (e.k === "ctorcall") return "";
        return this.ex(e, ctx).c + ";";
      }
      case "if": { const c = this.condCode(s.cond, ctx, line); const th = this.stmt(this.wrapScope(s.th), ctx); const el = s.el ? " else " + this.stmt(this.wrapScope(s.el), ctx) : ""; return "if (" + c + ") " + th + el; }
      case "while": { const c = this.condCode(s.cond, ctx, line); return "while (" + c + ") " + this.stmt(this.wrapScope(s.body), ctx); }
      case "do": { const b = this.stmt(this.wrapScope(s.body), ctx); const c = this.condCode(s.cond, ctx, line); return "do " + b + " while (" + c + ");"; }
      case "for": {
        const sub = this.pushFrame(ctx); let init = "";
        if (s.init.length) { if (s.init[0].k === "local") init = this.localDecl(s.init[0], sub, true); else init = s.init.map((x) => this.stmt(x, sub).replace(/;$/, "")).join(", "); }
        const c = s.cond ? this.condCode(s.cond, sub, line) : "";
        const upd = s.upd.map((u) => { const e = u.k === "expr" ? u.e : u; return e.k === "assign" ? this.assign(e, sub, true).c : (e.k === "pre" || e.k === "post") ? this.incdec(e, sub, true).c : this.ex(e, sub).c; }).join(", ");
        return "for (" + init + "; " + c + "; " + upd + ") " + this.stmt(this.wrapScope(s.body), sub);
      }
      case "foreach": return this.foreachStmt(s, ctx);
      case "label": return jsId(s.name) + "$L: " + this.stmt(s.body, ctx);
      case "break": return s.label ? "break " + jsId(s.label) + "$L;" : "break;";
      case "continue": return s.label ? "continue " + jsId(s.label) + "$L;" : "continue;";
      case "return": return this.returnStmt(s, ctx);
      case "yield": { const e = this.ex(s.e, ctx); const types = ctx.yieldTypes; if (!types) { this.err(line, "yield outside of switch expression"); return ";"; } types.push(e); return "return %%" + (types.length - 1) + "%%;"; }
      case "throw": { const e = this.ex(s.e, ctx); if (isPrim(e.t) || e.t.n === "String") this.err(line, "incompatible types: " + tName(e.t) + " cannot be converted to Throwable"); return "throw $nn(" + e.c + ");"; }
      case "assert": return ";";
      case "switch": { const r = this.switchCode(s, ctx, false); return "{\n" + r.code + "}"; }
      case "try": return this.tryStmt(s, ctx);
      case "localclass": return this.localClass(s, ctx);
      case "sync": return this.block(s.body, ctx);
    }
    this.err(line, "unsupported statement " + s.k); return ";";
  }
  wrapScope(s) { return s.k === "block" ? s : { k: "block", stmts: [s], line: s.line }; }
  localDecl(s, ctx, inFor) {
    const parts = [];
    for (const d of s.decls) {
      let t = d.type.n === "var" && !d.type.arr ? null : this.rt(d.type, ctx.ci, null, ctx); let init = null, code, cvv;
      if (t === null) { if (!d.init) { this.err(d.line || s.line, "cannot infer type for local variable " + d.name + "\n  (cannot use 'var' on variable without initializer)"); t = UNK; } else { const e = this.ex(d.init, ctx); t = e.t.n === "null" ? UNK : e.t; if (t === tVoid) this.err(s.line, "cannot infer type for local variable " + d.name); code = e.c; init = true; } }
      else if (d.init) {
        if (d.init.k === "arrinit") { if (!t.arr) this.err(s.line, "illegal initializer for " + tName(t)); const e = this.arrInit(d.init, ctx, t.arr ? t : { arr: UNK }); code = e.c; }
        else { const e = this.ex(d.init, ctx, t); cvv = e.cv; code = this.conv(e, t, d.line || s.line, "assign"); }
        init = true;
      }
      const js = this.declareLocal(ctx, d.name, t, d.line || s.line);
      if (s.fin) { const lv = ctx.frames[ctx.frames.length - 1].locals.get(d.name); if (lv) { lv.final = true; lv.assigned = !!init; if (cvv !== undefined && (isPrim(t) || t.n === "String") && !(typeof cvv === "number" && (t.n === "double" || t.n === "float" || t.n === "long"))) lv.cv = cvv; } }
      parts.push(js + (init ? " = " + code : ""));
    }
    return "let " + parts.join(", ") + (inFor ? "" : ";");
  }
  foreachStmt(s, ctx) {
    const line = s.line; const sub = this.pushFrame(ctx); const it = this.ex(s.it, ctx); const id = ++this.tmpc;
    let declT = s.type.n === "var" && !s.type.arr ? null : this.rt(s.type, ctx.ci, null, ctx); let elT;
    if (it.t.arr) elT = it.t.arr; else if (isPrim(it.t) || it.t.n === "String") { this.err(line, "for-each not applicable to expression type\n  required: array or java.lang.Iterable\n  found:    " + tName(it.t)); elT = UNK; } else elT = it.t.a && it.t.a.length === 1 ? it.t.a[0] : (this.iterElem(it.t) || UNK);
    if (declT === null) declT = elT;
    const js = this.declareLocal(sub, s.name, declT, line);
    const cv = this.conv({ c: it.t.arr ? "$a" + id + "[$i" + id + "]" : "$e" + id, t: elT }, declT, line, "assign");
    const body = this.stmt(this.wrapScope(s.body), sub);
    if (it.t.arr) return "for (let $a" + id + " = $nn(" + it.c + "), $i" + id + " = 0; $i" + id + " < $a" + id + ".length; $i" + id + "++) { let " + js + " = " + cv + ";\n" + body + " }";
    return "for (const $e" + id + " of $iter(" + it.c + ")) { let " + js + " = " + cv + ";\n" + body + " }";
  }
  iterElem(t) { const ci = this.classes.get(t.n); if (ci) { for (const it of ci.ifaces) if ((it.n === "Iterable" || it.n === "Iterator") && it.a) return it.a[0]; } if (LIB[t.n] && t.a && t.a.length) { if (/Map$/.test(t.n)) return null; return t.a[0]; } return null; }
  returnStmt(s, ctx) {
    const rt = ctx.retType; const line = s.line;
    if (ctx.inInit) { this.err(line, "return outside method"); return ";"; }
    if (rt === "infer") { if (!s.e) return "return;"; const e = this.ex(s.e, ctx); ctx.inferRets.push(e.t); return "return " + this.boxE(e) + ";"; }
    if (rt === undefined || rt === null) { if (s.e) { const e = this.ex(s.e, ctx); return "return " + this.boxE(e) + ";"; } return "return;"; }
    if (rt === tVoid) { if (ctx.inCtor && !s.e) return "return this;"; if (s.e) { this.err(line, "incompatible types: unexpected return value"); this.ex(s.e, ctx); } return "return;"; }
    if (!s.e) { this.err(line, "incompatible types: missing return value"); return "return;"; }
    const e = this.ex(s.e, ctx, rt); return "return " + this.conv(e, rt, line, "return") + ";";
  }
  catchTest(t, ctx, line) {
    const ci = this.classes.get(t.n); if (ci) return ci.js;
    if (EXC[t.n]) return "$L." + t.n;
    this.err(line, "cannot find symbol\n  symbol:   class " + t.n); return "$L.Throwable";
  }
  tryStmt(s, ctx) {
    const line = s.line; const sub = this.pushFrame(ctx); let pre = "", post = "";
    let body;
    if (s.res.length) {
      const id = ++this.tmpc; let inner = "";
      const rs = []; for (const r of s.res) { if (r.k === "local") { const d = r.decls[0]; const t = d.type.n === "var" ? null : this.rt(d.type, ctx.ci, null, ctx); const e = this.ex(d.init, sub, t || undefined); const js = this.declareLocal(sub, d.name, t || e.t, r.line); rs.push(js); inner += "let " + js + " = " + e.c + ";\n"; } else { const e = this.ex(r.e, sub); const js = "$r" + (++this.tmpc); rs.push(js); inner += "let " + js + " = " + e.c + ";\n"; } }
      const b = this.block(s.block, sub);
      let code = b; for (let i = rs.length - 1; i >= 0; i--) { code = "{ let $p" + id + "_" + i + " = null; try " + code + " catch ($x) { $p" + id + "_" + i + " = $wrapEx($x); throw $p" + id + "_" + i + "; } finally { if (" + rs[i] + " !== null) { try { " + rs[i] + ".close(); } catch ($y) { if ($p" + id + "_" + i + " === null) throw $y; } } } }"; }
      // declarations must precede nested try blocks: emit all lets first
      body = "{\n" + inner + code + "\n}";
      if (!s.catches.length && !s.fin) return body;
    } else body = this.block(s.block, sub);
    let out = "try " + body;
    if (s.catches.length) {
      const id = ++this.tmpc; let c = " catch ($e" + id + ") {\n$e" + id + " = $wrapEx($e" + id + ");\n"; let first = true; const seen = [];
      for (const k of s.catches) {
        const types = k.types.map((t) => this.rt(t, ctx.ci, null, ctx)); const csub = this.pushFrame(ctx);
        const tests = types.map((t) => { const cn = this.classes.get(t.n); for (const p of seen) { if (this.excSub(t, p)) this.err(k.line, "exception " + t.n + " has already been caught"); } return "$e" + id + " instanceof " + this.catchTest(t, ctx, k.line); });
        seen.push(...types);
        const vt = types.length === 1 ? types[0] : { n: "Exception" }; const js = this.declareLocal(csub, k.name, vt, k.line);
        c += (first ? "" : "else ") + "if (" + tests.join(" || ") + ") {\nlet " + js + " = $e" + id + ";\n" + this.block(k.block, csub, true) + "\n}\n"; first = false;
      }
      c += "else throw $e" + id + ";\n}"; out += c;
    }
    if (s.fin) out += " finally " + this.block(s.fin, sub);
    return out;
  }
  excSub(a, b) { const ca = this.classes.get(a.n), cb = this.classes.get(b.n); if (ca && cb) return this.isSubClass(ca, cb); if (!ca && !cb) return !!(EXC[a.n] && EXC[b.n] && EXC[a.n].$all.has(EXC[b.n])); if (ca && !cb) { for (let c = ca; c; c = c.sup) if (c.supName && EXC[c.supName] && EXC[b.n] && EXC[c.supName].$all.has(EXC[b.n])) return true; } return false; }
  localClass(s, ctx) {
    const d = s.decl; const ci = this.declare(d, ctx.ci, ctx); ci.local = true; ci.isStatic = true; ci.ctx = ctx;
    for (const x of this.order) if (!x.resolved) this.resolveClass(x);
    this.computeMangling(); this.prepClass(ci);
    return this.emitClass(ci, ctx);
  }

  // ---------- classes ----------
  defVal(t) { if (isPrim(t)) { switch (t.n) { case "long": return "0n"; case "boolean": return "false"; default: return "0"; } } return "null"; }
  prepClass(ci) {
    this.resolveClass(ci); const d = ci.decl;
    ci.needInit = ci.kind === "enum" || d.members.some((m) => (m.k === "field" && m.mods.has("static") && m.init) || (m.k === "init" && m.static)) || (ci.sup && (this.prepClass(ci.sup), ci.sup.needInit)) || false;
    if (ci.kind === "interface") ci.needInit = d.members.some((m) => m.k === "field" && m.init);
    if (!ci.isStatic && ci.kind !== "class") ci.isStatic = true;
    if (ci.outer && !ci.local && !ci.decl.anon) { if (ci.kind !== "class" || ci.outer.kind === "interface") ci.isStatic = true; else ci.isStatic = ci.decl.mods.has("static"); }
    if (!ci.outer) ci.isStatic = true;
    if (ci.decl.mods.has("abstract") || ci.kind === "interface") ci.abstract = true;
  }
  classFrames(ci) {
    if (ci.local && ci.ctx) return ci.ctx.frames.concat([{ ci, static: false, thisExpr: "$T" + ci.id }]);
    const chain = []; let c = ci; while (c) { chain.unshift(c); c = c.outer; if (c && c.local) { chain.unshift(...[]); const base = c.ctx ? c.ctx.frames : []; return base.concat(this.chainFrames(chain.concat([]), c, ci)); } }
    return this.chainFrames(chain, null, ci);
  }
  chainFrames(chain, _l, ci) { // outermost..ci; thisExpr via $outer
    const frames = []; const last = chain.length - 1; let expr = "$T" + ci.id; let stat = false; const rev = [];
    for (let i = last; i >= 0; i--) { const c = chain[i]; rev.push({ ci: c, static: stat, thisExpr: expr }); if (c.isStatic) stat = true; expr = expr + ".$outer"; }
    return frames.concat(rev.reverse());
  }
  baseCtx(ci, isStatic) {
    const frames = this.classFrames(ci); frames[frames.length - 1] = Object.assign({}, frames[frames.length - 1], { static: !!isStatic });
    if (isStatic) for (let i = 0; i < frames.length; i++) if (frames[i].ci && i === frames.length - 1) frames[i].static = true;
    return { ci, frames, fr: { tmp: 0, tmps: new Set(), hoist: new Set() }, fnBase: frames.length, retType: tVoid, tps: this.tpScope(ci) };
  }
  fnPrologue(ctx, isStatic) { const d = [...ctx.fr.tmps, ...ctx.fr.hoist]; return (isStatic ? "" : "const $T" + ctx.ci.id + " = this;\n") + (d.length ? "let " + d.join(", ") + ";\n" : ""); }
  emitFn(ci, ctx0, m, ret, paramsDecl, bodyNode, opts) {
    opts = opts || {};
    const mtp = (m.tparams || []); const save = this.curTP; this.curTP = this.tpScope(ci, mtp);
    const frames = ctx0.frames.concat([{ locals: new Map() }]);
    const ctx = Object.assign({}, ctx0, { frames, fr: { tmp: 0, tmps: new Set(), hoist: new Set() }, fnBase: frames.length - 1, retType: ret, mname: opts.mname || m.name, msig: paramsDecl.map((p) => tName(p.t)).join(","), inCtor: !!opts.ctor, tps: this.curTP });
    const pjs = paramsDecl.map((p) => this.declareLocal(ctx, p.name, p.t, m.line || 0));
    let pre = "", body;
    if (opts.ctor) body = this.ctorBody(ci, ctx, m, bodyNode, opts); else body = this.block(bodyNode, ctx, true);
    if (!opts.ctor && ret && ret !== tVoid && !isUnk(ret) && this.canComplete(bodyNode)) this.err(bodyNode.end || m.line, "missing return statement");
    this.curTP = save;
    const decl = this.fnPrologue(ctx, opts.isStatic);
    return { pjs, code: "{\n" + decl + body.replace(/^\{\n?/, "").replace(/\n?\}$/, "") + (opts.ctor ? "\nreturn this;" : "") + "\n}" };
  }
  ctorBody(ci, ctx, m, bodyNode, opts) {
    const stmts = bodyNode ? bodyNode.stmts : []; let first = stmts[0] && stmts[0].k === "expr" && stmts[0].e.k === "ctorcall" ? stmts[0].e : null; const rest = first ? stmts.slice(1) : stmts;
    let out = [];
    const line = m.line || ci.decl.line;
    if (ci.kind === "enum" || ci.kind === "record") { if (first && first.which === "this") {} }
    if (first && first.which === "this") {
      const infos = this.argInfos(first.args, ctx); const k = this.pickCtor(ci, infos.map((a) => a.t));
      if (!k) { this.err(first.line, "no suitable constructor found for " + ci.name + "(" + this.describeArgs(infos) + ")"); }
      else { const args = this.buildArgs(k, infos, ctx, this.selfType(ci), first.line); out.push("this.$c" + ci.id + "_" + k.idx + "(" + (!ci.isStatic && ci.outer ? "$o, " : "") + args.join(", ") + ");"); }
    } else {
      if (ci.sup) {
        const sup = ci.sup; const infos = first ? this.argInfos(first.args, ctx) : []; const k = sup.ctors.length ? this.pickCtor(sup, infos.map((a) => a.t)) : null; let idx = 0, args = [];
        if (sup.ctors.length && !k) this.err(first ? first.line : line, "constructor " + sup.name + " in class " + sup.name + " cannot be applied to given types;\n  required: " + (sup.ctors[0].params.length ? sup.ctors[0].params.map(tName).join(",") : "no arguments") + "\n  found:    " + (infos.length ? this.describeArgs(infos) : "no arguments") + "\n  reason: actual and formal argument lists differ in length");
        if (k) { idx = k.idx; args = this.buildArgs(k, infos, ctx, ci.supType, first ? first.line : line); }
        const outer = !sup.isStatic && sup.outer ? (sup.outer === ci.outer || (ci.outer && this.isSubClass(ci.outer, sup.outer)) ? (!ci.isStatic && ci.outer ? "$o" : this.outerInstanceFor(sup, ctx, line)) : this.outerInstanceFor(sup, ctx, line)) + (args.length ? ", " : "") : "";
        out.push("super.$c" + sup.id + "_" + idx + "(" + outer + args.join(", ") + ");");
      } else if (ci.supName && ci.supName !== "$Enum" && ci.supName !== "$Record") {
        const infos = first ? this.argInfos(first.args, ctx) : []; out.push("super.$c(" + infos.map((a) => this.boxE(this.finishArg(a, ctx))).join(", ") + ");");
      }
      out.push("this.$f" + ci.id + "();");
    }
    if (opts.compact) { /* compact record ctor: params are locals, then assign */ }
    const sub = ctx; const body = rest.map((s) => this.stmt(s, sub));
    if (opts.compact) { for (const r of ci.decl.rec) { out.push("this._" + r.name + " = " + jsId(r.name) + ";"); } }
    return out.concat(body).join("\n");
  }
  emitClass(ci, ctxOuter) {
    this.resolveClass(ci); this.prepClass(ci); const d = ci.decl; const J = ci.js; const parts = [];
    const sup = ci.sup ? ci.sup.js : ci.kind === "enum" ? "$Enum" : ci.kind === "record" ? "$Record" : ci.supName ? "$L." + ci.supName : "$JObject";
    const base = this.baseCtx(ci, false); const sbase = this.baseCtx(ci, true);
    const own = []; const instFields = []; for (const [n, f] of ci.fields) if (!f.static && f.owner === ci && !f.enumConst) instFields.push(f);
    own.push("constructor() { super();" + instFields.map((f) => " this." + f.js + " = " + this.defVal(f.t) + ";").join("") + " }");
    // $f: instance initializers in order
    { const frames = base.frames.concat([{ locals: new Map() }]); const ctx = Object.assign({}, base, { frames, fnBase: frames.length - 1, retType: tVoid, inInit: true }); const code = [];
      this.curTP = this.tpScope(ci);
      for (const m of d.members) {
        if (m.k === "field" && !m.mods.has("static") && m.init) { const f = ci.fields.get(m.name); const e = m.init.k === "arrinit" ? this.arrInit(m.init, ctx, f.t) : this.ex(m.init, ctx, f.t); code.push("this." + f.js + " = " + this.conv(e, f.t, m.line, "assign") + ";"); }
        else if (m.k === "init" && !m.static) code.push(this.block(m.body, ctx));
      }
      own.push("$f" + ci.id + "() {\n" + this.fnPrologue(ctx, false) + code.join("\n") + "\n}"); }
    // constructors
    if (ci.kind !== "interface" && !ci.decl.anon) {
      const ctors = ci.ctors.length ? ci.ctors : [{ params: [], pnames: [], decl: null, idx: 0, cls: ci, line: d.line }];
      for (const c of ctors) {
        const pd = c.params.map((t, i) => ({ t, name: c.pnames[i] })); const node = c.decl && c.decl.body ? c.decl.body : (c.decl ? { stmts: [], end: c.line } : null);
        const compact = c.decl && c.decl.compact; const auto = c.auto;
        let r;
        if (auto) { const stmts = []; r = this.emitFn(ci, base, { line: c.line, tparams: [] }, tVoid, pd, { stmts: [], end: c.line }, { ctor: true, compact: true, mname: ci.name }); }
        else r = this.emitFn(ci, base, { line: c.line, tparams: [] }, tVoid, pd, node || { stmts: [], end: c.line }, { ctor: true, compact, mname: ci.name });
        const outerP = !ci.isStatic && ci.outer ? "$o" + (r.pjs.length ? ", " : "") : "";
        r.code = outerP ? r.code.replace(/^\{\n/, "{\nthis.$outer = $o;\n") : r.code;
        own.push("$c" + ci.id + "_" + c.idx + "(" + outerP + r.pjs.join(", ") + ") " + r.code);
      }
    }
    // methods
    for (const [name, ms] of ci.methods) for (const m of ms) {
      if (m.builtin) continue; const md = m.decl;
      if (m.accessor !== undefined && !md) { own.push(m.js + "() { return this._" + m.accessor + "; }"); continue; }
      if (!md || !md.body) continue;
      const pd = m.params.map((t, i) => ({ t, name: m.pnames[i] }));
      const r = this.emitFn(ci, m.static ? sbase : base, m, m.ret, pd, md.body, { isStatic: m.static, mname: name });
      own.push((m.static ? "static " : "") + m.js + "(" + r.pjs.join(", ") + ") " + r.code);
    }
    if (d.kind === "record") for (const rc of d.rec) { const ms = ci.methods.get(rc.name); if (ms && ms.some((m) => m.decl && !m.decl.body === false)) {} }
    // statics
    const stat = []; { const frames = sbase.frames.concat([{ locals: new Map() }]); const ctx = Object.assign({}, sbase, { frames, fnBase: frames.length - 1, retType: tVoid, inInit: true });
      this.curTP = this.tpScope(ci);
      const sinit = [];
      if (ci.sup && ci.sup.needInit) sinit.push(ci.sup.js + ".$ci();");
      if (ci.kind === "enum") {
        const names = [];
        d.consts.forEach((c, i) => { names.push(J + "." + c.name); const infos = this.argInfos(c.args, ctx); let k = ci.ctors.length ? this.pickCtor(ci, infos.map((a) => a.t)) : null; if (ci.ctors.length && !k) this.err(c.line, "no suitable constructor found for " + ci.name + "(" + this.describeArgs(infos) + ")"); const args = k ? this.buildArgs(k, infos, ctx, this.selfType(ci), c.line) : []; const cn = "$c" + ci.id + "_" + (k ? k.idx : 0);
          if (c.body) { const bd = c.body; bd.ext = { n: ci.name }; const bci = this.declare(bd, ci, null); bci.isStatic = true; bci.local = false; this.resolveClass(bci); this.computeMangling(); this.prepClass(bci); bci.isStatic = true; const bcode = this.emitClass(bci); sinit.push("{ " + bcode + " const o = new " + bci.js + "().$en(" + JSON.stringify(c.name) + ", " + i + "); o." + cn + "(" + args.join(", ") + "); o.$f" + bci.id + "(); " + J + "." + c.name + " = o; }"); }
          else sinit.push(J + "." + c.name + " = new " + J + "().$en(" + JSON.stringify(c.name) + ", " + i + ")." + cn + "(" + args.join(", ") + ");"); });
        sinit.push(J + ".$all = [" + names.join(", ") + "];");
      }
      for (const m of d.members) {
        if (m.k === "field" && m.mods.has("static") && m.init) { const f = ci.fields.get(m.name); const e = m.init.k === "arrinit" ? this.arrInit(m.init, ctx, f.t) : this.ex(m.init, ctx, f.t); sinit.push(J + "." + f.js + " = " + this.conv(e, f.t, m.line, "assign") + ";"); }
        else if (m.k === "field" && ci.kind === "interface" && m.init) { const f = ci.fields.get(m.name); const e = this.ex(m.init, ctx, f.t); sinit.push(J + "." + f.js + " = " + this.conv(e, f.t, m.line, "assign") + ";"); }
        else if (m.k === "init" && m.static) sinit.push(this.block(m.body, ctx));
      }
      if (ci.needInit) stat.push("static $ci() { if (" + J + ".hasOwnProperty('$done')) return; " + J + ".$done = true;\n" + this.fnPrologue(ctx, true) + sinit.join("\n") + "\n}");
    }
    if (ci.kind === "enum") stat.push("static $values() { " + J + ".$ci(); return " + J + ".$all.slice(); }", "static $valueOf(s) { " + J + ".$ci(); return $enumValueOf(" + J + ", s); }");
    if (ci.decl.anon && ci.kind !== "enum") own.push("$ac(sc, a) { " + (ci.sup ? "super[sc](...a);" : (ci.supName && ci.supName !== "$Record" ? "if (super.$c) super.$c(...a);" : "")) + " this.$f" + ci.id + "(); return this; }");
    let code = "class " + J + " extends " + sup + " {\n" + own.concat(stat).join("\n") + "\n}\n";
    for (const [n, f] of ci.fields) if (f.static && f.owner === ci && !f.enumConst) code += J + "." + f.js + " = " + this.defVal(f.t) + ";\n";
    { const chain = []; for (let c = ci; c; c = c.outer) chain.unshift(c.name); const bin = ci.decl.anon ? ci.name : ci.local && ci.outer ? (chain.slice(0, -1).join("$") + "$1" + ci.name) : chain.join("$"); code += J + ".$full = " + JSON.stringify(bin) + "; " + J + ".$canon = " + JSON.stringify(chain.join(".")) + "; "; }
    code += J + ".$name = " + JSON.stringify(ci.name.replace(/\$\d+$/, "")) + "; " + J + ".$ifs = [" + ci.ifaces.map((i) => this.classes.get(i.n)).filter(Boolean).map((i) => i.js).join(", ") + "]; " + J + ".$lib = [" + ci.ifaces.filter((i) => !this.classes.get(i.n)).map((i) => JSON.stringify(i.n)).join(", ") + "];\n";
    if (d.kind === "record") code += J + ".$rf = " + JSON.stringify(d.rec.map((r) => r.name)) + "; " + J + ".$rk = " + JSON.stringify(d.rec.map((r) => this.kindChar(this.rt(r.type, ci)))) + ";\n";
    ci.emitted = true;
    if (ci.local || ci.decl.anon) code += "$impl(" + J + ");\n";
    return code;
  }
  kindChar(t) { return isPrim(t) ? { int: "I", long: "J", double: "D", float: "F", char: "C", boolean: "Z", short: "I", byte: "I" }[t.n] : "L"; }
  // ---------- driver ----------
  compileAll() {
    for (const ci of this.order.slice()) this.resolveClass(ci);
    this.computeMangling();
    for (const ci of this.order.slice()) this.prepClass(ci);
    const top = this.order.filter((c) => !c.local && !c.decl.anon);
    const done = new Set(); const sorted = []; const visit = (c) => { if (done.has(c)) return; done.add(c); if (c.sup) visit(c.sup); sorted.push(c); };
    top.forEach(visit);
    this.checkCycles(sorted);
    const code = sorted.map((c) => this.emitClass(c)).join("\n") + "\n" + sorted.map((c) => "$impl(" + c.js + ");").join("\n");
    return code;
  }
  checkCycles(list) { for (const c of list) { let n = 0; for (let x = c.sup; x; x = x.sup) if (++n > 100) { this.err(c.decl.line, "cyclic inheritance involving " + c.name); break; } } }
}

/* ===== RT glue ===== */
class $Enum extends JObject {
  $en(n, o) { this.$nm = n; this.$ord = o; return this; }
  name() { return this.$nm; } ordinal() { return this.$ord; } toString() { return this.$nm; }
  compareTo(o) { return this.$ord - o.$ord; } equals(o) { return this === o; }
  getDeclaringClass() { let c = this.constructor; while (c && !Object.prototype.hasOwnProperty.call(c, "$all")) c = Object.getPrototypeOf(c); return new JClass(c); }
}
const kstr = (k, v) => k === "D" ? dstr(v) : k === "F" ? fstr(v) : k === "C" ? String.fromCharCode(v) : k === "L" ? str(v) : String(v);
class $Record extends JObject {
  toString() { const C = this.constructor; return C.$name + "[" + C.$rf.map((n, i) => n + "=" + kstr(C.$rk[i], this["_" + n])).join(", ") + "]"; }
  equals(o) { if (o === null || o === undefined || o.constructor !== this.constructor) return false; const C = this.constructor; return C.$rf.every((n, i) => C.$rk[i] === "L" ? eq(this["_" + n], o["_" + n]) : this["_" + n] === o["_" + n] || (C.$rk[i] === "D" && this["_" + n] !== this["_" + n] && o["_" + n] !== o["_" + n])); }
  hashCode() { const C = this.constructor; let h = 0; C.$rf.forEach((n, i) => { const v = this["_" + n]; const k = C.$rk[i]; h = (Math.imul(h, 31) + (k === "L" ? hash(v) : k === "D" ? hash(bd(v)) : k === "Z" ? (v ? 1231 : 1237) : k === "J" ? hash(v) : k === "F" ? hash(bf(v)) : v | 0)) | 0; }); return h; }
}
function enumValueOf(C, s) { if (s === null) npe("Name is null"); const r = C.$all.find((e) => e.$nm === s); if (!r) throw mk("IllegalArgumentException", "No enum constant " + (C.$canon || C.$name) + "." + s); return r; }
const hasI = (C, I) => { for (let k = C; k && k !== JObject; k = Object.getPrototypeOf(k)) { if (k === I) return true; if (Object.prototype.hasOwnProperty.call(k, "$ifs") && k.$ifs.some((x) => hasI(x, I))) return true; } return false; };
const hasLib = (C, n) => { for (let k = C; k && k !== JObject; k = Object.getPrototypeOf(k)) { if (Object.prototype.hasOwnProperty.call(k, "$lib") && k.$lib.includes(n)) return true; if (Object.prototype.hasOwnProperty.call(k, "$ifs") && k.$ifs.some((x) => hasLib(x, n))) return true; } return false; };
const cceMsg = (o, to) => { const nm = (x) => x === null ? "null" : typeof x === "string" ? "java.lang.String" : typeof x === "number" ? "java.lang.Integer" : typeof x === "bigint" ? "java.lang.Long" : x instanceof JDouble ? "java.lang.Double" : (x.constructor.$full || x.constructor.$name); return "class " + nm(o) + " cannot be cast to class " + to; };
function impl(C) { const seen = new Set(); const walk = (I) => { if (seen.has(I)) return; seen.add(I); for (const k of Object.getOwnPropertyNames(I.prototype)) if (k !== "constructor" && !(k in C.prototype)) Object.defineProperty(C.prototype, k, { value: I.prototype[k], writable: true, configurable: true }); (I.$ifs || []).forEach(walk); }; (Object.prototype.hasOwnProperty.call(C, "$ifs") ? C.$ifs : []).forEach(walk); }
const numInv = (o, name, a) => {
  const t = typeof o;
  switch (name) { case "equals": return eq(o, a[0]); case "hashCode": return hash(o); case "toString": return String(o); case "compareTo": case "compare": return cmp(o, a[0]);
    case "intValue": return t === "bigint" ? Number(BigInt.asIntN(32, o)) : o; case "longValue": return t === "bigint" ? o : BigInt(o); case "doubleValue": return Number(o); case "booleanValue": return o; case "shortValue": return (Number(o) << 16) >> 16; case "byteValue": return (Number(o) << 24) >> 24; case "floatValue": return Math.fround(Number(o)); case "isNaN": return false; }
  throw mk("RuntimeException", "no method " + name + " on boxed value");
};
const __jc = {}; function jclassOf(n) { return __jc[n] || (__jc[n] = new JClass({ $name: n, $full: "java.lang." + n })); }
function stackLines(e) { const L = RT.$LN; const ln = e && e.$ln ? e.$ln : L.l; const m = L.map[ln]; if (!m) return "\tat Main.main(Main.java)"; return "\tat " + m + "(Main.java:" + ln + ")"; }
function inv(o, name, a) {
  if (o === null || o === undefined) npe("Cannot invoke \"" + name + "()\" because value is null");
  const t = typeof o;
  if (name === "getClass" && (t === "number" || t === "bigint" || t === "boolean")) { const n = t === "number" ? "Integer" : t === "bigint" ? "Long" : "Boolean"; return jclassOf(n); }
  if (t === "string") { if (S[name]) return S[name](o, ...a); }
  else if (t === "function") return callf(o, name, a);
  else if (t === "number" || t === "bigint" || t === "boolean") return numInv(o, name, a);
  else if (typeof o[name] === "function") return o[name](...a);
  else if (o instanceof JDouble || o instanceof JFloat || o instanceof JChar) { if (name === "intValue") return o instanceof JChar ? o.v : d2i(o.v); if (name === "doubleValue") return Number(o.v); if (name === "longValue") return d2l(o.v); if (name === "charValue") return o.v; }
  throw mk("RuntimeException", "no method " + name + " on " + (o.constructor && o.constructor.name));
}
const invu = (o, js, name, a) => { if (o === null || o === undefined) npe(); return typeof o[js] === "function" ? o[js](...a) : inv(o, name, a); };
const UNBX = { int: ui, short: ui, byte: ui, long: ul, double: ud, float: uf, char: uc, boolean: ub };
const unbx = (v, k) => UNBX[k](v);
function castC(o, C) { if (o === null || o === undefined || o instanceof C) return o; throw mk("ClassCastException", cceMsg(o, C.$full || C.$name)); }
function castU(o, C) { if (o === null || o === undefined) return o; if (C.$isIface ? hasI(o.constructor, C) : o instanceof C) return o; throw mk("ClassCastException", cceMsg(o, C.$full || C.$name)); }
function castS(o) { if (o === null || typeof o === "string") return o; throw mk("ClassCastException", cceMsg(o, "java.lang.String")); }
function castB(o, n) { if (o === null) return o; const ok = n === "Integer" || n === "Short" || n === "Byte" ? typeof o === "number" : n === "Long" ? typeof o === "bigint" : n === "Double" ? o instanceof JDouble : n === "Float" ? o instanceof JFloat : n === "Character" ? o instanceof JChar : n === "Boolean" ? typeof o === "boolean" : true; if (!ok) throw mk("ClassCastException", cceMsg(o, "java.lang." + n)); return o; }
function instLib(o, n) {
  if (o === null || o === undefined) return false;
  switch (n) {
    case "Object": return true; case "String": return typeof o === "string"; case "Integer": case "Short": case "Byte": return typeof o === "number"; case "Long": return typeof o === "bigint";
    case "Double": return o instanceof JDouble; case "Float": return o instanceof JFloat; case "Character": return o instanceof JChar; case "Boolean": return typeof o === "boolean";
    case "Number": return typeof o === "number" || typeof o === "bigint" || o instanceof JDouble || o instanceof JFloat || o instanceof BigInteger || o instanceof BigDecimal;
    case "CharSequence": return typeof o === "string" || o instanceof StringBuilder;
    case "Comparable": return typeof o === "string" || typeof o === "number" || typeof o === "bigint" || o instanceof JDouble || o instanceof JChar || (typeof o === "object" && hasLib(o.constructor, "Comparable"));
    case "Collection": case "Iterable": return o instanceof JColl || hasLib(o.constructor, n);
    case "List": return o instanceof ArrayList && !(o instanceof ArrayDeque) || hasLib(o.constructor, n);
    case "Set": return o instanceof HashSet || o instanceof TreeSet || hasLib(o.constructor, n);
    case "Map": return o instanceof HashMap || o instanceof TreeMap || hasLib(o.constructor, n);
    case "Runnable": case "Callable": case "Supplier": case "Function": return typeof o === "function" || hasLib(o.constructor, n);
  }
  if (EXC[n]) return o instanceof EXC[n];
  const L = LIBS[n]; if (typeof L === "function" && o instanceof L) return true;
  return typeof o === "object" && hasLib(o.constructor, n);
}
function mref(cls, name) {
  return (...a) => {
    if (cls === "Math") { const k = a.some((x) => x instanceof JDouble || x instanceof JFloat) ? "D" : a.some((x) => typeof x === "bigint") ? "L" : "I"; const raw = a.map((x) => (x instanceof JDouble || x instanceof JFloat ? x.v : (k === "L" && typeof x === "number" ? BigInt(x) : x))); const nm = ["max", "min", "abs", "floorMod", "floorDiv", "addExact", "multiplyExact"].includes(name) ? name + k : name; const f = Math_[nm] || Math_[name]; const r = f(...(k === "D" || !["max", "min", "abs"].includes(name) && !/Exact|floor/.test(name) ? raw.map(Number) : raw)); return typeof r === "number" && (k === "D" || !/I$/.test(nm) && !/Exact|floor|abs|max|min/.test(name)) ? bd(r) : r; }
    if (cls === "String") { if (["valueOf", "format", "join", "copyValueOf"].includes(name)) return name === "valueOf" || name === "copyValueOf" ? (a[0] instanceof Uint16Array ? String.fromCharCode(...a[0]) : str(a[0])) : name === "format" ? fmt(a[0], a.slice(1)) : (a.length === 2 && typeof a[1] !== "string" && a[1] && a[1].toArray ? a[1].toArray() : a.slice(1)).map(str).join(str(a[0])); return inv(a[0], name, a.slice(1)); }
    const L = LIBS[cls];
    if (L && typeof L[name] === "function" && !(cls === "Integer" && ["compareTo", "equals", "intValue", "doubleValue", "longValue", "hashCode"].includes(name)) && !(["Double", "Long", "Character", "Boolean", "Float"].includes(cls) && ["compareTo", "equals", "intValue", "doubleValue", "longValue", "hashCode", "charValue", "booleanValue"].includes(name))) {
      const cvt = cls === "Double" || cls === "Float" || cls === "Character" ? a.map((x) => (x instanceof JDouble || x instanceof JFloat || x instanceof JChar ? x.v : x)) : a;
      const r = L[name](...cvt);
      if (cls === "Double" && typeof r === "number" && /^(sum|max|min|parseDouble)$/.test(name)) return bd(r);
      if (cls === "Character" && typeof r === "number" && /^(toUpperCase|toLowerCase)$/.test(name)) return bc(r);
      return r;
    }
    return inv(a[0], name, a.slice(1));
  };
}
function newU(C, a) { const ct = C.$ct || []; const m = ct.find((c) => c[1].length === a.length); if (!m) throw mk("RuntimeException", "no constructor"); const o = new C(); return o[m[0]](...a.map((x, i) => (UNBX[m[1][i]] ? unbx(x, m[1][i]) : x))); }
Entry.comparingByKey = (c) => { const f = cmpFn(c); return (a, b) => f(a.k, b.k); }; Entry.comparingByValue = (c) => { const f = cmpFn(c); return (a, b) => f(a.v, b.v); };
const LIBS = { String: { CASE_INSENSITIVE_ORDER: (a, b) => S.compareToIgnoreCase(a, b) }, Integer, Long, Double, Float, Short, Byte, Character, Boolean: Boolean_, Math: Math_, System: Sys, Arrays, Collections, Objects, List, Set: Set_, Map: Map_, Entry, AbstractMap, Comparator, Function: Function_, Iterator: Iterator_, Optional, OptionalInt, OptionalDouble: Optional, OptionalLong: Optional, ArrayList, LinkedList, Vector, ArrayDeque, CopyOnWriteArrayList, Stack, HashMap, LinkedHashMap, Hashtable, ConcurrentHashMap: HashMap, TreeMap, HashSet, LinkedHashSet, TreeSet, PriorityQueue, StringBuilder, StringBuffer, Scanner: JScanner, BufferedReader, StringReader, InputStreamReader, StringTokenizer, PrintWriter, BufferedWriter, OutputStreamWriter, Random, Thread, AtomicInteger, AtomicLong, AtomicBoolean, AtomicReference, IntStream, LongStream, DoubleStream, Stream, Collectors, BigInteger, BigDecimal, RoundingMode, TimeUnit, ThreadLocalRandom: Random };
Object.assign(LIBS, EXC);
const RT = { $L: LIBS, $S: S, $Enum, $Record, $JObject: JObject, $enumValueOf: enumValueOf, $impl: impl, $inv: inv, $invu: invu, $unbx: unbx, $cast: castU, $castS: castS, $castB: castB, $instLib: instLib, $mref: mref, $newu: newU, $new: newU,
  $isI: (o, I) => o !== null && o !== undefined && typeof o === "object" && hasI(o.constructor, I), $isArr: (o) => Array.isArray(o) || ArrayBuffer.isView(o),
  $ai: (a, i) => a[ci(a, i)], $len: (a) => a.length, $refeq: (a, b) => (typeof a === "number" && typeof b === "number") || (typeof a === "bigint" && typeof b === "bigint") ? a === b && a >= -128 && a <= 127 : a === b, $cloneArr: (a) => a.slice(), $sjoin: (sep, it) => Array.from(iter(it), (x) => str(x)).join(sep),
  $cls: (n) => new JClass({ $name: n }), $mkEx: (n, m) => mk(n, m === undefined ? null : m), $lam: (C, n, f) => { const o = Object.create(C.prototype); o[n] = f; return o; }, $anon: (C, sc, a) => new C().$ac(sc, a),
  $LN: $LNS, $iter: iter, $wrapEx: wrapEx, $fn: fn, $callf: callf, $bf: bf, $bd: bd, $bc: bc, $str: str, $nn: nn, $d2i: d2i, $d2l: d2l, $idiv: idiv, $imod: imod, $ldiv: ldiv, $lmod: lmod, $lshl: lshl, $lshr: lshr, $lushr: lushr, $dstr: dstr, $fstr: fstr, $sstr: sstr, $cstr: cstr, $charsToStr: charsToStr,
  $ui: ui, $ul: ul, $ud: ud, $uf: uf, $uc: uc, $ub: ub, $dyn: dyn, $dynneg: dynneg, $newArr: newArr, $newMulti: newMulti, $mkArr: mkArr, $eq: eq, $hash: hash, $fmt: fmt, $ci: ci, $LW: L };
/* ===== driver ===== */
function compileJava(src) {
  let ast; src = src.replace(/\bjava\.(?:util\.(?:function|stream|concurrent(?:\.atomic)?)|util|io|lang|math|text|time)\./g, "");
  try { ast = parseJava(src); } catch (e) { if (e instanceof JErr) return { errors: [{ line: e.jline, msg: e.message }] }; throw e; }
  const comp = new Compiler(ast);
  let code;
  try {
    for (const d of ast) comp.declare(d, null, null);
    code = comp.compileAll(); if (comp.lineMap) code = "RT.$LN.map = " + JSON.stringify(comp.lineMap) + ";\n" + code;
  } catch (e) { if (e instanceof JErr) return { errors: [{ line: e.jline, msg: e.message }] }; if (comp.errors.length) return { errors: comp.errors.map((x) => ({ line: x.line, msg: x.msg })) }; throw e; }
  if (comp.errors.length) { const seen = new Set(); const errs = comp.errors.filter((x) => { const k = x.line + x.msg; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.line - b.line); return { errors: errs.map((x) => ({ line: x.line, msg: x.msg })) }; }
  let mainCls = null; for (const c of comp.order) { if (c.local || c.decl.anon) continue; const ms = c.methods.get("main"); if (ms && ms.some((m) => m.static && m.params.length === 1 && m.params[0].arr)) { if (!mainCls || c.name === "Main") mainCls = c; } }
  if (!mainCls) return { errors: [{ line: 1, msg: "error: no main method found" }] };
  const mm = mainCls.methods.get("main").find((m) => m.static && m.params.length === 1);
  const names = new Set(code.match(/\$[A-Za-z_][A-Za-z0-9_]*/g) || []); const used = [...names].filter((n) => Object.prototype.hasOwnProperty.call(RT, n));
  const js = "const {" + used.join(", ") + "} = RT;\n" + code + "\nreturn () => { " + (mainCls.needInit ? mainCls.js + ".$ci(); " : "") + mainCls.js + "." + mm.js + "([]); };";
  return { js, mainName: mainCls.name };
}
function runJava(js, stdin, out) {
  __out = out; __stdin = stdin || ""; __stdinPos = 0;
  let code = 0;
  try { const start = new Function("RT", js)(RT); start(); }
  catch (e0) {
    let e = e0; if (e && e.$exit) return e.code | 0; if (typeof process !== "undefined" && process.env.QJDEBUG) console.error(e0 && e0.stack);
    try { e = wrapEx(e0); } catch (x) { if (x && x.$exit) return x.code | 0; throw x; }
    let s = "Exception in thread \"main\" " + e.toString() + "\n" + stackLines(e) + "\n"; out("stderr", s); code = 1;
  }
  return code;
}
if (typeof module !== "undefined" && module.exports) module.exports = { compileJava, runJava, RT };
if (typeof self !== "undefined" && typeof self.postMessage === "function" && typeof window === "undefined") {
  self.onmessage = (ev) => {
    const m = ev.data; const buf = []; let n = 0; let t0 = Date.now();
    const flush = () => { if (buf.length) { self.postMessage({ type: "out", chunks: buf.splice(0) }); } };
    const out = (k, s) => { buf.push([k, s]); n += s.length; if (buf.length > 200 || Date.now() - t0 > 50) { flush(); t0 = Date.now(); } };
    const c = compileJava(m.src);
    if (c.errors) { self.postMessage({ type: "compile-error", errors: c.errors }); return; }
    self.postMessage({ type: "compiled" });
    const code = runJava(c.js, m.stdin, out); flush(); self.postMessage({ type: "done", code });
  };
}

})();
