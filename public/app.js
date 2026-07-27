const state = {
  adminToken: localStorage.getItem('clubusl_admin_token') || null
};

function isAdmin() { return !!state.adminToken; }

async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.adminToken) headers['X-Admin-Token'] = state.adminToken;
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.adminToken) {
      logoutAdmin();
      throw new Error('Session responsable expiree, merci de vous reconnecter.');
    }
    throw new Error(data.error || 'Erreur serveur');
  }
  return data;
}

function toast(message, isError) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { t.className = 'toast hidden'; }, 4000);
}

function showCheck() {
  const overlay = document.getElementById('check-overlay');
  overlay.classList.remove('hidden');
  clearTimeout(showCheck._timer);
  showCheck._timer = setTimeout(() => { overlay.classList.add('hidden'); }, 900);
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateAffiche(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// ---------- Admin ----------

function updateAdminUI() {
  const btn = document.getElementById('btn-admin');
  const admin = isAdmin();
  btn.textContent = admin ? 'Deconnexion' : 'Administration';
  btn.classList.toggle('actif', admin);
  document.getElementById('tab-btn-parametres').style.display = admin ? '' : 'none';
  document.getElementById('form-annonce-card').style.display = admin ? '' : 'none';
  document.getElementById('form-evenement-card').style.display = admin ? '' : 'none';
  document.getElementById('form-document-card').style.display = admin ? '' : 'none';
  document.getElementById('form-finances-card').style.display = admin ? '' : 'none';
  if (!admin) {
    const tab = document.querySelector('.tab-btn.active');
    if (tab && tab.dataset.tab === 'parametres') switchTab('accueil');
  }
}

function logoutAdmin() {
  state.adminToken = null;
  localStorage.removeItem('clubusl_admin_token');
  updateAdminUI();
}

document.getElementById('btn-admin').addEventListener('click', async () => {
  if (isAdmin()) {
    logoutAdmin();
    toast('Deconnecte.');
    return;
  }
  const password = prompt('Mot de passe responsable :');
  if (!password) return;
  try {
    const data = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
    state.adminToken = data.token;
    localStorage.setItem('clubusl_admin_token', data.token);
    updateAdminUI();
    toast('Connecte en tant que responsable.');
    chargerAnnonces();
    chargerEvenements();
    chargerDocuments();
    chargerFinances();
  } catch (e) {
    toast(e.message, true);
  }
});

document.getElementById('btn-change-admin-password').addEventListener('click', async () => {
  const newPassword = document.getElementById('new-admin-password').value.trim();
  if (!newPassword) return toast('Entrez un nouveau mot de passe.', true);
  try {
    const data = await api('/api/admin/change-password', { method: 'POST', body: JSON.stringify({ newPassword }) });
    state.adminToken = data.token;
    localStorage.setItem('clubusl_admin_token', data.token);
    document.getElementById('new-admin-password').value = '';
    toast('Mot de passe change avec succes.');
  } catch (e) {
    toast(e.message, true);
  }
});

// ---------- Tabs ----------

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach((s) => s.classList.toggle('active', s.id === `tab-${name}`));
  if (name === 'presence') chargerPresence();
  if (name === 'accueil') chargerAccueil();
  if (name === 'finances') chargerFinances();
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.querySelectorAll('.tuile').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.goto));
});

// ---------- Banniere de bienvenue ----------

(function initBanniere() {
  const banniere = document.getElementById('banniere-bienvenue');
  if (!localStorage.getItem('clubusl_banniere_vue')) {
    banniere.classList.remove('hidden');
  }
  document.getElementById('btn-fermer-banniere').addEventListener('click', () => {
    banniere.classList.add('hidden');
    localStorage.setItem('clubusl_banniere_vue', '1');
  });
})();

// ---------- Accueil (tableau de bord en tuiles) ----------

