import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  signInWithRedirect, 
  getRedirectResult,
  GoogleAuthProvider, 
  OAuthProvider,
  signOut, 
  User 
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  deleteDoc,
  updateDoc,
  increment,
  arrayUnion,
  arrayRemove,
  getCountFromServer,
  runTransaction
} from 'firebase/firestore';
import { 
  AthleteProfile, 
  ChatMessage, 
  ChatThread, 
  AttachedFile, 
  TrackDiscipline, 
  PowerRecord,
  AthletePeriodizationPlan,
  CompetitionCalendar,
  Club,
  InferredTrainingContext
} from '../types';
import appletConfig from '../../firebase-applet-config.json';

const metaEnv = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {};
const procEnv = (typeof process !== 'undefined' && process.env) || {};

const firebaseConfig = {
  apiKey: metaEnv.VITE_FIREBASE_API_KEY || procEnv.VITE_FIREBASE_API_KEY || appletConfig.apiKey,
  authDomain: metaEnv.VITE_FIREBASE_AUTH_DOMAIN || procEnv.VITE_FIREBASE_AUTH_DOMAIN || appletConfig.authDomain,
  projectId: metaEnv.VITE_FIREBASE_PROJECT_ID || procEnv.VITE_FIREBASE_PROJECT_ID || appletConfig.projectId,
  storageBucket: metaEnv.VITE_FIREBASE_STORAGE_BUCKET || procEnv.VITE_FIREBASE_STORAGE_BUCKET || appletConfig.storageBucket || `${appletConfig.projectId}.appspot.com`,
  messagingSenderId: metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || procEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || appletConfig.messagingSenderId,
  appId: metaEnv.VITE_FIREBASE_APP_ID || procEnv.VITE_FIREBASE_APP_ID || appletConfig.appId
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app, (appletConfig as any).firestoreDatabaseId || "ai-studio-2e02a69f-fc8d-46cd-bbc1-146c884acf19");

export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/drive.file');
googleProvider.addScope('https://www.googleapis.com/auth/drive.metadata.readonly');

export const driveProvider = new GoogleAuthProvider();
driveProvider.addScope('https://www.googleapis.com/auth/drive.file');
driveProvider.addScope('https://www.googleapis.com/auth/drive.metadata.readonly');

export const microsoftProvider = new OAuthProvider('microsoft.com');
export const appleProvider = new OAuthProvider('apple.com');

let cachedDriveAccessToken: string | null = null;
try {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    cachedDriveAccessToken = window.sessionStorage.getItem('strides_drive_access_token');
  }
} catch {}

export function setCachedDriveToken(token: string | null): void {
  cachedDriveAccessToken = token;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (token) {
        window.sessionStorage.setItem('strides_drive_access_token', token);
      } else {
        window.sessionStorage.removeItem('strides_drive_access_token');
      }
    }
  } catch {}
}

export function getCachedDriveToken(): string | null {
  if (!cachedDriveAccessToken) {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        cachedDriveAccessToken = window.sessionStorage.getItem('strides_drive_access_token');
      }
    } catch {}
  }
  return cachedDriveAccessToken;
}

