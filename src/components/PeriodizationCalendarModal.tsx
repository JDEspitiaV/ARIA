import React, { useState, useEffect } from 'react';
import { 
  X, 
  Calendar, 
  Flag, 
  Award, 
  Clock, 
  AlertTriangle, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Save,
  Users,
  Shield,
  LogOut,
  Sparkles,
  Link,
  Info,
  Layers,
  Trophy,
  Target,
  Lock
} from 'lucide-react';
import { 
  AthleteProfile,
  AthletePeriodizationPlan, 
  CompetitionCalendar, 
  PeriodizationContext, 
  Mesocycle, 
  Competition,
  MesocyclePhase,
  CompetitionPriority,
  InferredTrainingContext
} from '../types';

interface PeriodizationCalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
  athlete: AthleteProfile;
  plan: AthletePeriodizationPlan;
  calendar: CompetitionCalendar;
  context: PeriodizationContext;
  inferredContext?: InferredTrainingContext | null;
  onSavePlanAndCalendar: (newPlan: AthletePeriodizationPlan, newCalendar: CompetitionCalendar) => Promise<void>;
  onJoinClub?: (joinCode: string) => Promise<{ success: boolean; error?: string }>;
  onLeaveClub?: () => Promise<boolean>;
}

const getPriorityBadgeClass = (p: CompetitionPriority) => {
  switch (p) {
    case 'A': return 'bg-amber-950/80 border-amber-500 text-amber-300 font-bold';
    case 'B': return 'bg-blue-950/80 border-blue-500 text-blue-300';
    case 'C': return 'bg-zinc-800 border-zinc-700 text-zinc-300';
    default: return 'bg-zinc-800 border-zinc-700 text-zinc-300';
  }
};

const getPhaseBadgeClass = (ph: MesocyclePhase) => {
  switch (ph) {
    case 'GPP': return 'bg-indigo-950/70 border-indigo-500 text-indigo-300';
    case 'SPP': return 'bg-cyan-950/70 border-cyan-500 text-cyan-300';
    case 'Competitive': return 'bg-emerald-950/70 border-emerald-500 text-emerald-300 font-bold';
    case 'Taper': return 'bg-purple-950/80 border-purple-500 text-purple-300 font-bold animate-pulse';
    case 'Transition': return 'bg-zinc-800 border-zinc-700 text-zinc-400';
    default: return 'bg-zinc-800 border-zinc-700 text-zinc-400';
  }
};

/* =========================================================================================
   1. READ-ONLY VIEW FOR CLUB-AFFILIATED ATHLETES
   Zero form inputs, zero edit capabilities, read-only formal club plan, option to leave club
   ========================================================================================= */
interface PeriodizationReadOnlyViewProps {
  athlete: AthleteProfile;
  context: PeriodizationContext;
  plan: AthletePeriodizationPlan;
  calendar: CompetitionCalendar;
  onClose: () => void;
  onLeaveClub?: () => Promise<boolean>;
}

