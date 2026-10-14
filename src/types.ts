/**
 * STRIDES System Types
 * System for Tactical Race Insight & Data Extraction
 */

export type SprintHurdleDiscipline = 
  | '60m'
  | '100m'
  | '200m'
  | '300mH'
  | '400m'
  | '400mH'
  | '100mH' // female-only
  | '110mH' // male-only
  | '60mH';

export type MiddleDistanceDiscipline = 
  | '800m'
  | '1500m'
  | '3000m'
  | '3000mSC';

export type JumpsDiscipline = 
  | 'Long Jump'
  | 'Triple Jump'
  | 'High Jump'
  | 'Pole Vault';

export type ThrowsDiscipline = 
  | 'Shot Put'
  | 'Discus'
  | 'Hammer'
  | 'Javelin';

export type CombinedDiscipline = 
  | 'Heptathlon' // female-only
  | 'Decathlon';  // male-only

export type TrackDiscipline = 
  | SprintHurdleDiscipline
  | MiddleDistanceDiscipline
  | JumpsDiscipline
  | ThrowsDiscipline
  | CombinedDiscipline;

export const ALL_DISCIPLINES: {
  category: 'Sprints & Hurdles' | 'Middle Distance' | 'Jumps' | 'Throws' | 'Combined Events';
  disciplines: TrackDiscipline[];
}[] = [
  {
    category: 'Sprints & Hurdles',
    disciplines: ['60m', '100m', '200m', '400m', '60mH', '100mH', '110mH', '300mH', '400mH']
  },
  {
    category: 'Middle Distance',
    disciplines: ['800m', '1500m', '3000m', '3000mSC']
  },
  {
    category: 'Jumps',
    disciplines: ['Long Jump', 'Triple Jump', 'High Jump', 'Pole Vault']
  },
  {
    category: 'Throws',
    disciplines: ['Shot Put', 'Discus', 'Hammer', 'Javelin']
  },
  {
    category: 'Combined Events',
    disciplines: ['Decathlon', 'Heptathlon']
  }
];

export const SEX_RESTRICTED_DISCIPLINES: Record<string, 'MALE' | 'FEMALE'> = {
  '100mH': 'FEMALE',
  '110mH': 'MALE',
  'Heptathlon': 'FEMALE',
  'Decathlon': 'MALE'
};

export const THROW_IMPLEMENT_STANDARDS: Record<string, { male: string; female: string }> = {
  'Shot Put': { male: '7.26kg (16 lb)', female: '4.00kg (8.8 lb)' },
  'Discus': { male: '2.00kg', female: '1.00kg' },
  'Hammer': { male: '7.26kg (16 lb)', female: '4.00kg (8.8 lb)' },
  'Javelin': { male: '800g', female: '600g' }
};

export interface PersonalBests {
  [eventOrKey: string]: string | undefined;
}

export interface Anthropometrics {
  heightCm: number;
  weightKg: number;
  inseamCm?: number | null;
  age: number;
  sex?: 'MALE' | 'FEMALE' | string;
}

export interface PowerRecord {
  liftName: string;
  maxKg: number;
  date?: string;
}

export interface DetailedInjuryReport {
  bodypart: string;
  type: string;
  severity: 'MILD' | 'MODERATE' | 'SEVERE' | string;
  date: string;
  status: 'ACTIVE' | 'RESOLVED' | 'REHABILITATING' | string;
  notes?: string;
}

export interface GoalProjection {
  event: TrackDiscipline | string;
  targetMark: string;
  targetDate: string;
}

export interface ChatThread {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview?: string;
  keyFactSummary?: string;
  messageCount?: number;
}

export interface AttachedFile {
  url: string;
  type: string;
  name: string;
  size?: number;
  publicId?: string;
  uploadedAt?: string;
  expired?: boolean;
  driveFileId?: string;
  thumbnailUrl?: string;
  iconUrl?: string;
  embedUrl?: string;
  mimeType?: string;
  isGoogleDrive?: boolean;
  description?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  fileUrl?: string; // backwards compatibility
  fileType?: string;
  fileName?: string;
  publicId?: string;
  fileExpired?: boolean;
  files?: AttachedFile[]; // multi-file support
  metadata?: {
    isInjuryOnboardingResponse?: boolean;
    isUnsubscribedOnboardingPrompt?: boolean;
    telemetrySynced?: boolean;
    sections?: {
      athleteState?: string;
      programmeAndTactics?: string;
      kinematicInterpretation?: string;
      scientificAnchors?: string;
    };
  };
}

