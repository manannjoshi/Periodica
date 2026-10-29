"use strict";

/* ================= sample data ================= */
const WEEK = { days: ["Mon", "Tue", "Wed", "Thu", "Fri"], startTime: "08:30", dayEnd: "16:20", periodMinutes: 50, breakMinutes: 10 };

const PEOPLE = {
  RS: "Richa Singh", AY: "Aarti Yadav", VY: "Vipin Yadav", RY: "Raveena Yadav",
  AkM: "Akanksha Mathur", ArM: "Arohi Mathur", T1: "Teaching Assistant 1", T2: "Teaching Assistant 2",
};
// Two teaching assistants are demo placeholders. The ERP confirms the faculty of section F only;
// for A-E, G and H the same faculty rotate.
const SAMPLE_ROOMS = [
  "RN 037", "RN 135", "RN 303", "N 205", "RN 216",
  "RN 223 (CAD LAB)", "LAB1", "LAB2", "LAB3",
];

// Meetings per week are trimmed from the ERP week of section F (FOCP-I 5, CSL120 3, MAL151 3, CSL110 2,
// MEP110 2 labs) so that every section sits at about 3 meetings a day, never more than 4 on the section's
// timetable. CSL110, its lab, the MAL151 lab and MEP110 run in two batches (CS 11 and CS 12) that can sit
// in separate rooms at the same time, which is why the two batches of a course have different faculty
// (except section F, where the ERP names one faculty for the whole course).
// Columns: course, batch, meetings/week, periods/meeting.
const CLASS_TEMPLATE = [
  ["CSL106N", "", 3, 1],
  ["CSL120", "", 2, 1],
  ["MAL151", "", 2, 1],
  ["MAL151L", "CS 11", 1, 2],
  ["MAL151L", "CS 12", 1, 2],
  ["CSL110", "CS 11", 1, 1],
  ["CSL110", "CS 12", 1, 1],
  ["CSL110L", "CS 11", 1, 2],
  ["CSL110L", "CS 12", 1, 2],
  ["MEP110", "CS 11", 1, 2],
  ["MEP110", "CS 12", 1, 2],
];
// Teacher of each template row, per section.
const SAMPLE_FACULTY = {
  A: ["T1", "RY", "ArM", "AY", "T2", "VY", "AkM", "RS", "ArM", "AY", "RS"],
  B: ["T1", "T2", "ArM", "T2", "T1", "T2", "RS", "T2", "VY", "AY", "T1"],
  C: ["RY", "AY", "ArM", "T1", "RS", "VY", "AY", "AkM", "AY", "AY", "ArM"],
  D: ["AkM", "T2", "RY", "AkM", "T2", "RY", "AkM", "T2", "RS", "AkM", "AY"],
  E: ["T1", "RS", "RY", "ArM", "RY", "AY", "ArM", "T2", "AkM", "T2", "RY"],
  F: ["VY", "VY", "VY", "T2", "RY", "RS", "AkM", "ArM", "T2", "ArM", "RS"],
  G: ["VY", "AkM", "VY", "T2", "VY", "ArM", "VY", "RS", "ArM", "RS", "T1"],
  H: ["AkM", "RY", "VY", "ArM", "AY", "AkM", "T1", "AY", "T1", "RS", "RY"],
};
const SAMPLE_EXTRA = { F: [["MME001", "", 1, 1, "AkM"]] }; // F only

function sampleData() {
  const row = (section, [code, batch, n, span], who) =>
    ({ code, section, batch, teacher: PEOPLE[who], blocksPerWeek: n, blockPeriods: span, roomType: "class", size: 0 });
  const courses = [];
  for (const [section, who] of Object.entries(SAMPLE_FACULTY)) {
    CLASS_TEMPLATE.forEach((t, i) => courses.push(row(section, t, who[i])));
    for (const t of SAMPLE_EXTRA[section] || []) courses.push(row(section, t, t[4]));
  }
  return {
    ...WEEK,
    teachers: Object.values(PEOPLE).join("\n"),
    rooms: SAMPLE_ROOMS.join("\n"),
    courses,
  };
}

/* ================= state ================= */
// teachers and rooms are kept as the text typed in the setup panel and parsed on demand,
// so a typo never loses a line.
const KEY = "periodica.data.v7";
const THEME_KEY = "periodica.theme.v2";
const SETUP_KEY = "periodica.setup.v2";

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: keep going */ } },
};

let pendingSharedResult = null;
let state = load();
let lastResult = null;       // { model, assignment, info } of the timetable on screen
let generation = 0;          // Generate press counter, retained in share links
let rescheduleMode = false;
let rescheduleSel = null;    // { sessionIdx }

function emptyData() {
  return {
    ...WEEK,
    teachers: "",
    rooms: "",
    courses: [],
    otherBlocks: "",
    otherBlocksArr: [],
  };
}

function load() {
  // try share link first
  try {
    if (typeof location !== 'undefined' && location.hash && location.hash.length > 1) {
      var b64 = location.hash.slice(1);
      var json = decodeURIComponent(escape(atob(b64)));
      var sd2 = JSON.parse(json);
      if (sd2 && typeof sd2 === "object" && sd2.__share) {
        pendingSharedResult = sd2.__share;
        delete sd2.__share;
      }
      if (typeof sd2.otherBlocks !== "string") sd2.otherBlocks = "";
      if (!Array.isArray(sd2.otherBlocksArr)) sd2.otherBlocksArr = [];
      return sd2;
    }
  } catch(e) {}
  try {
    const s = JSON.parse(store.get(KEY));
    if (s && Array.isArray(s.courses) && Array.isArray(s.days) && typeof s.teachers === "string" && typeof s.rooms === "string") {
      if (typeof s.otherBlocks !== "string") s.otherBlocks = "";
      if (!Array.isArray(s.otherBlocksArr)) s.otherBlocksArr = [];
      return s;
    }
  } catch (e) { /* fall through */ }
  return emptyData();
}
function save() { store.set(KEY, JSON.stringify(state)); }

function syncOtherBlocksArr() {
  if (!Array.isArray(state.otherBlocksArr)) state.otherBlocksArr = [];
  // try to parse legacy
  if (state.otherBlocks && typeof state.otherBlocks === "string" && state.otherBlocks.trim()) {
    const tlist = (state.teachers||"").split("\n").map(x=>x.trim()).filter(Boolean);
    for (const line of state.otherBlocks.split("\n")) {
      const l = line.trim();
      if (!l) continue;
      const parts = l.split("|").map(x=>x.trim());
      if (parts.length < 3) continue;
      const teacher = parts[0];
      if (tlist.length && !tlist.includes(teacher)) continue;
      const day = parts[1];
      let m;
      if ((m = parts[2].match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/))) {
        // can't map time to periods easily; skip legacy for now
        continue;
      }
      if ((m = parts[2].match(/(\d+)\s*-\s*(\d+)/))) {
        const from = +m[1], to = +m[2];
        state.otherBlocksArr.push({teacher, day, from, to});
      }
    }
    state.otherBlocks = "";
  }
}

