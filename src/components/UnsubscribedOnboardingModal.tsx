import React, { useState } from 'react';
import { 
  AthleteProfile, 
  ALL_DISCIPLINES, 
  SEX_RESTRICTED_DISCIPLINES, 
  THROW_IMPLEMENT_STANDARDS, 
  TrackDiscipline, 
  DetailedInjuryReport,
  PowerRecord
} from '../types';
import { updateAthleteProfile } from '../lib/firebase';
import { 
  Ruler, 
  Trophy, 
  Activity, 
  ShieldCheck, 
  ArrowRight, 
  ArrowLeft, 
  CheckCircle2, 
  Plus, 
  Trash2,
  Lock,
  Check,
  X
} from 'lucide-react';

/**
 * ============================================================================
 * ARCHITECTURAL NOTICE: MONETIZATION ON STANDBY
 * ============================================================================
 * Status: ON STANDBY (Do NOT implement billing flows, paywalls, or mock checkouts).
 * Planned Integration: dLocal GO (Primary) with Paddle (Secondary/Fallback).
 * Explicit Restriction: DO NOT IMPLEMENT STRIPE under any circumstances.
 * Subscription flags in AthleteProfile (e.g. isSubscribed, subscriptionTier)
 * are read-only profile properties and must NOT trigger blocking payment gates.
 * ============================================================================
 */

interface Props {
  athlete: AthleteProfile;
  mode?: 'full' | 'partial';
  onOnboardingComplete: (updatedProfile: AthleteProfile) => void;
  onClose?: () => void;
}

