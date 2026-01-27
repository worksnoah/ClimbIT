import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 1) PUT YOUR PROJECT VALUES HERE (Settings → API)
const SUPABASE_URL = "https://ddwjotqwjiaovlwcwokx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd2pvdHF3amlhb3Zsd2N3b2t4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NDMwMDYsImV4cCI6MjA4NTExOTAwNn0.JhufB9_M09PCgqiKCgQGL6a2dZ03xYcK0b0czjUSdIg";

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

// ====== Overlay open/close ======
function openUpload() {
  uploadMsg.textContent = "";
  uploadOverlay.classList.remove("hidden");
}

function closeUpload() {
  uploadOverlay.classList.add("hidden");
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

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  await renderSession(session);

  supabase.auth.onAuthStateChange(async (_event, session) => {
    await renderSession(session);
  });

  // autoplay: whenever you stop scrolling, play visible one
  feedEl.addEventListener("scroll", () => {
    clearTimeout(window.__scrollT);
    window.__scrollT = setTimeout(updateVisibleVideo, 120);
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
  setTimeout(updateVisibleVideo, 200);
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

// ====== Upload ======
async function uploadRoute() {
  uploadMsg.textContent = "";

  const grade = gradeEl.value.trim();
  const location = locationEl.value.trim();
  const file = videoEl.files[0];
  const desiredUsername = usernameEl.value.trim();

  if (!grade || !location || !file) {
    uploadMsg.textContent = "Add grade, location, and a video file.";
    return;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    uploadMsg.textContent = "Not logged in.";
    return;
  }

  if (desiredUsername) {
    await supabase.from("users").update({ username: desiredUsername }).eq("id", user.id);
  }

  const ext = file.name.split(".").pop();
  const filePath = `${user.id}/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await supabase
    .storage
    .from("route-videos")
    .upload(filePath, file, { contentType: file.type });

  if (upErr) {
    uploadMsg.textContent = "Upload failed: " + upErr.message;
    return;
  }

  const { data: pub } = supabase
    .storage
    .from("route-videos")
    .getPublicUrl(filePath);

  const video_url = pub.publicUrl;

  const { error: dbErr } = await supabase.from("routes").insert({
    video_url,
    grade,
    location,
    uploader_id: user.id
  });

  if (dbErr) {
    uploadMsg.textContent = "DB insert failed: " + dbErr.message;
    return;
  }

  uploadMsg.textContent = "Uploaded!";
  gradeEl.value = "";
  locationEl.value = "";
  videoEl.value = "";
  closeUpload();

  await renderUserBox();
  await loadFeed();
  setTimeout(updateVisibleVideo, 200);
}

// ====== Feed ======
async function loadFeed() {
  feedEl.innerHTML = "";

  const { data: { user } } = await supabase.auth.getUser();

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

  // which routes have I sent
  let mySends = new Set();
  if (user) {
    const { data: sends } = await supabase
      .from("sends")
      .select("route_id")
      .eq("user_id", user.id);
    (sends || []).forEach(s => mySends.add(s.route_id));
  }

  for (const r of routes) {
    const sentAlready = mySends.has(r.id);

    const card = document.createElement("div");
    card.className = "routeCard";
    card.innerHTML = `
      <video muted playsinline loop preload="auto" src="${r.video_url}"></video>

      <div class="meta">
        <div class="titleLine">${r.grade} • ${r.location}</div>
        <div class="subLine">uploaded by @${r.uploader?.username ?? "unknown"}</div>
      </div>

      <button class="sentBtn" ${sentAlready ? "disabled" : ""}>
        ${sentAlready ? "Sent ✓" : "Sent ✔"}
      </button>

      <div class="cardMsg"></div>
    `;

    const btn = card.querySelector(".sentBtn");
    const msg = card.querySelector(".cardMsg");

    btn.onclick = async () => {
      msg.textContent = "";
      btn.disabled = true;

      const { data: newTotal, error: rpcErr } = await supabase
        .rpc("log_send", { p_route_id: r.id });

      if (rpcErr) {
        msg.textContent = rpcErr.message;
        btn.disabled = false;
        return;
      }

      msg.textContent = `Logged! Total: ${newTotal} pts`;
      btn.textContent = "Sent ✓";
      await renderUserBox();
    };

    feedEl.appendChild(card);
  }
}

// ====== Autoplay visible video ======
function updateVisibleVideo() {
  const cards = Array.from(feedEl.querySelectorAll(".routeCard"));
  if (!cards.length) return;

  const mid = feedEl.scrollTop + feedEl.clientHeight / 2;

  let bestIdx = 0;
  let bestDist = Infinity;

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const center = c.offsetTop + c.clientHeight / 2;
    const d = Math.abs(center - mid);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  cards.forEach((c, i) => {
    const v = c.querySelector("video");
    if (!v) return;

    if (i === bestIdx) v.play().catch(()=>{});
    else v.pause();
  });
}