function renderOtherBlocks() {
  syncOtherBlocksArr();
  let tlist = (state.teachers||"").split("\n").map(x=>x.trim()).filter(Boolean);
  if ((!tlist || tlist.length === 0) && typeof parseTeachers === "function") {
    try { tlist = parseTeachers(state.teachers).items.map(x=>x.name); } catch(e){}
  }
  const days = Array.isArray(state.days)?state.days:[];
  const periods = Math.max(1, Number(state.periods)||8);
  const obT = document.getElementById("obTeacher");
  const obD = document.getElementById("obDay");
  const obF = document.getElementById("obFrom");
  const obTo = document.getElementById("obTo");
  if (obT) {
    obT.innerHTML = "";
    if (!tlist.length) {
      const o=document.createElement("option"); o.value=""; o.textContent="No teachers"; obT.appendChild(o);
    } else {
      tlist.forEach(t => { const o=document.createElement("option"); o.value=t; o.textContent=t; obT.appendChild(o); });
    }
  }
  if (obD) {
    obD.innerHTML = "";
    days.forEach(d => { const o=document.createElement("option"); o.value=d; o.textContent=d; obD.appendChild(o); });
  }
  if (obF) {
    obF.innerHTML = "";
    for (let i=1;i<=periods;i++){ const o=document.createElement("option"); o.value=i; o.textContent=i; obF.appendChild(o); }
    if (obF.options.length) obF.value = "1";
  }
  if (obTo) {
    obTo.innerHTML = "";
    for (let i=1;i<=periods;i++){ const o=document.createElement("option"); o.value=i; o.textContent=i; obTo.appendChild(o); }
    if (obTo.options.length) obTo.value = periods;
  }
  const tb = document.getElementById("obRows");
  const wrap = document.getElementById("obTableWrap");
  if (wrap) {
    wrap.style.display = (state.otherBlocksArr && state.otherBlocksArr.length > 0) ? "" : "none";
  }
  if (tb) {
    tb.innerHTML = "";
    state.otherBlocksArr.forEach((b, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${esc(b.teacher)}</td><td>${esc(b.day)}</td><td>${b.from}-${b.to}</td><td><button type="button" class="ghost" data-idx="${idx}">Remove</button></td>`;
      tb.appendChild(tr);
    });
    tb.querySelectorAll("button").forEach(btn => {
      btn.onclick = () => {
        const i = +btn.dataset.idx;
        state.otherBlocksArr.splice(i,1);
        save();
        renderOtherBlocks();
      };
    });
  }
}

document.getElementById("obAdd")?.addEventListener("click", () => {
  syncOtherBlocksArr();
  const t = document.getElementById("obTeacher")?.value;
  const d = document.getElementById("obDay")?.value;
  const f = +document.getElementById("obFrom")?.value || 1;
  const to = +document.getElementById("obTo")?.value || f;
  if (!t || !d) { alert("Add teachers and days first"); return; }
  if (f > to) { alert("From must be <= To"); return; }
  state.otherBlocksArr.push({teacher:t, day:d, from:f, to:to});
  save();
  renderOtherBlocks();
});

/* ================= helpers ================= */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function parseTime(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
}
function fmt(mins) {
  return String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
}

/* the periods of one day: class, break, class, ... until the day ends */
function periodTemplate() {
  const len = Math.max(0, Math.floor(Number(state.periodMinutes) || 0));
  const gap = Math.max(0, Math.floor(Number(state.breakMinutes) || 0));
  const start = parseTime(state.startTime), end = parseTime(state.dayEnd);
  if (start == null || end == null || len === 0 || end <= start) return [];
  const out = [];
  for (let t = start; t + len <= end; t += len + gap) out.push({ start: t, end: t + len });
  return out;
}

/* "CSL110 F/CS 11" - works for a class row and for a session */
function label(x) {
  return (x.code || "(no code)") + " " + (x.section || "?") + (x.batch ? "/" + x.batch : "");
}

/* ================= teachers and rooms: text -> data ================= */
function splitLines(text) {
  return String(text).split("\n")
    .map((raw, i) => ({ no: i + 1, blank: !raw.trim(), parts: raw.split("|").map(p => p.trim()) }))
    .filter(l => !l.blank);
}

/* "Aarti Yadav | Mon, Fri"  ->  { name, off: ["Mon", "Fri"] } */
function parseTeachers(text) {
  const items = [], errors = [], seen = new Set();
  for (const { no, parts } of splitLines(text)) {
    const [name, dayText = ""] = parts;
    if (!name) { errors.push(`line ${no}: the name is missing.`); continue; }
    if (parts.length > 2) { errors.push(`line ${no}: use one "|" only (name | days).`); continue; }
    if (seen.has(name.toLowerCase())) { errors.push(`line ${no}: ${name} is listed twice.`); continue; }
    const off = [], unknown = [];
    for (const d of dayText.split(/[\s,]+/).filter(Boolean)) {
      const day = state.days.find(x => x.toLowerCase() === d.toLowerCase());
      if (!day) unknown.push(d); else if (!off.includes(day)) off.push(day);
    }
    if (unknown.length) {
      errors.push(`line ${no}: ${unknown.join(", ")} ${unknown.length > 1 ? "are" : "is"} not one of the days (${state.days.join(", ")}).`);
      continue;
    }
    seen.add(name.toLowerCase());
    items.push({ name, off });
  }
  return { items, errors };
}

/* "LAB1 | lab | 60"  ->  { name, type: "lab", capacity: 60 } */
function parseRooms(text) {
  const items = [], errors = [], seen = new Set();
  for (const { no, parts } of splitLines(text)) {
    const name = parts[0]?.trim();
    if (!name) { errors.push(`line ${no}: the name is missing.`); continue; }
    if (seen.has(name.toLowerCase())) { errors.push(`line ${no}: ${name} is listed twice.`); continue; }
    seen.add(name.toLowerCase());
    items.push({ name });
  }
  return { items, errors };
}

/* ================= setup panel ================= */
function renderSlotPreview() {
  const t = periodTemplate();
  if (!t.length) {
    $("slotPreview").textContent = "Check the start time, period length and day end.";
    return;
  }
  $("slotPreview").textContent = "";
}

function renderStatus(id, parsed, noun) {
  const el = $(id), n = parsed.items.length, errs = parsed.errors;
  el.className = "status" + (errs.length ? " bad" : "");
  el.textContent = errs.length
    ? errs.slice(0, 4).join("\n") + (errs.length > 4 ? "\n+" + (errs.length - 4) + " more" : "")
    : n + " " + noun + (n === 1 ? "" : "s");
}
function renderPeople() {
  renderStatus("teachersStatus", parseTeachers(state.teachers), "teacher");
  renderStatus("roomsStatus", parseRooms(state.rooms), "room");
}

function renderCourses() {
  const names = parseTeachers(state.teachers).items.map(t => t.name);
  const cell = (c, i, f, cls, extra = "") =>
    `<td><input ${cls ? `class="${cls}" ` : ""}data-i="${i}" data-f="${f}" value="${esc(c[f] == null ? "" : c[f])}" ${extra}></td>`;
  const selectCell = (c, i, f, options) => {
    const current = c[f] == null ? "" : String(c[f]);
    const list = options.slice();
    if (!list.some(([v]) => v === current)) list.push([current, current || "Auto"]);
    const html = list.map(([v, label]) =>
      `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(label)}</option>`).join("");
    return `<td><select data-i="${i}" data-f="${f}">${html}</select></td>`;
  };

  $("courseRows").innerHTML = state.courses.map((c, i) => {
    const opts = names.slice();
    if (c.teacher && !opts.includes(c.teacher)) opts.unshift(c.teacher);
    const teacherOpts = opts.map(n =>
      `<option value="${esc(n)}"${n === c.teacher ? " selected" : ""}>${esc(n)}${names.includes(n) ? "" : " (not in list)"}</option>`).join("");
    const times = [["", "Auto"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"], ["7", "7"], ["8", "8"]];
    return `<tr data-idx="${i}">
      <td class="sel"><input type="checkbox" class="row-sel" data-idx="${i}" style="width:16px;height:16px"></td>
      ${cell(c, i, "code", "w-code")}
      ${cell(c, i, "section", "w-sec")}
      ${cell(c, i, "batch", "w-sec", 'placeholder="all"')}
      <td><select data-i="${i}" data-f="teacher">${teacherOpts}</select></td>
      ${selectCell(c, i, "blocksPerWeek", times)}
      <td><button class="del" data-del="${i}" aria-label="Delete this class row">x</button></td>
    </tr>`;
  }).join("");

  renderCopyOptions();
  renderLoad();
}

function renderCopyOptions() {
  const sel = $("copyFrom"), prev = sel.value;
  const secs = [...new Set(state.courses.map(c => c.section).filter(Boolean))];
  sel.innerHTML = secs.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join("");
  if (secs.includes(prev)) sel.value = prev;
}

/* classes a week per section, so the "about 3 a day" target can be checked while editing */
function renderLoad() {
  const counts = meetingCounts(), bySection = {};
  state.courses.forEach((c, i) => { if (c.section) bySection[c.section] = (bySection[c.section] || 0) + counts[i]; });
  const secs = Object.keys(bySection), days = state.days.length;
  if (!secs.length || !days) { $("load").textContent = ""; return; }
  const perDay = secs.map(s => bySection[s] / days);
  const lo = Math.min(...perDay).toFixed(1), hi = Math.max(...perDay).toFixed(1);
  $("load").textContent = "Classes per week: " + secs.map(s => s + " " + bySection[s]).join(" · ") +
    "  (about " + (lo === hi ? lo : lo + "-" + hi) + " per day per section)";
}

function renderAll() {
  $("days").value = state.days.join(",");
  $("startTime").value = state.startTime || "";
  $("periodMinutes").value = state.periodMinutes || "";
  $("breakMinutes").value = state.breakMinutes || 0;
  $("dayEnd").value = state.dayEnd || "";
  $("teachers").value = state.teachers;
  $("rooms").value = state.rooms;
  if ($("otherBlocks")) $("otherBlocks").value = state.otherBlocks || "";
  renderSlotPreview();
  renderPeople();
  renderCourses();
  renderOtherBlocks();
}

/* ================= setup panel: input handling ================= */
const NUMERIC = new Set(["blockPeriods"]);

$("courseRows").addEventListener("input", e => {
  const { i, f } = e.target.dataset;
  const row = state.courses[+i];
  if (!row || !f) return;
  const v = e.target.value;
  if (f === "blocksPerWeek") row[f] = v === "" ? "" : Math.max(0, Math.floor(Number(v) || 0));
  else row[f] = NUMERIC.has(f) ? Number(v) || 0 : v;
  save();
  renderLoad();
  if (f === "section") renderCopyOptions();
});
$("courseRows").addEventListener("click", e => {
  const b = e.target.closest("[data-del]");
  if (!b) return;
  state.courses.splice(+b.dataset.del, 1);
  save();
  renderCourses();
  return;
});

function updateBatchActions() {
  const classesSec = document.getElementById("classesSec");
  const isCollapsed = classesSec ? classesSec.classList.contains("collapsed") : false;
  const checked = document.querySelectorAll(".row-sel:checked").length;
  const ba = document.getElementById("batchActions");
  if (ba) ba.style.display = (!isCollapsed && checked > 0) ? "flex" : "none";
}

// Select all
document.getElementById("selectAll")?.addEventListener("change", e => {
  document.querySelectorAll(".row-sel").forEach(cb => { cb.checked = e.target.checked; });
  updateBatchActions();
});

document.getElementById("courseRows")?.addEventListener("change", e => {
  if (e.target.classList.contains("row-sel")) {
    const all = document.querySelectorAll(".row-sel");
    const checked = document.querySelectorAll(".row-sel:checked");
    const sa = document.getElementById("selectAll");
    if (sa) sa.checked = all.length > 0 && all.length === checked.length;
    updateBatchActions();
  }
});

// Batch actions
$("batchDelete")?.addEventListener("click", () => {
  const indices = [...document.querySelectorAll(".row-sel:checked")].map(cb => +cb.dataset.idx).sort((a,b)=>b-a);
  if (!indices.length) return alert("Select rows first");
  if (!confirm(`Delete ${indices.length} selected row(s)?`)) return;
  indices.forEach(i => state.courses.splice(i, 1));
  save();
  renderCourses();
  const sa = document.getElementById("selectAll");
  if (sa) sa.checked = false;
  updateBatchActions();
});

$("batchDuplicate")?.addEventListener("click", () => {
  const indices = [...document.querySelectorAll(".row-sel:checked")].map(cb => +cb.dataset.idx);
  if (!indices.length) return alert("Select rows first");
  alert("Duplicates not allowed. Use 'Split to CS 11 & CS 12' to create batches, or manually edit the cloned row after copying a single row.");
});

$("batchSplit")?.addEventListener("click", () => {
  const checked = [...document.querySelectorAll(".row-sel:checked")].map(cb => +cb.dataset.idx);
  if (!checked.length) return alert("Select rows first");
  const valid = checked.filter(i => {
    const c = state.courses[i];
    return c && (!c.batch || !c.batch.trim());
  }).sort((a, b) => b - a);

  if (!valid.length) return alert("Selected rows already have batches or none are valid to split.");

  valid.forEach(i => {
    const c = state.courses[i];
    const c1 = { ...c, batch: "CS 11" };
    const c2 = { ...c, batch: "CS 12" };
    state.courses.splice(i, 1, c1, c2);
  });

  save();
  renderCourses();
  const sa = document.getElementById("selectAll");
  if (sa) sa.checked = false;
  updateBatchActions();
});

$("teachers").addEventListener("input", e => { state.teachers = e.target.value; save(); renderPeople(); renderCourses(); renderOtherBlocks(); });
$("rooms").addEventListener("input", e => { state.rooms = e.target.value; save(); renderPeople(); renderLoad(); });
if ($("otherBlocks")) $("otherBlocks").addEventListener("input", e => { state.otherBlocks = e.target.value; save(); });

const weekFields = {
  days: v => v.split(",").map(s => s.trim()).filter(Boolean),
  startTime: v => v,
  periodMinutes: v => Number(v) || 0,
  breakMinutes: v => Number(v) || 0,
  dayEnd: v => v,
};
for (const [id, read] of Object.entries(weekFields)) {
  $(id).addEventListener("input", e => {
    state[id] = read(e.target.value);
    save();
    renderSlotPreview();
    if (id === "days") { renderPeople(); renderLoad(); renderOtherBlocks(); } // blocked days are checked against the day list
    else if (id === "startTime" || id === "periodMinutes" || id === "breakMinutes" || id === "dayEnd") { renderOtherBlocks(); }
  });
}

$("addCourse").onclick = () => {
  const first = parseTeachers(state.teachers).items[0];
  state.courses.unshift({ code: "", section: "", batch: "", teacher: first ? first.name : "", blocksPerWeek: "", blockPeriods: 1, roomType: "class", size: 40 });
  save();
  renderCourses();
};

$("doCopy").onclick = () => {
  const from = $("copyFrom").value, to = $("copyAs").value.trim();
  if (!from || !to || to === from) return;
  const rows = state.courses.filter(c => c.section === from).map(c => ({ ...c, section: to }));
  if (!rows.length) return;
  state.courses.push(...rows);
  save();
  renderCourses();
  $("copyAs").value = "";
};

function resetData(next) {
  state = next;
  if (!state.otherBlocksArr) state.otherBlocksArr = [];
  if (!Array.isArray(state.days)) state.days = [];
  save();
  renderAll();
  showResult(null);
  setMsg("");
}
$("sample").onclick = () => { if (confirm("Replace the current setup with the sample data?")) resetData(sampleData()); };
$("clear").onclick = () => {
  if (confirm("Clear all teachers, rooms and classes?")) resetData(emptyData());
};

/* ================= model ================= */
/* How many times each class row meets in a week. A blank cell means "auto": 2-4 times,
   fewer if the rooms cannot hold more. */
function meetingCounts() {
  const rooms = parseRooms(state.rooms).items;
  const sectionsOfCode = {};
  for (const c of state.courses)
    if (c.code && c.section) (sectionsOfCode[c.code] = sectionsOfCode[c.code] || new Set()).add(c.section);

  return state.courses.map(c => {
    if (c.blocksPerWeek !== "" && c.blocksPerWeek != null) return Math.max(0, Math.floor(Number(c.blocksPerWeek) || 0));
    let h = 0;
    for (const ch of c.code || "") h = (h * 31 + ch.charCodeAt(0)) % 997;
    const roomCount = rooms.length;
    const sections = (sectionsOfCode[c.code] || { size: 1 }).size || 1;
    return Math.min(2 + (h % 3), Math.max(1, Math.floor(roomCount * state.days.length / sections)));
  });
}

/* Everything the solver, the checks and the reschedule tool share.

   Resources are numbered so one flat busy table can answer "is it free?" for all of them:
   teachers 0..T-1, then rooms, then "atoms". An atom is a group of students that can only be
   in one place at a time: a whole section, or one batch of a section that has batches.
   A batch class occupies its own atom; a whole-section class occupies every atom of the section.
   That one rule replaces all the batch special cases. */
function buildModel() {
  const periods = periodTemplate(), per = periods.length;
  const slots = [];
  state.days.forEach((day, di) => periods.forEach((p, k) =>
    slots.push({ day, di, index: k, start: p.start, end: p.end, label: fmt(p.start) + "–" + fmt(p.end) })));
  const N = slots.length;

  const rooms = parseRooms(state.rooms).items;
  const teachers = parseTeachers(state.teachers).items;
  const teacherId = {};
  teachers.forEach((t, i) => { teacherId[t.name] = i; });

  // offSlot is laid out like the first rows of the busy table: a blocked teacher slot starts out taken
  const offSlot = new Uint8Array(Math.max(1, teachers.length * N));
  teachers.forEach((t, ti) => slots.forEach((sl, si) => { if (t.off.includes(sl.day)) offSlot[ti * N + si] = 1; }));

  // Apply other commitments from outside programs (MBA/BA/MTech/ECE etc)
  const hasOtherBlocks = Array.isArray(state.otherBlocksArr) && state.otherBlocksArr.length;
  if (hasOtherBlocks || state.otherBlocks) {
    const dayMap = {};
    state.days.forEach((d, di) => { dayMap[d.toLowerCase()] = di; dayMap[d.slice(0,3).toLowerCase()] = di; });

    if (hasOtherBlocks) {
      for (const b of state.otherBlocksArr) {
        const tid = teacherId[b.teacher];
        if (tid === undefined) continue;
        const dayStr = String(b.day || "").toLowerCase();
        const di = dayMap[dayStr] ?? dayMap[dayStr.slice(0,3)];
        if (di === undefined) continue;
        const from = Math.max(1, Math.floor(Number(b.from) || 1));
        const to = Math.max(from, Math.floor(Number(b.to) || from));
        for (let p = from - 1; p <= to - 1; p++) {
          if (p >= 0 && p < per) offSlot[tid * N + di * per + p] = 1;
        }
      }
    }

    for (const line of (state.otherBlocks || "").split("\n")) {
      const parts = line.split("|").map(x => x.trim()).filter(Boolean);
      if (parts.length < 3) continue;
      const tname = parts[0];
      const tid = teacherId[tname];
      if (tid === undefined) continue;
      const dayStr = parts[1].toLowerCase();
      let di = dayMap[dayStr] ?? dayMap[dayStr.slice(0,3)];
      if (di === undefined) continue;
      const range = parts[2];
      // Try period numbers like "2-3" or "2 to 3"
      const pm = range.match(/(\d+)\s*-\s*(\d+)/);
      if (pm) {
        const p1 = +pm[1] - 1, p2 = +pm[2] - 1;
        for (let k = Math.min(p1,p2); k <= Math.max(p1,p2); k++) {
          if (k >= 0 && k < per) offSlot[tid * N + di * per + k] = 1;
        }
        continue;
      }
      // Try time range like "09:00-11:00"
      const tm = range.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
      if (tm) {
        const s1 = +tm[1]*60 + +tm[2], e1 = +tm[3]*60 + +tm[4];
        for (let k = 0; k < per; k++) {
          const ps = slots[di*per + k].start;
          const pe = slots[di*per + k].end;
          if (ps >= s1 && pe <= e1) offSlot[tid * N + di * per + k] = 1;
        }
      }
    }
  }

  const roomBase = teachers.length;
  let resCount = roomBase + rooms.length;
  const atomId = {};
  const atom = (sec, batch) => atomId[sec + "|" + batch] != null ? atomId[sec + "|" + batch] : (atomId[sec + "|" + batch] = resCount++);

  const batchesOf = {};
  for (const c of state.courses) if (c.section && c.batch) (batchesOf[c.section] = batchesOf[c.section] || new Set()).add(c.batch);
  const atomsFor = (sec, batch) =>
    batch ? [atom(sec, batch)] : batchesOf[sec] ? [...batchesOf[sec]].map(b => atom(sec, b)) : [atom(sec, "")];

  const sectionIndex = {};
  const counts = meetingCounts();
  const sessions = [];
  state.courses.forEach((c, row) => {
    const span = Math.max(1, Math.floor(Number(c.blockPeriods) || 1));
    const tid = teacherId[c.teacher] != null ? teacherId[c.teacher] : -1;
    if (sectionIndex[c.section] == null) sectionIndex[c.section] = Object.keys(sectionIndex).length;
    const atoms = atomsFor(c.section, c.batch);
    for (let k = 0; k < counts[row]; k++)
      sessions.push({
        row, code: c.code, section: c.section, batch: c.batch || "", teacher: c.teacher || "",
        roomType: "class", size: 0, span,
        tid, sec: sectionIndex[c.section], atoms,
        res: tid >= 0 ? [tid, ...atoms] : atoms,   // every non-room resource the session occupies
      });
  });

  // start positions where a block of `span` periods fits inside one day
  const startMemo = {};
  const starts = span => startMemo[span] || (startMemo[span] = slots.map((_, si) => si)
    .filter(si => si % per + span <= per));

  return {
    slots, N, per, days: state.days, rooms, teachers, sessions, offSlot, roomBase, resCount,
    secCount: Object.keys(sectionIndex).length, rowCount: state.courses.length, starts,
  };
}

const eligibleRooms = (model, s) =>
  model.rooms.map((r, ri) => ri);

/* every (start, room) a session could legally take if the rest of the week were empty */
function buildDomains(model) {
  return model.sessions.map(s => {
    const dom = [];
    const roomsOk = eligibleRooms(model, s);
    for (const si of model.starts(s.span)) {
      if (s.tid >= 0 && Array.from({ length: s.span }, (_, k) => model.offSlot[s.tid * model.N + si + k]).some(Boolean)) continue;
      for (const ri of roomsOk) dom.push({ si, ri, room: model.rooms[ri].name });
    }
    return dom;
  });
}

/* ================= validation / diagnosis ================= */
function diagnose(model, domains) {
  const { slots, N, per, rooms, sessions } = model;
  const out = [
    ...parseTeachers(state.teachers).errors.map(e => "Teachers, " + e),
    ...parseRooms(state.rooms).errors.map(e => "Rooms, " + e),
  ];

  if (!state.days.length) out.push("No teaching days defined.");
  if (parseTime(state.startTime) == null || parseTime(state.dayEnd) == null) out.push("Start or end time is not valid.");
  else if (parseTime(state.dayEnd) <= parseTime(state.startTime)) out.push("The day ends before it starts.");
  else if (!per) out.push("No period fits between the start and end time. Check period length and break.");
  if (!rooms.length) out.push("No rooms defined.");
  if (!sessions.length) out.push("No classes defined.");

  const seen = new Set();
  const dupSet = new Set();
  const keys = [];
  state.courses.forEach((c, idx) => {
    const key = `${c.code}|${c.section}|${c.batch||''}|${c.teacher}|${c.blocksPerWeek}`;
    keys.push(key);
  });
  keys.forEach((k, idx) => {
    if (keys.filter(x => x === k).length > 1) dupSet.add(idx);
  });
  state.courses.forEach((c, idx) => {
    const name = label(c);
    if (!c.code) out.push("A class row has no course code.");
    if (!c.section) out.push(`${name}: no section.`);
    if (c.teacher && !model.teachers.some(t => t.name === c.teacher)) out.push(`${name}: teacher "${c.teacher}" is not in the teacher list.`);
    if (c.blocksPerWeek !== "" && Number(c.blocksPerWeek) <= 0) out.push(`${name}: meetings per week must be at least 1 (or blank).`);
    if (dupSet.has(idx)) out.push(`${name}: exact duplicate of another row. Change teacher/batch/meetings or use 'Split to CS 11 & CS 12' or delete one of them.`);
  });
  if (out.length) return [...new Set(out)];   // the checks below assume a well-formed setup

  // a class with nowhere to go at all
  const reported = new Set();
  sessions.forEach((s, i) => {
    if (domains[i].length || reported.has(s.row)) return;
    reported.add(s.row);
    if (!eligibleRooms(model, s).length) out.push(`${label(s)}: no ${s.roomType} room available.`);
    else if (s.tid >= 0 && !model.starts(s.span).some(si => !model.offSlot[s.tid * N + si])) out.push(`${label(s)}: ${s.teacher} is unavailable on every day.`);
    else out.push(`${label(s)}: no legal time or room.`);
  });

  // simple counting limits, so an impossible setup is explained instead of searched
  const need = new Map();   // resource -> periods needed
  for (const s of sessions) for (const r of s.res) need.set(r, (need.get(r) || 0) + s.span);
  model.teachers.forEach((t, ti) => {
    const free = slots.filter((_, si) => !model.offSlot[ti * N + si]).length;
    if ((need.get(ti) || 0) > free) out.push(`${t.name}: teaches ${need.get(ti)} periods a week but is free for only ${free}.`);
  });
  const demand = sessions.reduce((a, s) => a + s.span, 0);
  const supply = N * rooms.length;
  if (demand > supply) out.push(`rooms: ${demand} periods needed, only ${supply} room-periods exist.`);
  const atomNames = {};
  for (const s of sessions) s.atoms.forEach(a => { atomNames[a] = s.section + (s.batch ? "/" + s.batch : ""); });
  for (const a of Object.keys(atomNames))
    if ((need.get(+a) || 0) > N) out.push(`${atomNames[a]}: needs ${need.get(+a)} periods a week, only ${N} exist.`);

  return [...new Set(out)];
}

/* ================= shared state tables ================= */
/* Which (resource, period) places are taken. Used by the solver, the balancing pass and the
   reschedule tool, so "is this slot free?" has exactly one definition. */
function makeBoard(model) {
  const { N, roomBase } = model;
  const busy = new Uint8Array(model.resCount * N);
  busy.set(model.offSlot.subarray(0, model.teachers.length * N));   // blocked teacher days

  const taken = (r, si, span) => {
    for (let k = 0; k < span; k++) if (busy[r * N + si + k]) return true;
    return false;
  };
  return {
    free(s, si, ri) {
      if (taken(roomBase + ri, si, s.span)) return false;
      for (const r of s.res) if (taken(r, si, s.span)) return false;
      return true;
    },
    put(s, si, ri, on) {
      for (let k = 0; k < s.span; k++) {
        busy[(roomBase + ri) * N + si + k] = on ? 1 : 0;
        for (const r of s.res) busy[r * N + si + k] = on ? 1 : 0;
      }
    },
    /* what stops `s` from starting at `si`: "teacher", "room", "section" or null */
    blockedBy(s, si, roomsOk) {
      if (s.tid >= 0 && taken(s.tid, si, s.span)) return "teacher";
      if (roomsOk.every(ri => taken(roomBase + ri, si, s.span))) return "room";
      if (s.atoms.some(a => taken(a, si, s.span))) return "section";
      return null;
    },
  };
}

function boardFrom(model, assignment, skip = -1) {
  const board = makeBoard(model);
  assignment.forEach((a, i) => { if (a && i !== skip) board.put(model.sessions[i], a.si, a.ri, true); });
  return board;
}

/* How evenly the week is spread. Every table is a count, and the cost is a weighted sum of
   squares, so adding one more class to a busy day costs more than adding it to a quiet one:
   the "marginal" cost of a placement is exactly the cost increase it causes. */
const W = { secDay: 3, teaDay: 2, secPeriod: 1, teaPeriod: 1, sameDay: 100, room: 0.001 };

function makeTally(model) {
  const D = model.days.length, P = model.per;
  const secDay = new Int32Array(model.secCount * D), secPer = new Int32Array(model.secCount * P);
  const teaDay = new Int32Array(model.teachers.length * D), teaPer = new Int32Array(model.teachers.length * P);
  const rowDay = new Int32Array(model.rowCount * D), roomUse = new Int32Array(model.rooms.length);
  const sl = model.slots;

  return {
    add(s, si, ri, d) {
      const { di, index } = sl[si];
      secDay[s.sec * D + di] += d * s.span;
      teaDay[s.tid * D + di] += s.tid >= 0 ? d * s.span : 0;
      rowDay[s.row * D + di] += d;
      roomUse[ri] += d * s.span;
      for (let k = 0; k < s.span; k++) {
        const period = sl[si + k].index;
        secPer[s.sec * P + period] += d;
        if (s.tid >= 0) teaPer[s.tid * P + period] += d;
      }
    },
    marginal(s, si, ri) {
      const { di } = sl[si], dayAmount = s.span;
      let c = W.secDay * (2 * secDay[s.sec * D + di] * dayAmount + dayAmount * dayAmount)
            + W.room * (2 * roomUse[ri] * dayAmount + dayAmount * dayAmount);
      if (s.tid >= 0) c += W.teaDay * (2 * teaDay[s.tid * D + di] * dayAmount + dayAmount * dayAmount);
      for (let k = 0; k < s.span; k++) {
        const period = sl[si + k].index;
        c += W.secPeriod * (2 * secPer[s.sec * P + period] + 1);
        if (s.tid >= 0) c += W.teaPeriod * (2 * teaPer[s.tid * P + period] + 1);
      }
      if (rowDay[s.row * D + di] > 0) c += W.sameDay;   // same class twice in one day
      return c;
    },
  };
}

/* ================= solver ================= */
const MAX_NODES = 200000;   // safety nets for setups that have no solution; a valid setup never gets near them
const MAX_MS = 3000;

/* Find a valid timetable, improve it locally, then use bounded branch-and-bound to
   find a lower-scoring schedule. Results are deterministic for the same setup. */
function solve(model, domains) {
  const { sessions } = model;
  const n = sessions.length;
  const board = makeBoard(model), tally = makeTally(model);
  const assignment = new Array(n).fill(null);
  const t0 = performance.now();
  let nodes = 0, backtracks = 0, gaveUp = false;

  function search(placed) {
    if (placed === n) return true;
    if (++nodes > MAX_NODES || performance.now() - t0 > MAX_MS) { gaveUp = true; return false; }

    let pick = -1, fewest = Infinity;
    for (let i = 0; i < n; i++) {
      if (assignment[i]) continue;
      const s = sessions[i], dom = domains[i];
      let count = 0;
      for (let j = 0; j < dom.length && count <= fewest; j++) if (board.free(s, dom[j].si, dom[j].ri)) count++;
      if (count === 0) return false;
      if (count < fewest || (count === fewest && s.span > sessions[pick].span)) { fewest = count; pick = i; }
    }

    const s = sessions[pick];
    const options = [];
    for (const v of domains[pick])
      if (board.free(s, v.si, v.ri)) options.push({ v, cost: tally.marginal(s, v.si, v.ri) });
    options.sort((a, b) => a.cost - b.cost || a.v.si - b.v.si || a.v.ri - b.v.ri);

    for (const { v } of options) {
      assignment[pick] = v; board.put(s, v.si, v.ri, true); tally.add(s, v.si, v.ri, 1);
      if (search(placed + 1)) return true;
      assignment[pick] = null; board.put(s, v.si, v.ri, false); tally.add(s, v.si, v.ri, -1);
      backtracks++;
      if (gaveUp) return false;
    }
    return false;
  }

  const ok = search(0);
  if (!ok) return { ok, assignment, backtracks, gaveUp, optimal: false };
  improve(model, assignment, domains);

  const objective = candidate => {
    const scoreTally = makeTally(model);
    let score = 0;
    candidate.forEach((a, i) => {
      const s = sessions[i];
      score += scoreTally.marginal(s, a.si, a.ri);
      scoreTally.add(s, a.si, a.ri, 1);
    });
    return score;
  };
  let bestAssignment = assignment.map(a => ({ ...a }));
  let bestScore = objective(bestAssignment);
  let optimal = false;
  let optNodes = 0;
  const optBoard = makeBoard(model), optTally = makeTally(model);
  const work = new Array(n).fill(null);
  const OPT_MAX_NODES = 300000;
  const OPT_MAX_MS = 1800;

  function optimize(placed, score) {
    if (placed === n) {
      if (score < bestScore - 1e-9) {
        bestScore = score;
        bestAssignment = work.map(a => ({ ...a }));
      }
      return;
    }
    if (++optNodes > OPT_MAX_NODES || performance.now() - t0 > MAX_MS + OPT_MAX_MS) {
      gaveUp = true;
      return;
    }
    if (score >= bestScore - 1e-9) return;

    let pick = -1, fewest = Infinity;
    for (let i = 0; i < n; i++) {
      if (work[i]) continue;
      const s = sessions[i];
      let count = 0;
      for (const v of domains[i]) if (optBoard.free(s, v.si, v.ri)) count++;
      if (!count) return;
      if (count < fewest || (count === fewest && (pick < 0 || s.span > sessions[pick].span))) {
        fewest = count; pick = i;
      }
    }
    const s = sessions[pick];
    const choices = domains[pick].filter(v => optBoard.free(s, v.si, v.ri))
      .map(v => ({ v, cost: optTally.marginal(s, v.si, v.ri) }))
      .sort((a, b) => a.cost - b.cost || a.v.si - b.v.si || a.v.ri - b.v.ri);
    for (const { v, cost } of choices) {
      if (score + cost >= bestScore - 1e-9) continue;
      work[pick] = v;
      optBoard.put(s, v.si, v.ri, true); optTally.add(s, v.si, v.ri, 1);
      optimize(placed + 1, score + cost);
      optBoard.put(s, v.si, v.ri, false); optTally.add(s, v.si, v.ri, -1);
      work[pick] = null;
      if (optNodes > OPT_MAX_NODES || performance.now() - t0 > MAX_MS + OPT_MAX_MS) return;
    }
  }

  optimize(0, 0);
  optimal = !gaveUp;
  return { ok, assignment: bestAssignment, backtracks, gaveUp, optimal, optNodes };
}

/* Balancing pass: take each class out, put it back where it adds the least cost, repeat until
   nothing improves. Every accepted move lowers the total cost, so it always stops. */
function improve(model, assignment, domains) {
  const { sessions } = model;
  const board = boardFrom(model, assignment), tally = makeTally(model);
  assignment.forEach((a, i) => tally.add(sessions[i], a.si, a.ri, 1));

  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    sessions.forEach((s, i) => {
      const cur = assignment[i];
      board.put(s, cur.si, cur.ri, false); tally.add(s, cur.si, cur.ri, -1);
      let best = cur, bestCost = tally.marginal(s, cur.si, cur.ri);
      for (const v of domains[i]) {
        if (!board.free(s, v.si, v.ri)) continue;
        const c = tally.marginal(s, v.si, v.ri);
        if (c < bestCost - 1e-9) { best = v; bestCost = c; }
      }
      if (best !== cur) moved = true;
      assignment[i] = best;
      board.put(s, best.si, best.ri, true); tally.add(s, best.si, best.ri, 1);
    });
    if (!moved) break;
  }
}

/* ================= verification ================= */
/* An independent second opinion on a finished timetable: groups every occupied period and compares
   what shares it. Does not use the solver's tables. */
function verify(model, assignment, clashIdx) {
  const { slots, per, rooms, sessions, N } = model;
  const problems = [];
  const byPeriod = new Map();

  assignment.forEach((a, i) => {
    if (!a) return;
    const s = sessions[i], room = rooms[a.ri], at = slots[a.si];
    // room type check removed
    // capacity check removed
    if (a.si % per + s.span > per) problems.push(`${label(s)}: runs past the end of ${at.day}`);
    if (s.tid >= 0 && Array.from({ length: s.span }, (_, k) => model.offSlot[s.tid * N + a.si + k]).some(Boolean))
      problems.push(`${label(s)}: ${s.teacher} is unavailable during the class on ${at.day}`);
    for (let k = 0; k < s.span; k++) {
      if (!byPeriod.has(a.si + k)) byPeriod.set(a.si + k, []);
      byPeriod.get(a.si + k).push(i);
    }
  });

  for (const [p, list] of byPeriod) {
    const when = slots[p].day + " " + slots[p].label;
    for (let x = 0; x < list.length; x++)
      for (let y = x + 1; y < list.length; y++) {
        const s = sessions[list[x]], t = sessions[list[y]];
        const pair = `${label(s)} + ${label(t)}`;
        const bad = [];
        if (s.tid >= 0 && s.tid === t.tid) bad.push(`teacher ${s.teacher} double-booked`);
        if (assignment[list[x]].ri === assignment[list[y]].ri) bad.push(`room ${assignment[list[x]].room} double-booked`);
        if (s.atoms.some(a => t.atoms.includes(a))) bad.push(`section ${s.section} double-booked`);
        for (const b of bad) problems.push(`${b} at ${when}: ${pair}`);
        if (bad.length && clashIdx) { clashIdx.add(list[x]); clashIdx.add(list[y]); }
      }
  }
  return problems;
}

/* ================= quality numbers ================= */
function metrics(model, assignment) {
  const rowDay = {}, secDay = {};
  let placed = 0, periods = 0;
  assignment.forEach((a, i) => {
    if (!a) return;
    const s = model.sessions[i], di = model.slots[a.si].di;
    placed++; periods += s.span;
    rowDay[s.row + "|" + di] = (rowDay[s.row + "|" + di] || 0) + 1;
    secDay[s.section + "|" + di] = (secDay[s.section + "|" + di] || 0) + 1;
  });
  const repeats = Object.values(rowDay).reduce((a, n) => a + n - 1, 0);
  return { placed, periods, repeats, busiest: Math.max(0, ...Object.values(secDay)) };
}

/* ================= grid ================= */
function courseHue(code) {
  let h = 0;
  for (const ch of code || "") h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

const groupOf = (view, s, a) => view === "room" ? a.room : view === "section" ? s.section : s.teacher;

const BATCH_PALETTE = ["#3f5f9e", "#a8622a", "#6b4f9e", "#2f6f7a", "#9e3b52", "#3f7a4f"];
const BATCH_FIXED = { CS11: "#c62828", CS12: "#1d4ed8" };
function batchColors() {
  const colors = {};
  [...new Set(state.courses.map(c => c.batch).filter(Boolean))].sort().forEach((b, i) => {
    colors[b] = BATCH_FIXED[b.replace(/\s+/g, "").toUpperCase()] || BATCH_PALETTE[i % BATCH_PALETTE.length];
  });
  return colors;
}

function renderGrid(model, assignment) {
  const view = $("view").value;
  const { slots, sessions, per } = model;
  const clashIdx = new Set();
  verify(model, assignment, clashIdx);

  const groups = view === "room" ? model.rooms.map(r => r.name)
    : [...new Set(state.courses.map(c => view === "section" ? c.section : c.teacher).filter(Boolean))];
  const heading = { room: g => "Room " + g, section: g => "Section " + g, teacher: g => g }[view];

  // what sits in each (period, group) cell; a 2-period class appears in both of its periods
  const cells = {}, batchesIn = {};
  assignment.forEach((a, i) => {
    if (!a) return;
    const s = sessions[i], g = groupOf(view, s, a);
    for (let k = 0; k < s.span; k++) (cells[(a.si + k) + "|" + g] = cells[(a.si + k) + "|" + g] || []).push({ i, start: a.si });
    if (s.batch) (batchesIn[g] = batchesIn[g] || new Set()).add(s.batch);
  });

  // green cells for the class being rescheduled
  const targets = new Set();
  if (rescheduleMode && rescheduleSel) {
    const idx = rescheduleSel.sessionIdx, s = sessions[idx];
    for (const m of getValidMoves(model, assignment, idx)) {
      const g = view === "room" ? m.room : view === "section" ? s.section : s.teacher;
      for (let k = 0; k < s.span; k++) targets.add((m.si + k) + "|" + g);
    }
  }

  const colors = batchColors();
  const legend = g => !batchesIn[g] ? "" : '<span class="legend">' + [...batchesIn[g]].sort().map(b =>
    `<span class="chip"><span>${esc(b)}</span><i style="--c:${colors[b] || "#555"}"></i></span>`).join("") + "</span>";
  const badge = s => s.batch ? `<span class="batch" style="background:${colors[s.batch] || "#555"}">${esc(s.batch)}</span>` : "";

  const text = (s, room, tail) =>
    view === "room" ? `${badge(s)}${esc(s.code)} ${esc(s.section)} (${esc(s.teacher)})${tail}`
    : view === "section" ? `${badge(s)}${esc(s.code)} (${esc(s.teacher)}) · ${esc(room)}${tail}`
    : `${badge(s)}${esc(s.code)} ${esc(s.section)} · ${esc(room)}${tail}`;

  const days = model.days;
  let html = "";
  for (const g of groups) {
    const title = heading(g);
    html += `<h3><span>${esc(title)}</span>${legend(g)}</h3>` +
      `<table data-g="${esc(g)}"><tr><th>period</th>${days.map(d => `<th>${esc(d)}</th>`).join("")}</tr>`;

    for (let k = 0; k < per; k++) {
      html += `<tr><td class="period">${esc(slots[k].label)}</td>`;
      days.forEach((d, di) => {
        const si = di * per + k, key = si + "|" + g, list = cells[key] || [];
        const target = targets.has(key);
        if (!list.length) {
          html += `<td class="cell empty${target ? " valid-move" : ""}" data-si="${si}">${target ? "+" : ""}</td>`;
          return;
        }
        const body = list.map(({ i, start }) => {
          const s = sessions[i], full = text(s, assignment[i].room, "");
          if (start !== si) return `<span class="cont" data-i="${i}">${full}</span>`;
          const sel = rescheduleMode && rescheduleSel && rescheduleSel.sessionIdx === i;
          const style = `--h:${courseHue(s.code)}${s.batch && colors[s.batch] ? ";--bc:" + colors[s.batch] : ""}`;
          return `<span class="ev${sel ? " resched-sel" : ""}" style="${style}" data-i="${i}">${full}</span>`;
        }).join("");
        const clash = list.some(x => clashIdx.has(x.i));
        html += `<td class="cell${target ? " valid-move" : ""}${clash ? " clash" : ""}" data-si="${si}">${body}</td>`;
      });
      html += "</tr>";
    }
    html += "</table>";
  }
  $("grid").innerHTML = html;
}

/* ================= printing ================= */
// print/pdf removed

/* ================= messages, stats, theme ================= */
function setMsg(text, kind) {
  const m = $("msg");
  m.textContent = text || "";
  m.className = "msg" + (kind ? " " + kind : "");
}

const chip = (value, name, cls) => `<span class="stat${cls ? " " + cls : ""}"><b>${value}</b><i>${name}</i></span>`;

function renderStats({ model, assignment, info }) {
  const m = metrics(model, assignment);
  const problems = verify(model, assignment);
  const unplaced = model.sessions.length - m.placed;
  $("stats").innerHTML =
    chip(m.placed + "/" + model.sessions.length, "classes placed", unplaced ? "bad" : "good") +
    chip(problems.length, "clashes", problems.length ? "bad" : "good") +
    chip(m.busiest, "most classes in a section's day") +
    chip(m.repeats, "twice in a day") +
    chip(m.periods, "periods used") +
    chip(info.optimal ? "proven" : "best found", "schedule score") +
    chip(info.optNodes || 0, "optimization checks") +
    chip(info.ms + " ms", "solve time");
  if (problems.length) setMsg("Placed, but verification found conflicts:\n- " + problems.slice(0, 6).join("\n- "), "err");
}

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  store.set(THEME_KEY, t);
  const b = $("theme");
  b.textContent = t === "dark" ? "Light mode" : "Dark mode";
  b.setAttribute("aria-pressed", String(t === "dark"));
}
$("theme").onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
const savedTheme = store.get(THEME_KEY);
applyTheme(savedTheme === "dark" ? "dark" : "light");

/* ================= generate ================= */
/* The one place that changes what is on screen: a result, or nothing. */
function showResult(result, statsHtml) {
  lastResult = result;
  rescheduleMode = false;
  rescheduleSel = null;
  $("reschedule").classList.remove("on");
  $("reschedule").textContent = "Reschedule";
  $("reschedule").hidden = !result;   // only make sense with a timetable on screen
  const aiBtn = document.getElementById("analyseAi");
  if (aiBtn) aiBtn.hidden = !result;
  const aiBox = document.getElementById("aiAnalysisBox");
  if (!result && aiBox) aiBox.style.display = "none";
  if (result) {
    renderStats(result);
    renderGrid(result.model, result.assignment);
  } else {
    $("stats").innerHTML = statsHtml || chip("not run", "no timetable yet");
    $("grid").innerHTML = "";
  }
}

function generate() {
  const aiBox = document.getElementById("aiAnalysisBox");
  if (aiBox) aiBox.style.display = "none";
  const model = buildModel();
  const domains = buildDomains(model);
  const problems = diagnose(model, domains);
  if (problems.length) {
    showResult(null, chip("not run", "fix the setup first"));
    setMsg("Fix these first:\n- " + problems.join("\n- "), "err");
    if (typeof renderAdvisor === "function") renderAdvisor(problems);
    return;
  }
  if (typeof renderAdvisor === "function") renderAdvisor([]);

  const t0 = performance.now();
  const res = solve(model, domains);
  const ms = Math.round(performance.now() - t0);

  if (!res.ok) {
    showResult(null, chip(res.backtracks, "backtracks, no timetable", "bad"));
    setMsg(res.gaveUp
      ? "Stopped searching without finding a timetable. One may still exist: try adding a room, freeing a teacher or cutting meetings."
      : "No valid timetable exists with these rules.\nTry adding a room, freeing a teacher or cutting meetings.", "err");
    return;
  }

  generation++;
  setMsg("");
  lastResult = { model, assignment: res.assignment, info: { backtracks: res.backtracks, ms, optimal: res.optimal, optNodes: res.optNodes } };
  try {
    const days = model.days, perDay = model.per;
    const grid = {};
    model.sessions.forEach((ses, si) => {
      const placement = res.assignment[si];
      if (!placement) return;
      const di = Math.floor(placement.si / perDay), pi = placement.si % perDay;
      const key = di + ":" + pi;
      if (!grid[key]) grid[key] = [];
      grid[key].push({section: ses.section, batch: ses.batch, code: ses.code, teacher: ses.teacher, room: placement.room});
    });
    window._lastResult = { days, perDay, grid };
  } catch(e) {}
  showResult(lastResult);
}
$("generate").onclick = generate;

$("view").onchange = () => {
  if (!lastResult) return;
  exitRescheduleMode();
};

/* ================= reschedule ================= */
function enterRescheduleMode() {
  rescheduleMode = true;
  rescheduleSel = null;
  $("reschedule").textContent = "Exit Reschedule";
  $("reschedule").classList.add("on");
  setMsg("Click a class to select it. Green cells are legal moves; click a busy slot to see why it is blocked.", "info");
  renderGrid(lastResult.model, lastResult.assignment);
}

function exitRescheduleMode() {
  rescheduleMode = false;
  rescheduleSel = null;
  $("reschedule").textContent = "Reschedule";
  $("reschedule").classList.remove("on");
  setMsg("");
  if (lastResult) renderGrid(lastResult.model, lastResult.assignment);
}

document.getElementById("csvImport")?.addEventListener("click", function(){ document.getElementById("csvFile")?.click(); });
document.getElementById("csvFile")?.addEventListener("change", function(e){
  var f = e.target.files && e.target.files[0];
  if (!f) return;
  var r = new FileReader();
  r.onload = function(){
    try {
      var text = String(r.result||"");
      var lines = text.split(/\r?\n/).filter(function(x){return x.trim();});
      if (!lines.length) return;
      var teachers = new Set((state.teachers||"").split("\n").map(function(x){return x.trim();}).filter(Boolean));
      var rooms = new Set((document.getElementById("rooms")?.value||state.rooms||"").split("\n").map(function(x){return x.trim();}).filter(Boolean));
      var count = 0;
      for (var i=0; i<lines.length; i++){
        var line = lines[i].trim();
        if (!line) continue;
        if (line.indexOf("#TEACHERS") === 0) {
          var after = line.replace(/^#TEACHERS\s*/i, "").replace(/^,\s*/i, "");
          after.split(/[;,]/).forEach(function(t){ var tt=t.trim().replace(/^"|"$/g,"").replace(/^#+/,""); if(tt) teachers.add(tt); });
          continue;
        }
        if (line.indexOf("#ROOMS") === 0) {
          var after = line.replace(/^#ROOMS\s*/i, "").replace(/^,\s*/i, "");
          after.split(/[;,]/).forEach(function(t){ var tt=t.trim().replace(/^"|"$/g,"").replace(/^#+/,""); if(tt) rooms.add(tt); });
          continue;
        }
        var hdr = line.toLowerCase();
        if (hdr.indexOf("course")>=0 && hdr.indexOf("section")>=0) continue;
        var parts = line.split(",").map(function(x){return x.trim().replace(/^"|"$/g,"");});
        if (parts.length < 2) continue;
        var code = parts[0]||"", section = parts[1]||"", batch = parts[2]||"", teacher = parts[3]||"", meetings = parts[4]===undefined?"":parts[4], periods = parts[5]===undefined?"1":parts[5], room = parts[6]||"";
        if (!code && !section) continue;
        state.courses.push({code:code, section:section, batch:batch, teacher:teacher, blocksPerWeek: meetings===""?"":meetings, blockPeriods: periods||"1", roomType:"class", size:0});
        if (teacher) teachers.add(teacher);
        if (room) rooms.add(room);
        count++;
      }
      state.teachers = Array.from(teachers).filter(Boolean).join("\n");
      state.rooms = Array.from(rooms).filter(Boolean).join("\n");
      if(!state.rooms) state.rooms = Array.from(rooms).filter(Boolean).join("\n");
      save();
      console.log("IMPORTED teachers:", state.teachers);
      console.log("IMPORTED rooms:", state.rooms);
      var teachersEl = document.getElementById("teachers");
      if (teachersEl) { teachersEl.value = state.teachers; state.teachers = teachersEl.value; }
      var roomsEl = document.getElementById("rooms");
      if (roomsEl) { roomsEl.value = state.rooms; state.rooms = roomsEl.value; }
      if (roomsEl) state.rooms = roomsEl.value;
      state.rooms = state.rooms.replace(/\r/g,"").replace(/\n+/g,"\n").trim();
      save();
      renderPeople();
      try { renderStatus("teachersStatus", parseTeachers(state.teachers), "teacher"); } catch(e){}
      try { renderStatus("roomsStatus", parseRooms(state.rooms), "room"); } catch(e){}
      if (typeof renderLoad === "function") renderLoad();
      renderCourses();
      renderOtherBlocks();
      alert("Imported " + count + " rows");
    } catch(ex){ alert("Failed to import CSV"); }
    e.target.value = "";
  };
  r.readAsText(f);
});
document.getElementById("csvExport")?.addEventListener("click", function(){
  var rows = ["Course,Section,Batch,Teacher,Meetings,Periods,Room"];
  (state.courses||[]).forEach(function(c){
    var vals = [c.code||"", c.section||"", c.batch||"", c.teacher||"", c.blocksPerWeek||"", c.blockPeriods||"", c.room||""];
    rows.push(vals.map(function(v){
      var sv = String(v);
      if (sv.indexOf(",")>=0 || sv.indexOf('"')>=0 || sv.indexOf("\n")>=0) return '"'+sv.replace(/"/g,'""')+'"';
      return sv;
    }).join(","));
  });
  rows.push("");
  var tlist = (state.teachers||"").split("\n").map(function(x){return x.trim();}).filter(Boolean).join(";");
  var rlist = (state.rooms||"").split("\n").map(function(x){return x.trim();}).filter(Boolean).join(";");
  rows.push("#TEACHERS " + tlist);
  rows.push("#ROOMS " + rlist);
  var blob = new Blob([rows.join("\n")], {type:"text/csv"});
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "periodica-classes.csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
});
document.getElementById("ttExport")?.addEventListener("click", function(){
  if (!window._lastResult) { alert("Generate timetable first"); return; }
  var res = window._lastResult;
  var rows = ["Day,Period,Section,Batch,Course,Teacher,Room"];
  for (var di=0; di<res.days.length; di++){
    var d = res.days[di];
    for (var pi=0; pi<res.perDay; pi++){
      var key = di+":"+pi;
      var cell = res.grid[key];
      if (!cell || !cell.length) continue;
      for (var j=0; j<cell.length; j++){
        var it = cell[j];
        var vals = [d, pi+1, it.section||"", it.batch||"", it.code||"", it.teacher||"", it.room||""];
        rows.push(vals.map(function(v){
          var s = String(v);
          if (s.indexOf(",")>=0 || s.indexOf('"')>=0 || s.indexOf("\n")>=0) return '"'+s.replace(/"/g,'""')+'"';
          return s;
        }).join(","));
      }
    }
  }
  var blob = new Blob([rows.join("\n")], {type:"text/csv"});
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "periodica-timetable.csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
});

document.getElementById("shareLink")?.addEventListener("click", function(){
  if (!lastResult) { alert("Generate a timetable first so the link includes it."); return; }
  try {
    var a = lastResult.assignment;
    var tt = a.map(function(x){ return x && Number.isInteger(x.si) && Number.isInteger(x.ri) ? x.si + "." + x.ri : "-1.-1"; }).join(",");
    var data = {
      teachers: state.teachers, rooms: state.rooms, courses: state.courses,
      days: state.days, periods: state.periods, startTime: state.startTime,
      periodMinutes: state.periodMinutes, breakMinutes: state.breakMinutes, dayEnd: state.dayEnd,
      otherBlocksArr: state.otherBlocksArr||[],
      __share: { v: 1, seed: generation, bt: lastResult.info.backtracks, ms: lastResult.info.ms, optimal: lastResult.info.optimal, optNodes: lastResult.info.optNodes, tt: tt }
    };
    var json = JSON.stringify(data);
    var b64 = btoa(unescape(encodeURIComponent(json)));
    var url = location.origin + location.pathname + "#" + b64;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function(){ alert("Share link copied with the generated timetable"); }).catch(function(){ prompt("Copy this link", url); });
    } else {
      prompt("Copy this link", url);
    }
  } catch(e) { alert("Failed to create share link"); }
});

function parseSharedAssignment(model, tt) {
  if (typeof tt !== "string") return null;
  var parts = tt.split(",");
  if (parts.length !== model.sessions.length) return null;
  var assignment = [];
  for (var i = 0; i < parts.length; i++) {
    var m = /^(\d+)\.(\d+)$/.exec(parts[i]);
    if (!m) return null;
    var si = +m[1], ri = +m[2];
    if (si < 0 || si >= model.N || ri < 0 || ri >= model.rooms.length) return null;
    if (si % model.per + model.sessions[i].span > model.per) return null;
    assignment.push({ si: si, ri: ri, room: model.rooms[ri].name });
  }
  return assignment;
}

function applySharedResult(share) {
  if (!share || share.v !== 1) return;
  try {
    var model = buildModel();
    var domains = buildDomains(model);
    var problems = diagnose(model, domains);
    if (problems.length) { setMsg("Shared setup needs fixing:\n- " + problems.join("\n- "), "err"); return; }
    var assignment = parseSharedAssignment(model, share.tt);
    if (!assignment) { setMsg("Shared timetable could not be loaded; press Generate.", "err"); return; }
    var clashes = verify(model, assignment);
    if (clashes.length) { setMsg("Shared timetable failed verification; press Generate.", "err"); return; }
    generation = Number.isInteger(share.seed) ? share.seed : 0;
    var result = { model: model, assignment: assignment, info: { backtracks: Number(share.bt) || 0, ms: Number(share.ms) || 0, optimal: share.optimal === true, optNodes: Number(share.optNodes) || 0 } };
    showResult(result);
    setMsg("Loaded shared setup and generated timetable.", "ok");
  } catch (e) {
    setMsg("Shared timetable could not be loaded; press Generate.", "err");
  }
}

$("reschedule").onclick = () => {
  if (!lastResult) return;
  if (rescheduleMode) exitRescheduleMode(); else enterRescheduleMode();
};

const SYSTEM_PROMPT = `You are a concise timetable improvement assistant. The application performs the authoritative conflict check separately.
Give at most TWO short, specific setup suggestions, maximum 25 words each, one per line. Use only supplied metrics. Suggest spreading a teacher's busy day, adding a room or period when utilization is high, or adjusting availability. If total teacher loads differ substantially, you may suggest redistributing an existing class if qualifications permit. Never remove required meetings. Do not claim conflicts are absent. If no useful change is supported, say: No setup change is clearly needed.`;

async function runGroqDirect(apiKey, summary) {
  const userMsg = `Verified clash count: ${summary.clashCount}. Suggest useful setup improvements from these metrics:\n` + JSON.stringify(summary, null, 2);
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey.trim()
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-20b",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg }
      ],
      temperature: 0.2,
      max_completion_tokens: 180
    })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if (resp.status === 401) {
      localStorage.removeItem("periodica.groq_key");
      throw new Error("Invalid Groq API key. The saved key was cleared; click Check & Improve to enter a valid key.");
    }
    throw new Error(err.error?.message || `Groq API error (${resp.status})`);
  }
  const data = await resp.json();
  const msg = data.choices?.[0]?.message || {};
  return msg.content || msg.reasoning || "No setup change is clearly needed.";
}

function compactAdvice(text) {
  let lines = String(text || "").split(/\r?\n/).map(s => s.replace(/^\s*[-*•\d.)]+\s*/, "").trim()).filter(Boolean);
  if (lines.length < 2 && lines[0]) lines = lines[0].split(/(?<=[.!?])\s+/).filter(Boolean);
  return lines.slice(0, 2).map(s => "• " + s.split(/\s+/).slice(0, 25).join(" ").slice(0, 200)).join("\n") || "• No setup change is clearly needed.";
}

document.getElementById("analyseAi")?.addEventListener("click", async (e) => {
  try {
    if (!lastResult) { alert("Generate timetable first"); return; }
    
    // Holding Shift while clicking lets user change their saved key on static sites
    if (e.shiftKey && localStorage.getItem("periodica.groq_key")) {
      if (confirm("Reset your saved Groq API key?")) {
        localStorage.removeItem("periodica.groq_key");
        alert("Saved key cleared.");
        return;
      }
    }

    const model = lastResult.model, assignment = lastResult.assignment;
    const days = model.days;
    const per = model.per;
    const clashes = verify(model, assignment);
    const conflictStatus = clashes.length
      ? `Conflict check: ${clashes.length} issue${clashes.length === 1 ? "" : "s"} found.\n${clashes.slice(0, 3).map(x => "• " + x).join("\n")}`
      : "Conflict check: Conflict-free (verified).";
    const analysisBox = document.getElementById("aiAnalysisBox");
    const analysisOut = document.getElementById("aiAnalysisOut");
    if (analysisOut) analysisOut.textContent = `${conflictStatus}\n\nSetup improvements:\nChecking…`;
    if (analysisBox) analysisBox.style.display = "block";

    const teacherDayLoad = {};
    const teacherDayPeriods = {};
    const roomDayLoad = {};
    const roomTotalUse = {};
    const sectionDayPeriods = {};

    const teacherLoad = {};
    const courseLoad = {};
    const sectionLoad = {};

    model.sessions.forEach((ses, si) => {
      const a = assignment[si];
      if (!a || a.si < 0) return;
      const slot = model.slots[a.si];
      const day = slot.day;
      const pIdx = slot.index;
      const room = a.room || model.rooms[a.ri]?.name || "Unknown";

      // Teacher load
      const t = ses.teacher || "Unknown";
      teacherLoad[t] = (teacherLoad[t] || 0) + ses.span;
      if (!teacherDayLoad[t]) teacherDayLoad[t] = {};
      teacherDayLoad[t][day] = (teacherDayLoad[t][day] || 0) + ses.span;
      if (!teacherDayPeriods[t]) teacherDayPeriods[t] = {};
      if (!teacherDayPeriods[t][day]) teacherDayPeriods[t][day] = [];
      for (let k = 0; k < ses.span; k++) teacherDayPeriods[t][day].push(pIdx + k);

      // Room load
      roomTotalUse[room] = (roomTotalUse[room] || 0) + ses.span;
      if (!roomDayLoad[room]) roomDayLoad[room] = {};
      roomDayLoad[room][day] = (roomDayLoad[room][day] || 0) + ses.span;

      // Section load
      const secKey = ses.section + (ses.batch ? "/" + ses.batch : "");
      sectionLoad[secKey] = (sectionLoad[secKey] || 0) + ses.span;
      if (!sectionDayPeriods[secKey]) sectionDayPeriods[secKey] = {};
      if (!sectionDayPeriods[secKey][day]) sectionDayPeriods[secKey][day] = [];
      for (let k = 0; k < ses.span; k++) sectionDayPeriods[secKey][day].push(pIdx + k);

      // Course load
      const c = ses.code || "Unknown";
      courseLoad[c] = (courseLoad[c] || 0) + ses.span;
    });

    // Detect teacher highlights: peak day & consecutive streaks
    const teacherHighlights = [];
    for (const [t, dayMap] of Object.entries(teacherDayLoad)) {
      let maxDay = "", maxCount = 0;
      for (const [d, cnt] of Object.entries(dayMap)) {
        if (cnt > maxCount) { maxCount = cnt; maxDay = d; }
      }
      let maxStreak = 1;
      for (const [d, plist] of Object.entries(teacherDayPeriods[t] || {})) {
        const sorted = [...plist].sort((x, y) => x - y);
        let currStreak = 1;
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i] === sorted[i - 1] + 1) {
            currStreak++;
            if (currStreak > maxStreak) maxStreak = currStreak;
          } else {
            currStreak = 1;
          }
        }
      }
      if (maxCount >= 3 || maxStreak >= 2) {
        teacherHighlights.push(`${t}: peak ${maxCount} periods on ${maxDay}${maxStreak >= 2 ? ` (${maxStreak} consecutive)` : ""}`);
      }
    }

    // Detect room highlights
    const totalSlotsPerRoom = (days.length || 5) * (per || 8);
    const roomHighlights = [];
    const sortedRooms = Object.entries(roomTotalUse).sort((a, b) => b[1] - a[1]);
    for (const [r, count] of sortedRooms) {
      const pct = Math.round((count / totalSlotsPerRoom) * 100);
      let busiestDay = "", bCount = 0;
      for (const [d, c] of Object.entries(roomDayLoad[r] || {})) {
        if (c > bCount) { bCount = c; busiestDay = d; }
      }
      if (pct >= 40 || pct <= 20) {
        roomHighlights.push(`${r}: ${pct}% weekly use (peak ${bCount}/${per} periods on ${busiestDay})`);
      }
    }

    // Detect student highlights: heaviest day & idle gaps
    const studentHighlights = [];
    for (const [sec, dayMap] of Object.entries(sectionDayPeriods)) {
      let maxD = "", maxC = 0;
      let hasGap = false, gapInfo = "";
      for (const [d, plist] of Object.entries(dayMap)) {
        if (plist.length > maxC) { maxC = plist.length; maxD = d; }
        const sorted = [...plist].sort((x, y) => x - y);
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i] > sorted[i - 1] + 1) {
            hasGap = true;
            gapInfo = `${d} has ${sorted[i] - sorted[i - 1] - 1} idle period(s) between classes`;
            break;
          }
        }
      }
      if (maxC >= 4 || hasGap) {
        studentHighlights.push(`Section ${sec}: heaviest on ${maxD} (${maxC} periods)${gapInfo ? `, ${gapInfo}` : ""}`);
      }
    }

    const teacherLoadSorted = Object.entries(teacherLoad).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({teacher:k, periods:v}));
    const sectionLoadSorted = Object.entries(sectionLoad).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({section:k, periods:v}));
    const courseLoadSorted = Object.entries(courseLoad).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({course:k, periods:v}));
    const dailySessions = {};
    days.forEach(d => { dailySessions[d] = 0; });
    model.sessions.forEach((ses, si) => {
      const a = assignment[si];
      if (!a || a.si < 0) return;
      const day = model.slots[a.si].day;
      dailySessions[day] = (dailySessions[day] || 0) + 1;
    });

    const summary = {
      generation,
      days: model.days,
      periodsPerDay: model.per,
      totalSessions: model.sessions.length,
      clashCount: clashes.length,
      dailyDistribution: dailySessions,
      teacherHighlights: teacherHighlights.slice(0, 12),
      roomHighlights: roomHighlights.slice(0, 12),
      studentHighlights: studentHighlights.slice(0, 12),
      teacherLoad: teacherLoadSorted,
      courseLoad: courseLoadSorted,
      sectionLoad: sectionLoadSorted
    };
    const btn = document.getElementById("analyseAi");
    if (btn) { btn.disabled = true; btn.textContent = "Analysing..."; }

    let content = "";
    const isGitHubPages = location.hostname.endsWith("github.io");

    if (isGitHubPages) {
      // GitHub Pages is purely static and cannot execute serverless/Node code
      let key = localStorage.getItem("periodica.groq_key");
      if (!key) {
        key = prompt("GitHub Pages is a static host without a backend server.\n\nEnter your Groq API key to use AI Analysis:\n(Saved only in this browser)");
        if (!key || !key.trim()) return;
        localStorage.setItem("periodica.groq_key", key.trim());
      }
      content = await runGroqDirect(key, summary);
    } else {
      // Standard backend proxy (Vercel / Render / localhost server)
      const isLocalOtherPort = (location.hostname === "localhost" || location.hostname === "127.0.0.1") && location.port && location.port !== "3000";
      const endpoint = isLocalOtherPort ? "http://localhost:3000/api/analyse" : "/api/analyse";

      let resp;
      try {
        resp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summary })
        });
      } catch (err) {
        throw new Error("Cannot connect to server. Run 'npm start' in terminal to start the backend at http://localhost:3000.");
      }

      if (resp.status === 405 || resp.status === 404) {
        // Fallback for any other static hosting
        let key = localStorage.getItem("periodica.groq_key");
        if (!key) {
          key = prompt("This site is running on a static server without a backend.\n\nEnter your Groq API key to run analysis directly:\n(Saved only in this browser)");
          if (!key || !key.trim()) return;
          localStorage.setItem("periodica.groq_key", key.trim());
        }
        content = await runGroqDirect(key, summary);
      } else {
        const contentType = resp.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          const errorText = await resp.text();
          throw new Error(`Server returned error ${resp.status}: ${errorText.slice(0, 150)}`);
        }
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Analysis request failed");
        content = data.content || "No analysis generated.";
      }
    }

    const box = document.getElementById("aiAnalysisBox");
    const out = document.getElementById("aiAnalysisOut");
    if (out) out.textContent = `${conflictStatus}\n\nSetup improvements:\n${compactAdvice(content)}`;
    if (box) {
      box.style.display = "block";
      box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  } catch(e) {
    let msg = e.message || "Unknown error";
    const issues = lastResult ? verify(lastResult.model, lastResult.assignment) : [];
    const status = issues.length
      ? `Conflict check: ${issues.length} issue${issues.length === 1 ? "" : "s"} found.\n${issues.slice(0, 3).map(x => "• " + x).join("\n")}`
      : "Conflict check: Conflict-free (verified).";
    const box = document.getElementById("aiAnalysisBox");
    const out = document.getElementById("aiAnalysisOut");
    if (out) out.textContent = `${status}\n\nSetup suggestions unavailable: ${msg}`;
    if (box) box.style.display = "block";
  } finally {
    const btn = document.getElementById("analyseAi");
    if (btn) { btn.disabled = false; btn.textContent = "Check & Improve"; }
  }
});