export async function requestDriveAccessToken(): Promise<string> {
  const existing = getCachedDriveToken();
  if (existing) {
    return existing;
  }
  const result = await signInWithPopup(auth, driveProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('No se pudo obtener el token de acceso de Google Drive.');
  }
  setCachedDriveToken(credential.accessToken);
  return credential.accessToken;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): FirestoreErrorInfo {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('[handleFirestoreError] Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

getRedirectResult(auth).catch(() => {});

/**
 * Standard Consumer OAuth Authentication (Google, Microsoft, Apple).
 */
export async function signInWithSSO(providerType: 'google' | 'microsoft' | 'apple' = 'google'): Promise<User | null> {
  let provider;
  switch (providerType) {
    case 'microsoft': provider = microsoftProvider; break;
    case 'apple': provider = appleProvider; break;
    default: provider = googleProvider; break;
  }

  try {
    const result = await signInWithPopup(auth, provider);
    if (providerType === 'google') {
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setCachedDriveToken(credential.accessToken);
      }
    }
    return result.user;
  } catch (error: any) {
    if (error.code === 'auth/unauthorized-domain') {
      const currentHost = window.location.hostname;
      throw new Error(`Domain not authorized. Add "${currentHost}" to Firebase Console -> Authentication -> Settings -> Authorized domains.`);
    }

    if (
      error.code === 'auth/popup-blocked' || 
      error.code === 'auth/popup-closed-by-user' ||
      error.code === 'auth/cancelled-popup-request'
    ) {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw error;
  }
}

/**
 * Normalizes legacy Firestore user documents into the standardized AthleteProfile schema.
 * STRICT POLICY: NEVER synthesize or fabricate physical measurements or data.
 * Inseam (trocanteric length) provides femoral lever proportions for biomechanical calculations.
 */
function normalizeProfile(athleteId: string, raw: any): { profile: AthleteProfile; needsSave: boolean } {
  let needsSave = false;

  // 1. Biometrics / Anthropometrics
  // PRIMARY SOURCE: raw.anthropometrics (parallel-compatibility standard written by STRIDES & ARIA)
  // FALLBACK SOURCE: raw.biometrics (STRIDES legacy) or raw root-level fields (ARIA legacy)
  const rawAnthro = raw.anthropometrics;
  const rawBio = raw.biometrics;
  
  let heightCm = 0;
  let weightKg = 0;
  let inseamCm: number | null = null;
  let age = 0;
  let sex: 'MALE' | 'FEMALE' | string | undefined = undefined;

  // Primary Anthropometrics resolution
  if (rawAnthro && typeof rawAnthro === 'object') {
    heightCm = parseFloat(rawAnthro.heightCm ?? rawAnthro.height) || 0;
    weightKg = parseFloat(rawAnthro.weightKg ?? rawAnthro.weight) || 0;

    const parsedInseam = parseFloat(rawAnthro.inseamCm ?? rawAnthro.inseam);
    inseamCm = !isNaN(parsedInseam) && parsedInseam > 0 ? parsedInseam : null;

    if (rawAnthro.age && !isNaN(parseInt(rawAnthro.age, 10))) {
      age = parseInt(rawAnthro.age, 10);
    }
    if (rawAnthro.sex) {
      const rawSexStr = String(rawAnthro.sex).toLowerCase();
      if (rawSexStr === 'male' || rawSexStr === 'men' || rawSexStr === 'm') sex = 'MALE';
      else if (rawSexStr === 'female' || rawSexStr === 'women' || rawSexStr === 'f') sex = 'FEMALE';
      else sex = rawAnthro.sex;
    }
  }

  // Fallback to legacy biometrics or top-level if anthropometrics is absent or incomplete
  if ((!heightCm || !weightKg || inseamCm === null) && (rawBio || raw.height || raw.weight || raw.inseam)) {
    if (!rawAnthro) needsSave = true;
    if (!heightCm) {
      heightCm = parseFloat(rawBio?.height ?? rawBio?.heightCm ?? raw.height ?? raw.heightCm) || 0;
    }
    if (!weightKg) {
      weightKg = parseFloat(rawBio?.weight ?? rawBio?.weightKg ?? raw.weight ?? raw.weightKg) || 0;
    }
    if (inseamCm === null) {
      const parsedInseam = parseFloat(rawBio?.inseam ?? rawBio?.inseamCm ?? raw.inseam ?? raw.inseamCm);
      inseamCm = !isNaN(parsedInseam) && parsedInseam > 0 ? parsedInseam : null;
    }
  }

  // Resolve age from birthYear / birthdate if not already resolved from anthropometrics
  if (!age) {
    if (raw.birthYear && !isNaN(parseInt(raw.birthYear, 10))) {
      age = new Date().getFullYear() - parseInt(raw.birthYear, 10);
    } else if (raw.birthdate) {
      const bDate = new Date(raw.birthdate);
      if (!isNaN(bDate.getTime())) {
        age = Math.floor((Date.now() - bDate.getTime()) / (365.25 * 24 * 3600 * 1000));
      }
    } else if (rawBio?.age && !isNaN(parseInt(rawBio.age, 10))) {
      age = parseInt(rawBio.age, 10);
    }
  }

  // Resolve sex from root fields if not already resolved from anthropometrics
  if (!sex) {
    const rawSexStr = String(raw.sex || raw.gender || rawBio?.sex || '').toLowerCase();
    if (rawSexStr === 'male' || rawSexStr === 'men' || rawSexStr === 'm') {
      sex = 'MALE';
    } else if (rawSexStr === 'female' || rawSexStr === 'women' || rawSexStr === 'f') {
      sex = 'FEMALE';
    } else if (raw.sex || raw.gender || rawBio?.sex) {
      sex = raw.sex || raw.gender || rawBio?.sex;
    }
  }

  // 2. Events / Target Events (Strict rename / map from existing records only)
  let targetEvents: TrackDiscipline[] = [];
  if (Array.isArray(raw.targetEvents) && raw.targetEvents.length > 0) {
    targetEvents = raw.targetEvents;
  } else if (Array.isArray(raw.events) && raw.events.length > 0) {
    needsSave = true;
    targetEvents = raw.events;
  } else if (raw.activeDiscipline) {
    needsSave = true;
    targetEvents = [raw.activeDiscipline];
  } else {
    // Check old ad-hoc keys if explicitly present on document
    const legacyKeyMap: Record<string, TrackDiscipline> = {
      event100m: '100m',
      event200m: '200m',
      event400m: '400m',
      event110mHurdles: '110mH',
      event100mHurdles: '100mH',
      event400mHurdles: '400mH',
      event800m: '800m',
      event1500m: '1500m',
      longJump: 'Long Jump',
      tripleJump: 'Triple Jump',
      highJump: 'High Jump',
      shotPut: 'Shot Put',
      discus: 'Discus'
    };
    for (const [key, disc] of Object.entries(legacyKeyMap)) {
      if (raw[key]) {
        targetEvents.push(disc);
        needsSave = true;
      }
    }
  }

  // 3. PBs / Personal Bests
  // PRIMARY SOURCE: raw.personalBests (Record<string, string> written by STRIDES & ARIA)
  // FALLBACK SOURCE: raw.pbs (array format from STRIDES: [{ distance: 100, time: 10.45 }])
  let personalBests: Record<string, string> = {};
  if (raw.personalBests && typeof raw.personalBests === 'object' && !Array.isArray(raw.personalBests) && Object.keys(raw.personalBests).length > 0) {
    personalBests = raw.personalBests;
  } else if (Array.isArray(raw.pbs) && raw.pbs.length > 0) {
    needsSave = true;
    raw.pbs.forEach((pb: any) => {
      if (pb && (pb.distance || pb.event) && pb.time) {
        const key = pb.event || (pb.hurdles ? `${pb.distance}mH` : `${pb.distance}m`);
        personalBests[key] = typeof pb.time === 'string' && pb.time.endsWith('s') ? pb.time : `${pb.time}s`;
      }
    });
  } else if (raw.personalBests && typeof raw.personalBests === 'object' && !Array.isArray(raw.personalBests)) {
    personalBests = raw.personalBests;
  }

  // 4. Power Records / PRs (Convert exact array entries, no invented values)
  let powerRecords: PowerRecord[] = [];
  if (Array.isArray(raw.powerRecords) && raw.powerRecords.length > 0) {
    powerRecords = raw.powerRecords;
  } else if (Array.isArray(raw.prs)) {
    needsSave = true;
    powerRecords = raw.prs
      .filter((pr: any) => pr && (pr.exercise || pr.liftName) && pr.weightKg !== undefined)
      .map((pr: any) => {
        let liftName = pr.exercise || pr.liftName || 'Lift';
        if (liftName.toLowerCase().includes('clean')) liftName = 'Power Clean';
        else if (liftName.toLowerCase().includes('squat')) liftName = 'Back Squat';
        else if (liftName.toLowerCase().includes('bench')) liftName = 'Bench Press';
        return {
          liftName,
          maxKg: parseFloat(pr.weightKg) || 0,
          date: pr.date || 'Legacy Record'
        };
      });
  }

  // 5. Subscription Status Evaluation
  // Checks all shapes used across STRIDES StripeCheckout & ARIA:
  // - isSubscribed (boolean)
  // - subscribed (boolean)
  // - subscriptionStatus ("active" | "trialing")
  // - subscription.status ("active" | "trialing")
  // - stripe.status ("active")
  // - stripeSubscriptionId
  // - coach role (exempt / full access)
  const isSubscribed = Boolean(
    raw.isSubscribed === true ||
    raw.subscribed === true ||
    raw.subscriptionStatus === 'active' ||
    raw.subscriptionStatus === 'trialing' ||
    raw.subscription?.status === 'active' ||
    raw.subscription?.status === 'trialing' ||
    raw.stripe?.status === 'active' ||
    (typeof raw.subscription === 'boolean' && raw.subscription) ||
    raw.stripeSubscriptionId ||
    raw.tier === 'pro' ||
    raw.tier === 'premium' ||
    raw.role?.toUpperCase() === 'COACH'
  );

  const normalizedProfile: AthleteProfile = {
    id: raw.id || raw.uid || athleteId,
    email: raw.email || '',
    name: raw.name || raw.displayName || `${raw.firstName || ''} ${raw.lastName || ''}`.trim() || 'Athlete',
    isSubscribed,
    role: (raw.role?.toUpperCase() === 'COACH' ? 'COACH' : 'ATHLETE') as 'ATHLETE' | 'COACH',
    anthropometrics: {
      heightCm,
      weightKg,
      inseamCm,
      age,
      sex
    },
    targetEvents,
    personalBests,
    powerRecords,
    activeInjuries: Array.isArray(raw.activeInjuries) ? raw.activeInjuries : [],
    injuryHistory: Array.isArray(raw.injuryHistory) ? raw.injuryHistory : [],
    injuryHistoryReviewed: Boolean(raw.injuryHistoryReviewed || (raw.injuryHistory && raw.injuryHistory.length > 0)),
    kineticDeficiencies: Array.isArray(raw.kineticDeficiencies) ? raw.kineticDeficiencies : [],
    clinicalHistory: Array.isArray(raw.clinicalHistory) ? raw.clinicalHistory : [],
    geneticPredispositions: Array.isArray(raw.geneticPredispositions) ? raw.geneticPredispositions : [],
    videoAnalyses: Array.isArray(raw.videoAnalyses) ? raw.videoAnalyses : [],
    coachMethodologyDoc: raw.coachMethodologyDoc || undefined,
    onboardingComplete: Boolean(raw.onboardingComplete),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString()
  };

  return { profile: normalizedProfile, needsSave };
}

/**
 * Fetches real athlete profile from Firestore. Migrates legacy schemas transparently on read.
 */
export async function getAthleteProfile(athleteId: string): Promise<AthleteProfile | null> {
  try {
    const profileRef = doc(db, 'users', athleteId);
    const snap = await getDoc(profileRef);
    if (snap.exists()) {
      const raw = snap.data();
      const { profile, needsSave } = normalizeProfile(athleteId, raw);
      
      // One-time migration backfill: persist normalized shape back to Firestore
      if (needsSave || !raw.anthropometrics || !raw.targetEvents) {
        try {
          await updateAthleteProfile(athleteId, profile);
        } catch {}
      }
      
      return profile;
    }
  } catch (err) {
    console.warn('[Firestore] Error getting athlete profile:', err);
  }
  return null;
}

/**
 * Recursively removes any undefined keys or properties from an object so Firestore setDoc does not reject with "Unsupported field value: undefined".
 */
export function sanitizeForFirestore<T = any>(obj: T): T {
  if (obj === undefined) return null as unknown as T;
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return (obj as any[])
      .filter(item => item !== undefined)
      .map(item => sanitizeForFirestore(item)) as unknown as T;
  }
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj as Record<string, any>)) {
    if (value !== undefined) {
      clean[key] = sanitizeForFirestore(value);
    }
  }
  return clean as T;
}

