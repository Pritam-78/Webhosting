// ===== STATE =====
let token = localStorage.getItem('htmlhost_token');
let currentUser = JSON.parse(localStorage.getItem('htmlhost_user') || 'null');
let sites = [];
let deleteTargetId = null;
let uploadedFileContent = null;
let currentMode = 'editor';
let editTargetId = null;
let aliasTimer   = null;
let aliasTaken   = false;

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  if (token && currentUser) {
    showDashboard();
  } else {
    showHero();
  }
});

// ===== AUTH FLOW =====
function showAuth(mode) {
  document.getElementById('authModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (mode === 'login') {
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('authTitle').textContent = 'Welcome back';
    document.getElementById('authSubtitle').textContent = 'Sign in to your account';
  } else {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.remove('hidden');
    document.getElementById('authTitle').textContent = 'Create account';
    document.getElementById('authSubtitle').textContent = 'Start hosting for free';
  }
}

function closeAuth() {
  document.getElementById('authModal').classList.add('hidden');
  document.body.style.overflow = '';
  clearErrors();
}

function clearErrors() {
  ['loginError','registerError','nameError','publishError','deleteError'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.add('hidden'); el.textContent = ''; }
  });
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn.dataset.orig = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Please wait…';
  } else {
    btn.innerHTML = btn.dataset.orig || btn.innerHTML;
  }
}

async function handleLogin(e) {
  e.preventDefault();
  clearErrors();
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  setLoading('loginBtn', true);
  try {
    const res  = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ email, password }) });
    const data = await res.json();
    if (!res.ok) { showError('loginError', data.error || 'Login failed'); return; }
    saveSession(data.token, data.user);
    closeAuth();
    data.needsName ? showNameModal() : showDashboard();
  } catch { showError('loginError', 'Network error. Please try again.'); }
  finally { setLoading('loginBtn', false); }
}