document.getElementById("aiAnalysisClose")?.addEventListener("click", () => {
  const box = document.getElementById("aiAnalysisBox");
  if (box) box.style.display = "none";
});

/* every (start, room) the class could move to, given everything else stays put */
function getValidMoves(model, assignment, idx) {
  const s = model.sessions[idx], cur = assignment[idx];
  if (!cur) return [];
  const board = boardFrom(model, assignment, idx), roomsOk = eligibleRooms(model, s), moves = [];
  for (const si of model.starts(s.span)) {
    if (si === cur.si) continue;
    for (const ri of roomsOk) if (board.free(s, si, ri)) moves.push({ si, ri, room: model.rooms[ri].name });
  }
  return moves;
}

/* getValidMoves() came back empty: name the thing in the way */
function whyBlocked(model, assignment, idx) {
  const s = model.sessions[idx], cur = assignment[idx];
  const who = label(s) + " (" + s.teacher + ")";
  const none = "No legal slot for " + who;
  const roomsOk = eligibleRooms(model, s);
  const cands = model.starts(s.span).filter(si => si !== cur.si && !(s.tid >= 0 && model.offSlot[s.tid * model.N + si]));

  if (!cands.length) return none + ": it has no other free period this week.";
  if (!roomsOk.length) return none + ": no " + s.roomType + " room available.";

  const board = boardFrom(model, assignment, idx);
  const why = { teacher: [], room: [], section: [] };
  for (const si of cands) { const b = board.blockedBy(s, si, roomsOk); if (b) why[b].push(si); }
  const [key, list] = Object.entries(why).sort((x, y) => y[1].length - x[1].length)[0];
  if (!list.length) return none + ": every other free period clashes. Press Generate for a fresh timetable.";

  // name one class that is in the way, for the teacher and section cases
  const at = list[0];
  const culprit = key === "room" ? null : model.sessions.find((t, j) => j !== idx && assignment[j] &&
    assignment[j].si < at + s.span && at < assignment[j].si + t.span &&
    (key === "teacher" ? t.tid === s.tid : t.atoms.some(a => s.atoms.includes(a))));
  const reason =
    key === "teacher" ? s.teacher + " is already booked in " + list.length + " of " + cands.length + " other free periods" :
    key === "room" ? "every " + s.roomType + " room is taken in " + list.length + " of " + cands.length + " other free periods" :
    "section " + s.section + " already has a class in " + list.length + " of " + cands.length + " other free periods";
  const where = (culprit ? label(culprit) + " at " : "") + model.slots[at].day + " " + model.slots[at].label;
  return none + ".\n" + reason + ", e.g. " + where + ".\nMove that class first, or press Generate for a fresh timetable.";
}

