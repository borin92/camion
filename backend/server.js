require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const XLSX = require('xlsx');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function extractText(file) {
  const ext = path.extname(file.originalname).toLowerCase();

  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(file.buffer);
    return data.text;
  }

  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }

  if (ext === '.xlsx' || ext === '.xls') {
    const wb = XLSX.read(file.buffer, { type: 'buffer' });
    const parts = [];
    for (const sheetName of wb.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
      parts.push(csv);
    }
    return parts.join('\n');
  }

  if (ext === '.csv') {
    return file.buffer.toString('utf-8');
  }

  try {
    return file.buffer.toString('utf-8');
  } catch (e) {
    throw new Error('Format non supporté');
  }
}

function cleanGeminiResponse(raw) {
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) return match[1].trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0].trim();
  return raw.trim();
}

async function callGemini(text) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { thinkingConfig: { thinkingBudget: 0 } } });

  const prompt = `Tu es un expert en logistique de transport.
Voici du texte extrait d'un document (PDF, Excel, Word ou CSV).
Identifie tous les camions/véhicules mentionnés et retourne un JSON avec un tableau "trucks" contenant les 7 champs suivants pour chaque camion :
- "plate" : immatriculation (obligatoire, majuscules sans espaces, ex: "AB123CD")
- "format" : "poids-lourd" ou "semi" (déduire du contexte, défaut "poids-lourd")
- "type" : "known" si société ou infos connues, "unknown" sinon (défaut "known")
- "company" : nom de la société/transporteur (vide si inconnu)
- "content" : contenu/marchandise transportée (vide si inconnu)
- "eta" : heure prévue au format ISO 8601 si possible, sinon texte libre (vide si absent)
- "notes" : remarques diverses (vide si absent)

Réponds UNIQUEMENT avec un JSON valide, aucun texte avant ou après.
Format: {"trucks": [...]}

Texte à analyser :
${text}`;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  return response.text();
}

function buildExcel(trucks) {
  const wb = XLSX.utils.book_new();
  const rows = trucks.map(t => ([
    t.plate || '',
    t.format || '',
    t.type || '',
    t.company || '',
    t.content || '',
    t.eta || '',
    t.notes || ''
  ]));

  const wsData = [
    ['Immatriculation', 'Format', 'Type', 'Société', 'Contenu', 'Heure prévue', 'Notes'],
    ...rows
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, 'Camions');
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

app.post('/api/parse', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier fourni' });
  }

  console.log('[PARSE] Fichier reçu:', req.file?.originalname, req.file?.size, 'bytes');

  let text;
  try {
    text = await extractText(req.file);
    console.log('[PARSE] Texte extrait:', text.length, 'caractères');
  } catch (err) {
    console.error('[PARSE] ERREUR:', err.message);
    return res.status(500).json({ error: `Erreur extraction texte : ${err.message}` });
  }

  console.log('[PARSE] Appel Gemini...');
  let rawGemini;
  try {
    rawGemini = await callGemini(text);
    console.log('[PARSE] Réponse Gemini reçue, parsing JSON...');
  } catch (err) {
    console.error('[PARSE] ERREUR:', err.message);
    return res.status(500).json({ error: `Erreur Gemini : ${err.message}` });
  }

  let parsed;
  try {
    const cleaned = cleanGeminiResponse(rawGemini);
    parsed = JSON.parse(cleaned);
    console.log('[PARSE] Trucks détectés:', parsed.trucks ? parsed.trucks.length : 0);
  } catch (err) {
    console.error('[PARSE] ERREUR:', err.message);
    console.error('Réponse Gemini invalide :', rawGemini);
    return res.status(500).json({ error: 'Gemini a retourné un JSON invalide' });
  }

  if (!parsed.trucks || !Array.isArray(parsed.trucks)) {
    console.error('Champ trucks manquant dans la réponse Gemini :', parsed);
    return res.status(500).json({ error: 'Réponse Gemini : champ trucks manquant ou invalide' });
  }

  const trucks = parsed.trucks.map(t => ({
    ...t,
    status: 'waiting',
    place: null
  }));

  let excelBase64;
  try {
    excelBase64 = buildExcel(trucks);
  } catch (err) {
    console.error('[PARSE] ERREUR:', err.message);
    return res.status(500).json({ error: `Erreur génération Excel : ${err.message}` });
  }

  return res.json({ trucks, excelBase64 });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Test endpoints
app.post('/test/extract', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier fourni' });
  }

  try {
    const text = await extractText(req.file);
    const ext = path.extname(req.file.originalname).toLowerCase();
    return res.json({
      filename: req.file.originalname,
      size: req.file.size,
      extension: ext,
      textLength: text.length,
      textPreview: text.slice(0, 500)
    });
  } catch (err) {
    return res.status(500).json({ error: `Erreur extraction : ${err.message}` });
  }
});

app.get('/test/parse-excel', (req, res) => {
  if (!req.query.base64) {
    return res.status(400).json({ error: 'Param base64 manquant' });
  }

  try {
    const wb = XLSX.read(Buffer.from(req.query.base64, 'base64'));
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    return res.json({ rows, count: rows.length });
  } catch (err) {
    return res.status(500).json({ error: `Erreur parsing Excel : ${err.message}` });
  }
});

app.get('/test/firebase', async (req, res) => {
  const FIREBASE_URL = 'https://gpcorp-91948-default-rtdb.europe-west1.firebasedatabase.app';

  try {
    const https = require('https');
    return new Promise((resolve, reject) => {
      https.get(`${FIREBASE_URL}/trucks.json`, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            const trucks = JSON.parse(data);
            res.json({
              count: trucks ? Object.keys(trucks).length : 0,
              trucks: trucks || {}
            });
            resolve();
          } catch (err) {
            res.status(500).json({ error: `JSON parse error: ${err.message}` });
            resolve();
          }
        });
      }).on('error', (err) => {
        res.status(500).json({ error: `Firebase fetch error: ${err.message}` });
        resolve();
      });
    });
  } catch (err) {
    return res.status(500).json({ error: `Firebase error: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Eliott Parser running on port ${PORT}`);
  console.log('Test endpoints: /test/extract, /test/parse-excel, /test/firebase');
});
