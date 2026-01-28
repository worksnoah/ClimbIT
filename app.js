import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 1) PUT YOUR PROJECT VALUES HERE (Settings → API)
const SUPABASE_URL = "https://ddwjotqwjiaovlwcwokx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd2pvdHF3amlhb3Zsd2N3b2t4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDMwMDYsImV4cCI6MjA4NTExOTAwNn0.JhufB9_M09PCgqiKCgQGL6a2dZ03xYcK0b0czjUSdIg"; // keep yours

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

const usernameEl = document.getElementById("username");
const gradeEl = document.getElementById("grade");
const locationEl = document.getElementById("location");
const videoEl = document.getElementById("video");

// Upload overlay
const openUploadBtn = document.getElementById("openUpload");
const uploadOverlay = document.getElementById("uploadOverlay");
const closeUploadBtn = document.getElementById("closeUpload");

// ====== State ======
let isUploading = false;

// ====== Overlay open/close ======
function openUpload() {
  uploadMsg.textContent = "";
  uploadOverlay.classList.remove("hidden");
  requestAnimationFrame(() => uploadOverlay.classList.add("show"));
}

function closeUpload() {
  uploadOverlay.classList.remove("show");
  setTimeout(() => uploadOverlay.classList.add("hidden"), 200);
}

openUploadBtn?.addEventListener("click", openUpload);
closeUploadBtn?.addEventListener("click", closeUpload);

uploadOverlay?.addEventListener("click", (e) => {
  if (e.target.classList.contains("overlayBackdrop")) closeUpload();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && uploadOverlay && !uploadOverlay.classList.contains("hidden")) {
    closeUpload();
  }
});

// ====== Buttons ======
document.getElementById("btnSignup").onclick = signup;
document.getElementById("btnLogin").onclick = login;
document.getElementById("btnUpload").onclick = uploadRoute;

// ====== Start ======
init();

function scheduleWindowUpdate() {
  clearTimeout(window.__scrollT);
  window.__scrollT = setTimeout(updateActiveWindow, 90);
}

feedEl.addEventListener("scroll", scheduleWindowUpdate, { passive: true });
feedEl.addEventListener("touchend", scheduleWindowUpdate, { passive: true });
feedEl.addEventListener("wheel", scheduleWindowUpdate, { passive: true });

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  await renderSession(session);

  supabase.auth.onAuthStateChange(async (_event, session) => {
    await renderSession(session);
  });
}

async function renderSession(session) {
  if (!session) {
    authSection.classList.remove("hidden");
    appSection.classList.add("hidden");
    userBox.innerHTML = "";
    return;
  }

  authSection.classList.add("hidden");
  appSection.classList.remove("hidden");

  await ensureUserRow(session.user);
  await renderUserBox();
  await loadFeed();

  // start playing first visible
  requestAnimationFrame(() => {
    feedEl.scrollTop = 0;
    updateActiveWindow();
  });
}

// ====== Auth ======
async function signup() {
  authMsg.textContent = "";
  const email = emailEl.value.trim();
  const password = passEl.value;

  const { error } = await supabase.auth.signUp({ email, password });
  authMsg.textContent = error ? error.message : "Check your email to confirm (if confirmations are on).";
}

async function login() {
  authMsg.textContent = "";
  const email = emailEl.value.trim();
  const password = passEl.value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  authMsg.textContent = error ? error.message : "";
}

// ====== Ensure user row exists ======
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
    total_points: 0
  });

  if (error) console.log("ensureUserRow error:", error.message);
}

async function renderUserBox() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data: profile } = await supabase
    .from("users")
    .select("username,total_points")
    .eq("id", user.id)
    .single();

  userBox.innerHTML = `
    <div class="pill">@${profile.username} • ${profile.total_points} pts</div>
    <button id="btnLogout">Logout</button>
  `;
  document.getElementById("btnLogout").onclick = () => supabase.auth.signOut();
}