async function chargerAccueil() {
  try {
    const annonces = await api('/api/annonces');
    document.getElementById('apercu-alertes').textContent = annonces.length
      ? `${annonces[0].titre} (${formatDateAffiche(annonces[0].date)})`
      : 'Aucune annonce pour le moment.';
    const zoneActus = document.getElementById('liste-actus-accueil');
    if (!annonces.length) {
      zoneActus.innerHTML = '<p class="carte-vide">Aucune actualite pour le moment.</p>';
    } else {
      zoneActus.innerHTML = annonces.slice(0, 3).map((a) => `
        <div class="carte-item">
          <h3>${escapeHtml(a.titre)}</h3>
          <div class="carte-date">${formatDateAffiche(a.date)}</div>
          <p>${escapeHtml(a.texte)}</p>
        </div>
      `).join('');
    }
  } catch (e) {
    document.getElementById('apercu-alertes').textContent = 'Indisponible';
  }

  try {
    const evenements = await api('/api/evenements');
    const today = todayStr();
    const prochain = evenements.find((e) => e.date >= today) || evenements[0];
    document.getElementById('apercu-calendrier').textContent = prochain
      ? `Prochain : ${escapeHtml(prochain.titre)} le ${formatDateAffiche(prochain.date)}`
      : 'Aucun evenement prevu.';
  } catch (e) {
    document.getElementById('apercu-calendrier').textContent = 'Indisponible';
  }

  try {
    const documents = await api('/api/documents');
    document.getElementById('apercu-documents').textContent = documents.length
      ? `${documents.length} document(s) disponible(s)`
      : 'Aucun document pour le moment.';
  } catch (e) {
    document.getElementById('apercu-documents').textContent = 'Indisponible';
  }

  try {
    const data = await api('/api/presence');
    const dot = document.getElementById('dot-live-accueil');
    if (data.error) {
      document.getElementById('apercu-presence').textContent = 'Indisponible pour le moment';
      dot.classList.add('hidden');
    } else {
      const n = (data.presents || []).length;
      document.getElementById('apercu-presence').textContent = n
        ? `${n} personne(s) actuellement presente(s)`
        : 'Personne present actuellement.';
      dot.classList.toggle('hidden', n === 0);
    }
  } catch (e) {
    document.getElementById('apercu-presence').textContent = 'Indisponible';
    document.getElementById('dot-live-accueil').classList.add('hidden');
  }

  try {
    const data = await api('/api/finances');
    const dot = document.getElementById('dot-statut-finances');
    dot.className = 'dot-statut dot-' + data.statut;
    document.getElementById('apercu-finances').textContent = `Benefice actuel : ${formatEuro(data.benefice)}`;
  } catch (e) {
    document.getElementById('apercu-finances').textContent = 'Indisponible';
  }
}

// ---------- Annonces ----------

async function chargerAnnonces() {
  const zone = document.getElementById('liste-annonces');
  try {
    const list = await api('/api/annonces');
    if (!list.length) {
      zone.innerHTML = '<p class="carte-vide">Aucune annonce pour le moment.</p>';
      return;
    }
    zone.innerHTML = list.map((a) => `
      <div class="carte-item">
        <h3>${escapeHtml(a.titre)}</h3>
        <div class="carte-date">${formatDateAffiche(a.date)}</div>
        <p>${escapeHtml(a.texte)}</p>
        ${isAdmin() ? `<div class="carte-actions"><button class="btn btn-stop btn-small" data-id="${a.id}" data-action="suppr-annonce">Supprimer</button></div>` : ''}
      </div>
    `).join('');
  } catch (e) {
    zone.innerHTML = `<p class="carte-vide">Erreur : ${escapeHtml(e.message)}</p>`;
  }
}

document.getElementById('btn-add-annonce').addEventListener('click', async () => {
  const titre = document.getElementById('annonce-titre').value.trim();
  const texte = document.getElementById('annonce-texte').value.trim();
  const date = document.getElementById('annonce-date').value || todayStr();
  if (!titre || !texte) return toast('Titre et message requis.', true);
  try {
    await api('/api/annonces', { method: 'POST', body: JSON.stringify({ titre, texte, date }) });
    document.getElementById('annonce-titre').value = '';
    document.getElementById('annonce-texte').value = '';
    document.getElementById('annonce-date').value = '';
    toast('Annonce publiee.');
    showCheck();
    chargerAnnonces();
  } catch (e) {
    toast(e.message, true);
  }
});

