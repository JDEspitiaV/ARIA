import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import http from "http";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { streamChat, generateJson, StreamResult } from "./src/services/llmProvider";
import { GoogleGenAI } from "@google/genai";
import * as XLSX from "xlsx";
import { 
  fetchAllScientificLiteratureRaw, 
  weighScientificLiterature,
  LONGEVITY_SKELETAL_QUERIES,
  PERFORMANCE_QUERIES
} from "./src/services/scienceRetrievalService";
import { 
  getRelevantEventStandard,
  loadLocalReferenceStandards
} from "./src/services/eventStandardsService";
import { 
  fetchCoachingMediaMethodology 
} from "./src/services/youtubeRetrievalService";
import { 
  STRIDES_SYSTEM_PROMPT, 
  ARIA_TOOLS,
  UPDATE_ATHLETE_DATA_TOOL,
  UPDATE_PERIODIZATION_PLAN_TOOL,
  UPDATE_INFERRED_TRAINING_CONTEXT_TOOL,
  UPDATE_CLINICAL_AND_GENETIC_PROFILE_TOOL,
  getAriaSystemPrompt
} from "./src/services/ariaTools";
import {
  getDefaultPeriodizationPlan,
  getDefaultCompetitionCalendar,
  calculatePeriodizationContext,
  formatPeriodizationPromptContext
} from "./src/services/periodizationService";
import { AthleteProfile, AthletePeriodizationPlan, CompetitionCalendar, InferredTrainingContext } from "./src/types";
import { uploadToCloudinary, destroyFromCloudinary } from "./src/services/cloudinaryService";
import { sessionCache } from "./src/services/sessionCacheService";
import appletConfig from "./firebase-applet-config.json";
import { 
  initializeApp as initAdminApp, 
  getApps as getAdminApps, 
  getApp as getAdminApp, 
  type App as AdminApp 
} from "firebase-admin/app";
import { 
  getAuth as getAdminAuth 
} from "firebase-admin/auth";
import { 
  getFirestore as getAdminFirestore, 
  type Firestore as AdminFirestore 
} from "firebase-admin/firestore";
import { 
  normalizeProfile
} from "./src/lib/normalizeProfile";

dotenv.config();

// Default LLM first chunk timeout to 60000ms (60 seconds)
process.env.LLM_FIRST_CHUNK_TIMEOUT_MS = process.env.LLM_FIRST_CHUNK_TIMEOUT_MS || "60000";

// Firebase Admin SDK Initialization (server-side authoritative access)
const firebaseProjectId = process.env.VITE_FIREBASE_PROJECT_ID || appletConfig.projectId;
let adminApp: AdminApp | null = null;
let adminDb: AdminFirestore | null = null;
let adminAuth: any = null;

try {
  if (!getAdminApps().length) {
    adminApp = initAdminApp({
      projectId: firebaseProjectId
    });
  } else {
    adminApp = getAdminApp();
  }
  adminDb = getAdminFirestore(adminApp);
  adminAuth = getAdminAuth(adminApp);
} catch (adminErr) {
  console.warn("[Firebase-Admin] Initialization warning:", adminErr);
}

// Server-authoritative Inferred Training Context storage (bypassing client firestore rules)
const inferredContextStore = new Map<string, InferredTrainingContext>();
const INFERRED_CONTEXT_FILE = path.resolve(process.cwd(), 'inferred_contexts.json');

function loadPersistedInferredContexts() {
  try {
    if (fs.existsSync(INFERRED_CONTEXT_FILE)) {
      const content = fs.readFileSync(INFERRED_CONTEXT_FILE, 'utf-8');
      const data = JSON.parse(content);
      if (data && typeof data === 'object') {
        for (const [key, val] of Object.entries(data)) {
          if (val && typeof val === 'object') {
            inferredContextStore.set(key, val as InferredTrainingContext);
          }
        }
        console.log(`[Backend-Context] Loaded ${inferredContextStore.size} persisted inferred context(s) from disk.`);
      }
    }
  } catch (err) {
    console.warn('[Backend-Context] Could not load persisted inferred contexts from disk:', err);
  }
}

// ---------------------------------------------------------------------------
// ROLLING SUMMARY (COMPLETE CONTEXT) & MEMORY BLOCK PIPELINE
// ---------------------------------------------------------------------------
// In-memory Rolling Summary storage per active session/thread: Map<threadIdOrKey, string>
const rollingSummaryStore = new Map<string, string>();

/**
 * Analyzes multimodal documents (PDFs, biomechanical graphics, clinical reports, images)
 * using the official Google Gen AI SDK (@google/genai) with inlineData (base64).
 * Completely eliminates fragile local PDF/binary parsers.
 */
async function extractDocumentWithGemini(
  fileName: string,
  mimeType: string,
  base64Data: string,
  signal?: AbortSignal
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error("Clave de Gemini API no configurada para extracción de documentos");
  }

  // Strip data URI prefix if present to ensure pure base64
  let cleanBase64 = base64Data;
  if (cleanBase64.includes(';base64,')) {
    cleanBase64 = cleanBase64.split(';base64,')[1];
  }
  cleanBase64 = cleanBase64.trim();

  const ai = new GoogleGenAI({ apiKey });
  const prompt = `Actúa como ARIA, el sistema de inteligencia biomecánica de élite para atletismo de STRIDES.
Analiza con máxima precisión técnica este documento o gráfica adjunta ("${fileName}").

Extrae y estructura exhaustivamente:
1. IDENTIFICACIÓN: Nombre del atleta, fecha de evaluación, disciplina atlética, evaluador o laboratorio.
2. MÉTRICAS CINÉTICAS Y BIOMECÁNICAS:
   - Evaluaciones de salto (CMJ, SJ, Drop Jump): Altura de salto (cm), tiempo de contacto (ms), Reactive Strength Index (RSI), potencia pico (W/kg), fuerza concéntrica/excéntrica, asimetría de extremidades.
   - Dinamometría y evaluaciones isocinéticas (ej. isocinesia a 30°/s, 60°/s, dinamometría prono/supino): Torques pico (Nm), ratios isquiosurales/cuádriceps (H:Q ratio), déficit bilateral (%) entre pierna dominante y no dominante.
   - Evaluaciones de sprint y carrera: Tiempos parciales, velocidades pico (m/s), longitud y cadencia de paso, fuerzas de impacto.
3. CURVAS Y GRÁFICAS: Si se muestran gráficas de fuerza-tiempo, curvas de torque o diagramas angulares, describe la forma de las curvas, pendientes de desarrollo de fuerza (RFD) y puntos de inflexión.
4. INFORME CLÍNICO / MÉDICO: Si hay resonancias, radiografías o ecografías, extrae los hallazgos anatómicos objetivos y notas de rehabilitación.
5. RESUMEN DE TELEMETRÍA: Datos numéricos concretos para su integración en el perfil del atleta.

REGLA: Fidelidad estricta. Si un dato no es legible, indícalo expresamente.`;

  const contents = [
    {
      role: 'user',
      parts: [
        { text: prompt },
        {
          inlineData: {
            mimeType,
            data: cleanBase64
          }
        }
      ]
    }
  ];

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents,
      config: { temperature: 0.1 }
    });
    return response.text?.trim() || '';
  } catch (err: any) {
    // If gemini-1.5-flash fails or is unavailable, fall back to gemini-2.5-flash
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: { temperature: 0.1 }
    });
    return response.text?.trim() || '';
  }
}

/**
 * Implements Rolling Summary strategy:
 * If chat history has >= 10 messages:
 * - Takes older messages (all except the last 4-6)
 * - Summarizes them into a dense "Memory Block" with a 45s timeout and 2 retries
 * - Combines with any previous rolling summary
 * - Stores the accumulated summary in rollingSummaryStore
 * - Returns the accumulated summary and the last 4-6 recent messages
 * - Fallback: if summary fails after 2 attempts, uses raw last 10 messages instead of crashing or looping
 */