/**
 * Creates a clean, empty user record upon initial SSO registration.
 */
export async function initializeUserRecord(user: User): Promise<AthleteProfile> {
  const profileRef = doc(db, 'users', user.uid);
  const snap = await getDoc(profileRef);
  
  if (snap.exists()) {
    return snap.data() as AthleteProfile;
  }

  const cleanProfile: AthleteProfile = {
    id: user.uid,
    email: user.email || '',
    name: user.displayName || 'Athlete',
    isSubscribed: false,
    role: 'ATHLETE',
    anthropometrics: { heightCm: 0, weightKg: 0, inseamCm: 0, age: 0, sex: 'MALE' },
    targetEvents: ['100m', '200m'],
    personalBests: {},
    powerRecords: [],
    activeInjuries: [],
    injuryHistory: [],
    kineticDeficiencies: [],
    onboardingComplete: false,
    updatedAt: new Date().toISOString()
  };

  await setDoc(profileRef, sanitizeForFirestore(cleanProfile), { merge: true });
  return cleanProfile;
}

/**
 * Flattens an object to dot-notation keys for safe Firestore updating without wiping siblings.
 * Ignores any undefined values.
 */
function flattenToDotNotation(obj: any, prefix = ''): any {
  if (!obj || typeof obj !== 'object') return obj;
  return Object.keys(obj).reduce((acc: any, k: string) => {
    const value = obj[k];
    if (value === undefined) {
      return acc;
    }
    const pre = prefix.length ? prefix + '.' : '';
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(acc, flattenToDotNotation(value, pre + k));
    } else {
      acc[pre + k] = sanitizeForFirestore(value);
    }
    return acc;
  }, {});
}