document.getElementById('liste-annonces').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-action="suppr-annonce"]');
  if (!btn) return;
  if (!confirm('Supprimer cette annonce ?')) return;
  try {
    await api(`/api/annonces/${btn.dataset.id}`, { method: 'DELETE' });
    chargerAnnonces();
  } catch (e) {
    toast(e.message, true);
  }
});

// ---------- Evenements ----------

async function chargerEvenements() {
  const zone = document.getElementById('liste-evenements');
  try {
    const list = await api('/api/evenements');
    if (!list.length) {
      zone.innerHTML = '<p class="carte-vide">Aucun evenement a venir.</p>';
      return;
    }
    zone.innerHTML = list.map((e) => `
      <div class="carte-item">
        <h3>${escapeHtml(e.titre)}</h3>
        <div class="carte-date">${formatDateAffiche(e.date)}${e.heure ? ' a ' + e.heure : ''}${e.lieu ? ' - ' + escapeHtml(e.lieu) : ''}</div>
        ${e.description ? `<p>${escapeHtml(e.description)}</p>` : ''}
        ${isAdmin() ? `<div class="carte-actions"><button class="btn btn-stop btn-small" data-id="${e.id}" data-action="suppr-evenement">Supprimer</button></div>` : ''}
      </div>
    `).join('');
  } catch (e) {
    zone.innerHTML = `<p class="carte-vide">Erreur : ${escapeHtml(e.message)}</p>`;
  }
}

document.getElementById('btn-add-evenement').addEventListener('click', async () => {
  const titre = document.getElementById('ev-titre').value.trim();
  const date = document.getElementById('ev-date').value;
  const heure = document.getElementById('ev-heure').value;
  const lieu = document.getElementById('ev-lieu').value.trim();
  const description = document.getElementById('ev-description').value.trim();
  if (!titre || !date) return toast('Titre et date requis.', true);
  try {
    await api('/api/evenements', { method: 'POST', body: JSON.stringify({ titre, date, heure, lieu, description }) });
    ['ev-titre', 'ev-date', 'ev-heure', 'ev-lieu', 'ev-description'].forEach((id) => { document.getElementById(id).value = ''; });
    toast('Evenement ajoute.');
    showCheck();
    chargerEvenements();
  } catch (e) {
    toast(e.message, true);
  }
});

document.getElementById('liste-evenements').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-action="suppr-evenement"]');
  if (!btn) return;
  if (!confirm('Supprimer cet evenement ?')) return;
  try {
    await api(`/api/evenements/${btn.dataset.id}`, { method: 'DELETE' });
    chargerEvenements();
  } catch (e) {
    toast(e.message, true);
  }
});

// ---------- Documents ----------

async function chargerDocuments() {
  const tbody = document.querySelector('#table-documents tbody');
  try {
    const list = await api('/api/documents');
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="carte-vide">Aucun document.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map((d) => `
      <tr>
        <td><a href="/api/documents/${d.id}/fichier" target="_blank" rel="noopener">${escapeHtml(d.nom)}</a></td>
        <td>${formatDateAffiche(d.dateAjout)}</td>
        <td>${Math.round((d.taille || 0) / 1024)} Ko</td>
        <td>${isAdmin() ? `<button class="btn btn-stop btn-small" data-id="${d.id}" data-action="suppr-doc">Supprimer</button>` : '-'}</td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="carte-vide">Erreur : ${escapeHtml(e.message)}</td></tr>`;
  }
}

document.getElementById('btn-add-document').addEventListener('click', async () => {
  const nom = document.getElementById('doc-nom').value.trim();
  const fichierInput = document.getElementById('doc-fichier');
  const fichier = fichierInput.files[0];
  if (!nom || !fichier) return toast('Nom et fichier requis.', true);
  if (fichier.size > 8 * 1024 * 1024) return toast('Fichier trop volumineux (8 Mo maximum).', true);
  try {
    const base64 = await fileToBase64(fichier);
    await api('/api/documents', {
      method: 'POST',
      body: JSON.stringify({ nom, typeMime: fichier.type, contenuBase64: base64 })
    });
    document.getElementById('doc-nom').value = '';
    fichierInput.value = '';
    toast('Document ajoute.');
    showCheck();
    chargerDocuments();
  } catch (e) {
    toast(e.message, true);
  }
});

document.querySelector('#table-documents tbody').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-action="suppr-doc"]');
  if (!btn) return;
  if (!confirm('Supprimer ce document ?')) return;
  try {
    await api(`/api/documents/${btn.dataset.id}`, { method: 'DELETE' });
    chargerDocuments();
  } catch (e) {
    toast(e.message, true);
  }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- Presence en direct ----------