async function handleRegister(e) {
  e.preventDefault();
  clearErrors();
  const email    = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  if (password.length < 6) { showError('registerError', 'Password must be at least 6 characters.'); return; }
  setLoading('registerBtn', true);
  try {
    const res  = await fetch('/api/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ email, password }) });
    const data = await res.json();
    if (res.status === 409 && data.error === 'already_registered') {
      showError('registerError', data.message + ' Please log in instead.');
      setTimeout(() => showAuth('login'), 2500);
      return;
    }
    if (!res.ok) { showError('registerError', data.error || 'Registration failed'); return; }
    saveSession(data.token, data.user);
    closeAuth();
    data.needsName ? showNameModal() : showDashboard();
  } catch { showError('registerError', 'Network error. Please try again.'); }
  finally { setLoading('registerBtn', false); }
}

function showNameModal() {
  document.getElementById('nameModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('nameInput').focus(), 100);
}

async function handleNameSubmit(e) {
  e.preventDefault();
  clearErrors();
  const name = document.getElementById('nameInput').value.trim();
  if (!name) { showError('nameError', 'Please enter your name.'); return; }
  try {
    const res  = await fetch('/api/auth/name', { method:'PUT', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body:JSON.stringify({ name }) });
    const data = await res.json();
    if (!res.ok) { showError('nameError', data.error || 'Failed to save name'); return; }
    currentUser = data.user;
    localStorage.setItem('htmlhost_user', JSON.stringify(currentUser));
    document.getElementById('nameModal').classList.add('hidden');
    document.body.style.overflow = '';
    showDashboard();
  } catch { showError('nameError', 'Network error. Please try again.'); }
}

function saveSession(t, user) {
  token = t; currentUser = user;
  localStorage.setItem('htmlhost_token', t);
  localStorage.setItem('htmlhost_user', JSON.stringify(user));
}

function logout() {
  token = null; currentUser = null;
  localStorage.removeItem('htmlhost_token');
  localStorage.removeItem('htmlhost_user');
  showHero();
}

// ===== VIEWS =====
function showHero() {
  document.getElementById('heroSection').classList.remove('hidden');
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('navActions').classList.remove('hidden');
  document.getElementById('navUser').classList.add('hidden');
}

function showDashboard() {
  document.getElementById('heroSection').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  document.getElementById('navActions').classList.add('hidden');
  document.getElementById('navUser').classList.remove('hidden');
  const name = currentUser?.name || currentUser?.email?.split('@')[0] || 'User';
  document.getElementById('welcomeName').textContent = name;
  document.getElementById('navEmail').textContent = currentUser?.email || '';
  loadSites();
  updatePreview();
  loadAnnouncement();
  loadNotifications();
}

function openPublisher() {
  switchTab('publish', document.querySelectorAll('.tab-btn')[0]);
}

// ===== USER NOTIFICATIONS =====
async function loadNotifications() {
  try {
    const res  = await fetch('/api/notifications', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    renderNotifications(data.notifications || []);
  } catch {
    document.getElementById('notificationsStack').innerHTML = '';
  }
}

function renderNotifications(notifications) {
  const stack = document.getElementById('notificationsStack');
  if (!notifications.length) { stack.innerHTML = ''; return; }

  stack.innerHTML = notifications.map(n => `
    <div class="user-notif-card" id="notif-${n.id}" role="alert">
      <div class="user-notif-glow"></div>
      <div class="user-notif-icon">
        <i class="fa-solid fa-bell"></i>
      </div>
      <div class="user-notif-body">
        <div class="user-notif-label">
          <span class="user-notif-badge">Admin Message</span>
          <span class="user-notif-time">${formatTimeAgo(n.created_at)}</span>
        </div>
        <p class="user-notif-message">${escapeHtml(n.message)}</p>
        ${n.action_link ? `
          <a href="${escapeHtml(n.action_link)}" target="_blank" rel="noopener" class="user-notif-action-btn">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> Open Link
          </a>` : ''}
      </div>
      <button class="user-notif-dismiss" onclick="dismissNotification(${n.id})" aria-label="Mark as read">
        <i class="fa-solid fa-check"></i>
        <span>Mark read</span>
      </button>
    </div>
  `).join('');
}

async function dismissNotification(id) {
  const card = document.getElementById(`notif-${id}`);
  if (!card) return;

  // Optimistic animation
  card.classList.add('notif-dismissing');

  try {
    await fetch(`/api/notifications/${id}/read`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch { /* silent — card already visually gone */ }

  setTimeout(() => {
    card.remove();
    // If stack is empty, clear it
    const stack = document.getElementById('notificationsStack');
    if (!stack.children.length) stack.innerHTML = '';
  }, 380);
}

function formatTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)  return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// ===== ANNOUNCEMENT BANNER =====
async function loadAnnouncement() {
  try {
    const res  = await fetch('/api/announcements/active');
    const data = await res.json();
    if (data.announcement) {
      showAnnouncementBanner(data.announcement);
    } else {
      hideAnnouncementBanner();
    }
  } catch { hideAnnouncementBanner(); }
}

function showAnnouncementBanner(ann) {
  const dismissed = sessionStorage.getItem('ann_dismissed_' + ann.id);
  if (dismissed) return;

  const banner = document.getElementById('announcementBanner');
  const icon   = document.getElementById('annIcon');
  const title  = document.getElementById('annBannerTitle');
  const msg    = document.getElementById('annBannerMsg');

  const icons = { info:'fa-circle-info', success:'fa-circle-check', warning:'fa-triangle-exclamation', danger:'fa-radiation' };
  icon.className  = `fa-solid ${icons[ann.type] || 'fa-circle-info'}`;
  title.textContent = ann.title;
  msg.textContent   = ann.content;

  banner.className = `announcement-banner ann-${ann.type}`;
  banner.dataset.annId = ann.id;
  banner.classList.remove('hidden');
}

function hideAnnouncementBanner() {
  const banner = document.getElementById('announcementBanner');
  if (banner) banner.classList.add('hidden');
}

function dismissAnnouncement() {
  const banner = document.getElementById('announcementBanner');
  if (banner) {
    sessionStorage.setItem('ann_dismissed_' + banner.dataset.annId, '1');
    banner.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => banner.classList.add('hidden'), 300);
  }
}

// ===== TABS =====
function switchTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  if (btn) btn.classList.add('active');
  if (tab === 'publish') {
    document.getElementById('tabPublish').classList.remove('hidden');
    document.querySelectorAll('.tab-btn')[0].classList.add('active');
  } else {
    document.getElementById('tabSites').classList.remove('hidden');
    document.querySelectorAll('.tab-btn')[1].classList.add('active');
    loadSites();
  }
}

// ===== EDITOR =====
function setMode(mode) {
  currentMode = mode;
  document.getElementById('modeEditor').classList.toggle('active', mode === 'editor');
  document.getElementById('modeUpload').classList.toggle('active', mode === 'upload');
  document.getElementById('editorMode').classList.toggle('hidden', mode !== 'editor');
  document.getElementById('uploadMode').classList.toggle('hidden', mode !== 'upload');
  if (mode === 'editor') updatePreview();
  else if (uploadedFileContent) setPreviewContent(uploadedFileContent);
}

function updatePreview() {
  setPreviewContent(document.getElementById('htmlEditor').value);
}

function setPreviewContent(html) {
  const frame = document.getElementById('previewFrame');
  if (!html || !html.trim()) { frame.srcdoc = ''; return; }
  frame.srcdoc = html;
}

function refreshPreview() {
  if (currentMode === 'editor') updatePreview();
  else if (uploadedFileContent) setPreviewContent(uploadedFileContent);
}

function insertTemplate() {
  document.getElementById('htmlEditor').value = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My Website</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #1a1a2e, #16213e);
      color: #fff; min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
    }
    .container { text-align: center; padding: 40px; }
    h1 { font-size: 3rem; margin-bottom: 16px;
         background: linear-gradient(135deg, #6c63ff, #a855f7);
         -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    p { color: #9090b8; font-size: 1.1rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Hello, World!</h1>
    <p>Your website is live and ready to share.</p>
  </div>
</body>
</html>`;
  updatePreview();
}

function clearEditor() {
  document.getElementById('htmlEditor').value = '';
  setPreviewContent('');
}

// ===== FILE UPLOAD =====
function handleDragOver(e)  { e.preventDefault(); document.getElementById('uploadZone').classList.add('drag-over'); }
function handleDragLeave()  { document.getElementById('uploadZone').classList.remove('drag-over'); }
function handleDrop(e)      { e.preventDefault(); document.getElementById('uploadZone').classList.remove('drag-over'); const f = e.dataTransfer.files[0]; if (f) processFile(f); }
function handleFileSelect(e){ const f = e.target.files[0]; if (f) processFile(f); }

function processFile(file) {
  if (!file.name.match(/\.(html|htm)$/i)) { alert('Please select an .html or .htm file.'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    uploadedFileContent = e.target.result;
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('fileSize').textContent = formatBytes(file.size);
    document.getElementById('uploadZone').classList.add('hidden');
    document.getElementById('filePreview').classList.remove('hidden');
    if (!document.getElementById('siteName').value)
      document.getElementById('siteName').value = file.name.replace(/\.(html|htm)$/i, '');
    setPreviewContent(uploadedFileContent);
  };
  reader.readAsText(file);
}

function clearFile() {
  uploadedFileContent = null;
  document.getElementById('fileInput').value = '';
  document.getElementById('uploadZone').classList.remove('hidden');
  document.getElementById('filePreview').classList.add('hidden');
  setPreviewContent('');
}

function formatBytes(b) { return b < 1024 ? b + ' B' : (b / 1024).toFixed(1) + ' KB'; }

// ===== HAMBURGER MENU =====
function toggleMenu() {
  const menu = document.getElementById('sideMenu');
  if (menu.classList.contains('open')) {
    closeMenu();
  } else {
    openMenu();
  }
}

function openMenu() {
  document.getElementById('sideMenu').classList.add('open');
  document.getElementById('sideMenu').setAttribute('aria-hidden', 'false');
  document.getElementById('menuOverlay').classList.remove('hidden');
  document.getElementById('hamburgerBtn').classList.add('active');
  loadMenuAnnouncements();
}

function closeMenu() {
  document.getElementById('sideMenu').classList.remove('open');
  document.getElementById('sideMenu').setAttribute('aria-hidden', 'true');
  document.getElementById('menuOverlay').classList.add('hidden');
  document.getElementById('hamburgerBtn').classList.remove('active');
}

async function loadMenuAnnouncements() {
  const container = document.getElementById('menuAnnouncements');
  try {
    const res  = await fetch('/api/announcements/active');
    const data = await res.json();
    if (!data.announcement) {
      container.innerHTML = '<div class="menu-ann-empty"><i class="fa-solid fa-circle-info"></i> No announcements right now.</div>';
      return;
    }
    const ann = data.announcement;
    const icons = { info:'fa-circle-info', success:'fa-circle-check', warning:'fa-triangle-exclamation', danger:'fa-radiation' };
    const icon  = icons[ann.type] || 'fa-circle-info';
    // Convert any URLs in the content into clickable buttons
    const contentWithLinks = linkifyText(escapeHtml(ann.content));
    container.innerHTML = `
      <div class="menu-ann-card menu-ann-${ann.type}">
        <div class="menu-ann-card-title">
          <i class="fa-solid ${icon}"></i> ${escapeHtml(ann.title)}
        </div>
        <div class="menu-ann-card-body">${contentWithLinks}</div>
      </div>`;
  } catch {
    container.innerHTML = '<div class="menu-ann-empty">Could not load announcements.</div>';
  }
}

// Detect URLs in plain text and convert them to styled link-buttons
function linkifyText(text) {
  const urlPattern = /(https?:\/\/[^\s<>"]+)/g;
  return text.replace(urlPattern, (url) =>
    `<a href="${url}" target="_blank" rel="noopener" class="menu-ann-link-btn">
       <i class="fa-solid fa-arrow-up-right-from-square"></i> ${url}
     </a>`
  );
}

// ===== FEEDBACK =====
function openFeedback() {
  document.getElementById('feedbackMessage').value = '';
  const errEl = document.getElementById('feedbackError');
  errEl.classList.add('hidden');
  errEl.textContent = '';
  document.getElementById('feedbackModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('feedbackMessage').focus(), 100);
}

function closeFeedback() {
  document.getElementById('feedbackModal').classList.add('hidden');
  document.body.style.overflow = '';
}

async function sendFeedback() {
  const message = document.getElementById('feedbackMessage').value.trim();
  const errEl   = document.getElementById('feedbackError');
  errEl.classList.add('hidden');

  if (!message) {
    errEl.textContent = 'Please enter a message before submitting.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn  = document.getElementById('feedbackSubmitBtn');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';

  try {
    const res  = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message })
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Failed to send feedback.';
      errEl.classList.remove('hidden');
      return;
    }
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Feedback sent! Thank you.';
    btn.style.background = 'var(--success)';
    setTimeout(() => {
      closeFeedback();
      btn.style.background = '';
      btn.innerHTML = orig;
      btn.disabled = false;
    }, 1800);
    return;
  } catch {
    errEl.textContent = 'Network error. Please try again.';
    errEl.classList.remove('hidden');
  }
  btn.disabled = false;
  btn.innerHTML = orig;
}

// ===== DOWNLOAD CODE =====
function downloadCode() {
  const code = document.getElementById('htmlEditor').value;
  if (!code.trim()) { alert('The editor is empty — nothing to download.'); return; }
  const name = (document.getElementById('siteName').value.trim() || 'my-site')
    .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'my-site';
  const blob = new Blob([code], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `${name}.html`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ===== EDIT SITE =====
async function editSite(siteId) {
  try {
    const res  = await fetch(`/api/sites/${siteId}/html`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Failed to load site.'); return; }

    const site = data.site;
    editTargetId = siteId;

    // Load into editor
    document.getElementById('siteName').value   = site.name;
    document.getElementById('htmlEditor').value = site.html_content;
    document.getElementById('customAlias').value = site.custom_alias || '';
    updatePreview();
    clearAliasStatus();

    // Switch to publish tab and set edit mode UI
    switchTab('publish', document.querySelector('.tab-btn'));
    document.getElementById('publishBtnLabel').textContent = 'Update Site';
    document.getElementById('publishBtn').style.background = 'linear-gradient(135deg, var(--success) 0%, #16a34a 100%)';
    document.getElementById('cancelEditBtn').classList.remove('hidden');

    // Show edit mode notice
    showError('publishError', `✏️ Editing: "${escapeHtml(site.name)}" — make your changes and click Update Site.`);
    document.getElementById('publishError').style.background = 'rgba(124,111,255,0.08)';
    document.getElementById('publishError').style.borderColor = 'rgba(124,111,255,0.3)';
    document.getElementById('publishError').style.color = 'var(--primary-soft)';
  } catch { alert('Network error. Please try again.'); }
}

function cancelEdit() {
  editTargetId = null;
  document.getElementById('publishBtnLabel').textContent = 'Publish Site';
  document.getElementById('publishBtn').style.background = '';
  document.getElementById('cancelEditBtn').classList.add('hidden');
  document.getElementById('htmlEditor').value = '';
  document.getElementById('siteName').value   = '';
  document.getElementById('customAlias').value = '';
  clearAliasStatus();
  clearErrors();
  setPreviewContent('');
}

// ===== ALIAS CHECK =====
function clearAliasStatus() {
  aliasTaken = false;
  document.getElementById('aliasStatus').innerHTML = '';
  document.getElementById('aliasStatus').className = 'alias-status';
}

function checkAliasDebounced() {
  clearTimeout(aliasTimer);
  const val = document.getElementById('customAlias').value.trim();
  if (!val) { clearAliasStatus(); return; }
  aliasTimer = setTimeout(() => checkAlias(val), 500);
}

async function checkAlias(val) {
  const statusEl = document.getElementById('aliasStatus');
  statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  statusEl.className = 'alias-status checking';
  try {
    const res  = await fetch(`/api/sites/check-alias?alias=${encodeURIComponent(val)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.error && !data.available) {
      aliasTaken = true;
      statusEl.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${data.error}`;
      statusEl.className = 'alias-status taken';
    } else if (data.available) {
      aliasTaken = false;
      statusEl.innerHTML = '<i class="fa-solid fa-circle-check"></i> Available ✓';
      statusEl.className = 'alias-status available';
    } else {
      aliasTaken = true;
      statusEl.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> This name is already taken ❌';
      statusEl.className = 'alias-status taken';
    }
  } catch {
    aliasTaken = false;
    clearAliasStatus();
  }
}

// ===== PUBLISH =====
async function publishSite() {
  clearErrors();

  // Block if alias is taken
  if (aliasTaken) {
    showError('publishError', 'Please choose a different alias — the current one is already taken.');
    return;
  }

  const name        = document.getElementById('siteName').value.trim();
  const htmlContent = currentMode === 'editor'
    ? document.getElementById('htmlEditor').value.trim()
    : uploadedFileContent;
  const customAlias = document.getElementById('customAlias').value.trim();

  if (!name)        { showError('publishError', 'Please enter a website name.'); return; }
  if (!htmlContent) { showError('publishError', 'Please add some HTML content.'); return; }

  // If in edit mode, update instead of create
  if (editTargetId) {
    await doUpdateSite(name, htmlContent);
    return;
  }

  const btn = document.getElementById('publishBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Publishing…';

  try {
    const res  = await fetch('/api/sites', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
      body:JSON.stringify({ name, html_content: htmlContent, custom_alias: customAlias || null })
    });
    const data = await res.json();

    if (res.status === 429 && data.error === 'limit_reached') {
      showLimitReached(data.message);
      return;
    }
    if (res.status === 409 && data.error === 'alias_taken') {
      aliasTaken = true;
      const statusEl = document.getElementById('aliasStatus');
      statusEl.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> This name is already taken ❌';
      statusEl.className = 'alias-status taken';
      showError('publishError', data.message || 'That alias is already taken.');
      return;
    }
    if (!res.ok) { showError('publishError', data.error || 'Failed to publish site.'); return; }

    const longUrl  = data.long_url  || `${window.location.origin}/site/${data.site.slug}`;
    const shortUrl = data.short_url || longUrl;
    showSuccessModal(shortUrl, longUrl);
    loadSites();
    document.getElementById('htmlEditor').value  = '';
    document.getElementById('siteName').value    = '';
    document.getElementById('customAlias').value = '';
    clearAliasStatus();
    uploadedFileContent = null;
    setPreviewContent('');
    clearFile();
  } catch { showError('publishError', 'Network error. Please try again.'); }
  finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rocket"></i> <span id="publishBtnLabel">Publish Site</span>';
  }
}

async function doUpdateSite(name, htmlContent) {
  const btn = document.getElementById('publishBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating…';

  try {
    const res  = await fetch(`/api/sites/${editTargetId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, html_content: htmlContent })
    });
    const data = await res.json();
    if (!res.ok) { showError('publishError', data.error || 'Failed to update site.'); return; }

    const longUrl = data.long_url || `${window.location.origin}/site/${data.site.slug}`;
    showSuccessModal(longUrl, longUrl);
    loadSites();
    cancelEdit();
  } catch { showError('publishError', 'Network error. Please try again.'); }
  finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rocket"></i> <span id="publishBtnLabel">Update Site</span>';
  }
}

