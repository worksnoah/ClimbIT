import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ✅ Lazy-load FFmpeg ONLY when uploading (so login never depends on FFmpeg)
async function getFFmpeg() {
  const { FFmpeg } = await import("https://esm.sh/@ffmpeg/ffmpeg@0.12.6");
  const { fetchFile } = await import("https://esm.sh/@ffmpeg/util@0.12.6");
  const ffmpeg = new FFmpeg();
  let loaded = false;

  return {
    async compressToMp4(file) {
      if (!loaded) {
        await ffmpeg.load({
          coreURL: "https://esm.sh/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js",
        });
        loaded = true;
      }

      await ffmpeg.writeFile("input", await fetchFile(file));

      // Simple + reliable mobile-ish compression
      // - CRF 28 = decent compression
      // - scale down to max 720p (keeps uploads sane)
      await ffmpeg.exec([
        "-i", "input",
        "-vf", "scale='min(1280,iw)':-2",
        "-vcodec", "libx264",
        "-crf", "28",
        "-preset", "veryfast",
        "-movflags", "+faststart",
        "output.mp4",
      ]);

      const data = await ffmpeg.readFile("output.mp4");
      return new File([data.buffer], "compressed.mp4", { type: "video/mp4" });
    },
  };
}

// 1) PUT YOUR PROJECT VALUES HERE (Settings → API)
const SUPABASE_URL = "https://ddwjotqwjiaovlwcwokx.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd2pvdHF3amlhb3Zsd2N3b2t4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDMwMDYsImV4cCI6MjA4NTExOTAwNn0.JhufB9_M09PCgqiKCgQGL6a2dZ03xYcK0b0czjUSdIg";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ====== DOM ======
const authSection = document.getElementById("authSection");
const appSection = document.getElementById("appSection");
const authMsg = document.getElementById("authMsg");
const uploadMsg = document.getElementById("uploadMsg");

const feedEl = document.getElementById("feed");
const userBox = document.getElementById("userBox");

const emailEl = document.getElementById("email");
const passEl = document.getElementById("password");
const usernameSignupEl = document.getElementById("usernameSignup"); // may be null if you removed it

const problemNameEl = document.getElementById("problemName");
const gradeSelectEl = document.getElementById("gradeSelect");
const locationEl = document.getElementById("location");
const videoEl = document.getElementById("video");

const gradeFilterEl = document.getElementById("gradeFilter");

const userMenuOverlay = document.getElementById("userMenuOverlay");
const closeUserMenuBtn = document.getElementById("closeUserMenu");

// Upload overlay
const openUploadBtn = document.getElementById("openUpload");
const uploadOverlay = document.getElementById("uploadOverlay");
const closeUploadBtn = document.getElementById("closeUpload");

// ====== State ======
let isUploading = false;
let currentFilter = "ALL";

// ====== Safe attach helper ======
function on(id, event, handler) {
  const el = typeof id === "string" ? document.getElementById(id) : id;
  if (!el) return;
  el.addEventListener(event, handler);
  return el;
}

// ====== User menu overlay ======
function openUserMenu() {
  if (!userMenuOverlay) return;
  userMenuOverlay.classList.remove("hidden");
  requestAnimationFrame(() => userMenuOverlay.classList.add("show"));

  const btn = document.getElementById("userMenuBtn");
  btn?.setAttribute("aria-expanded", "true");

  const logoutBtn = document.getElementById("btnLogout");
  if (logoutBtn) logoutBtn.onclick = () => supabase.auth.signOut();
}

function closeUserMenu() {
  if (!userMenuOverlay) return;
  userMenuOverlay.classList.remove("show");
  setTimeout(() => userMenuOverlay.classList.add("hidden"), 200);

  const btn = document.getElementById("userMenuBtn");
  btn?.setAttribute("aria-expanded", "false");
}

on(closeUserMenuBtn, "click", closeUserMenu);

on(userMenuOverlay, "click", (e) => {
  if (e.target.classList?.contains("overlayBackdrop")) closeUserMenu();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && userMenuOverlay && !userMenuOverlay.classList.contains("hidden")) {
    closeUserMenu();
  }
});

