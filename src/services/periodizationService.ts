/**
 * ARIA Periodization and Competition Calendar Service
 * Handles macrocycle, mesocycles, competition timelines, taper tracking,
 * and dynamic context computation for training load recommendations.
 */

import { 
  AthletePeriodizationPlan, 
  CompetitionCalendar, 
  PeriodizationContext, 
  Mesocycle, 
  Competition 
} from '../types';

/**
 * Returns a realistic default 2026 periodization plan if none is yet saved for the athlete.
 */
export function getDefaultPeriodizationPlan(athleteId: string): AthletePeriodizationPlan {
  return {
    athleteId,
    season: '2026',
    createdBy: 'coach',
    lastUpdated: new Date().toISOString(),
    macrocycle: {
      startDate: '2026-01-06',
      endDate: '2026-11-15',
      goal: 'Juegos Nacionales / Selección Nacional'
    },
    mesocycles: [
      {
        name: 'Preparación General (GPP)',
        startDate: '2026-01-06',
        endDate: '2026-02-16',
        phase: 'GPP',
        weeklyVolumeTarget: 'alto',
        weeklyIntensityTarget: 'bajo-moderado',
        focusNotes: 'Base aeróbica, hipertrofia funcional, fuerza general, mecánica básica'
      },
      {
        name: 'Preparación Específica (SPP)',
        startDate: '2026-02-17',
        endDate: '2026-04-12',
        phase: 'SPP',
        weeklyVolumeTarget: 'moderado-alto',
        weeklyIntensityTarget: 'alto',
        focusNotes: 'Velocidad específica, aceleración, RFD, S&C específico y resiliencia excéntrica'
      },
      {
        name: 'Pre-Competitivo / Calificación',
        startDate: '2026-04-13',
        endDate: '2026-06-14',
        phase: 'SPP',
        weeklyVolumeTarget: 'moderado',
        weeklyIntensityTarget: 'alto-muy alto',
        focusNotes: 'Tolerancia al lactato, ritmo de prueba, elasticidad reactiva, meets de control'
      },
      {
        name: 'Competitivo Principal & Taper',
        startDate: '2026-06-15',
        endDate: '2026-08-30',
        phase: 'Competitive',
        weeklyVolumeTarget: 'bajo-moderado (reducción 40-60% en taper)',
        weeklyIntensityTarget: 'pico (alta velocidad, descansos completos)',
        focusNotes: 'Afilamiento neuromuscular, supercompensación, ejecución técnica bajo presión'
      },
      {
        name: 'Transición y Regeneración',
        startDate: '2026-08-31',
        endDate: '2026-10-15',
        phase: 'Transition',
        weeklyVolumeTarget: 'muy bajo',
        weeklyIntensityTarget: 'bajo',
        focusNotes: 'Salud articular, remodelado óseo, descanso activo y cross-training ligero'
      }
    ]
  };
}

/**
 * Returns a default 2026 competition calendar if none is yet saved.
 */
export function getDefaultCompetitionCalendar(athleteId: string): CompetitionCalendar {
  return {
    athleteId,
    competitions: [
      {
        name: 'Meet Regional Control',
        date: '2026-04-20',
        priority: 'C',
        events: ['100m', '200m'],
        taperStartDate: null
      },
      {
        name: 'Campeonato Nacional Clasificatorio',
        date: '2026-06-06',
        priority: 'B',
        events: ['200m', '400m'],
        taperStartDate: '2026-05-30'
      },
      {
        name: 'Juegos Nacionales U20 / Selección',
        date: '2026-08-15',
        priority: 'A',
        events: ['400m', '400mH'],
        taperStartDate: '2026-08-05'
      }
    ]
  };
}

/**
 * Calculates current periodization context in real-time according to system specification:
 * - Current active mesocycle
 * - Current week within active mesocycle
 * - Next upcoming competition and priority
 * - Days remaining to next competition
 * - Active taper state flag
 */