function explainBlockedAt(td) {
  if (!rescheduleSel || !lastResult) return;
  const { model, assignment } = lastResult;
  const idx = rescheduleSel.sessionIdx, s = model.sessions[idx];
  const si = Number(td.dataset.si);
  const view = $("view").value, group = td.closest("table")?.dataset.g;
  const who = label(s) + " (" + s.teacher + ")";
  const slot = model.slots[si], at = slot ? slot.day + " " + slot.label : "that slot";

  if (view === "section" && group !== s.section) {
    setMsg(`${who} is in Section ${s.section}. Use a green cell in the Section ${s.section} table.`, "err");
    return;
  }
  if (view === "teacher" && group !== s.teacher) {
    setMsg(`${who} is taught by ${s.teacher}. Use a green cell in the ${s.teacher} table.`, "err");
    return;
  }

  const cur = assignment[idx];
  if (cur && cur.si === si && (view !== "room" || cur.room === group)) {
    setMsg(`${who} is already in ${at}${cur.room ? " in " + cur.room : ""}. Pick a green cell to move it.`, "info");
    return;
  }

  const reasons = [];
  if (s.tid >= 0 && model.offSlot[s.tid * model.N + si]) reasons.push(`${s.teacher} is marked unavailable at that time`);

  const occupants = [];
  model.sessions.forEach((t, j) => {
    const a = assignment[j];
    if (!a || j === idx || a.si > si || si >= a.si + t.span) return;
    occupants.push({ t, a });
  });
  const teacherBusy = s.tid >= 0 && occupants.find(o => o.t.tid === s.tid);
  if (teacherBusy) reasons.push(`${s.teacher} is already teaching ${label(teacherBusy.t)} in ${teacherBusy.a.room}`);
  const sectionBusy = occupants.find(o => o.t.atoms.some(a => s.atoms.includes(a)));
  if (sectionBusy && sectionBusy !== teacherBusy) reasons.push(`${label(sectionBusy.t)} already uses that section/batch`);

  const targetRoom = view === "room" ? model.rooms.findIndex(r => r.name === group) : -1;
  const roomsToCheck = targetRoom >= 0 ? [targetRoom] : eligibleRooms(model, s);
  if (!roomsToCheck.some(ri => !occupants.some(o => o.a.ri === ri))) {
    if (view === "room") {
      const occupant = occupants.find(o => o.a.ri === targetRoom);
      reasons.push(`Room ${group} is already used by ${occupant ? label(occupant.t) : "another class"}`);
    } else {
      reasons.push("all classrooms are already in use at that time");
    }
  }

  if (!reasons.length) {
    setMsg(`${who} cannot move to ${at}. Pick a green cell, or Exit Reschedule to choose another class.`, "err");
    return;
  }
  setMsg(`${who} cannot move to ${at}:\n- ${[...new Set(reasons)].join("\n- ")}\nPick a green cell, or Exit Reschedule to choose another class.`, "err");
}