/**
 * Persists updated athlete parameters directly to Firestore using merge-safe setDoc with dot-notation.
 */
export async function updateAthleteProfile(
  athleteId: string, 
  updates: Partial<AthleteProfile>
): Promise<void> {
  const profileRef = doc(db, 'users', athleteId);
  
  const flatUpdates = flattenToDotNotation(updates);
  flatUpdates.updatedAt = new Date().toISOString();

  // Enforce merge: true explicitly
  await setDoc(profileRef, sanitizeForFirestore(flatUpdates), { merge: true });
}

export async function getChatThreads(userId: string): Promise<ChatThread[]> {
  try {
    const activeUserId = auth.currentUser?.uid || userId;
    const threadsRef = collection(db, 'users', activeUserId, 'chatThreads');
    const q = query(threadsRef, orderBy('updatedAt', 'desc'), limit(50));
    const snapshot = await getDocs(q);
    const threads: ChatThread[] = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      threads.push({
        id: docSnap.id,
        userId: activeUserId,
        title: data.title || 'Tactical Session',
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || new Date().toISOString(),
        lastMessagePreview: data.lastMessagePreview || '',
        keyFactSummary: data.keyFactSummary || '',
        messageCount: data.messageCount || 0
      });
    });
    return threads;
  } catch (err: any) {
    handleFirestoreError(err, OperationType.GET, `users/${auth.currentUser?.uid || userId}/chatThreads`);
    console.warn('Failed to get chat threads, falling back to local list:', err);
    return [];
  }
}

