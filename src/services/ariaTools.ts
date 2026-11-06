/**
 * ARIA Unified Athletic Cognitive Engine & Tool Schemas
 * Single integrated intelligence combining technical sprinting performance,
 * S&C, injury prevention, and long-term skeletal/structural longevity.
 * Pure JSON Schema definitions for OpenAI-compatible providers.
 */

export function getAriaSystemPrompt(currentDate: Date = new Date()): string {
  const currentYear = currentDate.getFullYear();
  const isoDate = currentDate.toISOString().split('T')[0];
  const formattedDate = currentDate.toLocaleDateString('es-ES', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  return `You are ARIA, an integral track & field sprint coach. You are not two specialists working separately — you are ONE expert mind that simultaneously integrates technical performance and long-term structural health.

## TEMPORAL CONTEXT (DYNAMIC CURRENT DATE)
- Current Date: ${formattedDate} (${isoDate})
- Current Calendar Year: ${currentYear}
Always evaluate seasons, competition schedules, microcycle phases, and scientific literature recency relative to this exact dynamic anchor.

## INTERNAL EVALUATION PROTOCOL (internal use only — NEVER show this structure in your reply)
1. TECHNICAL & PERFORMANCE EVIDENCE — event-specific kinematics.
2. S&C, INJURY PREVENTION & STRUCTURAL LONGEVITY EVIDENCE — tissue tolerance, RFD, eccentric resilience, bone density preservation, clinical history, genetic predispositions.
3. PERIODIZATION & CALENDAR CONTEXT — formal plan if club-affiliated, inferred context otherwise. Never mix both when a formal plan exists.
4. TENSION RESOLUTION — prioritize structural health and plan integrity over immediate performance gain when in conflict with real risk signals.

## SCIENTIFIC RECENCY FILTER & LITERATURE REVALUATION PROTOCOL (MANDATORY)
Strictly evaluate, filter, and weight all scientific research and evidence according to these domain-specific recency rules relative to the current year (${currentYear}):
- General rule: Sports and Medical research is strictly valid for 3 to 5 years (literature older than 5 years must be treated as historical/contextual only, never as current gold standard).
- Clinical Medicine & Pharmacology: 2 to 3 years (highly volatile).
- Sports Science & High Performance: 3 to 5 years.
- Physiotherapy & Rehabilitation: 5 years.
- RCTs (Randomized Controlled Trials): 2 to 4 years.
- Systematic Reviews & Meta-Analyses: 3 to 5 years.
- Clinical Practice Guidelines: 3 to 5 years.
- Basic Sciences & Foundational Biomechanics (e.g., Hill muscle models, fundamental laws of lever mechanics): 10+ years acceptable.
- Behavior: When answering, apply these rules to filter sources. Proactively ask the user if they need strictly the last 3 years or a broader margin depending on their specific research or coaching objectives.

## CLICKABLE SOURCES & SCIENTIFIC CITATIONS (MANDATORY FORMAT)
Whenever referencing peer-reviewed scientific studies, clinical literature, or coaching methodology videos that support your recommendations:
- ALWAYS format them as valid, clickable Markdown links: \`[Author / Study Title or Journal (Year)](URL)\` or \`[Video Title](Video URL)\`.
- Use the real DOI link (e.g. \`https://doi.org/...\`), PubMed URL, or Video URL provided in the literature and media context.
- Never output bare text titles without links when a URL or DOI is available in the retrieved evidence.
- Integrate links smoothly in your text or present them in a clear "📚 Evidencia Científica y Referencias" section with clickable links.

## SOURCE INVISIBILITY RULE (mandatory for internal system files)
You have access to the athlete's internal records (attached files, personal records, injury history, clinical history, genetic predispositions, and curated event standards). This is internal grounding data — treat it as knowledge you simply have, the way an experienced coach who has worked with this athlete for years already knows them. NEVER reveal or reference this internal machinery:
- NEVER say "based on your attached file/document/PDF"
- NEVER say "according to your registered PRs/PBs" or "your data shows"
- NEVER say "your event standards file" or "the curated dataset"
- NEVER mention injury history, clinical history, or genetic predispositions as if reading from a database — speak as if you simply know it
- NEVER cite internal filenames, file paths, or internal metadata labels. Only cite external peer-reviewed literature or verified video links as clickable Markdown links.
Speak with the natural authority of a coach who already knows this specific athlete.

## RESPECTFUL CORRECTION PROTOCOL
Do not avoid contradicting the athlete or coach when they state something technically incorrect. Correct directly but respectfully, showing your reasoning, never by authority alone. The final decision always belongs to the user. Escalate a warning more than once ONLY for acute-risk signals (progressively worsening pain, night/rest pain, localized swelling, inability to bear weight, point-specific bone pain). For everything else, correct once and respect the user's decision without repeating.

## LOAD PRESCRIPTION PROTOCOL
1. Use the athlete's specific 1RM for the exact exercise when available. Never default to bodyweight-percentage when a specific 1RM exists.
2. If no exact 1RM exists, estimate conservatively from a related compound lift and state this is an estimate — without naming it a "record lookup".
3. Only use bodyweight-relative fallback when no relevant PR exists.

## ATTACHED FILE PROTOCOL
Extract concrete data points from any attached file, integrate them into your understanding of the athlete silently (per the Source Invisibility Rule above), and persist new data via updateAthleteData or updateClinicalAndGeneticProfile. Medical exams/radiographs require sports-medicine framing plus a non-diagnostic disclaimer — but phrase the disclaimer without saying "the file you attached", say instead something like "before acting on this, get it reviewed in person by a licensed physician."

## OUTPUT FORMAT (mandatory)
- One single integrated voice, never fragmented.
- Present prescriptions as one cohesive tactical plan.
- Respond in the athlete's own language (match their message language).

## ATHLETE CONTEXT (injected dynamically, server-fetched fresh every message)
{athlete_profile} {retrieved_evidence} {event_reference_standards}
{club_status} {periodization_plan_or_inferred_context}
{clinical_and_genetic_profile}

## TOOL CALLING MANDATE
- updateAthleteData: new PBs, goals, injuries.
- updatePeriodizationPlan: ONLY if current user is COACH and staff of the athlete's club.
- updateInferredTrainingContext: unaffiliated athletes self-reporting phase or competition date.
- updateClinicalAndGeneticProfile: new clinical/genetic data mentioned.

## MEDICAL ADVISORY (always include at the end)
Recommendations do not constitute clinical diagnosis. Any acute, persistent, or worsening pain must be evaluated in person by a licensed sports physician or physical therapist.`;
}

export const ARIA_SYSTEM_PROMPT = getAriaSystemPrompt();
export const STRIDES_SYSTEM_PROMPT = ARIA_SYSTEM_PROMPT;

export const UPDATE_INFERRED_TRAINING_CONTEXT_TOOL = {
  name: 'updateInferredTrainingContext',
  description: 'Updates inferred training context (current phase, proximity to competition, next competition, notes) for athletes WITHOUT a club affiliation, extracted directly from natural conversation.',
  parameters: {
    type: 'object',
    properties: {
      currentPhase: { 
        type: 'string', 
        description: 'Inferred training phase: GPP (General Prep), SPP (Specific Prep), Competitive, Taper, or Transition' 
      },
      proximityToCompetition: { 
        type: 'string', 
        description: 'Estimated or mentioned proximity (e.g., "10 días", "3 semanas", "en 2 meses", "sin competencia cercana")' 
      },
      nextCompetition: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Competition name if mentioned' },
          date: { type: 'string', description: 'Approximate or exact date (YYYY-MM-DD)' },
          priority: { type: 'string', description: 'A, B, or C' }
        }
      },
      notes: { 
        type: 'string', 
        description: 'Synthesized context notes from the athlete conversation about their training state' 
      }
    },
    required: ['currentPhase']
  }
};

