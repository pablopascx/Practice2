// ---------- Global state ----------
let firstNumber = null; // first operand of a binary operation
let operator = null;    // "+" or "*"
let busy = false;       // true while a CSV operation is "loading"
const errorLog = [];    // errors recorded for later download

const MAX = 1e15;       // limit for entered numbers
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const $ = (id) => document.getElementById(id);
const display = $("display");
const infoEl = $("info");
const INITIAL_INFO = "Information about the number";

// ---------- Helpers ----------
const fmt = (n) => String(parseFloat(n.toPrecision(12)));

const validate = (raw, type = "number") => {
  const text = String(raw).trim();
  if (text === "") {
    return { ok: false, error: type === "csv"
      ? "Empty list: enter values separated by commas" : "Empty field: enter a number" };
  }
  if (type === "number") {
    if (!NUMBER_RE.test(text)) return { ok: false, error: `Invalid number: "${text}" is not a valid number` };
    const n = Number(text);
    if (Math.abs(n) > MAX) return { ok: false, error: `Number out of range: use values between -${MAX} and ${MAX}` };
    return { ok: true, value: n };
  }
  const parts = text.split(",").map((p) => p.trim());
  if (parts.some((p) => p === "")) return { ok: false, error: "Incomplete list: there is an empty value between or after commas" };
  const bad = parts.find((p) => !NUMBER_RE.test(p));
  if (bad !== undefined) return { ok: false, error: `Invalid value in list: "${bad}" is not a valid number` };
  const values = parts.map(Number);
  if (values.some((v) => Math.abs(v) > MAX)) return { ok: false, error: `Value out of range in list: use values between -${MAX} and ${MAX}` };
  return { ok: true, value: values };
};

const fill_info = (result, override = "") => {
  if (override) { infoEl.textContent = override; return; }
  if (Array.isArray(result)) { infoEl.textContent = "Info: List of values processed"; return; }
  if (result < 100) infoEl.textContent = "Info: The result is less than 100";
  else if (result <= 200) infoEl.textContent = "Info: The result is between 100 and 200";
  else infoEl.textContent = "Info: The result is greater than 200";
};

const showMessage = (text, isError = false, input = "", info = "") => {
  const msg = $("message");
  msg.textContent = text;
  msg.classList.toggle("error", isError);
  display.setAttribute("aria-invalid", String(isError));
  if (isError) {
    errorLog.push({ time: new Date().toISOString(), input, message: text });
    infoEl.textContent = info || "Info: No result because of an error";
  }
};

const showResult = (result, note = "", infoOverride = "") => {
  display.value = Array.isArray(result) ? result.map(fmt).join(",") : fmt(result);
  showMessage(note);
  fill_info(result, infoOverride);
};

const setLoading = (on) => {
  busy = on;
  $("calculator").classList.toggle("loading", on);
  $("calculator").setAttribute("aria-busy", String(on));
};

// ---------- Unary operations (arrow functions) ----------
const unary = (name, fn) => {
  const input = display.value;
  const v = validate(input);
  if (!v.ok) return showMessage(v.error, true, input);
  try {
    const { result, info = "" } = fn(v.value);
    if (Number.isNaN(result)) throw new Error("Invalid operation: the result is not a real number");
    if (!Number.isFinite(result)) throw new Error("Number out of range: the result is too large");
    showResult(result, `Operation: ${name}`, info);
  } catch (e) {
    showMessage(e.message, true, input, e.info);
  }
};

const square = () => unary("square", (x) => ({ result: x * x }));
const cube = () => unary("cube", (x) => ({ result: x * x * x }));
const mod = () => unary("modulus", (x) => ({ result: x < 0 ? -x : x }));

const fact = () => unary("factorial", (x) => {
  if (!Number.isInteger(x) || x < 0) throw new Error("Invalid input: factorial needs a non-negative integer");
  if (x > 170) throw new Error("Number out of range: factorial is limited to 170");
  let r = 1;
  for (let i = 2; i <= x; i++) r *= i;
  return { result: r };
});

const sqrt = () => unary("square root", (x) => {
  if (x < 0) {
    const err = new Error("Cannot calculate the square root of a negative number");
    err.info = "Info: The number is negative";
    throw err;
  }
  return { result: Math.sqrt(x), info: x === 0 ? "Info: The number is zero" : "Info: The number is positive" };
});

const power = () => {
  const e = validate($("exponent").value);
  if (!e.ok) return showMessage(`Exponent field: ${e.error}`, true, $("exponent").value);
  unary(`power (exponent ${fmt(e.value)})`, (x) => ({ result: x ** e.value }));
};