// ====== Upload overlay open/close ======
function openUpload() {
  if (uploadMsg) uploadMsg.textContent = "";
  uploadOverlay?.classList.remove("hidden");
  requestAnimationFrame(() => uploadOverlay?.classList.add("show"));
}
function closeUpload() {
  uploadOverlay?.classList.remove("show");
  setTimeout(() => uploadOverlay?.classList.add("hidden"), 200);
}

on(openUploadBtn, "click", openUpload);
on(closeUploadBtn, "click", closeUpload);

on(uploadOverlay, "click", (e) => {
  if (e.target.classList?.contains("overlayBackdrop")) closeUpload();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && uploadOverlay && !uploadOverlay.classList.contains("hidden")) {
    closeUpload();
  }
});

// ====== Buttons (safe) ======
const btnSignup = document.getElementById("btnSignup");
if (btnSignup) btnSignup.onclick = signup;

const btnLogin = document.getElementById("btnLogin");
if (btnLogin) btnLogin.onclick = login;

const btnUpload = document.getElementById("btnUpload");
if (btnUpload) btnUpload.onclick = uploadClimb;

// Grade filter (safe)
gradeFilterEl?.addEventListener("change", async () => {
  currentFilter = gradeFilterEl.value;
  await loadFeed();
  requestAnimationFrame(() => {
    if (feedEl) feedEl.scrollTop = 0;
    updateActiveWindow();
  });
});

// Feed scroll (safe)
function scheduleWindowUpdate() {
  clearTimeout(window.__scrollT);
  window.__scrollT = setTimeout(updateActiveWindow, 90);
}
feedEl?.addEventListener("scroll", scheduleWindowUpdate, { passive: true });
feedEl?.addEventListener("touchend", scheduleWindowUpdate, { passive: true });
feedEl?.addEventListener("wheel", scheduleWindowUpdate, { passive: true });

// ====== Start ======
init();

async function init() {
  // If your script was crashing, you’ll never see this
  console.log("app.js loaded OK");

  const { data: { session } } = await supabase.auth.getSession();
  await renderSession(session);

  supabase.auth.onAuthStateChange(async (_event, session2) => {
    await renderSession(session2);
  });
}

async function renderSession(session) {
  if (!session) {
    authSection?.classList.remove("hidden");
    appSection?.classList.add("hidden");
    if (userBox) userBox.innerHTML = "";
    return;
  }

  authSection?.classList.add("hidden");
  appSection?.classList.remove("hidden");

  await ensureUserRow(session.user);
  await applyPendingUsernameOnce(); // only runs if pending username exists
  await renderUserBox();
  await loadFeed();

  requestAnimationFrame(() => {
    if (feedEl) feedEl.scrollTop = 0;
    updateActiveWindow();
  });
}

// ====== Auth ======
async function signup() {
  if (authMsg) authMsg.textContent = "";

  const email = (emailEl?.value || "").trim();
  const password = passEl?.value || "";
  const username = (usernameSignupEl?.value || "").trim(); // ✅ safe even if field is missing

  if (!email || !password) {
    if (authMsg) authMsg.textContent = "Enter email and password.";
    return;
  }

  // If you removed usernameSignup from HTML, this will force you to add it back (good)
  if (!usernameSignupEl) {
    if (authMsg) authMsg.textContent = "Missing username input (id='usernameSignup') in HTML.";
    return;
  }

  if (!username) {
    if (authMsg) authMsg.textContent = "Pick a username (set once).";
    return;
  }
  if (!isValidUsername(username)) {
    if (authMsg) authMsg.textContent = "Username: 3–20 chars, letters/numbers/_ only.";
    return;
  }

  localStorage.setItem("pendingUsername", username);

  const { error } = await supabase.auth.signUp({ email, password });
  if (authMsg) {
    authMsg.textContent = error
      ? error.message
      : "Signed up. Check your email if confirmations are on, then log in.";
  }
}

async function login() {
  if (authMsg) authMsg.textContent = "";

  const email = (emailEl?.value || "").trim();
  const password = passEl?.value || "";

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (authMsg) authMsg.textContent = error ? error.message : "";
}

// ====== Users ======
async function ensureUserRow(user) {
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (existing) return;

  const email = user.email ?? null;

  const { error } = await supabase.from("users").insert({
    id: user.id,
    email,
    username: "user_" + user.id.slice(0, 6),
    username_locked: false,
    total_points: 0,
  });

  if (error) console.log("ensureUserRow error:", error.message);
}