export function calculatePeriodizationContext(
  plan: AthletePeriodizationPlan,
  calendar: CompetitionCalendar,
  today: Date = new Date()
): PeriodizationContext {
  const todayStr = today.toISOString().split('T')[0];
  const todayTime = today.getTime();

  // Find active mesocycle
  const currentMesocycle = (plan.mesocycles || []).find(m => {
    const start = new Date(m.startDate).getTime();
    const end = new Date(m.endDate + 'T23:59:59').getTime();
    return todayTime >= start && todayTime <= end;
  }) || null;

  // Calculate current week of mesocycle if active
  let currentWeekOfMesocycle: number | null = null;
  if (currentMesocycle) {
    const mesoStart = new Date(currentMesocycle.startDate).getTime();
    const elapsedDays = Math.max(0, Math.floor((todayTime - mesoStart) / (1000 * 60 * 60 * 24)));
    currentWeekOfMesocycle = Math.floor(elapsedDays / 7) + 1;
  }

  // Find next upcoming competition (future or today)
  const upcomingComps = (calendar.competitions || [])
    .filter(c => {
      const compDate = new Date(c.date + 'T23:59:59').getTime();
      return compDate >= todayTime;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const nextCompetition = upcomingComps[0] || null;

  let daysToNextComp: number | null = null;
  if (nextCompetition) {
    const compTime = new Date(nextCompetition.date + 'T00:00:00').getTime();
    daysToNextComp = Math.max(0, Math.ceil((compTime - todayTime) / (1000 * 60 * 60 * 24)));
  }

  // Evaluate if athlete is currently in taper
  let inTaper = false;
  if (nextCompetition && nextCompetition.taperStartDate) {
    const taperStartTime = new Date(nextCompetition.taperStartDate + 'T00:00:00').getTime();
    const compEndTime = new Date(nextCompetition.date + 'T23:59:59').getTime();
    inTaper = todayTime >= taperStartTime && todayTime <= compEndTime;
  }

  return {
    currentMesocycle,
    nextCompetition,
    daysToNextComp,
    inTaper,
    currentWeekOfMesocycle
  };
}

/**
 * Formats periodization and competition context for ARIA prompt injection
 */
export function formatPeriodizationPromptContext(context: PeriodizationContext): {
  planPeriodizacionText: string;
  calendarioCompetenciaText: string;
} {
  const { currentMesocycle, nextCompetition, daysToNextComp, inTaper, currentWeekOfMesocycle } = context;

  const planPeriodizacionText = currentMesocycle
    ? `Bloque/Mesociclo actual: "${currentMesocycle.name}" (Fase: ${currentMesocycle.phase})
Semana del bloque: Semana ${currentWeekOfMesocycle || 1} (${currentMesocycle.startDate} a ${currentMesocycle.endDate})
Volumen planificado: ${currentMesocycle.weeklyVolumeTarget}
Intensidad planificada: ${currentMesocycle.weeklyIntensityTarget}
Enfoque táctico: ${currentMesocycle.focusNotes}
Estado de Taper: ${inTaper ? 'ACTIVO (EN FASE DE TAPER PRE-COMPETITIVO - PROHIBIDO METER NUEVA CARGA O VOLUMEN)' : 'No activo'}`
    : `No hay mesociclo activo registrado para la fecha actual. Operando con prescripción de mantenimiento base.`;

  const calendarioCompetenciaText = nextCompetition
    ? `Próxima competencia: "${nextCompetition.name}"
Fecha: ${nextCompetition.date} (${daysToNextComp !== null ? `${daysToNextComp} días restantes` : 'Fecha inminente'})
Prioridad: ${nextCompetition.priority} (A = objetivo principal de temporada, B = secundaria/clasificatoria, C = control/rodaje)
Pruebas objetivo: ${nextCompetition.events.join(', ')}
Inicio de Taper: ${nextCompetition.taperStartDate || 'Sin taper específico (Evento de rodaje/control)'}
Estado actual de Taper: ${inTaper ? 'EN TAPER ACTIVO' : 'Fase regular de entrenamiento'}`
    : `Sin competencias programadas a corto plazo en el calendario.`;

  return {
    planPeriodizacionText,
    calendarioCompetenciaText
  };
}
