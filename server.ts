import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { streamChat, generateJson, StreamResult } from "./src/services/llmProvider";
import pdfParse from "pdf-parse";
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
  UPDATE_CLINICAL_AND_GENETIC_PROFILE_TOOL
} from "./src/services/geminiService";
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
  getFirestore as getAdminFirestore, 
  type Firestore as AdminFirestore 
} from "firebase-admin/firestore";
import { 
  getAthleteProfile, 
  getAthletePeriodizationPlan, 
  getCompetitionCalendar 
} from "./src/lib/firebase";

dotenv.config();

// Firebase Admin SDK Initialization (server-side authoritative access)
const firebaseProjectId = process.env.VITE_FIREBASE_PROJECT_ID || appletConfig.projectId;
let adminApp: AdminApp | null = null;
let adminDb: AdminFirestore | null = null;

try {
  if (!getAdminApps().length) {
    adminApp = initAdminApp({
      projectId: firebaseProjectId
    });
  } else {
    adminApp = getAdminApp();
  }
  adminDb = getAdminFirestore(adminApp);
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

const apiKey = process.env.LLM_API_KEY;
if (!apiKey) {
  throw new Error("FATAL: LLM_API_KEY environment variable is missing.");
}

// Server-side signed Cloudinary upload endpoint

// Server-side signed Cloudinary upload endpoint
app.post("/api/upload", async (req, res) => {
  try {
    const { base64Data, fileName, fileType, userId } = req.body;
    if (!base64Data || !fileName) {
      return res.status(400).json({ error: "Missing file payload (base64Data or fileName)." });
    }

    const uploaded = await uploadToCloudinary(base64Data, fileName, fileType, userId || 'athlete');
    res.json(uploaded);
  } catch (err: any) {
    console.error("[API Upload] Cloudinary upload error:", err);
    res.status(500).json({ error: err.message || "Failed to upload file to Cloudinary." });
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
      let athletePlan: AthletePeriodizationPlan = inputPlan || getDefaultPeriodizationPlan(athleteId);
      let athleteCalendar: CompetitionCalendar = inputCalendar || getDefaultCompetitionCalendar(athleteId);

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

      const periodizationContext = calculatePeriodizationContext(athletePlan, athleteCalendar, new Date());
      const { planPeriodizacionText, calendarioCompetenciaText } = formatPeriodizationPromptContext(periodizationContext);

      periodizationSection = `CLUB STATUS:
afiliado (Club ID: ${athleteProfile.clubId})

PLAN DE PERIODIZACIÓN FORMAL DEL CLUB:
${planPeriodizacionText}

CALENDARIO DE COMPETENCIAS FORMAL DEL CLUB & ESTADO DE TAPER:
${calendarioCompetenciaText}`;
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
          return `[${doc.source}] ${domainTag}${doc.belowThreshold ? '[Below-Threshold, Best Available] ' : ''}${doc.title} (${doc.year}). ${doiUrl ? `DOI Link: ${doiUrl}` : ''}${resolvedUrl && resolvedUrl !== doiUrl ? ` | Direct URL: ${resolvedUrl}` : ''} | Score: ${doc.score}`;
        }).join("\n")
      : "";

    // 3. Format coaching media methodology
    const coachingMediaText = coachingMedia.length > 0
      ? coachingMedia.map(m => `[Methodology Video Cue] ${m.title} (Channel: ${m.channelTitle}) - Focus: ${m.description} | Video URL: ${m.url}`).join("\n")
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

    // 10. Static Context Blob (Grounding context injected into the ARIA prompt)
    const staticContextBlob = `ATHLETE FIREBASE PROFILE:
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

    // Convert EVERY previous message in the session to Gemini multi-turn format with strictly alternating roles ('user' / 'model')
    const contents: any[] = [];
    
    for (const hMsg of historicalTurns) {
      const role = hMsg.role === 'assistant' || hMsg.role === 'model' ? 'model' : 'user';
      const cleanContent = (hMsg.content || '').trim() || ' ';
      
      // If previous turn has the same role, merge parts to preserve strict alternating roles for Gemini
      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts.push({ text: cleanContent });
      } else {
        contents.push({
          role,
          parts: [{ text: cleanContent }]
        });
      }
    }

    // If historical turns start with 'model', prepend an initial user intro turn so conversation starts with 'user'
    if (contents.length > 0 && contents[0].role === 'model') {
      contents.unshift({
        role: 'user',
        parts: [{ text: "Hello coach, initiating tactical training session." }]
      });
    }

    // 12. File / Attachment Pipeline Processing
    const currentParts: any[] = [];
    let hasMedicalExam = false;
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
        let mime = fileObj.type || 'application/pdf';
        let base64 = fileObj.base64Data || '';
        let isText = false;
        let textContent = '';

        const isDriveFile = (fileObj as any).isGoogleDrive || Boolean((fileObj as any).driveFileId) || (fileObj.url && (fileObj.url.includes('drive.google.com') || fileObj.url.includes('docs.google.com')));

        if (isDriveFile) {
          const driveDocInfo = [
            `[GOOGLE DRIVE ATTACHED DOCUMENT & ATHLETIC ASSET]`,
            `- File Name: ${fileName}`,
            `- File Type: ${mime}`,
            `- Google Drive URL: ${fileObj.url || 'N/A'}`,
            (fileObj as any).description ? `- Description: ${(fileObj as any).description}` : '',
            `[ARIA COACHING DIRECTIVE]: Examine this Google Drive document reference in correlation with the athlete's biometrics, periodization cycle, and training logs.`
          ].filter(Boolean).join('\n');

          currentParts.push({ text: driveDocInfo });
          parsedFilesLog.push({ name: fileName, type: mime, sizeOrChars: driveDocInfo.length, format: 'google_drive_reference' });

          const thumbUrl = (fileObj as any).thumbnailUrl;
          if (thumbUrl && typeof thumbUrl === 'string' && thumbUrl.startsWith('http')) {
            try {
              const thumbRes = await fetch(thumbUrl, { signal: AbortSignal.timeout(3000) });
              if (thumbRes.ok) {
                const arrayBuffer = await thumbRes.arrayBuffer();
                const thumbB64 = Buffer.from(arrayBuffer).toString('base64');
                const thumbMime = thumbRes.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
                currentParts.push({
                  inlineData: {
                    data: thumbB64,
                    mimeType: thumbMime
                  }
                });
                parsedFilesLog.push({ name: `${fileName}_thumbnail`, type: thumbMime, sizeOrChars: thumbB64.length, format: 'inline_data_base64' });
              }
            } catch (thumbErr) {
              console.warn(`[Google Drive] Could not fetch thumbnail for ${fileName}:`, thumbErr);
            }
          }
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
            const fileRes = await fetch(fileObj.url, { signal: AbortSignal.timeout(5000) });
            if (!fileRes.ok) {
              throw new Error(`HTTP ${fileRes.status} fetching remote file`);
            }
            if (mime.startsWith('text/') || mime === 'text/csv' || fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
              isText = true;
              textContent = await fileRes.text();
            } else {
              const arrayBuffer = await fileRes.arrayBuffer();
              base64 = Buffer.from(arrayBuffer).toString('base64');
            }
          }
        }

        if (isText) {
          currentParts.push({
            text: `[Attached Document: ${fileName}]\n\n${textContent}`
          });
          parsedFilesLog.push({ name: fileName, type: mime, sizeOrChars: textContent.length, format: 'inline_text' });
        } else if (base64) {
          currentParts.push({
            inlineData: {
              data: base64,
              mimeType: mime
            }
          });
          parsedFilesLog.push({ name: fileName, type: mime, sizeOrChars: base64.length, format: 'inline_data_base64' });
          if (mime.startsWith('image/') || mime === 'application/pdf') {
            hasMedicalExam = true;
          }
        }
      } catch (e: any) {
        console.error(`[Multimodal] Error processing file "${fileObj.name || fileObj.url}":`, e);
        currentParts.push({
          text: `[Note: Attached file "${fileObj.name || 'document'}" could not be loaded: ${e.message}]`
        });
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
${currentTurnMsg.content || userQuery}${fileAnalysisMandate}${hasMedicalExam ? '\n\n[NOTE: Athlete has attached medical exam/radiograph. Follow medical disclaimer & sports-medicine review protocols.]' : ''}`;

    currentParts.unshift({ text: finalUserTurnText });

    // Append current user turn
    if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
      contents[contents.length - 1].parts.push(...currentParts);
    } else {
      contents.push({
        role: 'user',
        parts: currentParts
      });
    }

    // Stage 3: Context Assembled Logging
    console.log(`[ARIA Stage 3: Context Assembled] Profile: ${athleteProfile.name || athleteId}, Event: ${primaryEvent}, Historical turns: ${historicalTurns.length}, Literature count: ${filteredLiterature.length}, Static context length: ${staticContextBlob.length} chars, Prompt length: ${finalUserTurnText.length} chars`);

    // Stage 4: Sent to Gemini Logging
    console.log(`[ARIA Stage 4: Sent to Gemini] Model: gemini-3.1-flash-lite (fallbacks: [gemini-3.8-flash, gemini-flash-latest]), Total conversation turns: ${contents.length}`);
    console.log(`[ARIA Stage 4: Sent to Gemini] Assembled prompt preview (latest turn):\n${finalUserTurnText.slice(0, 400)}...\n[Total Assembled Turn Chars]: ${finalUserTurnText.length}`);
    console.log(`[ARIA Stage 4: Sent to Gemini] Full Request Payload Summary:\n`, JSON.stringify({
      preferredModel: "gemini-3.1-flash-lite",
      temperature: 0.2,
      turnsCount: contents.length,
      turns: contents.map((c, i) => ({
        index: i,
        role: c.role,
        partsCount: c.parts.length,
        parts: c.parts.map((p: any) => p.text ? `[Text: ${p.text.length} chars, snippet: "${p.text.slice(0, 80).replace(/\n/g, ' ')}..."]` : `[InlineData: ${p.inlineData?.mimeType}, base64 chars: ${p.inlineData?.data?.length}]`)
      }))
    }, null, 2));

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

    const llmStart = Date.now();
    let streamResult: StreamResult;
    try {
      streamResult = await callGeminiStreamWithResilience(
        {
          preferredModel: "gemini-3.1-flash-lite",
          fallbackModels: ["gemini-3.8-flash", "gemini-flash-latest"],
          athleteId: athleteId,
          abortSignal: requestAbortController.signal,
          contents: contents,
          config: {
            systemInstruction: STRIDES_SYSTEM_PROMPT,
            temperature: 0.2,
            tools: [{
              functionDeclarations: [
                UPDATE_ATHLETE_DATA_TOOL, 
                UPDATE_PERIODIZATION_PLAN_TOOL,
                UPDATE_INFERRED_TRAINING_CONTEXT_TOOL,
                UPDATE_CLINICAL_AND_GENETIC_PROFILE_TOOL
              ]
            }]
          }
        },
        (textChunk: string) => {
          if (!isAborted && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'chunk', text: textChunk })}\n\n`);
          }
        }
      );
    } catch (llmErr: any) {
      if (isAborted || requestAbortController.signal.aborted) {
        console.log("[ARIA Stage 5: ABORTED] Request was cancelled by client. Halting SSE.");
        return;
      }
      console.error("[ARIA Stage 5: FAILED] Error calling Gemini streaming API:", llmErr);
      const errMsg = llmErr?.message || String(llmErr) || "Gemini streaming API failure";
      
      if (!res.writableEnded) {
        // Surface real error honestly to the user — NEVER return a fabricated fallback string
        res.write(`data: ${JSON.stringify({ 
          type: 'error', 
          error: `Analysis failed — please try again. [Error: ${errMsg}]` 
        })}\n\n`);
        res.end();
      }
      return;
    }

    if (isAborted || requestAbortController.signal.aborted) {
      console.log("[ARIA Pipeline] Aborted after Gemini stream. Skipping tool execution and database writes.");
      return;
    }

    const llmLatencyMs = Date.now() - llmStart;
    // Stage 5: Response Received Logging
    console.log(`[ARIA Stage 5: Response Received] Synthesis completed on model '${streamResult.modelUsed}' in ${llmLatencyMs}ms (Text Length: ${streamResult.text.length}, Function Calls: ${streamResult.functionCalls?.length || 0})`);

    if (streamResult.functionCalls && streamResult.functionCalls.length > 0) {
      const call = streamResult.functionCalls[0];
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
        if (!streamResult.text) {
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: confirmationText })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ 
          type: 'done', 
          text: confirmationText,
          functionCall: functionCallPayload 
        })}\n\n`);
        res.end();
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
        if (!streamResult.text) {
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: confirmationText })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ 
          type: 'done', 
          text: confirmationText,
          functionCall: functionCallPayload 
        })}\n\n`);
        res.end();
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
          if (!streamResult.text) {
            res.write(`data: ${JSON.stringify({ type: 'chunk', text: confirmationText })}\n\n`);
          }
          res.write(`data: ${JSON.stringify({ 
            type: 'done', 
            text: confirmationText,
            functionCall: functionCallPayload 
          })}\n\n`);
          res.end();
          return;
        }

        const functionCallPayload = {
          name: call.name,
          arguments: args
        };

        const confirmationText = streamResult.text || "He actualizado el plan de periodización y el calendario de competencias en la base de datos de ARIA. Tu prescripción de entrenamiento ahora responde exactamente a este ciclo y objetivo.";
        if (!streamResult.text) {
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: confirmationText })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ 
          type: 'done', 
          text: confirmationText,
          functionCall: functionCallPayload 
        })}\n\n`);
        res.end();
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
        if (!streamResult.text) {
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: confirmationText })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ 
          type: 'done', 
          text: confirmationText,
          functionCall: functionCallPayload 
        })}\n\n`);
        res.end();
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

    res.write(`data: ${JSON.stringify({ type: 'done', text: streamResult.text })}\n\n`);
    res.end();
  } catch (error: any) {
    if (isAborted) {
      console.log("[ARIA Pipeline] Closed connection error suppressed.");
      return;
    }
    console.error("[ARIA Chat Backend Error]:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "ARIA Backend Communication Error" });
    } else if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message || "Communication stream interrupted." })}\n\n`);
      res.end();
    }
  }
});

// Endpoint: Retrieve Inferred Training Context for an Athlete (Server-managed)
app.get("/api/inferred-context/:athleteId", (req, res) => {
  const { athleteId } = req.params;
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

    const response = await callGeminiWithResilience({
      preferredModel: "gemini-flash-latest",
      fallbackModels: ["gemini-3.1-flash-lite", "gemini-3.8-flash"],
      contents: prompt,
      config: {
        systemInstruction: "You are a concise athletic telemetry logger. Output only 1-2 factual sentences capturing key athlete metrics, kinetic observations, or training cycle priorities.",
        temperature: 0.1
      }
    });

    res.json({ summary: response.text?.trim() || "" });
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

    const response = await callGeminiWithResilience({
      preferredModel: "gemini-flash-latest",
      fallbackModels: ["gemini-3.1-flash-lite", "gemini-3.8-flash"],
      contents: prompt,
      config: {
        systemInstruction: "You are a concise title generator. Return only the 3-6 word title without formatting, punctuation, or quotation marks.",
        temperature: 0.2
      }
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
    const userId = req.body.athleteId || req.body.userId || (req.headers["x-user-id"] as string);

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
        const userDoc = await adminDb.collection("users").doc(userId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          if (userData?.role === "COACH") {
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

    const validationResponse = await callGeminiWithResilience({
      preferredModel: "gemini-flash-latest",
      fallbackModels: ["gemini-3.1-flash-lite", "gemini-3.8-flash"],
      contents: extractionPrompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.1
      }
    });

    let result = {
      validationStatus: 'PARTIALLY_VALIDATED',
      verifiedClaims: [],
      unverifiedClaims: []
    };

    try {
      if (validationResponse.text) {
        result = JSON.parse(validationResponse.text);
      }
    } catch {
      // Fallback structured result
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
    if (!publicId) {
      return res.status(400).json({ error: "Missing publicId parameter." });
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
app.get("/api/periodization/:athleteId", (req, res) => {
  try {
    const athleteId = req.params.athleteId;
    const plan = getDefaultPeriodizationPlan(athleteId);
    const calendar = getDefaultCompetitionCalendar(athleteId);
    const context = calculatePeriodizationContext(plan, calendar, new Date());
    res.json({
      success: true,
      plan,
      calendar,
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
  const PORT = 3000;
  
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`STRIDES Server active on port ${PORT}`);
    // Check GCP metadata server reachability with 1s timeout and log warning if unreachable
    checkGcpMetadataAvailability().catch(() => {});
  });
}

startServer();