function selectClass(idx) {
  const { model, assignment } = lastResult;
  rescheduleSel = { sessionIdx: idx };
  const moves = getValidMoves(model, assignment, idx);
  const who = label(model.sessions[idx]) + " (" + model.sessions[idx].teacher + ")";
  setMsg(moves.length
    ? `Selected ${who}: ${moves.length} legal slot${moves.length === 1 ? "" : "s"} (green). Click one to move it.`
    : `Selected ${who}.\n` + whyBlocked(model, assignment, idx), moves.length ? "info" : "err");
  renderGrid(model, assignment);
}

function moveSelectedTo(td) {
  const { model, assignment } = lastResult;
  const idx = rescheduleSel.sessionIdx, si = +td.dataset.si, g = td.closest("table").dataset.g;
  // room view: the clicked table is the room. Other views: any legal room will do.
  const move = getValidMoves(model, assignment, idx).find(m => m.si === si && ($("view").value !== "room" || m.room === g));
  if (!move) { setMsg("That slot did not survive the re-check. Pick another green cell.", "err"); return; }

  const old = assignment[idx];
  assignment[idx] = move;
  if (verify(model, assignment).length) {
    assignment[idx] = old;
    setMsg("That move would create a clash, so it was undone.", "err");
    return;
  }
  rescheduleSel = null;
  lastResult.info.optimal = false;
  lastResult.info.optNodes = 0;
  renderStats(lastResult);
  renderGrid(model, assignment);
  setMsg(`Moved ${model.sessions[idx].code} to ${model.slots[move.si].day} ${model.slots[move.si].label} in ${move.room}. Click another class, or Exit Reschedule.`, "ok");
}