export const UnsubscribedOnboardingModal: React.FC<Props> = ({ 
  athlete, 
  mode = 'full', 
  onOnboardingComplete,
  onClose
}) => {
  // Gating is decoupled from subscription status:
  // If mode === 'partial', skip directly to Step 4 (Injury History & Kinetic Deficiencies)
  // If mode === 'full', start at Step 1 (Role & Category Configuration)
  const isPartial = mode === 'partial';
  const initialStep = isPartial ? 4 : 1;

  const [step, setStep] = useState<number>(initialStep);
  
  // Step 1: Role & Disciplines
  const [role, setRole] = useState<'ATHLETE' | 'COACH'>((athlete.role as any) || 'ATHLETE');
  const [sex, setSex] = useState<'MALE' | 'FEMALE'>((athlete.anthropometrics?.sex as any) || 'MALE');
  const [selectedDisciplines, setSelectedDisciplines] = useState<TrackDiscipline[]>(
    (athlete.targetEvents as TrackDiscipline[])?.length > 0 
      ? (athlete.targetEvents as TrackDiscipline[]) 
      : ['100m', '200m']
  );

  // Step 2: Biometrics
  const [heightCm, setHeightCm] = useState<number>(athlete.anthropometrics?.heightCm || 180);
  const [weightKg, setWeightKg] = useState<number>(athlete.anthropometrics?.weightKg || 75);
  const [inseamCm, setInseamCm] = useState<number | ''>(
    athlete.anthropometrics?.inseamCm !== null && athlete.anthropometrics?.inseamCm !== undefined && athlete.anthropometrics.inseamCm > 0
      ? athlete.anthropometrics.inseamCm
      : 85
  );
  const [age, setAge] = useState<number>(athlete.anthropometrics?.age || 22);

  // Step 3: Specialized Data (PBs & Gym PRs)
  const [pbs, setPbs] = useState<Record<string, string>>(athlete.personalBests || {});
  const [squatPr, setSquatPr] = useState<number>(
    athlete.powerRecords?.find(r => r.liftName === 'Back Squat')?.maxKg || 140
  );
  const [cleanPr, setCleanPr] = useState<number>(
    athlete.powerRecords?.find(r => r.liftName === 'Power Clean')?.maxKg || 105
  );
  const [benchPr, setBenchPr] = useState<number>(
    athlete.powerRecords?.find(r => r.liftName === 'Bench Press')?.maxKg || 100
  );

  // Step 4: Structured Injury History & Explicit "No Injuries" State
  const [injuries, setInjuries] = useState<DetailedInjuryReport[]>(
    athlete.injuryHistory && athlete.injuryHistory.length > 0 
      ? athlete.injuryHistory 
      : []
  );
  const [hasNoInjuriesConfirmed, setHasNoInjuriesConfirmed] = useState<boolean>(
    Boolean(athlete.injuryHistoryReviewed && (!athlete.injuryHistory || athlete.injuryHistory.length === 0))
  );

  const [newBodypart, setNewBodypart] = useState('');
  const [newType, setNewType] = useState('');
  const [newSeverity, setNewSeverity] = useState<'MILD' | 'MODERATE' | 'SEVERE'>('MILD');
  const [newStatus, setNewStatus] = useState<'ACTIVE' | 'REHABILITATING' | 'RESOLVED'>('ACTIVE');
  const [kineticDeficienciesText, setKineticDeficienciesText] = useState<string>(
    athlete.kineticDeficiencies?.join(', ') || ''
  );

  const [isSaving, setIsSaving] = useState(false);

  // Toggle discipline selection with sex restriction guard
  const handleToggleDiscipline = (disc: TrackDiscipline) => {
    const restrictedSex = SEX_RESTRICTED_DISCIPLINES[disc];
    if (restrictedSex && restrictedSex !== sex) {
      alert(`Note: ${disc} is designated for ${restrictedSex.toLowerCase()} category. You are currently configured as ${sex.toLowerCase()}.`);
      return;
    }

    if (selectedDisciplines.includes(disc)) {
      if (selectedDisciplines.length === 1) return; // Keep at least one
      setSelectedDisciplines(selectedDisciplines.filter(d => d !== disc));
    } else {
      setSelectedDisciplines([...selectedDisciplines, disc]);
    }
  };

  const handleAddInjury = () => {
    if (!newBodypart.trim() || !newType.trim()) return;
    setInjuries([
      ...injuries,
      {
        bodypart: newBodypart.trim(),
        type: newType.trim(),
        severity: newSeverity,
        date: new Date().toISOString().split('T')[0],
        status: newStatus
      }
    ]);
    setHasNoInjuriesConfirmed(false);
    setNewBodypart('');
    setNewType('');
  };

  const handleRemoveInjury = (index: number) => {
    setInjuries(injuries.filter((_, i) => i !== index));
  };

  const handleConfirmNoInjuries = () => {
    setInjuries([]);
    setHasNoInjuriesConfirmed(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    const kineticArray = kineticDeficienciesText
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0);

    const activeInjuriesList = injuries
      .map(i => `${i.bodypart} - ${i.type} (${i.severity}, ${i.status})`);

    const powerRecordsPayload: PowerRecord[] = [
      { liftName: 'Back Squat', maxKg: squatPr, date: new Date().toISOString().split('T')[0] },
      { liftName: 'Power Clean', maxKg: cleanPr, date: new Date().toISOString().split('T')[0] },
      { liftName: 'Bench Press', maxKg: benchPr, date: new Date().toISOString().split('T')[0] }
    ];

    const parsedInseam = typeof inseamCm === 'number' && inseamCm > 0 ? inseamCm : null;

    const updates: Partial<AthleteProfile> = isPartial 
      ? {
          // PARTIAL FLOW: Updates injury history and sets injuryHistoryReviewed
          onboardingComplete: true,
          injuryHistoryReviewed: true,
          injuryHistory: injuries,
          activeInjuries: activeInjuriesList,
          kineticDeficiencies: kineticArray,
          ...(parsedInseam !== null ? {
            anthropometrics: {
              ...athlete.anthropometrics,
              inseamCm: parsedInseam
            }
          } : {})
        }
      : {
          // FULL FLOW: Updates all 4 stepped modules
          role,
          targetEvents: selectedDisciplines,
          onboardingComplete: true,
          injuryHistoryReviewed: true,
          anthropometrics: {
            heightCm,
            weightKg,
            inseamCm: parsedInseam,
            age,
            sex
          },
          personalBests: pbs,
          powerRecords: powerRecordsPayload,
          injuryHistory: injuries,
          activeInjuries: activeInjuriesList,
          kineticDeficiencies: kineticArray
        };

    // Save directly to Firestore with merge: true via updateAthleteProfile
    await updateAthleteProfile(athlete.id, updates);
    setIsSaving(false);
    onOnboardingComplete({
      ...athlete,
      ...updates
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/95 backdrop-blur-xl flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-3xl bg-zinc-900 border border-emerald-500/40 rounded-2xl shadow-2xl p-5 sm:p-7 font-sans my-8 relative">
        
        {/* Header Badge */}
        <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-950/80 border border-emerald-500/50 text-emerald-400 font-mono">
              <ShieldCheck className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-mono font-bold text-base sm:text-lg text-zinc-100 tracking-wider">
                  STRIDES ATHLETE ONBOARDING
                </h2>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                  isPartial 
                    ? 'bg-cyan-950 text-cyan-400 border-cyan-800' 
                    : 'bg-emerald-950 text-emerald-400 border-emerald-800'
                }`}>
                  {isPartial ? 'PARTIAL: INJURY & KINETIC REVIEW' : 'FULL 4-STEP CALIBRATION'}
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-mono">
                {isPartial 
                  ? 'Core biometric profile verified. Complete injury & kinetic history to calibrate ARIA integral synthesis.' 
                  : 'Complete your full 4-step biomechanical calibration for scientific ARIA integral analysis.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Stepper indicator (for full flow) */}
            {!isPartial && (
              <div className="hidden sm:flex items-center gap-1.5 font-mono text-xs text-zinc-400">
                <span className={`px-2 py-1 rounded ${step === 1 ? 'bg-emerald-500 text-zinc-950 font-bold' : 'bg-zinc-800'}`}>1</span>
                <span className={`px-2 py-1 rounded ${step === 2 ? 'bg-emerald-500 text-zinc-950 font-bold' : 'bg-zinc-800'}`}>2</span>
                <span className={`px-2 py-1 rounded ${step === 3 ? 'bg-emerald-500 text-zinc-950 font-bold' : 'bg-zinc-800'}`}>3</span>
                <span className={`px-2 py-1 rounded ${step === 4 ? 'bg-emerald-500 text-zinc-950 font-bold' : 'bg-zinc-800'}`}>4</span>
              </div>
            )}

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border border-zinc-700 transition-colors"
                title="Close Modal"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 text-xs sm:text-sm font-mono">
          
          {/* STEP 1: Role & Discipline Selection (Full Flow Only) */}
          {!isPartial && step === 1 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
                <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Ruler className="w-4 h-4" />
                  <span>Step 1: Role & Category Configuration</span>
                </h3>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="block text-zinc-400 text-[11px] mb-1">Role</label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as any)}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="ATHLETE">Track & Field Athlete</option>
                      <option value="COACH">Tactical Coach / Director</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-zinc-400 text-[11px] mb-1">Sex Category (Guards Hurdle & Throw Standards)</label>
                    <select
                      value={sex}
                      onChange={(e) => setSex(e.target.value as any)}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="MALE">Male (110mH, Decathlon, 7.26kg SP/HT, 2kg DT, 800g JT)</option>
                      <option value="FEMALE">Female (100mH, Heptathlon, 4kg SP/HT, 1kg DT, 600g JT)</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-zinc-400 text-[11px] mb-2 font-bold uppercase">
                    Select Target Track & Field Disciplines (Multi-Select):
                  </label>
                  <div className="space-y-3">
                    {ALL_DISCIPLINES.map(group => (
                      <div key={group.category} className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800/80">
                        <div className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider mb-1.5">
                          {group.category}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {group.disciplines.map(disc => {
                            const isRestricted = SEX_RESTRICTED_DISCIPLINES[disc] && SEX_RESTRICTED_DISCIPLINES[disc] !== sex;
                            const isSelected = selectedDisciplines.includes(disc);
                            return (
                              <button
                                key={disc}
                                type="button"
                                disabled={isRestricted}
                                onClick={() => handleToggleDiscipline(disc)}
                                className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-all flex items-center gap-1.5 ${
                                  isSelected 
                                    ? 'bg-emerald-500 text-zinc-950 font-bold shadow-[0_0_10px_rgba(16,185,129,0.3)]' 
                                    : isRestricted
                                      ? 'bg-zinc-900 text-zinc-600 border border-zinc-800 cursor-not-allowed opacity-50'
                                      : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700'
                                }`}
                              >
                                {isRestricted && <Lock className="w-3 h-3 text-zinc-600" />}
                                <span>{disc}</span>
                                {THROW_IMPLEMENT_STANDARDS[disc] && (
                                  <span className="text-[9px] opacity-75">
                                    ({sex === 'MALE' ? THROW_IMPLEMENT_STANDARDS[disc].male : THROW_IMPLEMENT_STANDARDS[disc].female})
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-mono font-bold text-xs uppercase tracking-wider flex items-center gap-2"
                >
                  <span>Continue to Biometrics</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Identity & Biometrics (Full Flow Only) */}
          {!isPartial && step === 2 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
                <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Ruler className="w-4 h-4" />
                  <span>Step 2: Anthropometrics & Kinetic Proportions</span>
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div>
                    <label className="block text-zinc-400 text-[11px] mb-1">Height (cm)</label>
                    <input
                      type="number"
                      value={heightCm}
                      onChange={(e) => setHeightCm(parseFloat(e.target.value) || 0)}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-400 text-[11px] mb-1">Weight (kg)</label>
                    <input
                      type="number"
                      value={weightKg}
                      onChange={(e) => setWeightKg(parseFloat(e.target.value) || 0)}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-400 text-[11px] mb-1">Inseam (cm)</label>
                    <input
                      type="number"
                      value={inseamCm}
                      onChange={(e) => setInseamCm(parseFloat(e.target.value) || 0)}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-400 text-[11px] mb-1">Age (years)</label>
                    <input
                      type="number"
                      value={age}
                      onChange={(e) => setAge(parseInt(e.target.value, 10) || 0)}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-xs flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-mono font-bold text-xs uppercase tracking-wider flex items-center gap-2"
                >
                  <span>Continue to Specialized Data</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Specialized Data - PBs & Gym PRs (Full Flow Only) */}
          {!isPartial && step === 3 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
                <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Trophy className="w-4 h-4" />
                  <span>Step 3: Track PBs & Weight Room PRs</span>
                </h3>

                <div className="mb-4">
                  <div className="text-[11px] text-zinc-400 mb-2">Track & Field Competition PBs / Marks for Selected Events:</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {selectedDisciplines.map(disc => (
                      <div key={disc}>
                        <label className="block text-zinc-400 text-[11px] mb-1">{disc} Personal Best (Time/Mark)</label>
                        <input
                          type="text"
                          value={pbs[disc] || ''}
                          onChange={(e) => setPbs({ ...pbs, [disc]: e.target.value })}
                          placeholder={disc.includes('Jump') || disc.includes('Put') || disc.includes('Discus') ? 'e.g. 7.92m / 18.50m' : 'e.g. 10.20s / 46.50s'}
                          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-100 focus:border-cyan-500 focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-zinc-800">
                  <div className="text-[11px] text-zinc-400 mb-2">Triple Extension & Power Records (1RM):</div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-zinc-400 text-[11px] mb-1">Back Squat (kg)</label>
                      <input
                        type="number"
                        value={squatPr}
                        onChange={(e) => setSquatPr(parseFloat(e.target.value) || 0)}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-100 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-zinc-400 text-[11px] mb-1">Power Clean (kg)</label>
                      <input
                        type="number"
                        value={cleanPr}
                        onChange={(e) => setCleanPr(parseFloat(e.target.value) || 0)}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-100 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-zinc-400 text-[11px] mb-1">Bench Press (kg)</label>
                      <input
                        type="number"
                        value={benchPr}
                        onChange={(e) => setBenchPr(parseFloat(e.target.value) || 0)}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-100 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-xs flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-mono font-bold text-xs uppercase tracking-wider flex items-center gap-2"
                >
                  <span>Continue to Injury History</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Structured Injury History & Kinetic Chain Deficiencies (Rendered for both Full & Partial) */}
          {step === 4 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    <span>Step 4: Active Injury History & Kinetic Deficiencies</span>
                  </h3>
                  <button
                    type="button"
                    onClick={handleConfirmNoInjuries}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono flex items-center gap-1.5 transition-all ${
                      hasNoInjuriesConfirmed 
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50' 
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{hasNoInjuriesConfirmed ? 'Confirmed: No Active Injuries' : 'I Have No Active Injuries'}</span>
                  </button>
                </div>
                
                <p className="text-[11px] text-zinc-400 mb-3">
                  Detail any active muscle strains, joint tendinopathy, or mobility restrictions for integral injury mitigation & structural health programming:
                </p>

                {/* Injury Log Table */}
                {injuries.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {injuries.map((inj, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs">
                        <div>
                          <span className="font-bold text-zinc-200">{inj.bodypart}</span>
                          <span className="text-zinc-400 ml-2">— {inj.type}</span>
                          <div className="flex items-center gap-2 mt-1 text-[10px]">
                            <span className={`px-1.5 py-0.5 rounded ${
                              inj.severity === 'SEVERE' ? 'bg-red-950 text-red-400 border border-red-800' :
                              inj.severity === 'MODERATE' ? 'bg-amber-950 text-amber-400 border border-amber-800' :
                              'bg-zinc-800 text-zinc-300'
                            }`}>
                              {inj.severity}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                              {inj.status}
                            </span>
                            <span className="text-zinc-500">{inj.date}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveInjury(idx)}
                          className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {hasNoInjuriesConfirmed && injuries.length === 0 && (
                  <div className="p-3 mb-3 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Cleared: No active injuries reported. Full kinetic chain tissue readiness flagged.</span>
                  </div>
                )}

                {/* Add New Injury Inline */}
                <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80 mb-3">
                  <div className="text-[11px] font-bold text-zinc-300 mb-2">+ Add Injury or Tight Tissue Entry:</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                    <input
                      type="text"
                      value={newBodypart}
                      onChange={(e) => setNewBodypart(e.target.value)}
                      placeholder="Body Part (e.g. Left Hamstring)"
                      className="bg-zinc-900 border border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                    />
                    <input
                      type="text"
                      value={newType}
                      onChange={(e) => setNewType(e.target.value)}
                      placeholder="Type (e.g. Grade 1 strain)"
                      className="bg-zinc-900 border border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                    />
                    <select
                      value={newSeverity}
                      onChange={(e) => setNewSeverity(e.target.value as any)}
                      className="bg-zinc-900 border border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                    >
                      <option value="MILD">MILD</option>
                      <option value="MODERATE">MODERATE</option>
                      <option value="SEVERE">SEVERE</option>
                    </select>
                    <select
                      value={newStatus}
                      onChange={(e) => setNewStatus(e.target.value as any)}
                      className="bg-zinc-900 border border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                    >
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="REHABILITATING">REHABILITATING</option>
                      <option value="RESOLVED">RESOLVED</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddInjury}
                    className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-md text-[11px] font-mono flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Append Entry</span>
                  </button>
                </div>

                <div>
                  <label className="block text-zinc-400 text-[11px] mb-1">
                    Kinetic Deficiencies / Range of Motion Constraints:
                  </label>
                  <textarea
                    rows={2}
                    value={kineticDeficienciesText}
                    onChange={(e) => setKineticDeficienciesText(e.target.value)}
                    placeholder="e.g. Right ankle dorsiflexion limit (12 deg), pelvic asymmetry on late-race sprint upright."
                    className="w-full bg-zinc-900 border border-zinc-700 focus:border-amber-500 rounded-lg p-2.5 text-zinc-100 placeholder-zinc-600 focus:outline-none text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-between items-center pt-2">
                {!isPartial && (
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-xs flex items-center gap-2"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back</span>
                  </button>
                )}

                <button
                  type="submit"
                  disabled={isSaving}
                  className="ml-auto px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-mono font-bold text-xs sm:text-sm uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] flex items-center justify-center gap-2"
                >
                  <ShieldCheck className="w-5 h-5" />
                  <span>{isSaving ? "Saving to Firestore..." : "Save Calibration & Start Integral Coaching"}</span>
                </button>
              </div>
            </div>
          )}

        </form>
      </div>
    </div>
  );
};

export const OnboardingModal = UnsubscribedOnboardingModal;