export async function createChatThread(userId: string, title = 'New Tactical Session'): Promise<ChatThread> {
  const activeUserId = auth.currentUser?.uid || userId;
  const threadId = `thread_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const newThread: ChatThread = {
    id: threadId,
    userId: activeUserId,
    title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastMessagePreview: '',
    keyFactSummary: '',
    messageCount: 0
  };
  try {
    const threadRef = doc(db, 'users', activeUserId, 'chatThreads', threadId);
    await setDoc(threadRef, newThread, { merge: true });
  } catch (err: any) {
    handleFirestoreError(err, OperationType.WRITE, `users/${activeUserId}/chatThreads/${threadId}`);
    console.warn('Error creating Firestore chat thread:', err);
  }
  return newThread;
}

export async function saveChatThread(userId: string, thread: Partial<ChatThread> & { id: string }): Promise<void> {
  const activeUserId = auth.currentUser?.uid || userId;
  try {
    const threadRef = doc(db, 'users', activeUserId, 'chatThreads', thread.id);
    await setDoc(threadRef, sanitizeForFirestore({ ...thread, updatedAt: new Date().toISOString() }), { merge: true });
  } catch (err: any) {
    handleFirestoreError(err, OperationType.WRITE, `users/${activeUserId}/chatThreads/${thread.id}`);
    console.warn('Error saving chat thread:', err);
  }
}

export async function renameChatThread(userId: string, threadId: string, newTitle: string): Promise<void> {
  const activeUserId = auth.currentUser?.uid || userId;
  try {
    const cleanTitle = newTitle.trim();
    if (!cleanTitle) return;
    const threadRef = doc(db, 'users', activeUserId, 'chatThreads', threadId);
    await setDoc(threadRef, sanitizeForFirestore({ title: cleanTitle, updatedAt: new Date().toISOString() }), { merge: true });
  } catch (err: any) {
    handleFirestoreError(err, OperationType.WRITE, `users/${activeUserId}/chatThreads/${threadId}`);
    console.warn('Error renaming chat thread:', err);
  }
}

export async function deleteChatThread(userId: string, threadId: string): Promise<void> {
  const activeUserId = auth.currentUser?.uid || userId;
  try {
    console.log(`[DEBUG-DB] deleteChatThread preparing to delete doc users/${activeUserId}/chatThreads/${threadId}`);
    const threadRef = doc(db, 'users', activeUserId, 'chatThreads', threadId);
    await deleteDoc(threadRef);
    console.log(`[DEBUG-DB] deleteChatThread deleteDoc completed successfully.`);
  } catch (err: any) {
    handleFirestoreError(err, OperationType.DELETE, `users/${activeUserId}/chatThreads/${threadId}`);
    console.error('[DEBUG-DB] Error deleting chat thread in Firebase:', err);
    throw err;
  }
}

export async function getThreadMessages(userId: string, threadId: string): Promise<ChatMessage[]> {
  const activeUserId = auth.currentUser?.uid || userId;
  try {
    const msgsRef = collection(db, 'users', activeUserId, 'chatThreads', threadId, 'messages');
    const q = query(msgsRef, orderBy('timestamp', 'asc'), limit(100));
    const snapshot = await getDocs(q);
    const messages: ChatMessage[] = [];
    snapshot.forEach(docSnap => {
      messages.push(docSnap.data() as ChatMessage);
    });
    return messages;
  } catch (err: any) {
    handleFirestoreError(err, OperationType.GET, `users/${activeUserId}/chatThreads/${threadId}/messages`);
    console.warn('Error getting thread messages:', err);
    return [];
  }
}

export async function getThreadActualMessageCount(userId: string, threadId: string): Promise<number> {
  const activeUserId = auth.currentUser?.uid || userId;
  if (!activeUserId || !threadId) return -1;
  try {
    const msgsRef = collection(db, 'users', activeUserId, 'chatThreads', threadId, 'messages');
    const countSnapshot = await getCountFromServer(msgsRef);
    const count = countSnapshot.data().count;
    return typeof count === 'number' ? count : 0;
  } catch (err: any) {
    handleFirestoreError(err, OperationType.GET, `users/${activeUserId}/chatThreads/${threadId}/messages`);
    console.warn(`[getThreadActualMessageCount] Aggregation query failed for thread ${threadId}, falling back to getDocs:`, err);
    try {
      const msgsRef = collection(db, 'users', activeUserId, 'chatThreads', threadId, 'messages');
      const snap = await getDocs(msgsRef);
      return snap.size;
    } catch (fallbackErr) {
      console.error(`[getThreadActualMessageCount] Critical error verifying message count for thread ${threadId}:`, fallbackErr);
      // Hard safety rail: If count cannot be verified due to error, return -1 so thread is NEVER treated as empty
      return -1;
    }
  }
}

export function isDefaultThreadTitle(title?: string): boolean {
  if (!title) return true;
  const trimmed = title.trim().toLowerCase();
  return (
    trimmed === 'nueva sesión' ||
    trimmed === 'nueva sesion' ||
    trimmed === 'new tactical session' ||
    trimmed === 'tactical session' ||
    trimmed === 'sesión táctica' ||
    trimmed === 'sesion tactica' ||
    trimmed === 'untitled' ||
    trimmed === 'sin título' ||
    trimmed === 'sin titulo'
  );
}

export async function saveThreadMessage(userId: string, threadId: string, message: ChatMessage): Promise<void> {
  const activeUserId = auth.currentUser?.uid || userId;
  if (!activeUserId || !threadId || !message || !message.id) {
    console.warn('[saveThreadMessage] Missing required arguments for persisting thread message', { activeUserId, threadId, messageId: message?.id });
    return;
  }
  const msgPath = `users/${activeUserId}/chatThreads/${threadId}/messages/${message.id}`;
  const threadPath = `users/${activeUserId}/chatThreads/${threadId}`;
  const msgRef = doc(db, 'users', activeUserId, 'chatThreads', threadId, 'messages', message.id);
  const threadRef = doc(db, 'users', activeUserId, 'chatThreads', threadId);
  const preview = (message.content || '').slice(0, 80).replace(/[#*`\n]/g, ' ').trim() + ((message.content || '').length > 80 ? '...' : '');
  const sanitizedMsg = sanitizeForFirestore(message);
  const nowIso = new Date().toISOString();

  try {
    // Atomic update using Firestore runTransaction to ensure message document & messageCount increment are written together
    await runTransaction(db, async (transaction) => {
      const threadDoc = await transaction.get(threadRef);
      
      // 1. Write message document
      transaction.set(msgRef, sanitizedMsg, { merge: true });

      // 2. Atomically update/increment thread document
      if (threadDoc.exists()) {
        transaction.update(threadRef, {
          messageCount: increment(1),
          lastMessagePreview: preview,
          updatedAt: nowIso
        });
      } else {
        transaction.set(threadRef, sanitizeForFirestore({
          id: threadId,
          userId: activeUserId,
          title: 'Tactical Session',
          createdAt: nowIso,
          updatedAt: nowIso,
          messageCount: 1,
          lastMessagePreview: preview,
          keyFactSummary: ''
        }), { merge: true });
      }
    });
    console.log(`[saveThreadMessage] Message ${message.id} saved & thread ${threadId} messageCount atomically incremented via transaction.`);
  } catch (err: any) {
    console.warn('[saveThreadMessage] Transaction failed, using atomic setDoc/updateDoc fallback:', err?.message || err);
    try {
      await setDoc(msgRef, sanitizedMsg, { merge: true });
      try {
        await updateDoc(threadRef, {
          messageCount: increment(1),
          lastMessagePreview: preview,
          updatedAt: nowIso
        });
      } catch (updateErr) {
        await setDoc(threadRef, sanitizeForFirestore({
          id: threadId,
          userId: activeUserId,
          title: 'Tactical Session',
          createdAt: nowIso,
          updatedAt: nowIso,
          messageCount: 1,
          lastMessagePreview: preview,
          keyFactSummary: ''
        }), { merge: true });
      }
      console.log(`[saveThreadMessage] Fallback saved message & incremented messageCount for thread ${threadId}`);
    } catch (fallbackErr: any) {
      handleFirestoreError(fallbackErr, OperationType.WRITE, msgPath);
      console.error('[saveThreadMessage] Critical error persisting thread message:', fallbackErr);
    }
  }
}