async function applyPendingUsernameOnce() {
  const pending = (localStorage.getItem("pendingUsername") || "").trim();
  if (!pending) return;

  const { error } = await supabase.rpc("set_username_once", { p_username: pending });

  if (!error) {
    localStorage.removeItem("pendingUsername");
    if (usernameSignupEl) usernameSignupEl.value = "";
  } else {
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("already") || msg.includes("locked")) {
      localStorage.removeItem("pendingUsername");
    }
  }
}

async function renderUserBox() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !userBox) return;

  const { data: profile, error } = await supabase
    .from("users")
    .select("username,total_points")
    .eq("id", user.id)
    .single();

  if (error) {
    userBox.innerHTML = "";
    return;
  }

  userBox.innerHTML = `
    <button id="userMenuBtn" class="userPill" aria-haspopup="dialog" aria-expanded="false">
      @${escapeHtml(profile.username)} • ${Number(profile.total_points || 0)} pts
    </button>
  `;

  document.getElementById("userMenuBtn")?.addEventListener("click", openUserMenu);
}

// ====== Upload ======
async function uploadClimb() {
  if (isUploading) return;
  isUploading = true;

  const uploadBtnEl = document.getElementById("btnUpload");
  if (uploadBtnEl) uploadBtnEl.disabled = true;

  const oldBtnText = uploadBtnEl ? uploadBtnEl.textContent : "Upload";
  if (uploadBtnEl) uploadBtnEl.textContent = "Uploading…";
  if (uploadMsg) uploadMsg.textContent = "";

  try {
    const problem_name = (problemNameEl?.value || "").trim();
    const location = (locationEl?.value || "").trim();
    let file = videoEl?.files?.[0] || null;

    const gradeRaw = String(gradeSelectEl?.value ?? "NR");
    const grade_num = gradeRaw === "NR" ? null : Number(gradeRaw);

    if (!problem_name) {
      if (uploadMsg) uploadMsg.textContent = "Add a problem name.";
      return;
    }
    if (!location) {
      if (uploadMsg) uploadMsg.textContent = "Add a location.";
      return;
    }
    if (!file) {
      if (uploadMsg) uploadMsg.textContent = "Choose a video file.";
      return;
    }
    if (grade_num !== null && (!Number.isInteger(grade_num) || grade_num < 0 || grade_num > 14)) {
      if (uploadMsg) uploadMsg.textContent = "Grade must be NR or V0–V14.";
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      if (uploadMsg) uploadMsg.textContent = "Not logged in.";
      return;
    }

    // ✅ Compress (optional). If FFmpeg fails, fall back to original file.
    try {
      if (uploadMsg) uploadMsg.textContent = "Compressing video…";
      const ff = await getFFmpeg();
      file = await ff.compressToMp4(file);
    } catch (e) {
      console.log("FFmpeg compression failed, uploading original:", e);
      if (uploadMsg) uploadMsg.textContent = "Uploading original video…";
    }

    // 1) Upload video to storage
    const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
    const filePath = `${user.id}/${crypto.randomUUID()}.${ext}`;

    const { error: upErr } = await supabase
      .storage
      .from("route-videos")
      .upload(filePath, file, { contentType: file.type, upsert: false });

    if (upErr) {
      if (uploadMsg) uploadMsg.textContent = "Upload failed: " + upErr.message;
      return;
    }

    // 2) Public URL
    const { data: pub } = supabase.storage.from("route-videos").getPublicUrl(filePath);
    const video_url = pub.publicUrl;

    // ✅ IMPORTANT: insert column names that match your FEED query (problem_name, grade_num)
    const { error: dbErr } = await supabase.from("routes").insert({
      video_url,
      problem_name,
      grade_num,     // can be null for NR
      location,
      uploader_id: user.id,
    });

    if (dbErr) {
      if (uploadMsg) uploadMsg.textContent = "DB insert failed: " + dbErr.message;
      return;
    }

    if (uploadMsg) uploadMsg.textContent = "Uploaded!";

    // clear form
    if (problemNameEl) problemNameEl.value = "";
    if (locationEl) locationEl.value = "";
    if (videoEl) videoEl.value = "";
    if (gradeSelectEl) gradeSelectEl.value = "NR";

    await renderUserBox();
    await loadFeed();

    feedEl?.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => updateActiveWindow(), 200);
    setTimeout(() => closeUpload(), 350);
  } finally {
    isUploading = false;
    if (uploadBtnEl) uploadBtnEl.disabled = false;
    if (uploadBtnEl) uploadBtnEl.textContent = oldBtnText;
  }
}