// ---------- Binary operations ----------
const setOperator = (op) => {
  const input = display.value;
  const v = validate(input);
  if (!v.ok) return showMessage(v.error, true, input);
  firstNumber = v.value;
  operator = op;
  display.value = "";
  $("pending").textContent = `${fmt(firstNumber)} ${SYMBOLS[op]} ...`;
  showMessage("Enter the second number and press equal");
};

const SYMBOLS = { "+": "+", "-": "\u2212", "*": "\u00d7", "/": "\u00f7" };
const NAMES = { "+": "addition", "-": "subtraction", "*": "multiplication", "/": "division" };

const addition = () => setOperator("+");
const subtraction = () => setOperator("-");
const multiplication = () => setOperator("*");
const division = () => setOperator("/");

const eq = () => {
  if (operator === null) return showMessage("No operation pending: press addition, subtraction, multiplication or division first", true, display.value);
  const input = display.value;
  const v = validate(input);
  if (!v.ok) return showMessage(`Second number: ${v.error}`, true, input);
  if (operator === "/" && v.value === 0) return showMessage("Division by zero is not allowed: enter a non-zero second number", true, input);
  const ops = {
    "+": (a, b) => a + b,
    "-": (a, b) => a - b,
    "*": (a, b) => a * b,
    "/": (a, b) => a / b,
  };
  const result = ops[operator](firstNumber, v.value);
  const name = NAMES[operator];
  firstNumber = null;
  operator = null;
  $("pending").textContent = "";
  if (!Number.isFinite(result)) return showMessage("Number out of range: the result is too large", true, input);
  showResult(result, `Operation: ${name}`);
};

// ---------- CSV operations ----------
const csv = (name, fn, rawInput = display.value) => {
  if (busy) return;
  const input = display.value;
  const v = validate(input, "csv");
  if (!v.ok) return showMessage(v.error, true, input);
  setLoading(true);
  setTimeout(() => {
    try {
      showResult(fn(v.value), `Operation: ${name}`);
    } catch (e) {
      showMessage(e.message, true, input);
    } finally {
      setLoading(false);
    }
  }, 400);
};

const sum = () => csv("sum", (l) => l.reduce((a, b) => a + b, 0));
const average = () => csv("average", (l) => l.reduce((a, b) => a + b, 0) / l.length);
const sort = () => csv("sort", (l) => [...l].sort((a, b) => a - b));
const reverse = () => csv("reverse", (l) => [...l].reverse());
const removelast = () => csv("remove last", (l) => l.slice(0, -1));

const removeelements = () => {
  const target = validate($("remove").value, "csv");
  if (!target.ok) return showMessage(`Values to delete: ${target.error}`, true, $("remove").value);
  csv("remove elements", (l) => {
    const out = l.filter((x) => !target.value.includes(x));
    if (out.length === l.length) throw new Error("None of the values to delete were found in the list");
    return out;
  });
};

// ---------- Utilities ----------
const clearAll = () => {
  firstNumber = null;
  operator = null;
  display.value = "";
  $("exponent").value = "";
  $("remove").value = "";
  $("pending").textContent = "";
  showMessage("");
  infoEl.textContent = INITIAL_INFO;
  display.focus();
};

const downloadLog = () => {
  if (errorLog.length === 0) return showMessage("The error log is empty: no errors recorded yet");
  const text = errorLog.map((e) => `[${e.time}] input="${e.input}" -> ${e.message}`).join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "calculator-error-log.txt";
  a.click();
  URL.revokeObjectURL(url);
  showMessage(`Error log downloaded (${errorLog.length} entries)`);
};

// ---------- UX: shortcuts, tooltips, pressed highlight ----------
const shortcuts = {};
document.querySelectorAll("button[data-code]").forEach((btn) => {
  const code = btn.dataset.code;
  const label = code.replace(/^(Key|Digit)/, "");
  shortcuts[code] = btn;
  btn.title = `${btn.textContent.trim()} (Alt+${label})`;
  btn.setAttribute("aria-keyshortcuts", `Alt+${label}`);
});

document.addEventListener("keydown", (e) => {
  if (e.altKey && shortcuts[e.code]) {
    e.preventDefault();
    shortcuts[e.code].click();
  } else if (e.key === "Escape") {
    clearAll();
  } else if (e.key === "Enter" && e.target === display && operator !== null) {
    e.preventDefault();
    eq();
  }
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  document.querySelectorAll("button.pressed").forEach((b) => b.classList.remove("pressed"));
  btn.classList.add("pressed");
  setTimeout(() => btn.classList.remove("pressed"), 700);
});