export async function getUserPastThreadFacts(userId: string, currentThreadId?: string): Promise<string[]> {
  try {
    const activeUserId = auth.currentUser?.uid || userId;
    const threadsRef = collection(db, 'users', activeUserId, 'chatThreads');
    const q = query(threadsRef, orderBy('updatedAt', 'desc'), limit(50));
    const snapshot = await getDocs(q);
    const summaries: string[] = [];
    snapshot.forEach(docSnap => {
      if (docSnap.id !== currentThreadId) {
        const data = docSnap.data();
        if (data.keyFactSummary && typeof data.keyFactSummary === 'string' && data.keyFactSummary.trim().length > 0) {
          summaries.push(`[Session: "${data.title || 'Past Session'}"] ${data.keyFactSummary}`);
        }
      }
    });
    return summaries;
  } catch (err) {
    console.warn('Error getting past thread facts:', err);
    return [];
  }
}

export async function saveChatMessage(athleteId: string, message: ChatMessage): Promise<void> {
  const activeUserId = auth.currentUser?.uid || athleteId;
  const msgPath = `users/${activeUserId}/messages/${message.id}`;
  try {
    const msgRef = doc(db, 'users', activeUserId, 'messages', message.id);
    await setDoc(msgRef, sanitizeForFirestore(message), { merge: true });
  } catch (err: any) {
    handleFirestoreError(err, OperationType.WRITE, msgPath);
    console.warn('[saveChatMessage] Error saving chat message:', err);
  }
}

export async function saveVideoAnalysis(athleteId: string, analysis: any): Promise<void> {
  const videoRef = doc(db, 'users', athleteId, 'videoAnalyses', analysis.id);
  await setDoc(videoRef, sanitizeForFirestore(analysis), { merge: true });
}

export async function saveCoachMethodologyDoc(coachId: string, docData: any): Promise<void> {
  const coachRef = doc(db, 'users', coachId);
  await setDoc(coachRef, sanitizeForFirestore({ coachMethodologyDoc: docData, updatedAt: new Date().toISOString() }), { merge: true });
}

export async function logoutUser(): Promise<void> {
  await signOut(auth);
}

export async function deleteThreadMessage(userId: string, threadId: string, messageId: string): Promise<void> {
  try {
    const msgRef = doc(db, 'users', userId, 'chatThreads', threadId, 'messages', messageId);
    await deleteDoc(msgRef);
  } catch (err) {
    console.warn(`Error deleting thread message ${messageId}:`, err);
  }
}