// ====== Feed ======
async function loadFeed() {
  if (!feedEl) return;
  feedEl.innerHTML = "Loading…";

  let q = supabase
    .from("routes")
    .select(`
      id,
      video_url,
      problem_name,
      grade_num,
      location,
      created_at,
      uploader:users(username)
    `)
    .order("created_at", { ascending: false });

  if (currentFilter === "NR") {
    q = q.is("grade_num", null);
  } else if (currentFilter !== "ALL") {
    q = q.eq("grade_num", Number(currentFilter));
  }

  const { data: routes, error } = await q;

  if (error) {
    feedEl.innerHTML = "Error loading feed: " + error.message;
    return;
  }

  feedEl.innerHTML = "";

  for (const r of (routes || [])) {
    const card = document.createElement("div");
    card.className = "routeCard";

    const gradeLabel =
      r.grade_num === null || r.grade_num === undefined ? "NR" : `V${Number(r.grade_num)}`;

    card.innerHTML = `
      <video class="clip" muted playsinline loop preload="none" data-src="${escapeAttr(r.video_url)}"></video>

      <div class="meta">
        <div class="titleLine">
          <span class="badge">${gradeLabel}</span>
          <span class="problem">${escapeHtml(r.problem_name)}</span>
        </div>
        <div class="subLine">${escapeHtml(r.location)} • @${escapeHtml(r.uploader?.username ?? "unknown")}</div>
      </div>

      <button class="muteBtn" aria-label="Mute/unmute">🔇</button>
    `;

    const video = card.querySelector("video.clip");
    const muteBtn = card.querySelector(".muteBtn");

    video.addEventListener("error", () => card.remove());

    card.addEventListener("click", async (e) => {
      if (e.target.closest(".muteBtn")) return;
      if (video.paused) {
        try { await video.play(); } catch {}
      } else {
        video.pause();
      }
    });

    function syncMuteIcon() {
      muteBtn.textContent = video.muted ? "🔇" : "🔊";
    }
    syncMuteIcon();

    muteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      video.muted = !video.muted;
      syncMuteIcon();
      try { await video.play(); } catch {}
    });

    feedEl.appendChild(card);
  }

  setTimeout(updateActiveWindow, 60);
}

// ====== Lazy-load window: keep only nearby videos loaded ======
function getClosestCardIndex() {
  const cards = Array.from(feedEl?.querySelectorAll(".routeCard") || []);
  if (!cards.length) return 0;

  const feedRect = feedEl.getBoundingClientRect();
  const targetY = feedRect.top + feedRect.height / 2;

  let best = 0;
  let bestDist = Infinity;

  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    const center = r.top + r.height / 2;
    const d = Math.abs(center - targetY);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function loadVideoEl(video) {
  if (!video) return;
  if (video.src) return;

  const url = video.dataset.src;
  if (!url) return;

  video.preload = "metadata";
  video.src = url;
  video.load();
}

function unloadVideoEl(video) {
  if (!video) return;
  if (!video.src) return;

  video.pause();
  video.removeAttribute("src");
  video.load();
}

function updateActiveWindow() {
  const cards = Array.from(feedEl?.querySelectorAll(".routeCard") || []);
  if (!cards.length) return;

  const active = getClosestCardIndex();
  const keep = new Set([active - 2, active - 1, active, active + 1, active + 2]);

  cards.forEach((card, idx) => {
    const v = card.querySelector("video.clip");
    if (!v) return;
    if (keep.has(idx)) loadVideoEl(v);
    else unloadVideoEl(v);
  });

  const activeVideo = cards[active]?.querySelector("video.clip");
  if (activeVideo) {
    loadVideoEl(activeVideo);
    activeVideo.play().catch(() => {});
  }

  cards.forEach((card, idx) => {
    if (idx === active) return;
    const v = card.querySelector("video.clip");
    if (v) v.pause();
  });
}

// ====== Helpers ======
function isValidUsername(u) {
  if (u.length < 3 || u.length > 20) return false;
  return /^[a-zA-Z0-9_]+$/.test(u);
}
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeAttr(str) {
  return String(str ?? "").replaceAll('"', "&quot;");
}