export interface TelemetryCitation {
  id: string;
  title: string;
  authors: string;
  journalOrChannel: string;
  yearOrViews: string;
  doiOrUrl: string;
  type: 'scientific_paper' | 'kinematic_video' | 'strides_coach_data';
  relevanceKey: string;
  belowThreshold?: boolean;
  score?: number;
}

export interface KinematicMetric {
  parameter: string;
  measuredValue: string;
  optimalRange: string;
  status: 'OPTIMAL' | 'DEFICIENT' | 'CRITICAL';
}

export interface VideoAnalysisRecord {
  id: string;
  sessionTitle: string;
  date: string;
  discipline: string;
  kinematicMetrics: KinematicMetric[];
  notes?: string;
  maxVelocityMps?: number;
  groundContactTimeMs?: number;
  stepFrequencyHz?: number;
  strideLengthMeters?: number;
  pelvicTiltDegrees?: number;
  kneeFlexionAtTouchdownDegrees?: number;
}

export interface CoachMethodologyDoc {
  id: string;
  title: string;
  content: string;
  uploadedAt: string;
  validationStatus: 'VALIDATED' | 'PARTIALLY_VALIDATED' | 'UNVERIFIED';
  verifiedClaims: string[];
  unverifiedClaims: string[];
}

export type OnboardingGateMode = 'full' | 'partial' | 'none';

export interface OnboardingGateDecision {
  showModal: boolean;
  mode: OnboardingGateMode;
  hasCoreData: boolean;
  hasInjuryHistory: boolean;
}

export interface TelemetrySynthesis {
  timestamp: string;
  mediaPipeKinematics: KinematicMetric[];
  literatureCitations: TelemetryCitation[];
  coachTelemetryCount: number;
}

export interface Club {
  id: string;
  name?: string;
  ownerCoachId: string;
  joinCode: string;
  staffIds: string[];
  memberAthleteIds: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface InferredTrainingContext {
  athleteId: string;
  currentPhase?: MesocyclePhase | string;
  proximityToCompetition?: string;
  nextCompetition?: {
    name?: string;
    date?: string;
    priority?: CompetitionPriority;
  };
  notes?: string;
  lastUpdated: string;
  extractedFromMessage?: string;
}

export interface ClinicalHistoryEntry {
  condition: string;
  diagnosedDate?: string;
  status: 'ACTIVE' | 'MANAGED' | 'RESOLVED';
  notes?: string;
  reportedVia?: 'conversation' | 'attached_document' | 'coach_input';
}

export interface GeneticPredisposition {
  trait: string;
  source?: 'self_reported' | 'genetic_test_document';
  notes?: string;
}

export interface AthleteProfile {
  id: string; // Firebase Auth UID
  email: string;
  name: string;
  isSubscribed: boolean;
  role?: 'ATHLETE' | 'COACH' | string;
  clubId?: string | null; // null = sin afiliación, usa inferredTrainingContext
  inferredTrainingContext?: InferredTrainingContext | null;
  anthropometrics: Anthropometrics;
  targetEvents: (TrackDiscipline | string)[];
  personalBests: PersonalBests;
  powerRecords: PowerRecord[];
  activeInjuries: string[];
  injuryHistory?: DetailedInjuryReport[];
  injuryHistoryReviewed?: boolean;
  kineticDeficiencies: string[];
  clinicalHistory?: ClinicalHistoryEntry[];
  geneticPredispositions?: GeneticPredisposition[];
  videoAnalyses?: VideoAnalysisRecord[];
  coachMethodologyDoc?: CoachMethodologyDoc;
  onboardingComplete: boolean;
  updatedAt: string;
}

export type MesocyclePhase = 'GPP' | 'SPP' | 'Competitive' | 'Taper' | 'Transition';
export type CompetitionPriority = 'A' | 'B' | 'C';

export interface Mesocycle {
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  phase: MesocyclePhase;
  weeklyVolumeTarget: string;
  weeklyIntensityTarget: string;
  focusNotes: string;
}

export interface Macrocycle {
  startDate: string;
  endDate: string;
  goal: string;
}

export interface AthletePeriodizationPlan {
  athleteId: string;
  season: string;
  createdBy: 'athlete' | 'coach' | 'staff';
  lastUpdated: string;
  macrocycle: Macrocycle;
  mesocycles: Mesocycle[];
}

export interface Competition {
  name: string;
  date: string; // YYYY-MM-DD
  priority: CompetitionPriority;
  events: string[];
  taperStartDate?: string | null;
}

export interface CompetitionCalendar {
  athleteId: string;
  competitions: Competition[];
}

export interface PeriodizationContext {
  currentMesocycle: Mesocycle | null;
  nextCompetition: Competition | null;
  daysToNextComp: number | null;
  inTaper: boolean;
  currentWeekOfMesocycle?: number | null;
}