export async function deleteThreadMessages(userId: string, threadId: string, messageIds: string[]): Promise<void> {
  await Promise.all(messageIds.map(id => deleteThreadMessage(userId, threadId, id)));
}

export async function uploadChatFile(uid: string, file: File): Promise<AttachedFile> {
  // Read file as Base64 to transfer securely to server-side Cloudinary upload endpoint
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base64Data,
      fileName: file.name,
      fileType: file.type,
      userId: uid
    })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error || `Upload failed with status ${res.status}`);
  }

  const data = await res.json();
  return {
    url: data.url,
    name: data.name || file.name,
    type: data.type || file.type,
    size: data.size || file.size,
    publicId: data.publicId,
    uploadedAt: new Date().toISOString()
  };
}

export async function uploadChatFiles(uid: string, files: File[]): Promise<AttachedFile[]> {
  // Parallel uploads to Cloudinary via Promise.all
  return Promise.all(files.map(f => uploadChatFile(uid, f)));
}

/**
 * 48-Hour Cloudinary Asset Cleanup:
 * Checks messages across user threads for file attachments older than 48 hours.
 * Calls /api/cloudinary/destroy to delete the raw asset from Cloudinary CDN while
 * keeping the processed text context in Firestore, marking the file as expired.
 */
export async function checkAndCleanupExpiredFiles(userId: string): Promise<number> {
  let cleanedCount = 0;
  const EXPIRATION_MS = 48 * 60 * 60 * 1000; // 48 hours
  const now = Date.now();

  try {
    const threadsRef = collection(db, 'users', userId, 'chatThreads');
    const threadsSnap = await getDocs(query(threadsRef, limit(20)));

    for (const threadDoc of threadsSnap.docs) {
      const msgsRef = collection(db, 'users', userId, 'chatThreads', threadDoc.id, 'messages');
      const msgsSnap = await getDocs(query(msgsRef, limit(50)));

      for (const msgDoc of msgsSnap.docs) {
        const msg = msgDoc.data() as ChatMessage;
        let needsUpdate = false;
        let updatedFiles: AttachedFile[] = [];

        if (Array.isArray(msg.files) && msg.files.length > 0) {
          for (const f of msg.files) {
            const uploadTime = f.uploadedAt ? new Date(f.uploadedAt).getTime() : new Date(msg.timestamp).getTime();
            const isExpired = (now - uploadTime) > EXPIRATION_MS;

            if (isExpired && f.publicId && !f.expired) {
              try {
                // Call server endpoint to destroy from Cloudinary
                await fetch('/api/cloudinary/destroy', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                    publicId: f.publicId, 
                    resourceType: f.type?.startsWith('image') ? 'image' : 'raw' 
                  })
                });
                console.log(`[48h-CLEANUP] Deleted Cloudinary asset: ${f.publicId}`);
                cleanedCount++;
              } catch (delErr) {
                console.warn(`[48h-CLEANUP] Failed deleting Cloudinary asset ${f.publicId}:`, delErr);
              }

              updatedFiles.push({
                ...f,
                url: '',
                expired: true,
                name: `[Archivo original expirado tras 48h - contexto ya incorporado al historial]`
              });
              needsUpdate = true;
            } else {
              updatedFiles.push(f);
            }
          }
        }

        if (needsUpdate) {
          await setDoc(msgDoc.ref, sanitizeForFirestore({
            files: updatedFiles,
            fileExpired: true
          }), { merge: true });
        }
      }
    }
  } catch (err) {
    console.warn('[48h-CLEANUP] Error checking expired files:', err);
  }

  return cleanedCount;
}

/**
 * Retrieves all curated event reference standards from the Firestore collection.
 */
