/**
 * CLUB USL - Serveur principal
 * ---------------------------------------------------
 * Application de communication pour le club USL :
 *  - Annonces / actualites
 *  - Evenements (calendrier)
 *  - Documents a telecharger
 *  - Presence en direct (recuperee depuis l'application RH_USL)
 *
 * Stockage :
 *  - Si la variable d'environnement MONGODB_URI est definie -> MongoDB
 *  - Sinon -> fichier JSON local (data/db.json), pratique pour tester
 *    sur son propre PC sans rien configurer.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { MongoClient } = require('mongodb');
const webpush = require('web-push');

// Adresse de l'application RH_USL (pour recuperer la presence en direct)
const RH_USL_URL = process.env.RH_USL_URL || 'https://rh-usl-app.onrender.com';

// Cles VAPID (notifications push navigateur). Generees une fois pour ce
// projet : pas besoin de les changer, elles servent juste a signer les
// notifications envoyees aux telephones abonnes.
const VAPID_PUBLIC_KEY = 'BBXKSPNW52CIhwxhMdXXD39luGyA5iaz2QyhxJ5ZTnrwUELQqCnqCMlgWjauuFguGJsmP-WzvxjYVKFyL8Z_d_E';
const VAPID_PRIVATE_KEY = 'E_rAdGXcz97EOU9TZneLi_-qn4yvIJIFkwT-BBmwviI';
webpush.setVapidDetails('mailto:contact@bureau-usl.local', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// Mot de passe administrateur par defaut (a changer depuis Parametres une
// fois connecte). Partage entre tous les responsables autorises a publier.
const DEFAULT_ADMIN_PASSWORD = 'BUREAU2026';

// Taille maximale d'un document (en base64) : ~8 Mo, marge sous la limite
// MongoDB de 16 Mo par document.
const MAX_DOC_BASE64_LENGTH = 8 * 1024 * 1024 * 1.4;

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const MONGODB_URI = process.env.MONGODB_URI;

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Utilitaires ----------

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd).digest('hex');
}

function computeAdminToken(state) {
  return crypto.createHmac('sha256', state.settings.adminPasswordHash).update('clubusl-admin-session').digest('hex');
}

function requireAdmin(req, res, next) {
  loadState().then((state) => {
    const token = req.headers['x-admin-token'];
    if (token && token === computeAdminToken(state)) return next();
    res.status(401).json({ error: 'Action reservee aux responsables. Merci de vous connecter.' });
  }).catch((e) => res.status(500).json({ error: e.message }));
}

function defaultState() {
  return {
    settings: { nomClub: "Bureau'USL", adminPasswordHash: hashPassword(DEFAULT_ADMIN_PASSWORD) },
    annonces: [],
    evenements: []
  };
}

function migrateState(state) {
  let changed = false;
  if (!state.settings) { state.settings = defaultState().settings; changed = true; }
  if (!state.settings.adminPasswordHash) { state.settings.adminPasswordHash = hashPassword(DEFAULT_ADMIN_PASSWORD); changed = true; }
  if (!state.annonces) { state.annonces = []; changed = true; }
  if (!state.evenements) { state.evenements = []; changed = true; }
  return changed;
}

function formatDateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let mongoClientPromise = null;
function getMongoClient() {
  if (!mongoClientPromise) {
    const client = new MongoClient(MONGODB_URI);
    mongoClientPromise = client.connect();
  }
  return mongoClientPromise;
}

function readLocalFile() {
  if (!fs.existsSync(DB_PATH)) {
    const fresh = { ...defaultState(), documents: [] };
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2), 'utf-8');
    return fresh;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function writeLocalFile(full) {
  fs.writeFileSync(DB_PATH, JSON.stringify(full, null, 2), 'utf-8');
}

// ---------- Etat principal (settings, annonces, evenements) ----------

async function loadState() {
  if (MONGODB_URI) {
    const client = await getMongoClient();
    const col = client.db('uslclub').collection('appstate');
    let doc = await col.findOne({ _id: 'main' });
    if (!doc) {
      doc = { _id: 'main', ...defaultState() };
      await col.insertOne(doc);
    } else if (migrateState(doc)) {
      await saveState(doc);
    }
    return doc;
  }
  const full = readLocalFile();
  if (migrateState(full)) writeLocalFile(full);
  return full;
}

async function saveState(state) {
  if (MONGODB_URI) {
    const client = await getMongoClient();
    const col = client.db('uslclub').collection('appstate');
    const { _id, ...rest } = state;
    await col.updateOne({ _id: 'main' }, { $set: rest }, { upsert: true });
    return;
  }
  const full = readLocalFile();
  full.settings = state.settings;
  full.annonces = state.annonces;
  full.evenements = state.evenements;
  writeLocalFile(full);
}

// ---------- Documents (collection separee pour eviter les gros documents) ----------

async function listDocumentsMeta() {
  if (MONGODB_URI) {
    const client = await getMongoClient();
    const col = client.db('uslclub').collection('documents');
    const docs = await col.find({}, { projection: { contenuBase64: 0 } }).toArray();
    return docs.map((d) => ({ ...d, id: d._id }));
  }
  const full = readLocalFile();
  return (full.documents || []).map((d) => ({ id: d.id, nom: d.nom, typeMime: d.typeMime, taille: d.taille, dateAjout: d.dateAjout }));
}

async function getDocumentFull(id) {
  if (MONGODB_URI) {
    const client = await getMongoClient();
    const col = client.db('uslclub').collection('documents');
    const doc = await col.findOne({ _id: id });
    return doc ? { ...doc, id: doc._id } : null;
  }
  const full = readLocalFile();
  return (full.documents || []).find((d) => d.id === id) || null;
}

async function insertDocument(doc) {
  if (MONGODB_URI) {
    const client = await getMongoClient();
    const col = client.db('uslclub').collection('documents');
    await col.insertOne({ _id: doc.id, ...doc });
    return;
  }
  const full = readLocalFile();
  full.documents = full.documents || [];
  full.documents.push(doc);
  writeLocalFile(full);
}

async function deleteDocument(id) {
  if (MONGODB_URI) {
    const client = await getMongoClient();
    const col = client.db('uslclub').collection('documents');
    await col.deleteOne({ _id: id });
    return;
  }
  const full = readLocalFile();
  full.documents = (full.documents || []).filter((d) => d.id !== id);
  writeLocalFile(full);
}

// ---------- Notifications push (abonnements telephone/navigateur) ----------

async function listSubscriptions() {
  if (MONGODB_URI) {
    const client = await getMongoClient();
    const col = client.db('uslclub').collection('subscriptions');
    return col.find({}).toArray();
  }
  const full = readLocalFile();
  return full.subscriptions || [];
}

async function addSubscription(sub) {
  if (MONGODB_URI) {
    const client = await getMongoClient();
    const col = client.db('uslclub').collection('subscriptions');
    await col.updateOne({ endpoint: sub.endpoint }, { $set: sub }, { upsert: true });
    return;
  }
  const full = readLocalFile();
  full.subscriptions = full.subscriptions || [];
  full.subscriptions = full.subscriptions.filter((s) => s.endpoint !== sub.endpoint);
  full.subscriptions.push(sub);
  writeLocalFile(full);
}

async function removeSubscription(endpoint) {
  if (MONGODB_URI) {
    const client = await getMongoClient();
    const col = client.db('uslclub').collection('subscriptions');
    await col.deleteOne({ endpoint });
    return;
  }
  const full = readLocalFile();
  full.subscriptions = (full.subscriptions || []).filter((s) => s.endpoint !== endpoint);
  writeLocalFile(full);
}

async function sendPushToAll(title, body) {
  const subs = await listSubscriptions();
  const payload = JSON.stringify({ title, body });
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, payload);
    } catch (e) {
      // Abonnement expire ou invalide (410/404) -> on le retire silencieusement
      if (e.statusCode === 404 || e.statusCode === 410) {
        await removeSubscription(sub.endpoint);
      } else {
        console.error('Erreur envoi push:', e.message);
      }
    }
  }));
}

// ---------- Routes : ADMINISTRATION ----------

app.post('/api/admin/login', async (req, res) => {
  const state = await loadState();
  const { password } = req.body;
  if (!password || hashPassword(password) !== state.settings.adminPasswordHash) {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }
  res.json({ token: computeAdminToken(state) });
});

app.post('/api/admin/change-password', requireAdmin, async (req, res) => {
  const state = await loadState();
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 4 caracteres' });
  }
  state.settings.adminPasswordHash = hashPassword(newPassword);
  await saveState(state);
  res.json({ token: computeAdminToken(state) });
});

// ---------- Routes : ANNONCES ----------

app.get('/api/annonces', async (req, res) => {
  const state = await loadState();
  const list = [...state.annonces].sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
  res.json(list);
});

app.post('/api/annonces', requireAdmin, async (req, res) => {
  const state = await loadState();
  const { titre, texte, date } = req.body;
  if (!titre || !texte) return res.status(400).json({ error: 'Titre et texte requis' });
  const annonce = { id: uuidv4(), titre, texte, date: date || formatDateLocal(new Date()) };
  state.annonces.push(annonce);
  await saveState(state);
  sendPushToAll(`Nouvelle annonce : ${titre}`, texte).catch((e) => console.error('Push annonce:', e.message));
  res.status(201).json(annonce);
});

app.put('/api/annonces/:id', requireAdmin, async (req, res) => {
  const state = await loadState();
  const a = state.annonces.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Annonce introuvable' });
  ['titre', 'texte', 'date'].forEach((k) => { if (req.body[k] !== undefined) a[k] = req.body[k]; });
  await saveState(state);
  res.json(a);
});

app.delete('/api/annonces/:id', requireAdmin, async (req, res) => {
  const state = await loadState();
  state.annonces = state.annonces.filter((x) => x.id !== req.params.id);
  await saveState(state);
  res.json({ ok: true });
});

// ---------- Routes : EVENEMENTS ----------

app.get('/api/evenements', async (req, res) => {
  const state = await loadState();
  const list = [...state.evenements].sort((a, b) => (a.date + (a.heure || '')).localeCompare(b.date + (b.heure || '')));
  res.json(list);
});

app.post('/api/evenements', requireAdmin, async (req, res) => {
  const state = await loadState();
  const { titre, date, heure, lieu, description } = req.body;
  if (!titre || !date) return res.status(400).json({ error: 'Titre et date requis' });
  const evenement = { id: uuidv4(), titre, date, heure: heure || '', lieu: lieu || '', description: description || '' };
  state.evenements.push(evenement);
  await saveState(state);
  sendPushToAll(`Nouvel evenement : ${titre}`, `${date}${heure ? ' a ' + heure : ''}${lieu ? ' - ' + lieu : ''}`).catch((e) => console.error('Push evenement:', e.message));
  res.status(201).json(evenement);
});

app.put('/api/evenements/:id', requireAdmin, async (req, res) => {
  const state = await loadState();
  const e = state.evenements.find((x) => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: 'Evenement introuvable' });
  ['titre', 'date', 'heure', 'lieu', 'description'].forEach((k) => { if (req.body[k] !== undefined) e[k] = req.body[k]; });
  await saveState(state);
  res.json(e);
});

app.delete('/api/evenements/:id', requireAdmin, async (req, res) => {
  const state = await loadState();
  state.evenements = state.evenements.filter((x) => x.id !== req.params.id);
  await saveState(state);
  res.json({ ok: true });
});

// ---------- Routes : DOCUMENTS ----------

app.get('/api/documents', async (req, res) => {
  const list = await listDocumentsMeta();
  list.sort((a, b) => (b.dateAjout || '').localeCompare(a.dateAjout || ''));
  res.json(list);
});

app.post('/api/documents', requireAdmin, async (req, res) => {
  const { nom, typeMime, contenuBase64 } = req.body;
  if (!nom || !contenuBase64) return res.status(400).json({ error: 'Nom et fichier requis' });
  if (contenuBase64.length > MAX_DOC_BASE64_LENGTH) {
    return res.status(400).json({ error: 'Fichier trop volumineux (8 Mo maximum).' });
  }
  const doc = {
    id: uuidv4(),
    nom,
    typeMime: typeMime || 'application/octet-stream',
    taille: Math.round(contenuBase64.length * 0.75),
    dateAjout: formatDateLocal(new Date()),
    contenuBase64
  };
  await insertDocument(doc);
  const { contenuBase64: _omit, ...meta } = doc;
  res.status(201).json(meta);
});

app.get('/api/documents/:id/fichier', async (req, res) => {
  const doc = await getDocumentFull(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document introuvable' });
  const buffer = Buffer.from(doc.contenuBase64, 'base64');
  res.setHeader('Content-Type', doc.typeMime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${doc.nom}"`);
  res.send(buffer);
});

app.delete('/api/documents/:id', requireAdmin, async (req, res) => {
  await deleteDocument(req.params.id);
  res.json({ ok: true });
});

// ---------- Route : PRESENCE EN DIRECT (via RH_USL) ----------

app.get('/api/presence', async (req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const r = await fetch(`${RH_USL_URL}/api/public/presence`, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.json({ date: null, presents: [], error: 'Presence indisponible pour le moment (le serveur RH_USL demarre peut-etre encore).' });
  }
});

// ---------- Routes : NOTIFICATIONS PUSH (telephone) ----------

app.get('/api/push/public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', async (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Abonnement invalide' });
  await addSubscription(sub);
  res.status(201).json({ ok: true });
});

app.post('/api/push/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Endpoint requis' });
  await removeSubscription(endpoint);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`CLUB USL - serveur demarre sur le port ${PORT}`);
  console.log(`Stockage : ${MONGODB_URI ? 'MongoDB (en ligne)' : 'fichier local data/db.json'}`);
});