function showLimitReached(msg) {
  const el = document.getElementById('publishError');
  el.innerHTML = `<i class="fa-solid fa-circle-xmark"></i>
    <span>
      <strong>Hosting Limit Reached</strong><br>
      You have reached the maximum of 5 sites. Please
      <button onclick="switchTab('sites',document.querySelectorAll('.tab-btn')[1])" style="background:none;border:none;color:inherit;text-decoration:underline;cursor:pointer;font-size:inherit;padding:0">delete an existing site</button>
      to create a new one.
    </span>`;
  el.classList.remove('hidden');
}

function showSuccessModal(shortUrl, longUrl) {
  const input = document.getElementById('shortLinkInput');
  input.value = shortUrl;

  const origLink = document.getElementById('publishedLink');
  origLink.textContent = longUrl;
  origLink.href        = longUrl;

  document.getElementById('visitBtn').href = longUrl;

  document.getElementById('copyIcon').className    = 'fa-solid fa-copy';
  document.getElementById('copyLabel').textContent = 'Copy Link';
  document.getElementById('copyBtn').classList.remove('copied');

  // Show as persistent fixed banner (no body overflow lock)
  document.getElementById('successModal').classList.remove('hidden');
  setTimeout(() => input.select(), 200);
}

function closeSuccess() {
  document.getElementById('successModal').classList.add('hidden');
}