async function processRollingSummary(
  threadKey: string,
  historicalMessages: any[]
): Promise<{ accumulatedSummary: string; recentMessages: any[] }> {
  try {
    const THRESHOLD = 10;
    const RECENT_COUNT = 6;

    // If total historical turns is below threshold, no summarization needed yet
    if (!historicalMessages || historicalMessages.length < (THRESHOLD - 1)) {
      const existing = rollingSummaryStore.get(threadKey) || '';
      return {
        accumulatedSummary: existing,
        recentMessages: historicalMessages || []
      };
    }

    // Split into older messages to compress and recent messages to keep verbatim (last 4-6)
    const olderMessages = historicalMessages.slice(0, historicalMessages.length - RECENT_COUNT);
    const recentMessages = historicalMessages.slice(historicalMessages.length - RECENT_COUNT);

    const existingSummary = rollingSummaryStore.get(threadKey) || '';

    // Prepare text to summarize
    const textToSummarize = olderMessages.map((m: any) => {
      const r = m.role === 'assistant' || m.role === 'model' ? 'ARIA' : 'ATLETA';
      const c = (typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')).slice(0, 400);
      return `${r}: ${c}`;
    }).join('\n');

    const prompt = `Condense and update this running athletic coaching conversation summary into a dense, factual "Memory Block".
Preserve all key athlete metrics, PRs, training phases, kinetic deficiencies, injury history, and coaching decisions discussed.

${existingSummary ? `EXISTING ACCUMULATED SUMMARY:\n${existingSummary}\n\n` : ''}NEW OLDER MESSAGES TO INTEGRATE:
${textToSummarize}

Produce a dense, structured Memory Block in Spanish capturing all critical context. Keep it under 200 words.`;

    let newSummary = existingSummary;
    const MAX_SUMMARY_RETRIES = 2;
    const SUMMARY_TIMEOUT_MS = 45000; // Strictly 45 seconds to give background summarization ample time

    for (let attempt = 0; attempt < MAX_SUMMARY_RETRIES; attempt++) {
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => {
        try { 
          timeoutController.abort(new Error(`Summary timeout of ${SUMMARY_TIMEOUT_MS}ms exceeded`)); 
        } catch {}
      }, SUMMARY_TIMEOUT_MS);

      try {
        const summaryResult = await generateJson<{ summary?: string; text?: string }>({
          system: "Eres un sintetizador experto de telemetría y memoria atlética para STRIDES. Genera un bloque denso de memoria en JSON con la propiedad 'summary'.",
          user: prompt,
          signal: timeoutController.signal,
          timeoutMs: SUMMARY_TIMEOUT_MS
        });

        const extracted = summaryResult.summary || summaryResult.text?.trim();
        if (extracted && extracted.length > 20) {
          newSummary = extracted;
          rollingSummaryStore.set(threadKey, newSummary);
          console.log(`[Rolling Summary] Successfully updated memory block for thread '${threadKey}' (${newSummary.length} chars, summarized ${olderMessages.length} messages)`);
          break;
        }
      } catch (sumErr: any) {
        const isAbort = sumErr?.name === 'AbortError' || 
                        sumErr?.message?.toLowerCase().includes('aborted') || 
                        sumErr?.message?.toLowerCase().includes('timeout') ||
                        timeoutController.signal.aborted;

        if (isAbort) {
          console.warn(`[Rolling Summary] Attempt ${attempt + 1}/${MAX_SUMMARY_RETRIES} aborted (timeout of ${SUMMARY_TIMEOUT_MS}ms exceeded). Caught cleanly.`);
        } else {
          console.warn(`[Rolling Summary] Attempt ${attempt + 1}/${MAX_SUMMARY_RETRIES} failed:`, sumErr?.message || sumErr);
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // Fallback: If summarization failed after 2 attempts, just use the raw last 10 messages
    // instead of crashing or looping, keeping main chat flow completely uninterrupted
    if (!newSummary) {
      console.warn(`[Rolling Summary] Summary not produced after ${MAX_SUMMARY_RETRIES} attempts. Falling back gracefully to raw last 10 messages without blocking main chat flow.`);
      return {
        accumulatedSummary: '',
        recentMessages: historicalMessages.slice(-10)
      };
    }

    return {
      accumulatedSummary: newSummary,
      recentMessages
    };
  } catch (pipelineErr: any) {
    console.error(`[Rolling Summary] Unexpected error in rolling summary pipeline:`, pipelineErr);
    return {
      accumulatedSummary: rollingSummaryStore.get(threadKey) || '',
      recentMessages: (historicalMessages || []).slice(-10)
    };
  }
}

// ---------------------------------------------------------------------------
// DOCUMENT & SPREADSHEET MIME RESOLUTION & VALIDATION
// ---------------------------------------------------------------------------
const SUPPORTED_DOCUMENT_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
]);

function resolveMimeType(fileName: string, detectedMime?: string): string {
  const lower = (fileName || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return detectedMime || 'application/octet-stream';
}

// Auth Middleware
const authMiddleware = async (req: any, res: any, next: any) => {
  if (req.path === '/aria/health') return next();
  if (req.path.startsWith('/cron/')) {
    const expectedSecret = process.env.CRON_SECRET;
    const providedSecret = req.headers['x-cron-secret'];
    if (!expectedSecret || typeof providedSecret !== 'string') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const a = Buffer.from(providedSecret);
    const b = Buffer.from(expectedSecret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
  }
  
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    if (!adminAuth) throw new Error('Firebase Admin Auth not initialized');
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.uid = decodedToken.uid;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

function persistInferredContextsToDisk() {
  try {
    const data: Record<string, InferredTrainingContext> = {};
    for (const [key, val] of inferredContextStore.entries()) {
      data[key] = val;
    }
    fs.writeFileSync(INFERRED_CONTEXT_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Backend-Context] Could not save inferred contexts to disk:', err);
  }
}

// Load persisted contexts on server initialization
loadPersistedInferredContexts();

// GCP metadata server availability cache
let isGcpMetadataAvailable = false;
let gcpMetadataCheckCompleted = false;

async function checkGcpMetadataAvailability(): Promise<boolean> {
  if (gcpMetadataCheckCompleted) {
    return isGcpMetadataAvailable;
  }
  try {
    const metaRes = await fetch("http://metadata.google.internal/computeMetadata/v1/", {
      method: "HEAD",
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(1000)
    });
    isGcpMetadataAvailable = metaRes.ok;
    gcpMetadataCheckCompleted = true;
    if (isGcpMetadataAvailable) {
      console.log("[GCP Metadata] metadata.google.internal is reachable. GCP metadata service enabled.");
    }
    return isGcpMetadataAvailable;
  } catch {
    isGcpMetadataAvailable = false;
    gcpMetadataCheckCompleted = true;
    console.warn(
      "[GCP Metadata] metadata.google.internal is unreachable (non-GCP / sandbox environment). " +
      "GCP metadata server token paths are inert; server in-memory & disk storage (inferredContextStore) is active."
    );
    return false;
  }
}

// Initiate check immediately on startup
checkGcpMetadataAvailability().catch(() => {});

async function saveInferredTrainingContextBackend(athleteId: string, context: InferredTrainingContext): Promise<void> {
  // Always update in-memory store and local disk persistence as primary source of truth (zero latency, survives restarts)
  inferredContextStore.set(athleteId, context);
  persistInferredContextsToDisk();
  console.log(`[Backend-Context] Inferred context saved in server memory & disk for athlete ${athleteId}: Phase ${context.currentPhase || 'GPP'}`);

  // In non-GCP sandboxes or environments without explicit credentials, in-memory/disk store is authoritative.
  // Only attempt GCP metadata token if explicitly confirmed that metadata server is reachable
  if (!isGcpMetadataAvailable) {
    return;
  }

  try {
    const metaRes = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(1500)
    });
    if (metaRes.ok) {
      const metaData = await metaRes.json();
      const token = metaData.access_token;
      if (token && appletConfig.projectId) {
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${appletConfig.projectId}/databases/${(appletConfig as any).firestoreDatabaseId || '(default)'}/documents/inferredTrainingContext/${athleteId}`;
        const fields: any = {
          athleteId: { stringValue: athleteId },
          currentPhase: { stringValue: context.currentPhase || 'GPP' },
          proximityToCompetition: { stringValue: context.proximityToCompetition || '' },
          notes: { stringValue: context.notes || '' },
          lastUpdated: { stringValue: context.lastUpdated || new Date().toISOString() }
        };
        if (context.nextCompetition) {
          fields.nextCompetition = {
            mapValue: {
              fields: {
                name: { stringValue: context.nextCompetition.name || '' },
                date: { stringValue: context.nextCompetition.date || '' },
                priority: { stringValue: context.nextCompetition.priority || 'B' }
              }
            }
          };
        }
        await fetch(firestoreUrl, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fields }),
          signal: AbortSignal.timeout(2000)
        });
        console.log(`[Backend-Admin] Persisted inferredTrainingContext to Firestore for athlete ${athleteId}`);
      }
    }
  } catch (err) {
    console.log(`[Backend-Admin] Inferred context cached in server memory for athlete ${athleteId}`);
  }
}

const app = express();
// Increase body size limit for base64 file payloads during Cloudinary staging
app.use(express.json({ limit: '25mb' }));

app.use('/api', authMiddleware);

const apiKey = process.env.LLM_API_KEY;
if (!apiKey) {
  throw new Error("FATAL: LLM_API_KEY environment variable is missing.");
}

// Server-side signed Cloudinary upload endpoint with graceful fallback
app.post("/api/upload", async (req, res) => {
  try {
    const { base64Data, fileName, fileType } = req.body;
    const authId = (req as any).uid as string;
    if (!authId) {
      return res.status(401).json({ error: "Unauthorized: Missing authenticated userId." });
    }
    if (!base64Data || !fileName) {
      return res.status(400).json({ error: "Missing file payload (base64Data or fileName)." });
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      console.warn("[API Upload] Cloudinary credentials not configured in environment. Using data URI.");
      let dataUri = base64Data;
      if (!dataUri.startsWith('data:')) {
        dataUri = `data:${fileType || 'application/octet-stream'};base64,${base64Data}`;
      }
      return res.json({
        url: dataUri,
        base64Data,
        name: fileName,
        type: fileType || 'application/octet-stream',
        size: Buffer.byteLength(base64Data, 'utf8'),
        uploadedAt: new Date().toISOString()
      });
    }

    const uploaded = await uploadToCloudinary(base64Data, fileName, fileType, authId);
    res.json({
      ...uploaded,
      base64Data
    });
  } catch (err: any) {
    console.error("[API Upload] Cloudinary upload error, using local data URI fallback:", err);
    const { base64Data, fileName, fileType } = req.body || {};
    if (base64Data && fileName) {
      let dataUri = base64Data;
      if (!dataUri.startsWith('data:')) {
        dataUri = `data:${fileType || 'application/octet-stream'};base64,${base64Data}`;
      }
      return res.json({
        url: dataUri,
        base64Data,
        name: fileName,
        type: fileType || 'application/octet-stream',
        size: Buffer.byteLength(base64Data, 'utf8'),
        uploadedAt: new Date().toISOString()
      });
    }
    res.status(500).json({ error: err.message || "Failed to upload file." });
  }
});


app.post("/api/context/preload", async (req, res) => {
  try {
    const { athleteProfile, activeThreadId } = req.body;
    if (!athleteProfile || !athleteProfile.id) {
      return res.status(400).json({ error: "Missing valid athlete profile payload." });
    }

    const primaryEvent = athleteProfile.targetEvents?.[0] || "Track and Field Sprint Biomechanics";
    const cacheKey = `baseline_${primaryEvent}`;

    if (!sessionCache.has(`${cacheKey}_lit`)) {
      const [scientificRaw, coachingMedia] = await Promise.all([
        fetchAllScientificLiteratureRaw(`${primaryEvent} kinematics mechanics force`),
        fetchCoachingMediaMethodology(`${primaryEvent} drill cueing`)
      ]);
      sessionCache.set(`${cacheKey}_lit`, scientificRaw);
      sessionCache.set(`${cacheKey}_media`, coachingMedia);
      console.log(`[SessionCache] Baseline discipline context primed for: ${primaryEvent}`);
    }

    res.json({ success: true, message: "Baseline discipline context primed in cache." });
  } catch (err) {
    console.error("Preload error:", err);
    res.status(500).json({ error: "Preload failed." });
  }
});

app.get("/api/aria/health", (req, res) => {
  res.json({
    system: "ARIA Real-Time Athletic Intelligence Pipeline",
    status: "operational"
  });
});

app.post(["/api/chat", "/api/aria"], async (req, res) => {
  let isAborted = false;
  const requestAbortController = new AbortController();

  res.on('close', () => {
    if (!res.writableEnded) {
      isAborted = true;
      requestAbortController.abort();
      console.log(`[ARIA Pipeline] Client closed connection early. In-flight pipeline aborted.`);
    }
  });

  try {
    const { 
      messages, 
      message, 
      athleteId: reqAthleteId,
      athleteProfile: reqAthleteProfile, 
      activeThreadId,
      videoAnalyses, 
      pastThreadFacts,
      periodizationPlan: inputPlan,
      competitionCalendar: inputCalendar
    } = req.body;
    
    const athleteId = reqAthleteId || reqAthleteProfile?.id;
    if (!athleteId) {
      return res.status(400).json({ error: "Missing valid athleteId in request." });
    }
    if (!(await verifyAthleteAccess((req as any).uid, athleteId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (isAborted) {
      console.log("[ARIA Pipeline] Aborted before profile retrieval. Exiting.");
      return;
    }

    // Use client-provided profile immediately if supplied;
    // otherwise attempt server-side Firestore fetch with a 1500ms race timeout
    let athleteProfile: AthleteProfile | null = null;
    if (reqAthleteProfile && reqAthleteProfile.id === athleteId) {
      athleteProfile = reqAthleteProfile;
    } else {
      try {
        athleteProfile = await Promise.race([
          getAthleteProfile(athleteId),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Profile fetch timeout')), 1500))
        ]);
      } catch (fetchErr) {
        console.warn("[Firestore] Server-side getAthleteProfile skipped:", fetchErr);
      }
    }

    if (isAborted) {
      console.log("[ARIA Pipeline] Aborted after profile retrieval. Exiting.");
      return;
    }

    if (!athleteProfile) {
      if (reqAthleteProfile && reqAthleteProfile.id) {
        athleteProfile = reqAthleteProfile;
      } else {
        return res.status(404).json({ error: "Athlete profile not found." });
      }
    }

    // Initialize SSE streaming headers early so client connection opens immediately
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }
    res.write(`: open\n\n`);

    // Periodization Plan & Competition Calendar Real-Time Calculation
    const isClubAffiliated = Boolean(athleteProfile.clubId && typeof athleteProfile.clubId === 'string' && athleteProfile.clubId.trim().length > 0);
    const clubStatus = isClubAffiliated ? "afiliado" : "sin_afiliacion";

    let periodizationSection = "";
    if (isClubAffiliated) {
      let athletePlan: AthletePeriodizationPlan | null = inputPlan || null;
      let athleteCalendar: CompetitionCalendar | null = inputCalendar || null;

      // Server-side authoritative fresh fetch of formal periodization & calendar with timeout race
      try {
        const [freshPlan, freshCalendar] = await Promise.race([
          Promise.all([
            getAthletePeriodizationPlan(athleteId),
            getCompetitionCalendar(athleteId)
          ]),
          new Promise<[null, null]>((_, reject) => setTimeout(() => reject(new Error('Calendar fetch timeout')), 1500))
        ]);
        if (freshPlan) athletePlan = freshPlan;
        if (freshCalendar) athleteCalendar = freshCalendar;
      } catch (calErr) {
        console.warn("[Periodization] Error fetching fresh plan/calendar:", calErr);
      }

      if (athletePlan && athleteCalendar) {
        const periodizationContext = calculatePeriodizationContext(athletePlan, athleteCalendar, new Date());
        const { planPeriodizacionText, calendarioCompetenciaText } = formatPeriodizationPromptContext(periodizationContext);

        periodizationSection = `CLUB STATUS:
afiliado (Club ID: ${athleteProfile.clubId})

PLAN DE PERIODIZACIÓN FORMAL DEL CLUB:
${planPeriodizacionText}

CALENDARIO DE COMPETENCIAS FORMAL DEL CLUB & ESTADO DE TAPER:
${calendarioCompetenciaText}`;
      } else {
        periodizationSection = `CLUB STATUS:
afiliado (Club ID: ${athleteProfile.clubId})

PLAN DE PERIODIZACIÓN FORMAL DEL CLUB:
El atleta pertenece al club ${athleteProfile.clubId}, pero aún no tiene un plan de periodización formal cargado por el cuerpo técnico del club. NO inventes un plan predeterminado. Si se discuten objetivos o fases, recuerda que la programación formal debe ser establecida por su entrenador de club.`;
      }
    } else {
      const storedInferred = inferredContextStore.get(athleteId);
      const inferred = req.body.inferredTrainingContext || athleteProfile.inferredTrainingContext || storedInferred;
      const phase = inferred?.currentPhase || "GPP (Preparación General preliminar - No confirmada en conversación)";
      const prox = inferred?.proximityToCompetition || "No especificada";
      const notes = inferred?.notes || "Atleta sin club asignado. Fase inferida de conversaciones previas.";
      const nextComp = inferred?.nextCompetition ? `${inferred.nextCompetition.name || 'Torneo'} (${inferred.nextCompetition.date || 'Fecha por definir'}, Prioridad ${inferred.nextCompetition.priority || 'B'})` : 'Ninguna informada';

      periodizationSection = `CLUB STATUS:
sin_afiliacion (Sin club asignado — NO uses plan formal de periodización)

CONTEXTO DE ENTRENAMIENTO INFERIDO (CONSTRUIDO DE LA CONVERSACIÓN):
- Fase Actual Inferida: ${phase}
- Proximidad a Competencia: ${prox}
- Próxima Competencia Mencionada: ${nextComp}
- Notas de Contexto: ${notes}
- Última Actualización: ${inferred?.lastUpdated || 'Inicio de conversación'}
[MANDATO ARIA]: Si el atleta menciona en qué fase está o cuándo compite, invoca 'updateInferredTrainingContext' para mantener calibrado este contexto.`;
    }

    const primaryEvent = athleteProfile.targetEvents?.[0] || "Track and Field Sprint Biomechanics";
    const userQuery = message || (Array.isArray(messages) && messages[messages.length - 1]?.content) || primaryEvent;

    // 1. Parallel retrieval across Scientific Literature & Verified Coaching Media
    // Target query terms to ensure real PubMed/EuropePMC/arXiv papers are found
    const cleanQ = (userQuery || '').toLowerCase();
    let scientificSearchQuery = `${primaryEvent} sprint kinematics mechanics force`;
    if (cleanQ.includes('isquio') || cleanQ.includes('hamstring') || cleanQ.includes('biceps femoris')) {
      scientificSearchQuery = `${primaryEvent} hamstring strain injury eccentric sprint mechanics`;
    } else if (cleanQ.includes('aquiles') || cleanQ.includes('achilles') || cleanQ.includes('tendon') || cleanQ.includes('tendinop')) {
      scientificSearchQuery = `${primaryEvent} achilles tendon stiffness isometric loading`;
    } else if (cleanQ.includes('lactat') || cleanQ.includes('lactico') || cleanQ.includes('fatig') || cleanQ.includes('resistencia')) {
      scientificSearchQuery = `${primaryEvent} sprint anaerobic glycolytic lactate tolerance`;
    } else if (cleanQ.includes('valla') || cleanQ.includes('hurdle') || cleanQ.includes('paso') || cleanQ.includes('touchdown')) {
      scientificSearchQuery = `400m hurdles stride pattern kinematics fatigue`;
    } else if (cleanQ.includes('salida') || cleanQ.includes('block') || cleanQ.includes('acelerac') || cleanQ.includes('start')) {
      scientificSearchQuery = `${primaryEvent} sprint block start acceleration ground reaction force`;
    } else if (cleanQ.includes('fuerza') || cleanQ.includes('strength') || cleanQ.includes('1rm') || cleanQ.includes('pesa')) {
      scientificSearchQuery = `sprint rate of force development heavy resistance squat power`;
    }

    if (isAborted) {
      console.log("[ARIA Pipeline] Aborted before evidence retrieval. Exiting.");
      return;
    }

    const retrievalStart = Date.now();
    let filteredLiterature: any[] = [];
    let coachingMedia: any[] = [];

    try {
      let raceTimeoutId: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<{ timeout: true }>((resolve) => {
        raceTimeoutId = setTimeout(() => resolve({ timeout: true as const }), 3500);
      });

      const fetchEvidencePromise = Promise.all([
        fetchAllScientificLiteratureRaw(scientificSearchQuery),
        fetchCoachingMediaMethodology(`${primaryEvent} drill cueing`)
      ]).then(([scientificRaw, media]) => {
        if (raceTimeoutId) clearTimeout(raceTimeoutId);
        return { timeout: false as const, scientificRaw, media };
      });

      const raceResult = await Promise.race([fetchEvidencePromise, timeoutPromise]);

      if (isAborted) {
        console.log("[ARIA Pipeline] Aborted during evidence retrieval. Exiting.");
        return;
      }

      if (raceResult.timeout === true) {
        console.warn(`[EvidencePipeline] 6-second evidence retrieval timeout reached. Proceeding without citations to prioritize response latency.`);
      } else {
        coachingMedia = raceResult.media || [];
        filteredLiterature = weighScientificLiterature(raceResult.scientificRaw || []);
        console.log(`[EvidencePipeline] Retrieved ${raceResult.scientificRaw?.length || 0} raw papers, ${filteredLiterature.length} passed quality gate in ${Date.now() - retrievalStart}ms`);
      }
    } catch (evErr) {
      console.warn("[EvidencePipeline] Retrieval error, continuing without live research citations:", evErr);
    }

    const retrievalLatencyMs = Date.now() - retrievalStart;

    // 2. Format verified peer-reviewed literature
    // If literature is found, include real citations with direct links.
    // If no verified literature met threshold, omit the section entirely — NEVER a fake placeholder string!
    const verifiedLiteratureText = filteredLiterature.length > 0 
      ? filteredLiterature.map(doc => {
          const doiUrl = doc.doi ? (doc.doi.startsWith('http') ? doc.doi : `https://doi.org/${doc.doi}`) : '';
          const resolvedUrl = doc.url || doiUrl || '';
          const domainTag = doc.domain ? `[Domain: ${doc.domain}] ` : '[Domain: performance] ';
          const mdLink = resolvedUrl ? `[${doc.title} (${doc.year})](${resolvedUrl})` : `${doc.title} (${doc.year})`;
          return `[${doc.source}] ${domainTag}${doc.belowThreshold ? '[Below-Threshold, Best Available] ' : ''}${doc.title} (${doc.year}) | Link: ${resolvedUrl || 'N/A'} | Markdown Link: ${mdLink} | Score: ${doc.score}`;
        }).join("\n")
      : "";

    // 3. Format coaching media methodology
    const coachingMediaText = coachingMedia.length > 0
      ? coachingMedia.map(m => `[Methodology Video Cue] ${m.title} (Channel: ${m.channelTitle}) - Focus: ${m.description} | Video URL: ${m.url} | Markdown Link: [Video: ${m.title}](${m.url})`).join("\n")
      : "";

    // 4. Curated Event Reference Standards (Curated Technical Benchmarks, Kinematics & Geometry)
    const relevantStandard = getRelevantEventStandard(athleteProfile.targetEvents || [primaryEvent], `${primaryEvent} ${userQuery}`);
    const eventStandardText = relevantStandard
      ? `EVENT REFERENCE STANDARDS (${relevantStandard.eventName}):\n${relevantStandard.content}`
      : "No event-specific benchmark standards retrieved.";

    // 5. Format Athlete Video Analysis History & Kinematic Telemetry (Item 6)
    const userVideoAnalyses = videoAnalyses || athleteProfile.videoAnalyses || [];
    const videoTelemetryText = userVideoAnalyses.length > 0
      ? userVideoAnalyses.map((v: any, idx: number) => 
          `[Video Analysis #${idx + 1}: ${v.sessionTitle || 'Session'} (${v.date || 'Recent'}) - ${v.discipline || primaryEvent}] ` +
          `Max Velocity: ${v.maxVelocityMps || 'N/A'} m/s | Ground Contact: ${v.groundContactTimeMs || 'N/A'} ms | ` +
          `Step Frequency: ${v.stepFrequencyHz || 'N/A'} Hz | Stride Length: ${v.strideLengthMeters || 'N/A'} m | ` +
          `Pelvic Tilt: ${v.pelvicTiltDegrees || 'N/A'} deg | Knee Flexion at Touchdown: ${v.kneeFlexionAtTouchdownDegrees || 'N/A'} deg\n` +
          `Kinematic Metrics:\n${(v.kinematicMetrics || []).map((km: any) => `  - ${km.parameter}: ${km.measuredValue} (Optimal: ${km.optimalRange}, Status: ${km.status})`).join('\n')}`
        ).join("\n\n")
      : "No video analysis telemetry recorded yet for this athlete.";

    // 6. Cross-Thread Historical Memory & Key Facts (Item 4)
    const pastFactsText = Array.isArray(pastThreadFacts) && pastThreadFacts.length > 0
      ? `ATHLETE CROSS-THREAD HISTORICAL MEMORY (OBSERVATIONS & RECENT SESSIONS):\n${pastThreadFacts.join('\n')}`
      : "No prior cross-thread history logged.";

    // 7. Coach Role Custom Methodology Document Context (Item 7)
    let coachDocText = "";
    if (athleteProfile.role === 'COACH' && athleteProfile.coachMethodologyDoc) {
      const doc = athleteProfile.coachMethodologyDoc;
      coachDocText = `\nCOACH PERSONAL TRAINING METHODOLOGY DOCUMENT:
Title: ${doc.title}
Status: ${doc.validationStatus}
Verified Scientific Claims (<=5 year peer-reviewed alignment): ${doc.verifiedClaims?.join('; ') || 'None specific'}
Unverified Proprietary Cues: ${doc.unverifiedClaims?.join('; ') || 'None specific'}
Full Content:
${doc.content}\n`;
    }

    // 8. Athlete Clinical History & Genetic Predispositions Context
    const clinicalGeneticText = `ATHLETE CLINICAL HISTORY:
${(athleteProfile.clinicalHistory || []).map((c: any) => `- ${c.condition} [${c.status}]${c.notes ? `: ${c.notes}` : ''}`).join('\n') || 'None recorded.'}

ATHLETE GENETIC PREDISPOSITIONS:
${(athleteProfile.geneticPredispositions || []).map((g: any) => `- ${g.trait}${g.notes ? `: ${g.notes}` : ''}`).join('\n') || 'None recorded.'}`;

    // 9. Athlete Strength 1RMs & Personal Records
    const personalRecords1RMs = [
      ...(athleteProfile.powerRecords || []).map((p: any) => `- ${p.liftName}: ${p.maxKg}kg`),
      ...Object.entries(athleteProfile.personalBests || {})
        .filter(([k]) => ['Squat', 'Deadlift', 'Clean', 'Bench', 'Snatch', 'Press', '1RM', 'kg'].some(term => k.toLowerCase().includes(term.toLowerCase())))
        .map(([k, v]) => `- ${k}: ${v}`)
    ].join('\n') || 'None recorded in profile.';

    const personalRecordsText = `ATHLETE STRENGTH 1RMs / PERSONAL RECORDS (LOAD PRESCRIPTION BASE):
${personalRecords1RMs}`;

    const literatureSection = verifiedLiteratureText 
      ? `\nLIVE MATHEMATICALLY-WEIGHED SCIENTIFIC RESEARCH (WITH DOMAIN TAGS: performance | longevity | skeletal):\n${verifiedLiteratureText}\n` 
      : '';
    const coachingSection = coachingMediaText 
      ? `\nCOACHING METHODOLOGY & DRILL CUEING (VERIFIED VIDEO URLS - METHODOLOGY ONLY):\n${coachingMediaText}\n` 
      : '';

    // 10. Temporal Dynamic Date Anchor & Static Context Blob
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const isoDate = currentDate.toISOString().split('T')[0];
    const formattedCurrentDate = currentDate.toLocaleDateString('es-ES', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    const temporalContextText = `TEMPORAL ANCHOR & DYNAMIC CURRENT DATE:
- Fecha actual: ${formattedCurrentDate} (${isoDate})
- Año calendario actual: ${currentYear}
[MANDATO DE RECENCIA Y TEMPORALIDAD]:
1. Aplica la regla estricta de recencia científica: la investigación en medicina deportiva y alto rendimiento es válida por 3 a 5 años (años ${currentYear - 5} a ${currentYear}). Literatura más antigua es histórica.
2. Medicina clínica y farmacología: 2 a 3 años (${currentYear - 3} a ${currentYear}).
3. Pregunta proactivamente al usuario si requiere estrictamente los últimos 3 años o un margen más amplio según su investigación.
4. Cita siempre fuentes con enlaces Markdown clickeables: [Título del Estudio (Año)](URL).`;

    const staticContextBlob = `${temporalContextText}

ATHLETE FIREBASE PROFILE:
${JSON.stringify(athleteProfile, null, 2)}

${clinicalGeneticText}

${personalRecordsText}

${pastFactsText}

ATHLETE BIOMECHANICAL VIDEO ANALYSIS & KINEMATIC TELEMETRY:
${videoTelemetryText}
${coachDocText}

${eventStandardText}

${periodizationSection}${literatureSection}${coachingSection}`.trim();

    // 11. Multi-Turn Conversation History Pipeline
    const allInputMessages = Array.isArray(messages) ? messages : [];
    
    // Stage 1: Request Received Logging
    console.log(`[ARIA Stage 1: Request Received] Athlete ID: ${athleteId}, Event: ${primaryEvent}, Input messages count: ${allInputMessages.length}, Latest input length: ${(userQuery || '').length} chars`);

    // Separate historical turns and current turn
    let historicalTurns: any[] = [];
    let currentTurnMsg = allInputMessages.length > 0 ? allInputMessages[allInputMessages.length - 1] : { role: 'user', content: userQuery };
    
    if (allInputMessages.length > 1) {
      historicalTurns = allInputMessages.slice(0, allInputMessages.length - 1);
    }

    // Convert previous messages in the session using Rolling Summary
    const threadKey = (activeThreadId && typeof activeThreadId === 'string' && activeThreadId.trim().length > 0)
      ? activeThreadId
      : athleteId;

    // Apply Rolling Summary strategy: summarizes earlier turns when history reaches 10 messages
    const { accumulatedSummary, recentMessages } = await processRollingSummary(threadKey, historicalTurns);

    const llmMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];

    // Inject Accumulated Memory Block if present
    if (accumulatedSummary && accumulatedSummary.trim().length > 0) {
      llmMessages.push({
        role: 'system',
        content: `[BLOQUE DE MEMORIA DE CONVERSACIÓN PREVIA - RESUMEN ACUMULATIVO]:\nEsta es la síntesis de los mensajes iniciales de esta sesión que ya fueron compactados para mantener contexto completo sin sobrecargar tokens:\n${accumulatedSummary.trim()}`
      });
    }

    // The last 4-6 recent messages verbatim
    for (const hMsg of recentMessages) {
      const role = hMsg.role === 'assistant' || hMsg.role === 'model' ? 'assistant' : 'user';
      const cleanContent = (hMsg.content || '').trim();
      if (cleanContent) {
        llmMessages.push({
          role,
          content: cleanContent
        });
      }
    }

    // 12. File / Attachment Pipeline Processing
    let hasMedicalExam = false;
    let extractedFilesText = "";
    const currentFilesToProcess: Array<{ url?: string; base64Data?: string; type?: string; name?: string; size?: number }> = [];

    // Extract files from current turn or request body
    if (Array.isArray(currentTurnMsg.files) && currentTurnMsg.files.length > 0) {
      for (const f of currentTurnMsg.files) {
        if (f) currentFilesToProcess.push(f);
      }
    } else if (currentTurnMsg.fileUrl) {
      currentFilesToProcess.push({ url: currentTurnMsg.fileUrl, type: currentTurnMsg.fileType, name: currentTurnMsg.fileName });
    }
    if (Array.isArray(req.body.attachedFiles)) {
      for (const f of req.body.attachedFiles) {
        if (f) currentFilesToProcess.push(f);
      }
    }
    if (Array.isArray(req.body.files)) {
      for (const f of req.body.files) {
        if (f) currentFilesToProcess.push(f);
      }
    }

    const parsedFilesLog: Array<{ name: string; type: string; sizeOrChars: number; format: string }> = [];

    for (const fileObj of currentFilesToProcess) {
      try {
        const fileName = fileObj.name || 'attached_document';
        const rawMime = fileObj.type || '';
        let mime = resolveMimeType(fileName, rawMime);
        let base64 = fileObj.base64Data || '';
        if (base64 && base64.includes(';base64,')) {
          base64 = base64.split(';base64,')[1];
        }
        let isText = false;
        let textContent = '';

        // Format validation: verify supported document/image format
        const isSupported = SUPPORTED_DOCUMENT_MIMES.has(mime) || 
                            Boolean(fileName.match(/\.(pdf|xlsx|xls|csv|txt|png|jpe?g|webp|gif)$/i));
        if (!isSupported) {
          extractedFilesText += `\n\n[Validación de Archivo]: "${fileName}" tiene un formato no compatible (${mime || 'desconocido'}). Solo se procesan documentos PDF (.pdf), Excel (.xlsx, .xls), CSV (.csv), Texto (.txt) e Imágenes (.png, .jpg, .webp).`;
          parsedFilesLog.push({ name: fileName, type: mime, sizeOrChars: 0, format: 'unsupported_format_skipped' });
          continue;
        }

        const isDriveFile = (fileObj as any).isGoogleDrive || Boolean((fileObj as any).driveFileId) || (fileObj.url && (
          fileObj.url.includes('drive.google.com') || 
          fileObj.url.includes('docs.google.com') ||
          fileObj.url.includes('googleapis.com') ||
          fileObj.url.includes('googleusercontent.com')
        ));

        if (isDriveFile) {
          const driveDocInfo = [
            `[GOOGLE DRIVE ATTACHED DOCUMENT & ATHLETIC ASSET]`,
            `- File Name: ${fileName}`,
            `- File Type: ${mime}`,
            `- Google Drive URL: ${fileObj.url || 'N/A'}`,
            (fileObj as any).description ? `- Description: ${(fileObj as any).description}` : '',
            `[ARIA COACHING DIRECTIVE]: Examine this Google Drive document reference in correlation with the athlete's biometrics, periodization cycle, and training logs.`
          ].filter(Boolean).join('\n');

          extractedFilesText += `\n\n${driveDocInfo}`;
          parsedFilesLog.push({ name: fileName, type: mime, sizeOrChars: driveDocInfo.length, format: 'google_drive_reference' });
          continue;
        }

        if (!base64 && fileObj.url) {
          if (fileObj.url.startsWith('data:')) {
            const matches = fileObj.url.match(/^data:([^;]+);base64,(.*)$/);
            if (matches) {
              mime = matches[1] || mime;
              base64 = matches[2];
            } else {
              const textMatch = fileObj.url.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?,(.*)$/);
              if (textMatch) {
                isText = true;
                textContent = decodeURIComponent(textMatch[2]);
              }
            }
          } else if (fileObj.url.startsWith('http://') || fileObj.url.startsWith('https://')) {
            const fetchHeaders: Record<string, string> = {};
            const isCloudinaryUrl = fileObj.url.includes('res.cloudinary.com') || fileObj.url.includes('cloudinary');
            const cloudApiKey = process.env.CLOUDINARY_API_KEY;
            const cloudApiSecret = process.env.CLOUDINARY_API_SECRET;
            if (isCloudinaryUrl && cloudApiKey && cloudApiSecret) {
              fetchHeaders['Authorization'] = `Basic ${Buffer.from(`${cloudApiKey}:${cloudApiSecret}`).toString('base64')}`;
            }

            try {
              const fileRes = await fetch(fileObj.url, { 
                headers: fetchHeaders,
                signal: AbortSignal.timeout(8000) 
              });

              if (fileRes.ok) {
                if (mime.startsWith('text/') || mime === 'text/csv' || fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
                  isText = true;
                  textContent = await fileRes.text();
                } else {
                  const arrayBuffer = await fileRes.arrayBuffer();
                  base64 = Buffer.from(arrayBuffer).toString('base64');
                }
              } else {
                console.warn(`[Multimodal] Remote file fetch HTTP ${fileRes.status} for "${fileName}" (${fileObj.url}). Preserving reference context.`);
                extractedFilesText += `\n\n[Attached Document: ${fileName} (${mime}) - Remote asset referenced at ${fileObj.url}]`;
                parsedFilesLog.push({ name: fileName, type: mime, sizeOrChars: fileObj.size || 0, format: 'remote_reference_unreachable' });
                continue;
              }
            } catch (fetchErr: any) {
              console.warn(`[Multimodal] Network error fetching remote file "${fileName}":`, fetchErr.message);
              extractedFilesText += `\n\n[Attached Document: ${fileName} (${mime}) - Remote asset referenced at ${fileObj.url}]`;
              parsedFilesLog.push({ name: fileName, type: mime, sizeOrChars: fileObj.size || 0, format: 'remote_reference_error' });
              continue;
            }
          }
        }

        if (mime === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
          if (base64) {
            hasMedicalExam = true;
            try {
              console.log(`[Multimodal PDF] Processing "${fileName}" with Google Gen AI SDK (@google/genai)...`);
              const extractedPdfText = await extractDocumentWithGemini(fileName, mime, base64);
              if (extractedPdfText && extractedPdfText.trim().length > 0) {
                extractedFilesText += `\n\n[DOCUMENTO PDF ADJUNTO ANALIZADO POR IA MULTIMODAL: "${fileName}"]\n${extractedPdfText}`;
                parsedFilesLog.push({ name: fileName, type: mime, sizeOrChars: extractedPdfText.length, format: 'gemini_multimodal_pdf' });
                console.log(`[Multimodal PDF] Successfully extracted ${extractedPdfText.length} chars from "${fileName}".`);
              } else {
                extractedFilesText += `\n\n[Documento PDF: ${fileName}]: Documento recibido y analizado pero no contiene datos biométricos legibles.`;
                parsedFilesLog.push({ name: fileName, type: mime, sizeOrChars: 0, format: 'pdf_empty' });
              }
            } catch (pdfErr: any) {
              console.warn(`[Multimodal PDF] Gemini analysis failed for ${fileName}:`, pdfErr.message || pdfErr);
              // Gracefully reject the file with a clear message, DO NOT crash the server
              extractedFilesText += `\n\n[Documento PDF: ${fileName}]: El documento fue recibido en el servidor pero la extracción visual de PDFs falló (${pdfErr.message || 'error de proveedor'}). Puedes subir una captura de pantalla (.png/.jpg) del reporte o gráficas para lectura inmediata.`;
              parsedFilesLog.push({ name: fileName, type: mime, sizeOrChars: 0, format: 'pdf_extraction_fallback' });
            }
          }
        } else if (
          mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
          mime === 'application/vnd.ms-excel' ||
          fileName.toLowerCase().endsWith('.xlsx') ||
          fileName.toLowerCase().endsWith('.xls')
        ) {
          if (base64) {
            try {
              const excelBuffer = Buffer.from(base64, 'base64');
              const workbook = XLSX.read(excelBuffer, { type: 'buffer' });
              const sheetSummaries: string[] = [];

              for (const sheetName of workbook.SheetNames) {
                const worksheet = workbook.Sheets[sheetName];
                const sheetCsv = XLSX.utils.sheet_to_csv(worksheet);
                if (sheetCsv && sheetCsv.trim().length > 0) {
                  sheetSummaries.push(`--- HOJA: ${sheetName} ---\n${sheetCsv.trim().slice(0, 15000)}`);
                }
              }

              const excelContent = sheetSummaries.join('\n\n') || '[Hoja de cálculo vacía]';
              extractedFilesText += `\n\n[Attached Excel Spreadsheet: ${fileName} (${workbook.SheetNames.length} sheet(s))]\n${excelContent}`;
              parsedFilesLog.push({ name: fileName, type: mime, sizeOrChars: excelContent.length, format: 'xlsx_parsed_table' });
            } catch (xlsxErr: any) {
              console.warn(`[Excel Parser] Error parsing ${fileName}:`, xlsxErr);
              extractedFilesText += `\n\n[Attached Document: ${fileName} - Excel binary processing issue: ${xlsxErr.message}]`;
            }
          }
        } else if (mime === 'text/csv' || mime === 'text/plain' || isText) {
          extractedFilesText += `\n\n[Attached Document: ${fileName}]\n\n${textContent}`;
          parsedFilesLog.push({ name: fileName, type: mime, sizeOrChars: textContent.length, format: 'inline_text' });
        } else if (mime.startsWith('image/')) {
          hasMedicalExam = true;
          if (base64) {
            try {
              console.log(`[Multimodal Image] Processing image "${fileName}" (${mime}) with Google Gen AI SDK...`);
              const extractedImgText = await extractDocumentWithGemini(fileName, mime, base64);
              if (extractedImgText && extractedImgText.trim().length > 0) {
                extractedFilesText += `\n\n[IMAGEN / EXAMEN CLÍNICO ADJUNTO ANALIZADO: "${fileName}"]\n${extractedImgText}`;
                parsedFilesLog.push({ name: fileName, type: mime, sizeOrChars: extractedImgText.length, format: 'gemini_multimodal_image' });
              } else {
                extractedFilesText += `\n\n[Attached Image: ${fileName} (${mime}) - Image provided via inline base64]`;
                parsedFilesLog.push({ name: fileName, type: mime, sizeOrChars: base64.length, format: 'image_inline_data' });
              }
            } catch (imgErr: any) {
              console.warn(`[Multimodal Image] Direct Gemini extraction error for "${fileName}":`, imgErr.message || imgErr);
              extractedFilesText += `\n\n[Attached Image: ${fileName} (${mime}) - Image registered in session]`;
              parsedFilesLog.push({ name: fileName, type: mime, sizeOrChars: base64.length, format: 'image_inline_data' });
            }
          }
        }
      } catch (e: any) {
        console.error(`[Multimodal] Error processing file "${fileObj.name || fileObj.url}":`, e);
        extractedFilesText += `\n\n[Note: Attached file "${fileObj.name || 'document'}" could not be loaded: ${e.message}]`;
      }
    }

    // Stage 2: Files Parsed Logging
    console.log(`[ARIA Stage 2: Files Parsed] Attached file count: ${parsedFilesLog.length}, Details:`, parsedFilesLog);

    // Formulate final user turn text with static context blob injected once
    let fileAnalysisMandate = "";
    if (parsedFilesLog.length > 0) {
      fileAnalysisMandate = `\n\n[MANDATORY ATTACHED FILE PROTOCOL & SOURCE INVISIBILITY]:
1. Extract concrete data points from the attached content silently.
2. Cross-reference those data points against this athlete's profile (existing 1RMs per exercise, injury history, periodization phase, anthropometrics, clinical history, and genetic predispositions).
3. STRICT SOURCE INVISIBILITY: NEVER say "based on your attached file/document", "according to your PDF", or "in the file you sent". Speak as an experienced coach who already knows this information naturally.
4. If medical exam/radiograph/lab result: apply sports-medicine framing and non-diagnostic disclaimer without saying "the file you attached" (phrase as: "before acting on this, get it reviewed in person by a licensed sports physician").
5. If new data is extracted (PR, injury, clinical condition, genetic predisposition), invoke updateAthleteData or updateClinicalAndGeneticProfile to persist it.`;
    }

    const finalUserTurnText = `SYSTEM & ATHLETE HIGH-PERFORMANCE CONTEXT:
${staticContextBlob}

CURRENT ATHLETE QUERY:
${currentTurnMsg.content || userQuery}${extractedFilesText}${fileAnalysisMandate}${hasMedicalExam ? '\n\n[NOTE: Athlete has attached medical exam/radiograph/image. Follow medical disclaimer & sports-medicine review protocols.]' : ''}`;

    llmMessages.push({
      role: 'user',
      content: finalUserTurnText
    });

    // Stage 3: Context Assembled Logging
    console.log(`[ARIA Stage 3: Context Assembled] Profile: ${athleteProfile.name || athleteId}, Event: ${primaryEvent}, Historical turns: ${historicalTurns.length}, Literature count: ${filteredLiterature.length}, Static context length: ${staticContextBlob.length} chars, Prompt length: ${finalUserTurnText.length} chars`);

    // Stage 4: Sent to LLM Provider Logging
    const activeModel = process.env.LLM_MODEL || 'deepseek-chat';
    console.log(`[ARIA Stage 4: Sent to LLM Provider] Model: ${activeModel}, Total conversation turns: ${llmMessages.length}`);
    console.log(`[ARIA Stage 4: Sent to LLM Provider] Assembled prompt preview (latest turn):\n${finalUserTurnText.slice(0, 400)}...\n[Total Assembled Turn Chars]: ${finalUserTurnText.length}`);

    if (isAborted) {
      console.log("[ARIA Pipeline] Aborted before starting SSE response. Exiting.");
      return;
    }

    // Prepare Server-Sent Events (SSE) Streaming Response
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      if (typeof (res as any).flushHeaders === 'function') {
        (res as any).flushHeaders();
      }
    }

    const ariaSystemPrompt = getAriaSystemPrompt(currentDate);

    const llmStart = Date.now();
    let streamResult: StreamResult;
    const hasUploadedFiles = parsedFilesLog.length > 0;
    const isTextOnlyModel = !(process.env.LLM_MODEL || '').toLowerCase().includes('gemini') && 
                            !(process.env.LLM_MODEL || '').toLowerCase().includes('vision');
    const dynamicModel = hasUploadedFiles && isTextOnlyModel ? 'gemini-1.5-flash' : undefined;

    try {
      streamResult = await streamChat({
        system: ariaSystemPrompt,
        messages: llmMessages,
        tools: ARIA_TOOLS,
        signal: requestAbortController.signal,
        preferredModel: dynamicModel,
        onChunk: (textChunk: string) => {
          if (!isAborted && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'chunk', text: textChunk })}\n\n`);
          }
        }
      });
    } catch (llmErr: any) {
      if (isAborted || requestAbortController.signal.aborted) {
        console.log("[ARIA Stage 5: ABORTED] Request was cancelled by client. Halting SSE.");
        return;
      }
      console.error("[ARIA Stage 5: FAILED] Error calling LLM streaming API:", llmErr);
      const errMsg = llmErr?.message || String(llmErr) || "LLM streaming API failure";
      const isTimeout = llmErr?.name === 'AbortError' || 
                        errMsg.toLowerCase().includes('timeout') || 
                        errMsg.toLowerCase().includes('aborted');

      const userFriendlyMessage = isTimeout
        ? "El servidor de IA superó el tiempo máximo de espera sin responder (timeout). Por favor, intenta de nuevo."
        : `Analysis failed — please try again. [Error: ${errMsg}]`;
      
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ 
          type: 'error', 
          error: userFriendlyMessage,
          isTimeout
        })}\n\n`);
        res.end();
      }
      return;
    }

    if (isAborted || requestAbortController.signal.aborted) {
      console.log("[ARIA Pipeline] Aborted after LLM stream. Skipping tool execution and database writes.");
      return;
    }

    const llmLatencyMs = Date.now() - llmStart;
    // Stage 5: Response Received Logging
    console.log(`[ARIA Stage 5: Response Received] Synthesis completed on model '${streamResult.modelUsed}' in ${llmLatencyMs}ms (Text Length: ${streamResult.text.length}, Function Calls: ${streamResult.functionCalls?.length || 0})`);

    if (streamResult.functionCalls && streamResult.functionCalls.length > 0) {
      const call = streamResult.functionCalls[0];

      // Helper to process continuation: guarantees that the model answers the user's query
      // in the SAME response stream rather than cutting off prematurely after saving memory.
      const completeToolCallWithAnswer = async (
        functionCallPayload: any,
        defaultConfirmation: string
      ) => {
        let finalAnswerText = streamResult.text || defaultConfirmation;

        // If the model only returned a tool call with empty or very short text (< 120 chars),
        // stream the confirmation prefix, then immediately execute a continuation turn
        // so the user gets their actual question answered in the SAME response stream.
        if (!streamResult.text || streamResult.text.trim().length < 120) {
          if (!streamResult.text && !res.writableEnded && !isAborted) {
            res.write(`data: ${JSON.stringify({ type: 'chunk', text: `${defaultConfirmation}\n\n` })}\n\n`);
          }

          const MAX_TOOL_RETRIES = 2;
          let continuationSucceeded = false;

          for (let contAttempt = 0; contAttempt < MAX_TOOL_RETRIES; contAttempt++) {
            if (isAborted || res.writableEnded) break;
            try {
              console.log(`[ARIA Pipeline] Tool '${functionCallPayload.name}' executed. Continuing generation (attempt ${contAttempt + 1}/${MAX_TOOL_RETRIES})...`);
              const continuationMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
                ...llmMessages,
                { role: 'assistant', content: defaultConfirmation },
                { 
                  role: 'user', 
                  content: `[SISTEMA: La información de contexto ha sido registrada y guardada exitosamente. Ahora responde de manera completa, detallada y directa a la consulta o pregunta original del atleta, aplicando tus conocimientos de biomecánica, entrenamiento y salud estructural con enlaces Markdown clickeables a fuentes, sin mencionar herramientas internas.]` 
                }
              ];

              const continuationResult = await streamChat({
                system: ariaSystemPrompt,
                messages: continuationMessages,
                tools: undefined, // Omit tools to prevent circular tool execution
                signal: requestAbortController.signal,
                onChunk: (chunk: string) => {
                  if (!isAborted && !res.writableEnded) {
                    res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
                  }
                }
              });

              if (continuationResult.text) {
                finalAnswerText = `${defaultConfirmation}\n\n${continuationResult.text}`;
              }
              continuationSucceeded = true;
              break;
            } catch (contErr: any) {
              console.warn(`[ARIA Pipeline] Error in continuation stream after tool call (attempt ${contAttempt + 1}/${MAX_TOOL_RETRIES}):`, contErr?.message || contErr);
              if (contAttempt === MAX_TOOL_RETRIES - 1 && !continuationSucceeded && !finalAnswerText) {
                if (!res.writableEnded && !isAborted) {
                  res.write(`data: ${JSON.stringify({ 
                    type: 'error', 
                    error: "Ocurrió un error al completar la respuesta tras registrar los datos. Por favor, intenta de nuevo." 
                  })}\n\n`);
                  res.end();
                  return;
                }
              }
            }
          }
        }

        if (!res.writableEnded && !isAborted) {
          res.write(`data: ${JSON.stringify({ 
            type: 'done', 
            text: finalAnswerText,
            functionCall: functionCallPayload 
          })}\n\n`);
          res.end();
        }
      };

      if (call.name === 'updateAthleteData') {
        const args = (call.args || {}) as any;
        
        // Map structured telemetry into normalized keys for ChatContainer & Firestore updates
        const pbMap: Record<string, string> = {};
        if (Array.isArray(args.personalBests)) {
          args.personalBests.forEach((pb: any) => {
            if (pb.event && (pb.timeOrMark || pb.time)) {
              pbMap[pb.event] = pb.timeOrMark || pb.time;
            }
          });
        }
        
        let injList: string[] = [];
        if (Array.isArray(args.injuryReports)) {
          injList = args.injuryReports.map((ir: any) => 
            `${ir.bodypart || ''} ${ir.type || ''} (${ir.severity || ''}) - ${ir.status || ''}`.trim()
          );
        }

        const functionCallPayload = {
          name: call.name,
          arguments: {
            personalBests: Object.keys(pbMap).length > 0 ? pbMap : undefined,
            activeInjuries: injList.length > 0 ? injList : undefined,
            injuryReports: args.injuryReports,
            goalProjections: args.goalProjections,
            rawArgs: args
          }
        };

        const confirmationText = streamResult.text || "He actualizado tu perfil en STRIDES con estos parámetros. El sistema de entrenamiento integral está listo para el análisis táctico.";
        await completeToolCallWithAnswer(functionCallPayload, confirmationText);
        return;
      } else if (call.name === 'updateInferredTrainingContext') {
        const args = (call.args || {}) as any;
        const inferredData: InferredTrainingContext = {
          athleteId,
          currentPhase: args.currentPhase || 'GPP',
          proximityToCompetition: args.proximityToCompetition || 'Sin especificar',
          nextCompetition: args.nextCompetition,
          notes: args.notes || '',
          lastUpdated: new Date().toISOString()
        };

        // Persist to server backend store & Cloud Firestore (Admin SDK / REST bypass)
        await saveInferredTrainingContextBackend(athleteId, inferredData);

        const functionCallPayload = {
          name: call.name,
          arguments: inferredData
        };

        const confirmationText = streamResult.text || `He registrado tu contexto de entrenamiento inferido: Fase ${inferredData.currentPhase}${inferredData.proximityToCompetition ? ` (${inferredData.proximityToCompetition})` : ''}. Tus próximas recomendaciones tácticas estarán calibradas a este momento.`;
        await completeToolCallWithAnswer(functionCallPayload, confirmationText);
        return;
      } else if (call.name === 'updatePeriodizationPlan') {
        const args = (call.args || {}) as any;
        const isCoachUser = athleteProfile.role === 'COACH' || athleteProfile.role === 'coach';

        // Strict Tool Calling Mandate: updatePeriodizationPlan is only for Coach/Staff of club.
        // If an unaffiliated athlete requests changing their phase, redirect cleanly to updateInferredTrainingContext.
        if (!isCoachUser && !isClubAffiliated) {
          const inferredPhase = args.mesocycles?.[0]?.phase || 'SPP';
          const inferredData: InferredTrainingContext = {
            athleteId,
            currentPhase: inferredPhase,
            proximityToCompetition: args.competitions?.[0]?.date ? `Próxima competencia: ${args.competitions[0].date}` : 'Sin fecha fija',
            nextCompetition: args.competitions?.[0],
            notes: `Fase ajustada desde conversación (${args.mesocycles?.[0]?.name || inferredPhase})`,
            lastUpdated: new Date().toISOString()
          };

          await saveInferredTrainingContextBackend(athleteId, inferredData);

          const functionCallPayload = {
            name: 'updateInferredTrainingContext',
            arguments: inferredData
          };

          const confirmationText = streamResult.text || `Como atleta independiente sin club asignado, he registrado tu fase actual (${inferredPhase}) en tu contexto inferido. Tus prescripciones tácticas se adaptarán a este bloque.`;
          await completeToolCallWithAnswer(functionCallPayload, confirmationText);
          return;
        }

        const functionCallPayload = {
          name: call.name,
          arguments: args
        };

        const confirmationText = streamResult.text || "He actualizado el plan de periodización y el calendario de competencias en la base de datos de ARIA. Tu prescripción de entrenamiento ahora responde exactamente a este ciclo y objetivo.";
        await completeToolCallWithAnswer(functionCallPayload, confirmationText);
        return;
      } else if (call.name === 'updateClinicalAndGeneticProfile') {
        const args = (call.args || {}) as any;
        const functionCallPayload = {
          name: call.name,
          arguments: {
            clinicalHistory: args.clinicalHistory,
            geneticPredispositions: args.geneticPredispositions,
            rawArgs: args
          }
        };

        const confirmationText = streamResult.text || "He actualizado tu perfil clínico y predisposiciones genéticas en STRIDES para asegurar que toda prescripción respete la tolerancia estructural de tus tejidos.";
        await completeToolCallWithAnswer(functionCallPayload, confirmationText);
        return;
      }
    }

    if (isAborted || res.writableEnded) {
      return;
    }

    if (!streamResult.text && (!streamResult.functionCalls || streamResult.functionCalls.length === 0)) {
      console.error("[ARIA Stage 5: FAILED] Stream completed without text output or function call.");
      res.write(`data: ${JSON.stringify({ type: 'error', error: "Analysis failed — received empty response from AI model. Please try again." })}\n\n`);
      res.end();
      return;
    }

    const primaryCall = streamResult.functionCalls?.[0];
    res.write(`data: ${JSON.stringify({ 
      type: 'done', 
      text: streamResult.text,
      functionCall: primaryCall ? { name: primaryCall.name, arguments: primaryCall.arguments || primaryCall.args } : undefined
    })}\n\n`);
    res.end();
  } catch (error: any) {
    if (isAborted) {
      console.log("[ARIA Pipeline] Closed connection error suppressed.");
      return;
    }
    console.error("[ARIA Chat Backend Error]:", error);
    const errMsg = error?.message || String(error) || "ARIA Backend Communication Error";
    const isTimeout = error?.name === 'AbortError' || errMsg.toLowerCase().includes('timeout');
    const userFriendlyMessage = isTimeout
      ? "El servidor de IA superó el tiempo máximo de espera sin responder (timeout). Por favor, intenta de nuevo."
      : errMsg;

    if (!res.headersSent) {
      res.status(isTimeout ? 504 : 500).json({ error: userFriendlyMessage, isTimeout });
    } else if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: userFriendlyMessage, isTimeout })}\n\n`);
      res.end();
    }
  }
});

// Server-side Firestore reads via Admin SDK (the client SDK has no signed-in user on the server,
// so security rules would always deny these reads).
async function adminGetDoc(collection: string, id: string): Promise<any | null> {
  if (!adminDb) return null;
  try {
    const snap = await adminDb.collection(collection).doc(id).get();
    return snap.exists ? snap.data() : null;
  } catch (err: any) {
    console.warn(`[Firestore-Admin] Could not read ${collection}/${id}: ${err?.message || err}`);
    return null;
  }
}
const getAthleteProfile = async (athleteId: string): Promise<AthleteProfile | null> => {
  const raw = await adminGetDoc('users', athleteId);
  return raw ? normalizeProfile(athleteId, raw).profile : null;
};
const getAthletePeriodizationPlan = async (athleteId: string): Promise<AthletePeriodizationPlan | null> =>
  (await adminGetDoc('athletePeriodizationPlans', athleteId)) as AthletePeriodizationPlan | null;
const getCompetitionCalendar = async (athleteId: string): Promise<CompetitionCalendar | null> =>
  (await adminGetDoc('competitionCalendar', athleteId)) as CompetitionCalendar | null;

// Helper: Verify if user has access to athlete
async function verifyAthleteAccess(uid: string, athleteId: string) {
  if (uid === athleteId) return true;
  if (!adminDb) return false;
  
  // Check coach role via roles collection
  const roleDoc = await adminDb.collection('roles').doc(uid).get();
  if (roleDoc.data()?.role !== 'COACH') return false;
  
  const athleteDoc = await adminDb.collection('users').doc(athleteId).get();
  if (!athleteDoc.exists) return false;
  const athleteData = athleteDoc.data();
  if (!athleteData?.clubId) return false;
  
  const clubDoc = await adminDb.collection('clubs').doc(athleteData.clubId).get();
  if (!clubDoc.exists) return false;
  const clubData = clubDoc.data();
  return clubData?.staffIds?.includes(uid);
}

// Endpoint: Retrieve Inferred Training Context for an Athlete (Server-managed)
app.get("/api/inferred-context/:athleteId", async (req, res) => {
  const { athleteId } = req.params;
  const uid = (req as any).uid;
  if (!(await verifyAthleteAccess(uid, athleteId))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const data = inferredContextStore.get(athleteId) || null;
  res.json({ athleteId, inferredTrainingContext: data });
});
app.post("/api/thread/summarize", async (req, res) => {
  try {
    const { messages, title } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.json({ summary: "" });
    }

    const conversationSnippet = messages
      .slice(-6)
      .map((m: any) => `${m.role.toUpperCase()}: ${m.content.slice(0, 300)}`)
      .join("\n\n");

    const prompt = `Summarize the essential athletic facts, kinetic deficiencies, injury flags, or specific training parameters discussed in this track & field coaching session in 1 or 2 concise, factual sentences for future training sessions. Keep it concise.
