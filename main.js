// ------------------- IndexedDB (for attachments) -------------------
const DB_NAME = "heptech_admin_db";
const DB_STORE = "files";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(key, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(blob, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function dbClearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// ------------------- App State -------------------
const LS_KEY = "heptech_jobs_v1";
let jobs = JSON.parse(localStorage.getItem(LS_KEY) || "[]");

const el = (id) => document.getElementById(id);

const form = el("jobForm");
const jobsEl = el("jobs");
const emptyEl = el("empty");

const totalCount = el("totalCount");
const openCount = el("openCount");
const doneCount = el("doneCount");

const searchEl = el("search");
const filterStatusEl = el("filterStatus");

function save() {
  localStorage.setItem(LS_KEY, JSON.stringify(jobs));
}

function uid() {
  return "job_" + Math.random().toString(16).slice(2) + "_" + Date.now();
}

function priorityBadgeClass(p) {
  if (p === "Urgent") return "bad";
  if (p === "High") return "warn";
  return "good";
}

function computeStats() {
  const total = jobs.length;
  const done = jobs.filter(j => j.status === "Completed").length;
  const open = total - done;
  totalCount.textContent = total;
  openCount.textContent = open;
  doneCount.textContent = done;
}

// ------------------- Rendering -------------------
async function render() {
  computeStats();

  const q = (searchEl.value || "").toLowerCase().trim();
  const statusFilter = filterStatusEl.value;

  const filtered = jobs.filter(j => {
    const matchesText =
      !q ||
      j.client.toLowerCase().includes(q) ||
      (j.site || "").toLowerCase().includes(q) ||
      (j.notes || "").toLowerCase().includes(q);

    const matchesStatus = statusFilter === "All" || j.status === statusFilter;
    return matchesText && matchesStatus;
  });

  jobsEl.innerHTML = "";
  emptyEl.style.display = filtered.length ? "none" : "block";

  for (const job of filtered) {
    const card = document.createElement("div");
    card.className = "job";

    card.innerHTML = `
      <div class="jobTop">
        <div>
          <div class="jobTitle">${escapeHtml(job.client)}</div>
          <div class="badges">
            <span class="badge ${priorityBadgeClass(job.priority)}">${escapeHtml(job.priority)}</span>
            <span class="badge">${escapeHtml(job.status)}</span>
            <span class="badge">${escapeHtml(job.jobType)}</span>
            ${job.dueDate ? `<span class="badge">Due: ${escapeHtml(job.dueDate)}</span>` : ""}
          </div>
        </div>

        <div>
          <select data-action="status" data-id="${job.id}">
            ${["New","In Progress","On Hold","Completed"].map(s => `
              <option ${job.status===s?"selected":""}>${s}</option>
            `).join("")}
          </select>
        </div>
      </div>

      <div class="jobMeta">
        ${job.site ? `<div><b>Site:</b> ${escapeHtml(job.site)}</div>` : ""}
        ${job.notes ? `<div style="margin-top:6px"><b>Notes:</b> ${escapeHtml(job.notes)}</div>` : ""}
      </div>

      <div class="attachments" id="att_${job.id}"></div>

      <div class="jobActions">
        <button class="btn" data-action="addFiles" data-id="${job.id}">Add Photos/Videos</button>
        <button class="btn danger" data-action="delete" data-id="${job.id}">Delete</button>
      </div>
    `;

    jobsEl.appendChild(card);

    // render attachments
    const attWrap = document.getElementById(`att_${job.id}`);
    if (job.attachments?.length) {
      for (const fileKey of job.attachments) {
        const blob = await dbGet(fileKey);
        if (!blob) continue;

        const url = URL.createObjectURL(blob);
        const box = document.createElement("div");
        box.className = "thumb";

        if (blob.type.startsWith("image/")) {
          box.innerHTML = `<img src="${url}" alt="attachment" />`;
        } else if (blob.type.startsWith("video/")) {
          box.innerHTML = `<video src="${url}" controls></video>`;
        } else {
          box.textContent = "FILE";
        }

        box.title = "Click to remove";
        box.style.cursor = "pointer";
        box.addEventListener("click", async () => {
          // remove attachment
          job.attachments = job.attachments.filter(k => k !== fileKey);
          await dbDelete(fileKey);
          save();
          render();
        });

        attWrap.appendChild(box);
      }
    }
  }
}

// ------------------- Events -------------------
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = uid();
  const client = el("client").value.trim();
  const site = el("site").value.trim();
  const jobType = el("jobType").value;
  const priority = el("priority").value;
  const dueDate = el("dueDate").value;
  const status = el("status").value;
  const notes = el("notes").value.trim();

  const files = Array.from(el("attachments").files || []);
  const attachmentKeys = [];

  for (const f of files) {
    const key = `${id}_${cryptoSafeName(f.name)}_${Date.now()}`;
    await dbPut(key, f);
    attachmentKeys.push(key);
  }

  const job = {
    id,
    client,
    site,
    jobType,
    priority,
    dueDate,
    status,
    notes,
    attachments: attachmentKeys
  };

  jobs.unshift(job);
  save();
  form.reset();
  await render();
});

el("clearAll").addEventListener("click", async () => {
  if (!confirm("Clear ALL jobs and files?")) return;
  jobs = [];
  save();
  await dbClearAll();
  await render();
});

jobsEl.addEventListener("change", async (e) => {
  const target = e.target;
  if (target.matches('select[data-action="status"]')) {
    const id = target.dataset.id;
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    job.status = target.value;
    save();
    await render();
  }
});

jobsEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;
  const job = jobs.find(j => j.id === id);
  if (!job) return;

  if (action === "delete") {
    if (!confirm("Delete this job?")) return;
    // delete all attachment blobs
    for (const key of job.attachments || []) await dbDelete(key);
    jobs = jobs.filter(j => j.id !== id);
    save();
    await render();
  }

  if (action === "addFiles") {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "image/*,video/*";
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      for (const f of files) {
        const key = `${id}_${cryptoSafeName(f.name)}_${Date.now()}`;
        await dbPut(key, f);
        job.attachments = job.attachments || [];
        job.attachments.push(key);
      }
      save();
      await render();
    };
    input.click();
  }
});

searchEl.addEventListener("input", render);
filterStatusEl.addEventListener("change", render);

// ------------------- Helpers -------------------
function escapeHtml(str) {
  return (str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cryptoSafeName(name) {
  return (name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
}

// Initial
render();