let presenceDerniereMaj = null;
let presenceMajTimer = null;

function demarrerCompteurMaj() {
  clearInterval(presenceMajTimer);
  presenceMajTimer = setInterval(() => {
    const el = document.getElementById('presence-derniere-maj');
    if (!el || !presenceDerniereMaj) return;
    const secondes = Math.max(0, Math.round((Date.now() - presenceDerniereMaj) / 1000));
    el.textContent = secondes < 5 ? 'Mis a jour a l\'instant' : `Mis a jour il y a ${secondes} secondes`;
  }, 1000);
}

async function chargerPresence() {
  const zone = document.getElementById('liste-presence');
  const info = document.getElementById('presence-info');
  zone.innerHTML = '<p class="hint"><span class="spinner-inline"></span> Chargement... (jusqu\'a 50 secondes si l\'application RH_USL etait en veille)</p>';
  info.textContent = '';
  try {
    const data = await api('/api/presence');
    if (data.error) {
      zone.innerHTML = `<p class="carte-vide">${escapeHtml(data.error)}</p>`;
      document.getElementById('presence-derniere-maj').textContent = '';
      return;
    }
    info.textContent = data.date ? `Situation du ${formatDateAffiche(data.date)}` : '';
    presenceDerniereMaj = Date.now();
    demarrerCompteurMaj();
    if (!data.presents || !data.presents.length) {
      zone.innerHTML = '<p class="carte-vide">Personne n\'est actuellement pointe comme present.</p>';
      return;
    }
    zone.innerHTML = data.presents.map((p) => `
      <div class="presence-item">
        <div class="presence-nom">${escapeHtml(p.nom)}</div>
        <div class="presence-salle">${p.salle ? escapeHtml(p.salle) : 'Salle non precisee'}</div>
        <div class="presence-heure">Arrive a ${p.arrivee || '?'}</div>
      </div>
    `).join('');
  } catch (e) {
    zone.innerHTML = `<p class="carte-vide">Impossible de recuperer la presence : ${escapeHtml(e.message)}</p>`;
  }
}

// ---------- Finances ----------

function formatEuro(n) {
  const val = Number(n) || 0;
  return val.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
}

function libelleStatutFinances(statut) {
  if (statut === 'vert') return 'Situation saine';
  if (statut === 'orange') return 'Situation a surveiller';
  return 'Situation dans le rouge';
}

const CATEGORIES_FINANCES = [
  { key: 'charges', label: 'Depenses / Charges' },
  { key: 'banque', label: 'Compte en banque' },
  { key: 'partenariat', label: 'Partenariats' },
  { key: 'stage', label: 'Stages' },
  { key: 'subventions', label: 'Subventions' },
  { key: 'adhesions', label: 'Adhesions' }
];

async function chargerFinances() {
  const banniere = document.getElementById('statut-finances-banniere');
  const grille = document.getElementById('grille-finances');
  banniere.className = 'statut-finances';
  banniere.innerHTML = '<span class="spinner-inline"></span> Chargement...';
  try {
    const data = await api('/api/finances');
    banniere.className = 'statut-finances statut-' + data.statut;
    banniere.innerHTML = `
      <div class="statut-titre">${libelleStatutFinances(data.statut)}</div>
      <div class="statut-chiffre">Benefice actuel : ${formatEuro(data.benefice)}</div>
      <div class="statut-detail">Produits : ${formatEuro(data.produits)} &bull; Charges : ${formatEuro((data.charges || {}).actuel)}</div>
    `;

    grille.innerHTML = CATEGORIES_FINANCES.map((c) => {
      const val = data[c.key] || { actuel: 0, objectif: 0 };
      const pct = val.objectif > 0 ? Math.min(100, Math.round((val.actuel / val.objectif) * 100)) : 0;
      return `
        <div class="carte-finance">
          <h3>${c.label}</h3>
          <div class="finance-chiffres">${formatEuro(val.actuel)} / ${formatEuro(val.objectif)}</div>
          <div class="barre-progres"><div class="barre-progres-remplie" style="width:${pct}%"></div></div>
          <div class="finance-pct">${pct}% de l'objectif saison</div>
        </div>
      `;
    }).join('');

    if (isAdmin()) {
      CATEGORIES_FINANCES.forEach((c) => {
        const val = data[c.key] || { actuel: 0, objectif: 0 };
        document.getElementById(`fin-${c.key}-actuel`).value = val.actuel;
        document.getElementById(`fin-${c.key}-objectif`).value = val.objectif;
      });
    }
  } catch (e) {
    banniere.innerHTML = `<p class="carte-vide">Erreur : ${escapeHtml(e.message)}</p>`;
  }
}