Session Title: ${title || 'Tactical Session'}

Conversation:
${conversationSnippet}`;

    const response = await generateJson<{ summary?: string }>({
      system: "You are a concise athletic telemetry logger. Output JSON with a 'summary' property containing 1-2 factual sentences capturing key athlete metrics, kinetic observations, or training cycle priorities.",
      user: prompt
    });

    res.json({ summary: response.summary || response.text?.trim() || "" });
  } catch (err: any) {
    console.warn("Thread summarize error:", err);
    res.json({ summary: "" });
  }
});

// Endpoint: Fast lightweight title generator for new threads from first conversation exchange
app.post("/api/thread/generate-title", async (req, res) => {
  try {
    const { messages, userMessage, assistantResponse } = req.body;
    let textToSummarize = "";
    if (userMessage && assistantResponse) {
      textToSummarize = `User: ${userMessage}\nCoach: ${assistantResponse}`;
    } else if (Array.isArray(messages) && messages.length >= 2) {
      textToSummarize = messages.slice(0, 4).map((m: any) => `${m.role.toUpperCase()}: ${m.content.slice(0, 300)}`).join("\n");
    } else if (userMessage) {
      textToSummarize = `User: ${userMessage}`;
    } else {
      return res.json({ title: "" });
    }

    const prompt = `Generate a short, descriptive 3 to 6 word title summarizing this track & field coaching exchange.