export async function getEventReferenceStandardsFromFirestore(): Promise<any[]> {
  try {
    const colRef = collection(db, 'eventReferenceStandards');
    const snap = await getDocs(colRef);
    if (!snap.empty) {
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
  } catch (err) {
    console.warn('[Firestore] Error fetching eventReferenceStandards:', err);
  }
  return [];
}

/**
 * Saves or updates an event reference standard in Firestore.
 */
export async function saveEventReferenceStandardToFirestore(standard: {
  id: string;
  eventName: string;
  sourceFile: string;
  lastUpdatedByCoach: string;
  content: string;
  keywords?: string[];
}): Promise<void> {
  const docRef = doc(db, 'eventReferenceStandards', standard.id);
  await setDoc(docRef, sanitizeForFirestore({
    id: standard.id,
    eventName: standard.eventName,
    sourceFile: standard.sourceFile,
    lastUpdatedByCoach: standard.lastUpdatedByCoach || new Date().toISOString(),
    content: standard.content,
    keywords: standard.keywords || []
  }), { merge: true });
}

/**
 * Retrieves the athlete's annual periodization plan from Firestore.
 */
export async function getAthletePeriodizationPlan(athleteId: string): Promise<AthletePeriodizationPlan | null> {
  try {
    const docRef = doc(db, 'athletePeriodizationPlans', athleteId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as AthletePeriodizationPlan;
    }
  } catch (err) {
    console.warn('[Firestore] Error getting periodization plan:', err);
  }
  return null;
}

/**
 * Saves or updates an athlete's annual periodization plan in Firestore.
 */
export async function saveAthletePeriodizationPlan(athleteId: string, plan: Partial<AthletePeriodizationPlan>): Promise<void> {
  const docRef = doc(db, 'athletePeriodizationPlans', athleteId);
  await setDoc(docRef, sanitizeForFirestore({
    ...plan,
    athleteId,
    lastUpdated: new Date().toISOString()
  }), { merge: true });
}

/**
 * Retrieves the athlete's competition calendar from Firestore.
 */
export async function getCompetitionCalendar(athleteId: string): Promise<CompetitionCalendar | null> {
  try {
    const docRef = doc(db, 'competitionCalendar', athleteId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as CompetitionCalendar;
    }
  } catch (err) {
    console.warn('[Firestore] Error getting competition calendar:', err);
  }
  return null;
}

/**
 * Saves or updates an athlete's competition calendar in Firestore.
 */
export async function saveCompetitionCalendar(athleteId: string, calendar: Partial<CompetitionCalendar>): Promise<void> {
  const docRef = doc(db, 'competitionCalendar', athleteId);
  await setDoc(docRef, sanitizeForFirestore({
    ...calendar,
    athleteId
  }), { merge: true });
}

/**
 * Retrieves the athlete's conversationally inferred training context from Firestore.
 */
export async function getInferredTrainingContext(athleteId: string): Promise<InferredTrainingContext | null> {
  try {
    const docRef = doc(db, 'inferredTrainingContext', athleteId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as InferredTrainingContext;
    }
  } catch (err) {
    console.warn('[Firestore] Error getting inferred training context:', err);
  }
  return null;
}

/**
 * Retrieves a club by ID.
 */
export async function getClub(clubId: string): Promise<Club | null> {
  try {
    const docRef = doc(db, 'clubs', clubId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as Club;
    }
  } catch (err) {
    console.warn('[Firestore] Error getting club:', err);
  }
  return null;
}

/**
 * Joins an athlete to a club via join code (or initializes standard demonstration club e.g. SANTAFE400).
 */
export async function joinClubByCode(athleteId: string, joinCode: string): Promise<{ success: boolean; club?: Club; error?: string }> {
  try {
    const normalizedCode = joinCode.trim().toUpperCase();
    const clubsRef = collection(db, 'clubs');
    const q = query(clubsRef, where('joinCode', '==', normalizedCode), limit(1));
    const snap = await getDocs(q);

    let clubData: Club;

    if (snap.empty) {
      if (normalizedCode === 'SANTAFE400' || normalizedCode === 'SPRINT100') {
        const newClubId = `club_${normalizedCode.toLowerCase()}`;
        const newClub: Club = {
          id: newClubId,
          name: normalizedCode === 'SANTAFE400' ? 'Santa Fe Speed & Hurdles Club' : 'Velocity Sprint Academy',
          ownerCoachId: 'coach_head_strides',
          joinCode: normalizedCode,
          staffIds: ['coach_head_strides', 'coach_assistant_strides'],
          memberAthleteIds: [athleteId],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        const ref = doc(db, 'clubs', newClubId);
        await setDoc(ref, sanitizeForFirestore(newClub), { merge: true });
        clubData = newClub;
      } else {
        return { success: false, error: 'Código de club no encontrado.' };
      }
    } else {
      const clubDoc = snap.docs[0];
      clubData = clubDoc.data() as Club;
      const ref = doc(db, 'clubs', clubDoc.id);
      await updateDoc(ref, {
        memberAthleteIds: arrayUnion(athleteId),
        updatedAt: new Date().toISOString()
      });
    }

    // Update athlete profile with clubId
    const userRef = doc(db, 'users', athleteId);
    await updateDoc(userRef, {
      clubId: clubData.id,
      updatedAt: new Date().toISOString()
    });

    return { success: true, club: clubData };
  } catch (err: any) {
    console.error('Error joining club:', err);
    return { success: false, error: err?.message || 'Error al unirse al club' };
  }
}

/**
 * Unlinks an athlete from their club, returning them to unaffiliated status.
 */
export async function leaveClub(athleteId: string, clubId: string): Promise<boolean> {
  try {
    const clubRef = doc(db, 'clubs', clubId);
    try {
      await updateDoc(clubRef, {
        memberAthleteIds: arrayRemove(athleteId),
        updatedAt: new Date().toISOString()
      });
    } catch (e) {
      console.warn('Could not update club members array:', e);
    }
    const userRef = doc(db, 'users', athleteId);
    await updateDoc(userRef, {
      clubId: null,
      updatedAt: new Date().toISOString()
    });
    return true;
  } catch (err) {
    console.error('Error leaving club:', err);
    return false;
  }
}


