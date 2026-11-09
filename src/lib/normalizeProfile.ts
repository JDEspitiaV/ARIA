import { 
  AthleteProfile, 
  TrackDiscipline, 
  PowerRecord 
} from '../types';

/**
 * Normalizes legacy Firestore user documents into the standardized AthleteProfile schema.
 * STRICT POLICY: NEVER synthesize or fabricate physical measurements or data.
 * Inseam (trocanteric length) provides femoral lever proportions for biomechanical calculations.
 */
export function normalizeProfile(athleteId: string, raw: any): { profile: AthleteProfile; needsSave: boolean } {
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
  if (!heightCm) {
    heightCm = parseFloat(rawBio?.heightCm ?? rawBio?.height ?? raw.heightCm ?? raw.height) || 0;
  }
  if (!weightKg) {
    weightKg = parseFloat(rawBio?.weightKg ?? rawBio?.weight ?? raw.weightKg ?? raw.weight) || 0;
  }
  if (inseamCm === null) {
    const parsedInseam = parseFloat(rawBio?.inseamCm ?? rawBio?.inseam ?? raw.inseamCm ?? raw.inseam);
    inseamCm = !isNaN(parsedInseam) && parsedInseam > 0 ? parsedInseam : null;
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
    clubId: raw.clubId !== undefined ? raw.clubId : null,
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
    onboardingComplete: raw.onboardingComplete === true ? true : Boolean(raw.onboardingComplete || raw.isOnboarded || raw.onboarded),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString()
  };

  return { profile: normalizedProfile, needsSave };
}