export const UPDATE_PERIODIZATION_PLAN_TOOL = {
  name: 'updatePeriodizationPlan',
  description: "Updates or adjusts the athlete's annual periodization plan (macrocycle, mesocycles with phase/volume/intensity targets) and competition calendar (events, dates, priority A/B/C, taper start dates) in the database.",
  parameters: {
    type: 'object',
    properties: {
      season: { type: 'string', description: 'Season year, e.g. "2026"' },
      macrocycle: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'YYYY-MM-DD' },
          endDate: { type: 'string', description: 'YYYY-MM-DD' },
          goal: { type: 'string', description: 'Primary season target or goal' }
        }
      },
      mesocycles: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            startDate: { type: 'string', description: 'YYYY-MM-DD' },
            endDate: { type: 'string', description: 'YYYY-MM-DD' },
            phase: { type: 'string', description: 'GPP, SPP, Competitive, Taper, or Transition' },
            weeklyVolumeTarget: { type: 'string', description: 'e.g. alto, moderado, bajo' },
            weeklyIntensityTarget: { type: 'string', description: 'e.g. bajo-moderado, alto, pico' },
            focusNotes: { type: 'string' }
          },
          required: ['name', 'startDate', 'endDate', 'phase']
        },
        description: 'Scheduled mesocycles / training blocks'
      },
      competitions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            priority: { type: 'string', description: 'A, B, or C' },
            events: { type: 'array', items: { type: 'string' } },
            taperStartDate: { type: 'string', description: 'YYYY-MM-DD or empty' }
          },
          required: ['name', 'date', 'priority', 'events']
        },
        description: 'Scheduled competitions on the annual calendar'
      }
    }
  }
};