const PeriodizationReadOnlyView: React.FC<PeriodizationReadOnlyViewProps> = ({
  athlete,
  context,
  plan,
  calendar,
  onClose,
  onLeaveClub
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'competitions' | 'governance'>('overview');
  const [isLeaving, setIsLeaving] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleLeaveClubClick = async () => {
    if (!onLeaveClub) return;
    try {
      setIsLeaving(true);
      setActionMsg(null);
      const ok = await onLeaveClub();
      if (ok) {
        setActionMsg({ type: 'success', text: 'Te has desvinculado del club. Tu cuenta ahora opera en modo independiente.' });
      } else {
        setActionMsg({ type: 'error', text: 'No se pudo completar la desvinculación.' });
      }
    } catch (err: any) {
      setActionMsg({ type: 'error', text: err?.message || 'Error al salir del club.' });
    } finally {
      setIsLeaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-sans">
        
        {/* Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-950/70 border border-indigo-500/40 text-indigo-400">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-zinc-100 uppercase tracking-wide font-mono">
                  Plan de Periodización Formal
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 border border-emerald-800 text-emerald-300">
                  TEMPORADA {plan.season || '2026'}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-950 border border-indigo-700 text-indigo-300 flex items-center gap-1">
                  <Users className="w-3 h-3 text-indigo-400" />
                  CLUB: {athlete.clubId}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 border border-zinc-700 text-zinc-300">
                  MODO ATLETA
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-mono">
                Plan oficial estructurado por el cuerpo técnico de tu club (Modo Solo Lectura)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Real-time Status Banner */}
        <div className="px-4 py-3 bg-zinc-900/40 border-b border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="text-zinc-500">MESOCICLO ACTUAL:</span>
            {context.currentMesocycle ? (
              <span className={`px-2 py-0.5 rounded border text-[11px] ${getPhaseBadgeClass(context.currentMesocycle.phase)}`}>
                {context.currentMesocycle.name} (Semana {context.currentWeekOfMesocycle || 1})
              </span>
            ) : (
              <span className="text-zinc-400 italic">Sin bloque activo hoy</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-zinc-500">PRÓXIMA COMPETENCIA:</span>
            {context.nextCompetition ? (
              <div className="flex items-center gap-1.5">
                <span className={`px-1.5 py-0.5 rounded border text-[10px] ${getPriorityBadgeClass(context.nextCompetition.priority)}`}>
                  PRIORIDAD {context.nextCompetition.priority}
                </span>
                <span className="text-zinc-200 font-bold">{context.nextCompetition.name}</span>
                <span className="text-emerald-400 font-bold">
                  ({context.daysToNextComp !== null ? `${context.daysToNextComp}d` : 'Hoy'})
                </span>
              </div>
            ) : (
              <span className="text-zinc-400 italic">Ninguna cercana</span>
            )}
          </div>

          {context.inTaper && (
            <div className="w-full flex items-center gap-2 px-3 py-1.5 rounded bg-purple-950/70 border border-purple-600 text-purple-200 font-sans text-xs">
              <AlertTriangle className="w-4 h-4 text-purple-400 shrink-0" />
              <span>
                <strong>TAPER ACTIVO:</strong> A menos de 10-14 días de competencia principal. ARIA modula la carga restringiendo volumen y evitando fatiga residual.
              </span>
            </div>
          )}
        </div>

        {/* Read-Only Navigation Tabs */}
        <div className="flex border-b border-zinc-800 bg-zinc-950 px-4 text-xs font-mono">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2.5 border-b-2 font-medium transition-colors ${
              activeTab === 'overview'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            RESUMEN & MESOCICLOS ({plan.mesocycles?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('competitions')}
            className={`px-4 py-2.5 border-b-2 font-medium transition-colors ${
              activeTab === 'competitions'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            COMPETICIONES ({calendar.competitions?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('governance')}
            className={`px-4 py-2.5 border-b-2 font-medium transition-colors ${
              activeTab === 'governance'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            CLUB & GOBERNANZA
          </button>
        </div>

        {/* Tab Content Window */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {actionMsg && (
            <div className={`p-3 rounded-lg border text-xs font-mono flex items-center gap-2 ${
              actionMsg.type === 'success' 
                ? 'bg-emerald-950/70 border-emerald-600 text-emerald-300' 
                : 'bg-red-950/70 border-red-600 text-red-300'
            }`}>
              {actionMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              <span>{actionMsg.text}</span>
            </div>
          )}

          {activeTab === 'overview' && (
            <div className="space-y-4 animate-fadeIn">
              {/* Macrocycle Card */}
              <div className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-800 space-y-3">
                <div className="flex items-center gap-2 text-zinc-300 font-mono text-xs font-bold">
                  <Target className="w-4 h-4 text-indigo-400" />
                  <span>OBJETIVO DE MACROCICLO ANUAL</span>
                </div>
                <div className="p-3 rounded-md bg-zinc-950 border border-zinc-800/80 text-sm font-semibold text-zinc-100">
                  {plan.macrocycle?.goal || 'Preparación deportiva y pico de rendimiento'}
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                  <div className="p-2.5 rounded bg-zinc-950 border border-zinc-800">
                    <span className="text-zinc-500 block mb-0.5">FECHA INICIO:</span>
                    <span className="text-zinc-200 font-semibold">{plan.macrocycle?.startDate || 'Sin definir'}</span>
                  </div>
                  <div className="p-2.5 rounded bg-zinc-950 border border-zinc-800">
                    <span className="text-zinc-500 block mb-0.5">FECHA CIERRE:</span>
                    <span className="text-zinc-200 font-semibold">{plan.macrocycle?.endDate || 'Sin definir'}</span>
                  </div>
                </div>
              </div>

              {/* Mesocycles List */}
              <div className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-mono text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    Cronograma Oficial de Mesociclos
                  </h4>
                  <span className="text-[11px] font-mono text-zinc-500">Solo lectura • Administrado por el staff</span>
                </div>

                <div className="space-y-2.5">
                  {(plan.mesocycles || []).map((m, idx) => {
                    const isCurrent = context.currentMesocycle?.name === m.name;
                    return (
                      <div
                        key={idx}
                        className={`p-3.5 rounded-lg border transition-all ${
                          isCurrent
                            ? 'bg-emerald-950/30 border-emerald-500/70 shadow-[0_0_12px_rgba(16,185,129,0.12)]'
                            : 'bg-zinc-900/60 border-zinc-800'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] border font-mono ${getPhaseBadgeClass(m.phase)}`}>
                              {m.phase}
                            </span>
                            <span className="font-bold text-sm text-zinc-100">{m.name}</span>
                            {isCurrent && (
                              <span className="px-2 py-0.5 rounded bg-emerald-900/80 border border-emerald-500 text-emerald-300 text-[10px] font-mono font-bold">
                                ACTIVO HOY
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs font-mono text-zinc-400">
                            <span>{m.startDate} → {m.endDate}</span>
                            <span className="text-zinc-500">Vol: <strong className="text-zinc-200">{m.weeklyVolumeTarget}</strong></span>
                            <span className="text-zinc-500">Int: <strong className="text-zinc-200">{m.weeklyIntensityTarget}</strong></span>
                          </div>
                        </div>

                        {m.focusNotes && (
                          <div className="mt-2 text-xs text-zinc-400 font-mono bg-zinc-950/60 p-2 rounded border border-zinc-800/70">
                            <span className="text-zinc-500 mr-1.5 font-bold">Enfoque:</span>
                            {m.focusNotes}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'competitions' && (
            <div className="space-y-3 animate-fadeIn">
              <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800 flex items-center justify-between text-xs font-mono">
                <span className="text-zinc-400">Calendario Oficial de Competencias fijadas por tu club:</span>
                <span className="text-zinc-500">{calendar.competitions?.length || 0} eventos registrados</span>
              </div>

              {(calendar.competitions || []).map((comp, idx) => {
                const compDate = new Date(comp.date + 'T00:00:00');
                const daysLeft = Math.ceil((compDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                const isPast = daysLeft < 0;

                return (
                  <div 
                    key={idx} 
                    className={`p-4 rounded-lg border space-y-2 ${
                      isPast 
                        ? 'bg-zinc-900/25 border-zinc-800/50 opacity-60' 
                        : 'bg-zinc-900/60 border-zinc-800'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className={`px-2 py-0.5 rounded text-xs font-mono border ${getPriorityBadgeClass(comp.priority)}`}>
                          PRIORIDAD {comp.priority}
                        </span>
                        <span className="font-bold text-sm text-zinc-100">{comp.name}</span>
                      </div>
                      <div className="text-xs font-mono font-bold">
                        {isPast ? (
                          <span className="text-zinc-500">Finalizada</span>
                        ) : (
                          <span className="text-emerald-400">{daysLeft} días restantes</span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono pt-1 text-zinc-300">
                      <div>
                        <span className="text-zinc-500 block">Fecha Evento:</span>
                        <span>{comp.date}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block">Inicio Taper:</span>
                        <span>{comp.taperStartDate || 'Programado por coach'}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block">Pruebas Asignadas:</span>
                        <span>{(comp.events || []).join(', ') || 'General'}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'governance' && (
            <div className="space-y-4 animate-fadeIn">
              <div className="bg-zinc-900/60 border border-indigo-900/50 rounded-xl p-4 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-indigo-950/80 border border-indigo-700 text-indigo-400">
                    <Users className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-zinc-100 font-mono">CLUB: {athlete.clubId}</h3>
                    <p className="text-xs text-zinc-400 font-mono mt-0.5">
                      Tu plan de entrenamiento formal y calendario son gestionados por el cuerpo técnico del club.
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-zinc-950/80 border border-zinc-800 rounded-lg text-xs space-y-1.5 font-mono text-zinc-300">
                  <div className="flex items-center gap-2 text-indigo-400 font-bold mb-1">
                    <Shield className="w-4 h-4" />
                    <span>SEGURIDAD Y GOBERNANZA STRIDES</span>
                  </div>
                  <p className="text-zinc-400">
                    • Los planes formales están resguardados por reglas de seguridad en Firestore. Solo los coaches verificados del club pueden editar mesociclos y competencias.
                  </p>
                  <p className="text-zinc-400">
                    • Si necesitas modificar una prueba, fecha de competencia o mesociclo, comunícaselo a tu entrenador.
                  </p>
                </div>

                <div className="flex justify-between items-center pt-2 border-t border-zinc-800/80">
                  <span className="text-xs text-zinc-500 font-mono">¿Quieres entrenar como independiente?</span>
                  <button
                    onClick={handleLeaveClubClick}
                    disabled={isLeaving}
                    className="px-3.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-red-950/50 border border-zinc-800 hover:border-red-700 text-zinc-400 hover:text-red-300 text-xs font-mono flex items-center gap-1.5 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>{isLeaving ? 'Desvinculando...' : 'Desvincularme del Club'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Read-Only Modal Footer: No Save Button */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/80 flex items-center justify-between">
          <div className="text-xs font-mono text-zinc-400 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-zinc-500" />
            <span>Modo lectura: Gobernado por el cuerpo técnico del club</span>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-xs font-bold border border-zinc-700 transition-colors"
          >
            CERRAR
          </button>
        </div>

      </div>
    </div>
  );
};

/* =========================================================================================
   2. READ-ONLY VIEW FOR UNAFFILIATED ATHLETES (INFERRED CONTEXT & JOIN CLUB)
   Zero formal plan editor, displays dynamic inferred context and club code join form
   ========================================================================================= */
interface InferredContextReadOnlyViewProps {
  athlete: AthleteProfile;
  context: PeriodizationContext;
  inferredContext?: InferredTrainingContext | null;
  onClose: () => void;
  onJoinClub?: (joinCode: string) => Promise<{ success: boolean; error?: string }>;
}

const InferredContextReadOnlyView: React.FC<InferredContextReadOnlyViewProps> = ({
  athlete,
  context,
  inferredContext,
  onClose,
  onJoinClub
}) => {
  const [clubCodeInput, setClubCodeInput] = useState('');
  const [isJoiningClub, setIsJoiningClub] = useState(false);
  const [clubActionMsg, setClubActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleJoinClubClick = async () => {
    if (!clubCodeInput.trim() || !onJoinClub) return;
    try {
      setIsJoiningClub(true);
      setClubActionMsg(null);
      const res = await onJoinClub(clubCodeInput.trim());
      if (res.success) {
        setClubActionMsg({ type: 'success', text: '¡Te has unido exitosamente al club!' });
        setClubCodeInput('');
      } else {
        setClubActionMsg({ type: 'error', text: res.error || 'No se pudo unir al club con ese código.' });
      }
    } catch (err: any) {
      setClubActionMsg({ type: 'error', text: err?.message || 'Error al procesar la unión.' });
    } finally {
      setIsJoiningClub(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-sans">
        
        {/* Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-950/70 border border-emerald-500/40 text-emerald-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-zinc-100 uppercase tracking-wide font-mono">
                  Contexto de Entrenamiento ARIA
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 border border-zinc-700 text-zinc-300 flex items-center gap-1">
                  <Shield className="w-3 h-3 text-zinc-400" />
                  ATLETA INDEPENDIENTE
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-mono">
                Contexto inferido dinámicamente por ARIA según tus charlas técnicas y registros
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono">
          {clubActionMsg && (
            <div className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
              clubActionMsg.type === 'success' 
                ? 'bg-emerald-950/70 border-emerald-600 text-emerald-300' 
                : 'bg-red-950/70 border-red-600 text-red-300'
            }`}>
              {clubActionMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              <span>{clubActionMsg.text}</span>
            </div>
          )}

          {/* Inferred Context Summary Card */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3 font-sans">
            <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs font-bold">
              <Sparkles className="w-4 h-4" />
              <span>ESTADO DE ENTRENAMIENTO INFERIDO</span>
            </div>
            <p className="text-xs text-zinc-300 font-mono leading-relaxed">
              Como atleta independiente, no utilizas un macrociclo cerrado rígido. ARIA infiere tu fase de preparación y proximidad competitiva a partir de tus preguntas y reportes de fatiga.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="p-3 bg-zinc-950/90 border border-zinc-800 rounded-lg">
                <span className="text-[10px] font-mono text-zinc-500 uppercase block mb-1">Fase Actual Inferida</span>
                <div className="text-sm font-bold text-zinc-100 font-mono">
                  {inferredContext?.currentPhase || 'GPP (Preparación General)'}
                </div>
              </div>
              <div className="p-3 bg-zinc-950/90 border border-zinc-800 rounded-lg">
                <span className="text-[10px] font-mono text-zinc-500 uppercase block mb-1">Proximidad a Competencia</span>
                <div className="text-sm font-bold text-zinc-100 font-mono">
                  {inferredContext?.proximityToCompetition || 'Sin especificar en chat'}
                </div>
              </div>
            </div>

            {inferredContext?.nextCompetition && (
              <div className="p-3 bg-zinc-950/90 border border-zinc-800 rounded-lg text-xs font-mono">
                <span className="text-[10px] text-zinc-500 uppercase block mb-1">Próxima Competencia Mencionada</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-zinc-200">{inferredContext.nextCompetition.name}</span>
                  <span className="text-zinc-400">({inferredContext.nextCompetition.date})</span>
                  <span className="text-emerald-400 font-bold">Prioridad {inferredContext.nextCompetition.priority || 'B'}</span>
                </div>
              </div>
            )}

            {inferredContext?.notes && (
              <div className="p-3 bg-zinc-950/90 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-400">
                <span className="text-[10px] text-zinc-500 uppercase block mb-1">Notas de Contexto Táctico</span>
                <p>{inferredContext.notes}</p>
              </div>
            )}

            <div className="text-[11px] font-mono text-zinc-500 pt-1">
              Última calibración por ARIA: {inferredContext?.lastUpdated ? new Date(inferredContext.lastUpdated).toLocaleString() : 'Inicio de sesión'}
            </div>
          </div>

          {/* Join Club Card */}
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 space-y-3 font-sans">
            <div className="flex items-center gap-2 text-zinc-200 font-mono text-xs font-bold">
              <Link className="w-4 h-4 text-emerald-400" />
              <span>UNIRSE A UN CLUB CON CÓDIGO</span>
            </div>
            <p className="text-xs text-zinc-400 font-mono">
              Si tu entrenador o equipo ya utiliza STRIDES, ingresa el código de club (ejemplo: <code className="text-emerald-400 bg-zinc-950 px-1 py-0.5 rounded">SANTAFE400</code>) para vincularte y activar tu plan de periodización oficial administrado por el coach.
            </p>

            <div className="flex gap-2 pt-1 max-w-md">
              <input
                type="text"
                value={clubCodeInput}
                onChange={e => setClubCodeInput(e.target.value.toUpperCase())}
                placeholder="CÓDIGO DE CLUB (EJ: SANTAFE400)"
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none uppercase"
              />
              <button
                onClick={handleJoinClubClick}
                disabled={isJoiningClub || !clubCodeInput.trim()}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-mono text-xs font-bold transition-colors"
              >
                {isJoiningClub ? 'UNIENDO...' : 'UNIRME'}
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer: No Save Button */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/80 flex items-center justify-between">
          <div className="text-xs font-mono text-zinc-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>Modo independiente: ARIA calibra tu contexto dinámicamente en el chat</span>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-xs font-bold border border-zinc-700 transition-colors"
          >
            CERRAR
          </button>
        </div>

      </div>
    </div>
  );
};

/* =========================================================================================
   3. FULL COACH PERIODIZATION EDITOR
   Rendered ONLY when athlete.role === 'COACH'
   ========================================================================================= */
interface PeriodizationCoachEditorProps {
  athlete: AthleteProfile;
  plan: AthletePeriodizationPlan;
  calendar: CompetitionCalendar;
  context: PeriodizationContext;
  onClose: () => void;
  onSavePlanAndCalendar: (newPlan: AthletePeriodizationPlan, newCalendar: CompetitionCalendar) => Promise<void>;
}

const PeriodizationCoachEditor: React.FC<PeriodizationCoachEditorProps> = ({
  athlete,
  plan,
  calendar,
  context,
  onClose,
  onSavePlanAndCalendar
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'mesocycles' | 'competitions' | 'club'>('overview');
  const [editedPlan, setEditedPlan] = useState<AthletePeriodizationPlan>(plan);
  const [editedCalendar, setEditedCalendar] = useState<CompetitionCalendar>(calendar);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setEditedPlan(plan);
    setEditedCalendar(calendar);
  }, [plan, calendar]);

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await onSavePlanAndCalendar(editedPlan, editedCalendar);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      console.error('Failed to save periodization plan:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddMesocycle = () => {
    const newMeso: Mesocycle = {
      name: 'Nuevo Bloque de Carga',
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      phase: 'SPP',
      weeklyVolumeTarget: 'moderado',
      weeklyIntensityTarget: 'alto',
      focusNotes: 'Enfoque técnico y de potencia'
    };
    setEditedPlan({
      ...editedPlan,
      mesocycles: [...(editedPlan.mesocycles || []), newMeso]
    });
  };

  const handleDeleteMesocycle = (index: number) => {
    const updated = [...editedPlan.mesocycles];
    updated.splice(index, 1);
    setEditedPlan({ ...editedPlan, mesocycles: updated });
  };

  const handleAddCompetition = () => {
    const newComp: Competition = {
      name: 'Nueva Competencia',
      date: new Date(Date.now() + 60 * 86400000).toISOString().split('T')[0],
      priority: 'B',
      events: ['100m'],
      taperStartDate: new Date(Date.now() + 50 * 86400000).toISOString().split('T')[0]
    };
    setEditedCalendar({
      ...editedCalendar,
      competitions: [...(editedCalendar.competitions || []), newComp]
    });
  };

  const handleDeleteCompetition = (index: number) => {
    const updated = [...editedCalendar.competitions];
    updated.splice(index, 1);
    setEditedCalendar({ ...editedCalendar, competitions: updated });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-sans">
        
        {/* Modal Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-950/70 border border-emerald-500/40 text-emerald-400">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-zinc-100 uppercase tracking-wide font-mono">
                  Editor de Periodización (COACH)
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 border border-emerald-800 text-emerald-300">
                  TEMPORADA {editedPlan.season || '2026'}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-950 border border-indigo-700 text-indigo-300 flex items-center gap-1">
                  <Users className="w-3 h-3 text-indigo-400" />
                  CLUB: {athlete.clubId || 'STAFF'}
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-mono">
                Permisos de entrenador: Configuración oficial de macrociclo, mesociclos y competiciones
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Real-time Status Card Banner */}
        <div className="px-4 py-3 bg-zinc-900/40 border-b border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="text-zinc-500">MESOCICLO ACTUAL:</span>
            {context.currentMesocycle ? (
              <span className={`px-2 py-0.5 rounded border text-[11px] ${getPhaseBadgeClass(context.currentMesocycle.phase)}`}>
                {context.currentMesocycle.name} (Semana {context.currentWeekOfMesocycle || 1})
              </span>
            ) : (
              <span className="text-zinc-400 italic">Sin bloque activo hoy</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-zinc-500">PRÓXIMA COMPETENCIA:</span>
            {context.nextCompetition ? (
              <div className="flex items-center gap-1.5">
                <span className={`px-1.5 py-0.5 rounded border text-[10px] ${getPriorityBadgeClass(context.nextCompetition.priority)}`}>
                  PRIORIDAD {context.nextCompetition.priority}
                </span>
                <span className="text-zinc-200 font-bold">{context.nextCompetition.name}</span>
                <span className="text-emerald-400 font-bold">
                  ({context.daysToNextComp !== null ? `${context.daysToNextComp}d` : 'Hoy'})
                </span>
              </div>
            ) : (
              <span className="text-zinc-400 italic">Ninguna cercana</span>
            )}
          </div>

          {context.inTaper && (
            <div className="w-full flex items-center gap-2 px-3 py-1.5 rounded bg-purple-950/70 border border-purple-600 text-purple-200 font-sans text-xs">
              <AlertTriangle className="w-4 h-4 text-purple-400 shrink-0" />
              <span>
                <strong>TAPER ACTIVO:</strong> A menos de 10-14 días de competencia principal. ARIA restringirá todo volumen alto o sobrecarga nueva.
              </span>
            </div>
          )}
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-zinc-800 bg-zinc-950 px-4 text-xs font-mono">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2.5 border-b-2 font-medium transition-colors ${
              activeTab === 'overview'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            RESUMEN DE TEMPORADA
          </button>
          <button
            onClick={() => setActiveTab('mesocycles')}
            className={`px-4 py-2.5 border-b-2 font-medium transition-colors ${
              activeTab === 'mesocycles'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            MESOCICLOS & CARGAS ({editedPlan.mesocycles?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('competitions')}
            className={`px-4 py-2.5 border-b-2 font-medium transition-colors ${
              activeTab === 'competitions'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            COMPETICIONES ({editedCalendar.competitions?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('club')}
            className={`px-4 py-2.5 border-b-2 font-medium transition-colors ${
              activeTab === 'club'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            GESTIÓN DE CLUB
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          
          {/* OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {/* Macrocycle Card */}
              <div className="p-4 rounded-lg bg-zinc-900/50 border border-zinc-800 space-y-3">
                <h4 className="font-mono text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  Objetivo del Macrociclo Anual
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="md:col-span-3">
                    <label className="block text-zinc-400 mb-1 font-mono">Meta Principal de Temporada:</label>
                    <input
                      type="text"
                      value={editedPlan.macrocycle?.goal || ''}
                      onChange={e => setEditedPlan({
                        ...editedPlan,
                        macrocycle: { ...editedPlan.macrocycle, goal: e.target.value }
                      })}
                      placeholder="e.g. Clasificación a Juegos Panamericanos / Marca A en 400m"
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-200 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1 font-mono">Fecha Inicio:</label>
                    <input
                      type="date"
                      value={editedPlan.macrocycle?.startDate || ''}
                      onChange={e => setEditedPlan({
                        ...editedPlan,
                        macrocycle: { ...editedPlan.macrocycle, startDate: e.target.value }
                      })}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-200 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1 font-mono">Fecha Cierre:</label>
                    <input
                      type="date"
                      value={editedPlan.macrocycle?.endDate || ''}
                      onChange={e => setEditedPlan({
                        ...editedPlan,
                        macrocycle: { ...editedPlan.macrocycle, endDate: e.target.value }
                      })}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-200 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Timeline Snapshot */}
              <div className="p-4 rounded-lg bg-zinc-900/50 border border-zinc-800 space-y-2">
                <h4 className="font-mono text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  Cronograma Anual de Bloques
                </h4>
                <div className="space-y-2">
                  {(editedPlan.mesocycles || []).map((m, idx) => {
                    const isCurrent = context.currentMesocycle?.name === m.name;
                    return (
                      <div
                        key={idx}
                        className={`p-3 rounded border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition-all ${
                          isCurrent
                            ? 'bg-emerald-950/40 border-emerald-500/80 shadow-[0_0_10px_rgba(16,185,129,0.15)]'
                            : 'bg-zinc-900/60 border-zinc-800'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] border font-mono ${getPhaseBadgeClass(m.phase)}`}>
                            {m.phase}
                          </span>
                          <span className="font-semibold text-zinc-200">{m.name}</span>
                          {isCurrent && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-900 text-emerald-300 text-[10px] font-mono font-bold">
                              HOY EN CURSO
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-zinc-400 font-mono text-[11px]">
                          <span>{m.startDate} → {m.endDate}</span>
                          <span className="text-zinc-500">Vol: <strong className="text-zinc-300">{m.weeklyVolumeTarget}</strong></span>
                          <span className="text-zinc-500">Int: <strong className="text-zinc-300">{m.weeklyIntensityTarget}</strong></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* MESOCYCLES TAB */}
          {activeTab === 'mesocycles' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-zinc-400 font-mono">
                  Configuración detallada de fases, semanas de carga y orientaciones tácticas:
                </p>
                <button
                  onClick={handleAddMesocycle}
                  className="px-2.5 py-1.5 rounded bg-emerald-950 hover:bg-emerald-900 border border-emerald-700 text-emerald-300 text-xs font-mono flex items-center gap-1.5 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>AGREGAR MESOCICLO</span>
                </button>
              </div>

              <div className="space-y-3">
                {(editedPlan.mesocycles || []).map((meso, idx) => (
                  <div key={idx} className="p-3.5 rounded-lg bg-zinc-900/70 border border-zinc-800 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1 mr-2">
                        <input
                          type="text"
                          value={meso.name}
                          onChange={e => {
                            const updated = [...editedPlan.mesocycles];
                            updated[idx].name = e.target.value;
                            setEditedPlan({ ...editedPlan, mesocycles: updated });
                          }}
                          placeholder="Nombre del Mesociclo"
                          className="font-bold text-sm bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-100 flex-1 max-w-sm focus:border-emerald-500 focus:outline-none"
                        />
                        <select
                          value={meso.phase}
                          onChange={e => {
                            const updated = [...editedPlan.mesocycles];
                            updated[idx].phase = e.target.value as MesocyclePhase;
                            setEditedPlan({ ...editedPlan, mesocycles: updated });
                          }}
                          className={`px-2 py-1 rounded text-xs font-mono border ${getPhaseBadgeClass(meso.phase)}`}
                        >
                          <option value="GPP">GPP (Preparación General)</option>
                          <option value="SPP">SPP (Preparación Específica)</option>
                          <option value="Competitive">Competitive (Competitivo)</option>
                          <option value="Taper">Taper (Puesta a Punto)</option>
                          <option value="Transition">Transition (Transición)</option>
                        </select>
                      </div>

                      <button
                        onClick={() => handleDeleteMesocycle(idx)}
                        className="p-1.5 rounded bg-zinc-900 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 border border-zinc-800 transition-colors"
                        title="Eliminar mesociclo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs font-mono">
                      <div>
                        <label className="block text-zinc-500 mb-0.5">Inicio:</label>
                        <input
                          type="date"
                          value={meso.startDate}
                          onChange={e => {
                            const updated = [...editedPlan.mesocycles];
                            updated[idx].startDate = e.target.value;
                            setEditedPlan({ ...editedPlan, mesocycles: updated });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-zinc-500 mb-0.5">Fin:</label>
                        <input
                          type="date"
                          value={meso.endDate}
                          onChange={e => {
                            const updated = [...editedPlan.mesocycles];
                            updated[idx].endDate = e.target.value;
                            setEditedPlan({ ...editedPlan, mesocycles: updated });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-zinc-500 mb-0.5">Objetivo Volumen:</label>
                        <input
                          type="text"
                          value={meso.weeklyVolumeTarget}
                          onChange={e => {
                            const updated = [...editedPlan.mesocycles];
                            updated[idx].weeklyVolumeTarget = e.target.value;
                            setEditedPlan({ ...editedPlan, mesocycles: updated });
                          }}
                          placeholder="alto / moderado / bajo"
                          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-zinc-500 mb-0.5">Objetivo Intensidad:</label>
                        <input
                          type="text"
                          value={meso.weeklyIntensityTarget}
                          onChange={e => {
                            const updated = [...editedPlan.mesocycles];
                            updated[idx].weeklyIntensityTarget = e.target.value;
                            setEditedPlan({ ...editedPlan, mesocycles: updated });
                          }}
                          placeholder="bajo / moderado / alto / pico"
                          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-zinc-500 text-xs font-mono mb-0.5">Notas de Enfoque y Adaptación Tisular:</label>
                      <input
                        type="text"
                        value={meso.focusNotes || ''}
                        onChange={e => {
                          const updated = [...editedPlan.mesocycles];
                          updated[idx].focusNotes = e.target.value;
                          setEditedPlan({ ...editedPlan, mesocycles: updated });
                        }}
                        placeholder="e.g. Fuerza excéntrica, tolerancia al lactato, stiffness de tendón de Aquiles"
                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* COMPETITIONS TAB */}
          {activeTab === 'competitions' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-zinc-400 font-mono">
                  Competencias programadas con fecha de inicio de taper para descompresión neuromuscular:
                </p>
                <button
                  onClick={handleAddCompetition}
                  className="px-2.5 py-1.5 rounded bg-emerald-950 hover:bg-emerald-900 border border-emerald-700 text-emerald-300 text-xs font-mono flex items-center gap-1.5 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>AGREGAR COMPETENCIA</span>
                </button>
              </div>

              <div className="space-y-3">
                {(editedCalendar.competitions || []).map((comp, idx) => {
                  const compDate = new Date(comp.date + 'T00:00:00');
                  const daysLeft = Math.ceil((compDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                  const isPast = daysLeft < 0;

                  return (
                    <div key={idx} className={`p-3.5 rounded-lg border space-y-2.5 ${isPast ? 'bg-zinc-900/30 border-zinc-800/60 opacity-60' : 'bg-zinc-900/70 border-zinc-800'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            type="text"
                            value={comp.name}
                            onChange={e => {
                              const updated = [...editedCalendar.competitions];
                              updated[idx].name = e.target.value;
                              setEditedCalendar({ ...editedCalendar, competitions: updated });
                            }}
                            placeholder="Nombre de la Competencia"
                            className="font-bold text-sm bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-100 flex-1 max-w-sm focus:border-emerald-500 focus:outline-none"
                          />
                          <select
                            value={comp.priority}
                            onChange={e => {
                              const updated = [...editedCalendar.competitions];
                              updated[idx].priority = e.target.value as CompetitionPriority;
                              setEditedCalendar({ ...editedCalendar, competitions: updated });
                            }}
                            className={`px-2 py-1 rounded text-xs font-mono border ${getPriorityBadgeClass(comp.priority)}`}
                          >
                            <option value="A">Prioridad A (Principal)</option>
                            <option value="B">Prioridad B (Secundaria/Clasificatoria)</option>
                            <option value="C">Prioridad C (Control/Rodaje)</option>
                          </select>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-zinc-400">
                            {isPast ? 'Completada' : `${daysLeft} días`}
                          </span>
                          <button
                            onClick={() => handleDeleteCompetition(idx)}
                            className="p-1.5 rounded bg-zinc-900 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 border border-zinc-800 transition-colors"
                            title="Eliminar competencia"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono">
                        <div>
                          <label className="block text-zinc-500 mb-0.5">Fecha del Evento:</label>
                          <input
                            type="date"
                            value={comp.date}
                            onChange={e => {
                              const updated = [...editedCalendar.competitions];
                              updated[idx].date = e.target.value;
                              setEditedCalendar({ ...editedCalendar, competitions: updated });
                            }}
                            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200 focus:border-emerald-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-zinc-500 mb-0.5">Inicio Taper (opcional):</label>
                          <input
                            type="date"
                            value={comp.taperStartDate || ''}
                            onChange={e => {
                              const updated = [...editedCalendar.competitions];
                              updated[idx].taperStartDate = e.target.value || null;
                              setEditedCalendar({ ...editedCalendar, competitions: updated });
                            }}
                            placeholder="YYYY-MM-DD"
                            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200 focus:border-emerald-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-zinc-500 mb-0.5">Pruebas (separadas por coma):</label>
                          <input
                            type="text"
                            value={(comp.events || []).join(', ')}
                            onChange={e => {
                              const updated = [...editedCalendar.competitions];
                              updated[idx].events = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                              setEditedCalendar({ ...editedCalendar, competitions: updated });
                            }}
                            placeholder="400m, 400mH"
                            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200 focus:border-emerald-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* CLUB TAB */}
          {activeTab === 'club' && (
            <div className="space-y-4">
              <div className="bg-zinc-900/60 border border-indigo-900/50 rounded-xl p-4 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-indigo-950/80 border border-indigo-700 text-indigo-400">
                    <Users className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-zinc-100 font-mono">CLUB: {athlete.clubId || 'STAFF'}</h3>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 border border-emerald-800 text-emerald-300">
                      ROL: COACH / HEAD COACH
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-zinc-950/80 border border-zinc-800 rounded-lg text-xs space-y-1 font-mono text-zinc-300">
                  <div className="flex items-center gap-2 text-indigo-400 font-bold mb-1">
                    <Shield className="w-4 h-4" />
                    <span>AUTORIZACIÓN DE ENTRENADOR</span>
                  </div>
                  <p className="text-zinc-400">
                    • Como coach, cualquier cambio que guardes en los mesociclos y competencias se propagará de forma inmediata al motor ARIA del atleta.
                  </p>
                  <p className="text-zinc-400">
                    • ARIA adaptará automáticamente los microciclos prescritos y las fases de descarga / taper del atleta en función de estas fechas.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Coach Modal Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/80 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
            {saveSuccess ? (
              <span className="text-emerald-400 flex items-center gap-1.5 font-bold">
                <CheckCircle2 className="w-4 h-4" />
                Plan y calendario sincronizados en Firestore
              </span>
            ) : (
              <span>Permiso Coach: Sincronización oficial de club habilitada</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono text-xs border border-zinc-700 transition-colors"
            >
              CERRAR
            </button>
            <button
              id="save-periodization-btn"
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-mono text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-950 transition-colors"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'GUARDANDO...' : 'GUARDAR PLAN (COACH)'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

/* =========================================================================================
   MAIN EXPORT WITH STRICT ROLE-BASED EARLY RETURN GUARD
   ========================================================================================= */
export const PeriodizationCalendarModal: React.FC<PeriodizationCalendarModalProps> = ({
  isOpen,
  onClose,
  athlete,
  plan,
  calendar,
  context,
  inferredContext,
  onSavePlanAndCalendar,
  onJoinClub,
  onLeaveClub
}) => {
  if (!isOpen) return null;

  const isCoach = athlete.role === 'COACH' || athlete.role === 'coach';
  const isClubAffiliated = Boolean(athlete.clubId && athlete.clubId.trim().length > 0);

  // GUARD DE ROL AL INICIO — no al final en el botón
  if (!isCoach) {
    if (isClubAffiliated) {
      return (
        <PeriodizationReadOnlyView
          athlete={athlete}
          context={context}
          plan={plan}
          calendar={calendar}
          onClose={onClose}
          onLeaveClub={onLeaveClub}
        />
      );
    } else {
      return (
        <InferredContextReadOnlyView
          athlete={athlete}
          context={context}
          inferredContext={inferredContext}
          onClose={onClose}
          onJoinClub={onJoinClub}
        />
      );
    }
  }

  // SOLO SI isCoach === true se llega a este return:
  return (
    <PeriodizationCoachEditor
      athlete={athlete}
      plan={plan}
      calendar={calendar}
      context={context}
      onClose={onClose}
      onSavePlanAndCalendar={onSavePlanAndCalendar}
    />
  );
};