/* one click handler for the grid: print buttons, then the reschedule tool */
$("grid").addEventListener("click", e => {
  // print button handler removed
  if (!rescheduleMode || !lastResult) return;

  const td = e.target.closest("td.cell");
  if (rescheduleSel && td && td.classList.contains("valid-move")) { moveSelectedTo(td); return; }   // a green cell wins, even if the other batch sits in it

  const hit = e.target.closest("[data-i]") || (td && td.querySelector("[data-i]"));
  if (!rescheduleSel && hit) { selectClass(+hit.dataset.i); return; }

  if (rescheduleSel) {   // clicked a cell: explain why it cannot be used
    if (td) explainBlockedAt(td);
    else exitRescheduleMode();
  }
});

document.addEventListener("click", e => {
  // Don't toggle if clicking on buttons inside collapsible header
  if (e.target.closest("button")) return;
  const h = e.target.closest(".collapsible");
  if (!h) return;
  const target = h.dataset.target;
  if (!target) return;
  const content = document.getElementById(target);
  if (!content) return;
  const collapser = h.querySelector(".collapser");
  if (content.classList.contains("collapsed")) {
    content.classList.remove("collapsed");
    if (collapser) collapser.textContent = "−";
  } else {
    content.classList.add("collapsed");
    if (collapser) collapser.textContent = "+";
  }
  if (target === "classesSec") {
    const isCollapsed = content.classList.contains("collapsed");
    const addBtn = document.getElementById("addCourse");
    if (addBtn) addBtn.style.display = isCollapsed ? "none" : "inline-flex";
    updateBatchActions();
  }
});