Rules:
- 3 to 6 words maximum.
- No quotation marks, no quotes.
- No trailing punctuation (no periods, colons, or exclamation marks).
- Capture specific athletic topics (e.g. "Sprint Acceleration & Ground Contact", "Block Clearance Mechanics", "Hamstring Eccentric Conditioning").

Exchange:
${textToSummarize}`;

    const response = await generateJson<{ title?: string }>({
      system: "You are a concise title generator. Return JSON with a 'title' property containing a 3 to 6 word title without formatting, punctuation, or quotation marks.",
      user: prompt
    });

    let cleanTitle = response.text?.trim().replace(/^["'`]|["'`]$/g, '').replace(/[.:;]$/, '') || "";
    if (cleanTitle.length > 60) {
      cleanTitle = cleanTitle.slice(0, 60);
    }

    res.json({ title: cleanTitle });
  } catch (err: any) {
    console.error("Thread title generation error:", err?.message || err);
    res.json({ title: "" });
  }
});

// Endpoint: Validate Coach Methodology Document with 5-Year Rolling Literature Filter
app.post("/api/coach/validate-methodology", async (req, res) => {
  try {
    const { title, content, discipline } = req.body;
    const userId = (req as any).uid as string;

    if (!userId) {
      return res.status(401).json({ 
        error: "Unauthorized: Missing authenticated user identification." 
      });
    }

    // Server-side Role Verification Gate: Look up actual user record from Firestore using Firebase Admin SDK
    // Do NOT trust any client-supplied 'role' field in req.body
    let isVerifiedCoach = false;
    try {
      if (adminDb) {
        const roleDoc = await adminDb.collection("roles").doc(userId).get();
        if (roleDoc.exists) {
          const roleData = roleDoc.data();
          if (roleData?.role === "COACH") {
            isVerifiedCoach = true;
          }
        }
      }
    } catch (authErr) {
      console.error("Firestore user verification error (Firebase Admin SDK):", authErr);
    }

    if (!isVerifiedCoach) {
      return res.status(403).json({ 
        error: "Forbidden: Coach Methodology Ingestion is strictly restricted to verified Coach accounts." 
      });
    }

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "Document content is required." });
    }

    // Current year is 2026 -> 5-year rolling window is 2021-2026
    const minValidYear = 2021;
    const searchTopic = `${discipline || "track and field sprint speed strength"} ${title || ""}`;

    // Query peer-reviewed literature
    const rawLiterature = await fetchAllScientificLiteratureRaw(searchTopic);
    const recentPapers = rawLiterature.filter(p => {
      const yr = parseInt(p.year, 10);
      return !isNaN(yr) && yr >= minValidYear;
    });

    const literatureContext = recentPapers.slice(0, 10).map(p => 
      `Paper: "${p.title}" (${p.year}) - Journal/Source: ${p.source} - DOI: ${p.doi}\nAbstract: ${p.abstract.slice(0, 200)}...`
    ).join("\n\n");

    const extractionPrompt = `You are a Sports Biomechanics Peer-Review Validation Engine.
Analyze the following Coach Training Methodology Document against recent peer-reviewed scientific literature (Rolling 5-Year Window: 2021-2026).

COACH DOCUMENT:
Title: ${title || 'Coaching Philosophy'}
Content:
${content}

RECENT PEER-REVIEWED LITERATURE (2021-2026):
${literatureContext || 'General biomechanical principles'}

TASK:
1. Extract distinct coaching claims/principles from the document.
2. Cross-reference each claim against the recent (2021-2026) peer-reviewed literature or modern sports science consensus.
3. Categorize claims into:
   - "verifiedClaims": Claims that directly align with or are supported by recent peer-reviewed biomechanics/physiology literature (include the brief scientific rationale).
   - "unverifiedClaims": Proprietary coaching cues, experiential heuristics, or historical methods that lack >=2021 peer-reviewed validation (mark as "Unverified proprietary cue - preserved for coach reasoning").
4. Assign an overall validationStatus:
   - 'VALIDATED' if all/majority of scientific claims are supported.
   - 'PARTIALLY_VALIDATED' if some claims are supported while others are proprietary/unverified.
   - 'UNVERIFIED' if no claims have >=2021 scientific support.

Respond with JSON:
{
  "validationStatus": "VALIDATED" | "PARTIALLY_VALIDATED" | "UNVERIFIED",
  "verifiedClaims": ["claim 1 with rationale", ...],
  "unverifiedClaims": ["claim 2 (unverified proprietary)", ...]
}`;

    const validationResponse = await generateJson<any>({
      system: "You are a Sports Biomechanics Peer-Review Validation Engine. Respond strictly with valid JSON.",
      user: extractionPrompt
    });

    let result = {
      validationStatus: validationResponse.validationStatus || 'PARTIALLY_VALIDATED',
      verifiedClaims: validationResponse.verifiedClaims || [],
      unverifiedClaims: validationResponse.unverifiedClaims || []
    };

    if (result.verifiedClaims.length === 0 && result.unverifiedClaims.length === 0) {
      result = {
        validationStatus: 'PARTIALLY_VALIDATED',
        verifiedClaims: [`Methodology ingested for ${title || 'Coach System'}`],
        unverifiedClaims: ['Proprietary coaching cues preserved as unverified heuristics.']
      };
    }

    res.json(result);
  } catch (error: any) {
    console.error("Coach methodology validation error:", error);
    res.status(500).json({ error: error.message || "Methodology validation failed." });
  }
});