async function copyLink() {
  const url = document.getElementById('shortLinkInput').value;
  try {
    await navigator.clipboard.writeText(url);
    const btn   = document.getElementById('copyBtn');
    const icon  = document.getElementById('copyIcon');
    const label = document.getElementById('copyLabel');
    icon.className    = 'fa-solid fa-check';
    label.textContent = 'Copied! ✅';
    btn.classList.add('copied');
    setTimeout(() => {
      icon.className    = 'fa-solid fa-copy';
      label.textContent = 'Copy Link';
      btn.classList.remove('copied');
    }, 2500);
  } catch { alert('Link: ' + url); }
}

// ===== SITES =====
async function loadSites() {
  try {
    const res  = await fetch('/api/sites', { headers:{ Authorization:`Bearer ${token}` } });
    const data = await res.json();
    sites = data.sites || [];
    renderSites();
    document.getElementById('siteCount').textContent = sites.length;
  } catch { console.error('Failed to load sites'); }
}

function renderSites() {
  const grid = document.getElementById('sitesGrid');
  if (sites.length === 0) {
    grid.innerHTML = `<div class="empty-sites-message">
      <i class="fa-solid fa-globe"></i>
      <h3>No sites hosted yet</h3>
      <p>Publish your first website to see it here.</p>
    </div>`;
    return;
  }

  const host = window.location.origin;
  const remaining = 5 - sites.length;

  grid.innerHTML = [
    // Limit indicator
    `<div class="limit-bar">
      <span class="limit-label"><i class="fa-solid fa-layer-group"></i> Hosting Usage</span>
      <div class="limit-track"><div class="limit-fill" style="width:${(sites.length/5)*100}%;background:${sites.length>=5?'var(--danger)':sites.length>=4?'var(--warning)':'var(--primary)'}"></div></div>
      <span class="limit-count ${sites.length>=5?'limit-full':''}">${sites.length}/5 ${sites.length>=5?'· Limit reached':remaining===1?'· 1 slot left':''}</span>
    </div>`,
    ...sites.map(site => `
    <div class="site-card" id="site-${site.id}">
      <div class="site-card-header">
        <div class="site-card-name"><i class="fa-solid fa-file-code"></i>${escapeHtml(site.name)}</div>
        <span class="site-status">Live</span>
      </div>
      <a href="${host}/site/${site.slug}" target="_blank" class="site-link">
        <i class="fa-solid fa-link"></i>${host}/site/${site.slug}
      </a>
      <div class="site-card-meta">
        <span><i class="fa-solid fa-calendar-days"></i> ${formatDate(site.published_at)}</span>
      </div>
      <div class="site-card-actions">
        <button class="btn btn-outline btn-sm" onclick="copyToClipboard('${host}/site/${site.slug}',this)"><i class="fa-solid fa-copy"></i> Copy</button>
        <a href="${host}/site/${site.slug}" target="_blank" class="btn btn-ghost btn-sm"><i class="fa-solid fa-arrow-up-right-from-square"></i> Visit</a>
        <button class="btn btn-sm" style="background:rgba(124,111,255,0.1);color:var(--primary-soft);border:1px solid rgba(124,111,255,0.25)" onclick="editSite(${site.id})"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn btn-sm" style="background:var(--danger-tint);color:var(--danger);border:1px solid rgba(240,68,68,0.3)" onclick="openDelete(${site.id})"><i class="fa-solid fa-trash"></i> Delete</button>
      </div>
    </div>`)
  ].join('');
}