/* ================= scroll jump ================= */
const scrollJump = $("scrollJump");
let scrollFrame = 0;
let scrollTween = 0;

function scrollLimit() {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

function atPageBottom() {
  const limit = scrollLimit();
  return limit > 0 && window.scrollY >= limit - 2;
}

function updateScrollJump() {
  if (!scrollJump || scrollTween) return;
  const bottom = atPageBottom();
  scrollJump.hidden = false;
  scrollJump.classList.toggle("at-bottom", bottom);
  const text = bottom ? "Scroll to top" : "Scroll to bottom";
  if (scrollJump.getAttribute("aria-label") !== text) {
    scrollJump.setAttribute("aria-label", text);
    scrollJump.title = text;
  }
}

function smoothScrollTo(target) {
  cancelAnimationFrame(scrollTween);
  scrollTween = 0;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.scrollTo(0, target);
    updateScrollJump();
    return;
  }
  const start = window.scrollY, delta = target - start;
  if (Math.abs(delta) < 2) return;
  const duration = Math.min(650, Math.max(320, Math.abs(delta) * 0.35));
  const t0 = performance.now();
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  function step(now) {
    const t = Math.min(1, (now - t0) / duration);
    window.scrollTo(0, start + delta * ease(t));
    if (t < 1) scrollTween = requestAnimationFrame(step);
    else { scrollTween = 0; updateScrollJump(); }
  }
  scrollTween = requestAnimationFrame(step);
}

