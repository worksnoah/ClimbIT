import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 1) PUT YOUR PROJECT VALUES HERE (Settings → API)
const SUPABASE_URL = "https://YOURPROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// DOM
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

// Buttons
document.getElementById("btnSignup").onclick = signup;
document.getElementById("btnLogin").onclick = login;
document.getElementById("btnUpload").onclick = uploadRoute;

// ---------- App start ----------
init();

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
}

// ---------- Auth ----------
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

async function googleLogin() {
  authMsg.textContent = "";

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin
    }
  });

  if (error) authMsg.textContent = error.message;
}

// ---------- Ensure user row exists ----------
async function ensureUserRow(user) {
  // Try to find existing profile row
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (existing) return;

  // Create it (RLS allows insert if id = auth.uid())
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

// ---------- Upload ----------
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

  // Optional: set username once (simple MVP behavior)
  if (desiredUsername) {
    await supabase.from("users").update({ username: desiredUsername }).eq("id", user.id);
  }

  // 1) Upload video to storage
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

  // 2) Get public URL
  const { data: pub } = supabase
    .storage
    .from("route-videos")
    .getPublicUrl(filePath);

  const video_url = pub.publicUrl;

  // 3) Insert route row
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

  await renderUserBox();
  await loadFeed();
}

// ---------- Feed ----------
async function loadFeed() {
  feedEl.innerHTML = "Loading…";

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

  // Fetch my sends so we can disable Sent button
  let mySends = new Set();
  if (user) {
    const { data: sends } = await supabase
      .from("sends")
      .select("route_id")
      .eq("user_id", user.id);
    (sends || []).forEach(s => mySends.add(s.route_id));
  }

  feedEl.innerHTML = "";
  for (const r of routes) {
    const sentAlready = mySends.has(r.id);

    const card = document.createElement("div");
    card.className = "routeCard";
    card.innerHTML = `
      <video controls playsinline preload="metadata" src="${r.video_url}"></video>
      <div class="meta">
        <div><b>${r.grade}</b> • ${r.location}</div>
        <div class="sub">uploaded by @${r.uploader?.username ?? "unknown"}</div>
      </div>
      <button class="sentBtn" ${sentAlready ? "disabled" : ""}>
        ${sentAlready ? "Sent ✓" : "Sent ✔"}
      </button>
      <div class="msg small"></div>
    `;

    const btn = card.querySelector(".sentBtn");
    const msg = card.querySelector(".msg.small");

    btn.onclick = async () => {
      msg.textContent = "";
      btn.disabled = true;

      // call the RPC that inserts send + adds points atomically
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

