const SUPABASE_URL = "https://tqfocdktvjuwoiyfgesb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxZm9jZGt0dmp1d29peWZnZXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MDg0NTIsImV4cCI6MjEwNTQ4NDQ1Mn0.8TW4fQCQHc4c_xTNBEwOK3lSC9HYCbkTbfXuYQB-S8g";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let session = null;

const $ = (id) => document.getElementById(id);

function showView(name) {
  document.querySelectorAll(".view").forEach((el) => el.classList.remove("on"));
  $("view-" + name).classList.add("on");
  document.querySelectorAll("nav button").forEach((b) => {
    b.setAttribute("aria-current", b.dataset.view === name ? "true" : "false");
  });
}

document.querySelectorAll("nav button").forEach((b) => {
  b.addEventListener("click", () => showView(b.dataset.view));
});

function fmt(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function ensureProfile(user) {
  const { data } = await sb.from("nightglass_profiles").select("*").eq("id", user.id).maybeSingle();
  if (data) return data;
  const handle = (user.email || "guest").split("@")[0] + "-" + user.id.slice(0, 6);
  const row = { id: user.id, handle, display_name: (user.email || "guest").split("@")[0] };
  await sb.from("nightglass_profiles").insert(row);
  return row;
}

function renderAuth() {
  const slot = $("authSlot");
  slot.innerHTML = "";
  const btn = document.createElement("button");
  if (session) {
    btn.textContent = "Sign out";
    btn.onclick = () => sb.auth.signOut();
    $("pieceForm").hidden = false;
    $("deskGate").hidden = true;
  } else {
    btn.textContent = "Sign in";
    btn.onclick = () => { $("gate").hidden = false; };
    $("pieceForm").hidden = true;
    $("deskGate").hidden = false;
  }
  slot.appendChild(btn);
}

async function loadHour() {
  const { data: hours } = await sb
    .from("nightglass_hours")
    .select("editorial_line, featured_at, piece_id")
    .order("featured_at", { ascending: false })
    .limit(1);
  const hour = hours && hours[0];
  $("editorial").textContent = hour ? hour.editorial_line : "No hour set yet.";
  $("hourStamp").textContent = hour ? "this hour · " + fmt(hour.featured_at) : "this hour";

  if (hour && hour.piece_id) {
    const { data: piece } = await sb
      .from("nightglass_pieces")
      .select("title, body, created_at, user_id, is_public")
      .eq("id", hour.piece_id)
      .maybeSingle();
    if (piece && piece.is_public) {
      const { data: prof } = await sb.from("nightglass_profiles").select("handle").eq("id", piece.user_id).maybeSingle();
      $("featureCard").hidden = false;
      $("featureMeta").textContent = (prof?.handle || "someone") + " · " + fmt(piece.created_at);
      $("featureTitle").textContent = piece.title || "Untitled";
      $("featureBody").textContent = piece.body;
      return;
    }
  }
  $("featureCard").hidden = true;
}

function cardHTML(p, extra = "") {
  const el = document.createElement("article");
  el.className = "card";
  el.innerHTML = `<p class="meta ${p.is_public ? "pub" : "priv"}">${p.is_public ? "public" : "private"} · ${fmt(p.created_at)}</p>
    <h3>${escapeHtml(p.title || "Untitled")}</h3>
    <p>${escapeHtml(p.body)}</p>${extra}`;
  return el;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadYard() {
  const { data } = await sb
    .from("nightglass_pieces")
    .select("id, title, body, created_at, is_public, user_id")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(40);
  const yard = $("yard");
  yard.innerHTML = "";
  if (!data || !data.length) {
    yard.innerHTML = "<p class='lede'>The yard is empty. Write something and mark it public.</p>";
    return;
  }
  data.forEach((p) => yard.appendChild(cardHTML(p)));
}

async function loadMine() {
  if (!session) { $("mine").innerHTML = ""; return; }
  const { data } = await sb
    .from("nightglass_pieces")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false });
  const mine = $("mine");
  mine.innerHTML = "";
  (data || []).forEach((p) => {
    const extra = `<div class="row">
      <button data-act="toggle">${p.is_public ? "Make private" : "Mark public"}</button>
      <button data-act="del">Forget</button>
    </div>`;
    const el = cardHTML(p, extra);
    el.querySelector("[data-act=toggle]").onclick = async () => {
      await sb.from("nightglass_pieces").update({ is_public: !p.is_public, updated_at: new Date().toISOString() }).eq("id", p.id);
      loadMine(); loadYard(); loadHour();
    };
    el.querySelector("[data-act=del]").onclick = async () => {
      await sb.from("nightglass_pieces").delete().eq("id", p.id);
      loadMine(); loadYard(); loadHour();
    };
    mine.appendChild(el);
  });
}

$("pieceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!session) return;
  await ensureProfile(session.user);
  const fd = new FormData(e.target);
  await sb.from("nightglass_pieces").insert({
    user_id: session.user.id,
    title: String(fd.get("title") || "").trim(),
    body: String(fd.get("body") || "").trim(),
    is_public: fd.get("is_public") === "on",
  });
  e.target.reset();
  loadMine(); loadYard();
});

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = new FormData(e.target).get("email");
  const { error } = await sb.auth.signInWithOtp({
    email: String(email),
    options: { emailRedirectTo: window.location.origin },
  });
  $("authMsg").textContent = error ? error.message : "Check your mail. The door is there.";
});

$("gate").addEventListener("click", (e) => {
  if (e.target.id === "gate") $("gate").hidden = true;
});

sb.auth.onAuthStateChange(async (_e, s) => {
  session = s;
  renderAuth();
  if (s) {
    await ensureProfile(s.user);
    $("gate").hidden = true;
  }
  loadMine();
});

loadHour();
loadYard();
setInterval(loadHour, 60_000);