if (scrollJump) {
  scrollJump.addEventListener("click", () => smoothScrollTo(atPageBottom() ? 0 : scrollLimit()));
  window.addEventListener("scroll", () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; updateScrollJump(); });
  }, { passive: true });
  window.addEventListener("resize", updateScrollJump);
  ["wheel", "touchstart"].forEach(name => window.addEventListener(name, () => {
    cancelAnimationFrame(scrollTween); scrollTween = 0;
  }, { passive: true }));
  if ("ResizeObserver" in window) new ResizeObserver(updateScrollJump).observe(document.body);
  updateScrollJump();
}

/* ================= boot ================= */
const setupEl = $("setup");
const savedOpen = store.get(SETUP_KEY);
if (savedOpen !== null) setupEl.open = savedOpen === "1";
else setupEl.open = true;
setupEl.addEventListener("toggle", () => store.set(SETUP_KEY, setupEl.open ? "1" : "0"));

const addBtnInit = document.getElementById('addCourse');
const classesSec = document.getElementById('classesSec');
if (addBtnInit && classesSec) {
  addBtnInit.style.display = classesSec.classList.contains('collapsed') ? 'none' : 'inline-flex';
}
renderAll();
showResult(null);
if (pendingSharedResult) applySharedResult(pendingSharedResult);