// ====== Upload (adds points on upload) ======
// IMPORTANT: Create this SQL function in Supabase (SQL editor):
// create or replace function log_upload(p_user uuid) returns void language sql as $$
//   update users set total_points = total_points + 1 where id = p_user;
// $$;
async function uploadRoute() {
  if (isUploading) return;
  isUploading = true;

  const uploadBtn = document.getElementById("btnUpload");
  uploadBtn.disabled = true;
  const oldBtnText = uploadBtn.textContent;
  uploadBtn.textContent = "Uploading…";
  uploadMsg.textContent = "";

  try {
    const location = locationEl.value.trim();
    const file = videoEl.files[0];
    const desiredUsername = usernameEl.value.trim();

    // ✅ grade: integers only 0–14
    const gradeNum = Number(gradeEl.value);
    if (!Number.isInteger(gradeNum) || gradeNum < 0 || gradeNum > 14) {
      uploadMsg.textContent = "Grade must be a number from 0 to 14.";
      return;
    }

    if (!location || !file) {
      uploadMsg.textContent = "Add location and a video file.";
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      uploadMsg.textContent = "Not logged in.";
      return;
    }

    // optional username set
    if (desiredUsername) {
      await supabase.from("users").update({ username: desiredUsername }).eq("id", user.id);
    }

    // 1) Upload video
    const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
    const filePath = `${user.id}/${crypto.randomUUID()}.${ext}`;

    const { error: upErr } = await supabase
      .storage
      .from("route-videos")
      .upload(filePath, file, { contentType: file.type, upsert: false });

    if (upErr) {
      uploadMsg.textContent = "Upload failed: " + upErr.message;
      return;
    }

    // 2) Public URL
    const { data: pub } = supabase
      .storage
      .from("route-videos")
      .getPublicUrl(filePath);

    const video_url = pub.publicUrl;

    // 3) Insert route row (grade stored as number)
    const { error: dbErr } = await supabase.from("routes").insert({
      video_url,
      grade: gradeNum,
      location,
      uploader_id: user.id
    });

    if (dbErr) {
      uploadMsg.textContent = "DB insert failed: " + dbErr.message;
      return;
    }

    // 4) ✅ Add points ON UPLOAD (server-side function)
    const { error: ptsErr } = await supabase.rpc("log_upload", { p_user: user.id });
    if (ptsErr) {
      // still uploaded fine; just show warning
      console.log("log_upload error:", ptsErr.message);
    }

    uploadMsg.textContent = "Uploaded! +1 point";

    // clear form
    gradeEl.value = "";
    locationEl.value = "";
    videoEl.value = "";

    // refresh UI + feed
    await renderUserBox();
    await loadFeed();

    // reset feed to top and play first
    feedEl.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => updateActiveWindow(), 200);

    // close overlay after a beat
    setTimeout(() => closeUpload(), 350);
  } finally {
    isUploading = false;
    uploadBtn.disabled = false;
    uploadBtn.textContent = oldBtnText;
  }
}

// ====== Feed (NO send button) ======
async function loadFeed() {
  feedEl.innerHTML = "Loading…";

  const { data: routes, error } = await supabase
    .from("routes")
    .select(`
      id,
      video_url,
      grade,
      location,
      created_at,
      uploader:users(username)
    `)
    .order("created_at", { ascending: false });

  if (error) {
    feedEl.innerHTML = "Error loading feed: " + error.message;
    return;
  }

  feedEl.innerHTML = "";

  for (const r of routes) {
    const card = document.createElement("div");
    card.className = "routeCard";

    card.innerHTML = `
      <video class="clip" muted playsinline loop preload="none" data-src="${r.video_url}"></video>

      <div class="meta">
        <div class="titleLine"><b>V${Number(r.grade)}</b> • ${escapeHtml(r.location)}</div>
        <div class="subLine">uploaded by @${escapeHtml(r.uploader?.username ?? "unknown")}</div>
      </div>

      <button class="muteBtn" aria-label="Mute/unmute">🔇</button>
    `;

    const video = card.querySelector("video.clip");
    const muteBtn = card.querySelector(".muteBtn");

    // If the URL is dead, remove it (prevents ghost rows)
    video.addEventListener("error", () => {
      card.remove();
    });

    // Play/pause on tap (except mute button)
    card.addEventListener("click", async (e) => {
      if (e.target.closest(".muteBtn")) return;

      if (video.paused) {
        try { await video.play(); } catch {}
      } else {
        video.pause();
      }
    });

    // Mute toggle
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

  // Ensure active window loads after render
  setTimeout(updateActiveWindow, 60);
}

// ====== Lazy-load window: keep only nearby videos loaded ======
function getClosestCardIndex() {
  const cards = Array.from(feedEl.querySelectorAll(".routeCard"));
  if (!cards.length) return 0;

  const feedRect = feedEl.getBoundingClientRect();
  const targetY = feedRect.top + feedRect.height / 2;

  let best = 0;
  let bestDist = Infinity;

  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    const center = r.top + r.height / 2;
    const d = Math.abs(center - targetY);
    if (d < bestDist) { bestDist = d; best = i; }
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
  const cards = Array.from(feedEl.querySelectorAll(".routeCard"));
  if (!cards.length) return;

  const active = getClosestCardIndex();

  // keep active ±2 (fast + reliable)
  const keep = new Set([active - 2, active - 1, active, active + 1, active + 2]);

  cards.forEach((card, idx) => {
    const v = card.querySelector("video.clip");
    if (!v) return;

    if (keep.has(idx)) loadVideoEl(v);
    else unloadVideoEl(v);
  });

  // autoplay only active
  const activeVideo = cards[active]?.querySelector("video.clip");
  if (activeVideo) {
    loadVideoEl(activeVideo);
    activeVideo.play().catch(() => {});
  }

  // pause all others
  cards.forEach((card, idx) => {
    if (idx === active) return;
    const v = card.querySelector("video.clip");
    if (v) v.pause();
  });
}

// ====== Helpers ======
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