document.getElementById('btn-save-finances').addEventListener('click', async () => {
  const body = {};
  CATEGORIES_FINANCES.forEach((c) => {
    body[c.key] = {
      actuel: document.getElementById(`fin-${c.key}-actuel`).value,
      objectif: document.getElementById(`fin-${c.key}-objectif`).value
    };
  });
  try {
    await api('/api/finances', { method: 'PUT', body: JSON.stringify(body) });
    toast('Finances mises a jour.');
    showCheck();
    chargerFinances();
    chargerAccueil();
  } catch (e) {
    toast(e.message, true);
  }
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Notifications push (sur le telephone) ----------

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function pushSupporte() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

async function getAbonnementActuel() {
  if (!pushSupporte()) return null;
  // On utilise register() (et non "ready") car "ready" reste bloque indefiniment
  // tant qu'aucun service worker n'a jamais ete enregistre (1ere visite).
  const reg = await navigator.serviceWorker.register('/sw.js');
  return reg.pushManager.getSubscription();
}

function updateNotifUI(actif) {
  const btn = document.getElementById('btn-notif');
  if (!btn) return;
  btn.classList.toggle('actif', !!actif);
  btn.title = actif ? 'Notifications activees sur ce telephone (clic pour desactiver)' : 'Activer les notifications sur ce telephone';
}

async function activerNotifications() {
  if (!pushSupporte()) {
    toast("Les notifications ne sont pas prises en charge sur cet appareil/navigateur (sur iPhone, il faut d'abord ajouter l'appli a l'ecran d'accueil).", true);
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast('Notifications refusees. Tu peux les autoriser plus tard dans les reglages du navigateur.', true);
      return;
    }
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const { publicKey } = await api('/api/push/public-key');
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub)
    });
    updateNotifUI(true);
    toast('Notifications activees sur ce telephone.');
    showCheck();
  } catch (e) {
    toast('Impossible d\'activer les notifications : ' + e.message, true);
  }
}

async function desactiverNotifications() {
  try {
    const sub = await getAbonnementActuel();
    if (sub) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint })
      });
      await sub.unsubscribe();
    }
    updateNotifUI(false);
    toast('Notifications desactivees sur ce telephone.');
  } catch (e) {
    toast('Erreur : ' + e.message, true);
  }
}

const btnNotif = document.getElementById('btn-notif');
if (btnNotif) {
  btnNotif.addEventListener('click', async () => {
    if (!pushSupporte()) {
      toast("Les notifications ne sont pas prises en charge sur cet appareil/navigateur (sur iPhone, il faut d'abord ajouter l'appli a l'ecran d'accueil).", true);
      return;
    }
    try {
      const sub = await getAbonnementActuel();
      if (sub) desactiverNotifications();
      else activerNotifications();
    } catch (e) {
      toast('Erreur : ' + e.message, true);
    }
  });
}

(async function initNotifUI() {
  if (!pushSupporte()) return;
  try {
    const sub = await getAbonnementActuel();
    updateNotifUI(!!sub);
  } catch (e) {
    // pas grave si ca echoue au chargement, l'utilisateur pourra reessayer via le bouton
  }
})();

// ---------- Init ----------

function initApp() {
  updateAdminUI();
  chargerAccueil();
  chargerAnnonces();
  chargerEvenements();
  chargerDocuments();
}

initApp();
