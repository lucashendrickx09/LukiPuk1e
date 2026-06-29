"use strict";

// --- token handling (only needed if you set webui.token / CLIPPER_WEB_TOKEN) -
let TOKEN = localStorage.getItem("clipper_token") || "";

async function api(path, opts = {}) {
  opts.headers = Object.assign({}, opts.headers, TOKEN ? { "X-Clipper-Token": TOKEN } : {});
  if (opts.body && !opts.headers["Content-Type"]) {
    opts.headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, opts);
  if (res.status === 401) {
    const t = prompt("Web UI token:");
    if (t) { TOKEN = t; localStorage.setItem("clipper_token", t); return api(path, opts); }
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
  return res.status === 204 ? null : res.json();
}
const videoUrl = (id) => `/clip/${id}/video` + (TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : "");

function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}
const esc = (s) => (s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// --- tabs -------------------------------------------------------------------
document.querySelectorAll(".tabbar button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabbar button").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    document.getElementById("tab-" + b.dataset.tab).classList.add("active");
    if (b.dataset.tab === "review") loadReview();
    if (b.dataset.tab === "sources") loadSources();
  });
});

// --- status / job polling ---------------------------------------------------
async function refreshStatus() {
  let s;
  try { s = await api("/api/status"); } catch (e) { return; }
  const pill = document.getElementById("statusPill");
  const job = s.job || {};
  if (job.running) {
    pill.textContent = "running: " + job.running; pill.classList.add("busy");
  } else {
    pill.textContent = "idle"; pill.classList.remove("busy");
  }
  const js = document.getElementById("jobStatus");
  js.className = "jobstatus";
  if (job.running) { js.textContent = "⏳ running " + job.running + "…"; js.classList.add("busy"); }
  else if (job.last) {
    js.textContent = (job.last.ok ? "✅ " : "‼️ ") + job.last.step + " — " + job.last.result;
    js.classList.add(job.last.ok ? "ok" : "bad");
  } else js.classList.add("muted"), (js.textContent = "idle");

  document.querySelectorAll(".step").forEach((b) => (b.disabled = !!job.running));

  const c = s.counts || {};
  const cell = (n, label) => `<div class="c"><b>${n || 0}</b><span>${label}</span></div>`;
  document.getElementById("counts").innerHTML =
    cell((c.videos && c.videos.transcribed) , "transcribed") +
    cell((c.clips && c.clips.candidate), "candidates") +
    cell((c.clips && c.clips.ready), "ready") +
    cell((c.clips && c.clips.approved), "approved") +
    cell((c.clips && c.clips.posted), "posted") +
    cell((c.clips && c.clips.rejected), "rejected");
}

document.querySelectorAll(".step").forEach((b) => {
  b.addEventListener("click", async () => {
    try {
      const r = await api("/api/run/" + b.dataset.step, { method: "POST" });
      toast(r.started ? "started " + b.dataset.step : (r.reason || "busy"));
      refreshStatus();
    } catch (e) { toast(e.message); }
  });
});

// --- review queue -----------------------------------------------------------
async function loadReview() {
  const list = document.getElementById("reviewList");
  let items;
  try { items = await api("/api/review"); } catch (e) { return; }
  document.getElementById("reviewEmpty").hidden = items.length > 0;
  list.innerHTML = "";
  items.forEach((it) => list.appendChild(card(it)));
}

function card(it) {
  const el = document.createElement("div");
  el.className = "card";
  const permBadge = it.permission_cleared
    ? `<span class="badge ok">🔐 ${esc(it.permission)}</span>`
    : `<span class="badge bad">🔐 ${esc(it.permission)} — blocked</span>`;
  el.innerHTML = `
    ${it.has_video ? `<video controls preload="metadata" playsinline src="${videoUrl(it.id)}"></video>` : `<p class="muted">no preview</p>`}
    <div class="title">${esc(it.title) || "(no title)"}</div>
    <div>${permBadge}<span class="badge">hook ${it.hook_score}/10</span>
      <span class="badge">${it.start.toFixed(1)}–${it.end.toFixed(1)}s</span></div>
    <textarea rows="3">${esc(it.caption)}</textarea>
    <div class="tags">${(it.hashtags || []).map(esc).join(" ")}</div>
    <div class="actions">
      <button class="approve">✅ Approve</button>
      <button class="secondary save">✏️ Save + approve</button>
      <button class="danger reject">❌</button>
    </div>`;
  const ta = el.querySelector("textarea");
  el.querySelector(".approve").onclick = () => act(it.id, "approve", el);
  el.querySelector(".reject").onclick = () => act(it.id, "reject", el);
  el.querySelector(".save").onclick = () => act(it.id, "caption", el, ta.value);
  return el;
}

async function act(id, kind, el, caption) {
  try {
    let r;
    if (kind === "approve") r = await api(`/api/clip/${id}/approve`, { method: "POST" });
    else if (kind === "reject") r = await api(`/api/clip/${id}/reject`, { method: "POST" });
    else r = await api(`/api/clip/${id}/caption`, { method: "POST",
        body: JSON.stringify({ caption, approve: true }) });
    toast(r.result || "done");
    el.remove();
    refreshStatus();
  } catch (e) { toast(e.message); }
}

// --- sources ----------------------------------------------------------------
async function loadSources() {
  const list = document.getElementById("sourceList");
  let rows;
  try { rows = await api("/api/sources"); } catch (e) { return; }
  list.innerHTML = "";
  rows.forEach((s) => {
    const el = document.createElement("div");
    el.className = "src";
    el.innerHTML = `<div><span class="badge ${s.cleared ? "ok" : "bad"}">${esc(s.permission_status)}</span>
      <div class="u">${esc(s.type)} · ${esc(s.url)}</div></div>
      <button class="ghost del">Delete</button>`;
    el.querySelector(".del").onclick = async () => {
      await api("/api/sources/" + s.id, { method: "DELETE" }); loadSources();
    };
    list.appendChild(el);
  });
}

document.getElementById("addSource").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/sources", { method: "POST", body: JSON.stringify({
      url: document.getElementById("srcUrl").value,
      type: document.getElementById("srcType").value,
      permission: document.getElementById("srcPerm").value,
    }) });
    document.getElementById("srcUrl").value = "";
    toast("source added"); loadSources();
  } catch (err) { toast(err.message); }
});

// --- boot -------------------------------------------------------------------
refreshStatus();
loadReview();
setInterval(refreshStatus, 2500);
// Service worker only registers on a secure context (https/localhost); harmless otherwise.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