async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
    btn.style.color = 'var(--success)';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 2000);
  } catch { alert('Link: ' + text); }
}

// ===== DELETE =====
function openDelete(siteId) {
  deleteTargetId = siteId;
  document.getElementById('deletePassword').value = '';
  clearErrors();
  document.getElementById('deleteModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('deletePassword').focus(), 100);
}

function closeDelete() {
  deleteTargetId = null;
  document.getElementById('deleteModal').classList.add('hidden');
  document.body.style.overflow = '';
}

async function confirmDelete() {
  const password = document.getElementById('deletePassword').value;
  if (!password) { showError('deleteError', 'Please enter your password.'); return; }
  try {
    const res  = await fetch(`/api/sites/${deleteTargetId}`, { method:'DELETE', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body:JSON.stringify({ password }) });
    const data = await res.json();
    if (!res.ok) { showError('deleteError', data.error || 'Failed to delete site.'); return; }
    closeDelete();
    sites = sites.filter(s => s.id !== deleteTargetId);
    renderSites();
    document.getElementById('siteCount').textContent = sites.length;
  } catch { showError('deleteError', 'Network error. Please try again.'); }
}

// ===== HELPERS =====
function togglePass(id, btn) {
  const el = document.getElementById(id);
  const isP = el.type === 'password';
  el.type = isP ? 'text' : 'password';
  btn.innerHTML = isP ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Close modals on overlay click (success banner is NOT a modal overlay — skip it)
document.addEventListener('click', (e) => {
  if (e.target.id === 'authModal')     closeAuth();
  if (e.target.id === 'deleteModal')   closeDelete();
  if (e.target.id === 'feedbackModal') closeFeedback();
});

// Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAuth();
    closeDelete();
    closeFeedback();
    closeMenu();
    document.getElementById('nameModal').classList.add('hidden');
    document.body.style.overflow = '';
  }
});