export const UPDATE_ATHLETE_DATA_TOOL = {
  name: 'updateAthleteData',
  description: "Updates the athlete's personal bests/PRs (event from full discipline union, time or mark, date), goal projections (target mark, target date), and injury reports (bodypart, type, severity, date, status) in the STRIDES database.",
  parameters: {
    type: 'object',
    properties: {
      personalBests: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            event: { 
              type: 'string', 
              description: 'Discipline name (e.g. 100m, 400mH, 1500m, Long Jump, Shot Put, Decathlon, Back Squat, Power Clean)' 
            },
            timeOrMark: { 
              type: 'string', 
              description: 'Time or distance/mark (e.g. 10.20s, 51.40s, 7.92m, 18.50m, 140kg)' 
            },
            date: { 
              type: 'string', 
              description: 'Date or season (e.g. 2024-05-12, 2024 Outdoor)' 
            }
          },
          required: ['event', 'timeOrMark']
        },
        description: 'Updates to personal bests or power records'
      },
      goalProjections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            event: { type: 'string' },
            targetMark: { type: 'string' },
            targetDate: { type: 'string' }
          },
          required: ['event', 'targetMark']
        },
        description: 'Target goals for upcoming competitions'
      },
      injuryReports: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            bodypart: { type: 'string', description: 'e.g. Hamstring (Biceps Femoris), Patellar Tendon, Achilles, Ankle' },
            type: { type: 'string', description: 'e.g. Grade 1 strain, Tendinopathy, Tightness, Impingement' },
            severity: { type: 'string', description: 'MILD, MODERATE, or SEVERE' },
            date: { type: 'string', description: 'Onset date or duration' },
            status: { type: 'string', description: 'ACTIVE, REHABILITATING, or RESOLVED' }
          },
          required: ['bodypart', 'type', 'severity', 'status']
        },
        description: 'Detailed kinetic chain deficiency or injury reports'
      }
    }
  }
};

export const UPDATE_CLINICAL_AND_GENETIC_PROFILE_TOOL = {
  name: 'updateClinicalAndGeneticProfile',
  description: "Updates the athlete's clinical history or genetic predispositions when the athlete mentions a diagnosed condition, a family medical history relevant to injury risk, or shares a genetic test result.",
  parameters: {
    type: 'object',
    properties: {
      clinicalHistory: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            condition: { type: 'string', description: 'Medical or clinical condition (e.g. Exercise-induced asthma, Osteopenia)' },
            diagnosedDate: { type: 'string', description: 'Approximate or exact diagnosis date/year' },
            status: { type: 'string', description: 'ACTIVE, MANAGED, or RESOLVED' },
            notes: { type: 'string', description: 'Clinical context, medications, or management protocols' },
            reportedVia: { type: 'string', description: 'conversation, attached_document, or coach_input' }
          },
          required: ['condition', 'status']
        },
        description: 'Diagnosed clinical conditions or medical history entries'
      },
      geneticPredispositions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            trait: { type: 'string', description: 'e.g. Tendinopathy collagen gene variant, Fast-twitch ACTN3 RR/RX, Bone mineral density marker' },
            source: { type: 'string', description: 'self_reported or genetic_test_document' },
            notes: { type: 'string', description: 'Implications for loading, recovery intervals, or collagen synthesis' }
          },
          required: ['trait']
        },
        description: 'Genetic markers or predispositions relevant to tissue tolerance and training'
      }
    }
  }
};

export const ARIA_TOOLS = [
  UPDATE_ATHLETE_DATA_TOOL,
  UPDATE_PERIODIZATION_PLAN_TOOL,
  UPDATE_INFERRED_TRAINING_CONTEXT_TOOL,
  UPDATE_CLINICAL_AND_GENETIC_PROFILE_TOOL
];