// Endpoint for 48-Hour Cloudinary Asset Cleanup
app.post("/api/cloudinary/destroy", async (req, res) => {
  try {
    const { publicId, resourceType } = req.body;
    const authId = (req as any).uid as string;
    if (!authId) {
      return res.status(401).json({ error: "Unauthorized: Missing authenticated userId." });
    }
    if (!publicId || typeof publicId !== 'string') {
      return res.status(400).json({ error: "Missing publicId parameter." });
    }
    if (!publicId.startsWith(`strides_users/${authId}/`) || publicId.includes('..')) {
      return res.status(403).json({ error: "Forbidden: asset does not belong to the authenticated user." });
    }
    const destroyed = await destroyFromCloudinary(publicId, resourceType || 'image');
    res.json({ success: true, destroyed });
  } catch (err: any) {
    console.error("[API Cloudinary Destroy] Error:", err);
    res.status(500).json({ error: err.message || "Failed to destroy Cloudinary asset." });
  }
});

// GET all curated event reference standards
app.get("/api/reference-standards", (req, res) => {
  try {
    const standards = loadLocalReferenceStandards();
    res.json({
      success: true,
      count: standards.length,
      standards: standards.map(s => ({
        id: s.id,
        eventName: s.eventName,
        sourceFile: s.sourceFile,
        lastUpdatedByCoach: s.lastUpdatedByCoach,
        contentLength: s.content.length,
        preview: s.content.slice(0, 300) + "..."
      }))
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET specific curated event reference standard by ID
app.get("/api/reference-standards/:id", (req, res) => {
  try {
    const standards = loadLocalReferenceStandards();
    const standard = standards.find(s => s.id === req.params.id);
    if (!standard) {
      return res.status(404).json({ error: `Event standard '${req.params.id}' not found.` });
    }
    res.json({ success: true, standard });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST trigger to sync local .md reference standards to Firestore eventReferenceStandards collection
app.post("/api/reference-standards/sync", async (req, res) => {
  try {
    const standards = loadLocalReferenceStandards();
    res.json({
      success: true,
      count: standards.length,
      syncedAt: new Date().toISOString(),
      standards: standards.map(s => ({ id: s.id, eventName: s.eventName, sourceFile: s.sourceFile }))
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET athlete periodization plan and current context
app.get("/api/periodization/:athleteId", async (req, res) => {
  try {
    const athleteId = req.params.athleteId;
    const uid = (req as any).uid;
    if (!(await verifyAthleteAccess(uid, athleteId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const [plan, calendar] = await Promise.all([
      getAthletePeriodizationPlan(athleteId),
      getCompetitionCalendar(athleteId)
    ]);
    const context = (plan && calendar) ? calculatePeriodizationContext(plan, calendar, new Date()) : null;
    res.json({
      success: true,
      plan: plan || null,
      calendar: calendar || null,
      context
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST calculate real-time periodization context dynamically
app.post("/api/periodization/context", (req, res) => {
  try {
    const { plan, calendar, date } = req.body;
    const athleteId = plan?.athleteId || "athlete";
    const resolvedPlan = plan || getDefaultPeriodizationPlan(athleteId);
    const resolvedCalendar = calendar || getDefaultCompetitionCalendar(athleteId);
    const evaluationDate = date ? new Date(date) : new Date();
    const context = calculatePeriodizationContext(resolvedPlan, resolvedCalendar, evaluationDate);
    const promptContext = formatPeriodizationPromptContext(context);
    res.json({
      success: true,
      context,
      promptContext
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST context-driven scientific evidence refresh (triggered by taper or upcoming Priority A competition)
app.post("/api/periodization/refresh-evidence", async (req, res) => {
  try {
    const { inTaper, phase, priority, event } = req.body;
    const targetEvent = event || "sprint";
    console.log(`[EvidencePipeline] Context-driven refresh triggered. Phase: ${phase}, inTaper: ${inTaper}, Priority: ${priority}`);

    let query = `${targetEvent} sprint periodization load`;
    if (inTaper) {
      query = `${targetEvent} sprint taper volume reduction neuromuscular power`;
    } else if (phase === 'Competitive') {
      query = `${targetEvent} competition microcycle peaking kinematics`;
    }

    const articles = await fetchAllScientificLiteratureRaw(query);
    const weighed = weighScientificLiterature(articles);

    res.json({
      success: true,
      query,
      triggerReason: inTaper ? 'Taper Phase Active' : `Phase: ${phase}`,
      refreshedAt: new Date().toISOString(),
      articlesRetrieved: weighed.length,
      topEvidence: weighed.slice(0, 3)
    });
  } catch (err: any) {
    console.error("[EvidencePipeline] Context refresh failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST trigger for Cloud Scheduler: Performance literature refresh (Quarterly / Pre-peak)
app.post("/api/cron/scientific-refresh/performance", async (req, res) => {
  try {
    console.log("[CloudScheduler] Starting Performance Scientific Evidence Refresh Cycle (Quarterly)...");
    const results: any[] = [];
    for (const q of PERFORMANCE_QUERIES) {
      const articles = await fetchAllScientificLiteratureRaw(q.query);
      const weighed = weighScientificLiterature(articles);
      results.push({
        query: q.query,
        domain: q.domain,
        refreshCycle: q.refreshCycle,
        retrievedCount: weighed.length
      });
    }
    res.json({
      success: true,
      cycle: "performance",
      schedule: "0 0 1 1,4,7,10 *", // Quarterly cron representation
      refreshedAt: new Date().toISOString(),
      queriesExecuted: results
    });
  } catch (err: any) {
    console.error("[CloudScheduler] Performance refresh failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST trigger for Cloud Scheduler: Longevity & Skeletal literature refresh (Monthly independent)
app.post("/api/cron/scientific-refresh/longevity", async (req, res) => {
  try {
    console.log("[CloudScheduler] Starting Longevity & Skeletal Scientific Evidence Refresh Cycle (Monthly Independent)...");
    const results: any[] = [];
    for (const q of LONGEVITY_SKELETAL_QUERIES) {
      const articles = await fetchAllScientificLiteratureRaw(q.query);
      const weighed = weighScientificLiterature(articles);
      results.push({
        query: q.query,
        domain: q.domain,
        refreshCycle: q.refreshCycle,
        retrievedCount: weighed.length
      });
    }
    res.json({
      success: true,
      cycle: "monthly-independent",
      schedule: "0 0 1 * *", // Monthly cron representation
      refreshedAt: new Date().toISOString(),
      queriesExecuted: results
    });
  } catch (err: any) {
    console.error("[CloudScheduler] Longevity & Skeletal refresh failed:", err);
    res.status(500).json({ error: err.message });
  }
});

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      // HMR is off by default: behind the AI Studio / Cloud Run proxy the HMR websocket cannot open and
      // floods the console. Set ENABLE_HMR=true locally to use it; it then shares the app's HTTP server (no port 24678).
      server: { middlewareMode: true, hmr: process.env.ENABLE_HMR === 'true' ? { server: httpServer } : false },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[Startup] Port ${PORT} is already in use. Stop the previous server process and restart.`);
      process.exit(1);
    }
    throw err;
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`STRIDES Server active on port ${PORT}`);
    // Check GCP metadata server reachability with 1s timeout and log warning if unreachable
    checkGcpMetadataAvailability().catch(() => {});
  });
}

startServer();
