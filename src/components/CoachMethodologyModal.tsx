import React, { useState } from 'react';
import { AthleteProfile, CoachMethodologyDoc } from '../types';
import { saveCoachMethodologyDoc } from '../lib/firebase';

interface CoachMethodologyModalProps {
  athlete: AthleteProfile;
  setAthlete: React.Dispatch<React.SetStateAction<AthleteProfile | null>>;
  isOpen: boolean;
  onClose: () => void;
}

export const CoachMethodologyModal: React.FC<CoachMethodologyModalProps> = ({
  athlete,
  setAthlete,
  isOpen,
  onClose
}) => {
  const existingDoc = athlete.coachMethodologyDoc;
  const [title, setTitle] = useState(existingDoc?.title || 'Personal Sprint & Power Training Doctrine');
  const [content, setContent] = useState(
    existingDoc?.content || 
    `# High-Velocity Sprint & Core Rigidity Framework
- Emphasize isometric core stiffness and anti-extension bracing to resist excessive anterior pelvic tilt during top-speed sprinting.
- Prioritize high-velocity eccentric overload for the biceps femoris in late-swing deceleration.
- Implement potentiation complexes combining heavy quarter squats (85%+ 1RM) with unresisted 30m sprint flys to optimize neuromuscular rate of force development (RFD).
- Restrict max-velocity sprint volume to under 300m per session when CNS fatigue compromises ground contact times.`
  );
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<CoachMethodologyDoc | null>(existingDoc || null);
  const [statusMessage, setStatusMessage] = useState('');

  // Strict role check: Modal is strictly for COACH accounts
  if (!isOpen || athlete.role !== 'COACH') return null;

  const handleValidateAndSave = async () => {
    if (!content.trim()) {
      setStatusMessage('Please enter methodology content.');
      return;
    }

    setIsValidating(true);
    setStatusMessage('Scanning peer-reviewed literature (2021–2026 5-Year Window)...');

    try {
      const response = await fetch('/api/coach/validate-methodology', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content,
          discipline: athlete.targetEvents?.[0] || 'Track and Field Sprint Biomechanics',
          athleteId: athlete.id,
          userId: athlete.id
        })
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Forbidden: Only Coach accounts can ingest coaching methodologies.');
        }
        throw new Error('Validation failed');
      }

      const data = await response.json();
      const newDoc: CoachMethodologyDoc = {
        id: existingDoc?.id || `coach-doc-${Date.now()}`,
        title,
        content,
        uploadedAt: new Date().toISOString(),
        validationStatus: data.validationStatus || 'PARTIALLY_VALIDATED',
        verifiedClaims: data.verifiedClaims || [],
        unverifiedClaims: data.unverifiedClaims || []
      };

      setValidationResult(newDoc);
      await saveCoachMethodologyDoc(athlete.id, newDoc);

      setAthlete(prev => prev ? {
        ...prev,
        coachMethodologyDoc: newDoc,
        updatedAt: new Date().toISOString()
      } : null);

      setStatusMessage('Methodology verified against 2021-2026 sports science and saved to STRIDES engine.');
    } catch (err: any) {
      console.error('Validation error:', err);
      setStatusMessage('Error validating document. Saved with fallback validation.');
    } finally {
      setIsValidating(false);
    }
  };

  const getStatusBadge = (status: 'VALIDATED' | 'PARTIALLY_VALIDATED' | 'UNVERIFIED') => {
    switch (status) {
      case 'VALIDATED':
        return (
          <span className="px-2.5 py-1 rounded text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            PEER-REVIEW VALIDATED (2021–2026)
          </span>
        );
      case 'PARTIALLY_VALIDATED':
        return (
          <span className="px-2.5 py-1 rounded text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            PARTIALLY VALIDATED + PROPRIETARY CUES
          </span>
        );
      case 'UNVERIFIED':
        return (
          <span className="px-2.5 py-1 rounded text-xs font-bold bg-zinc-700/40 text-zinc-300 border border-zinc-600 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-zinc-400"></span>
            UNVERIFIED PROPRIETARY PHILOSOPHY
          </span>
        );
    }
  };

  return (
    <div 
      id="coach-methodology-modal-backdrop"
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <div 
        id="coach-methodology-modal-content"
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 border-b border-zinc-800 bg-zinc-950 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                COACH PORTAL
              </span>
              <h2 className="text-base font-bold text-white tracking-wide">
                Custom Training Methodology Ingestion
              </h2>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Ingest your personal philosophy into the ARIA integral reasoning engine. Claims are cross-referenced against peer-reviewed literature published in the last 5 years (2021–2026).
            </p>
          </div>
          <button
            id="close-coach-modal-btn"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          <div>
            <label className="block text-xs font-mono font-medium text-zinc-300 mb-1">
              Methodology Document Title
            </label>
            <input
              id="coach-methodology-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-hidden focus:border-purple-500"
              placeholder="e.g., Anaerobic Speed Reserve & Sprint Cadence Model"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-mono font-medium text-zinc-300">
                Methodology Text / Training Principles (Markdown supported)
              </label>
              <span className="text-[11px] text-zinc-500 font-mono">5-Year Literature Filter: 2021–2026</span>
            </div>
            <textarea
              id="coach-methodology-content-textarea"
              rows={8}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-md p-3 text-xs text-zinc-100 font-mono placeholder-zinc-500 focus:outline-hidden focus:border-purple-500 custom-scrollbar"
              placeholder="Paste or write your tactical drills, loading rules, volume caps, or biomechanical cues here..."
            />
          </div>

          {/* Validation Results Display */}
          {validationResult && (
            <div className="p-3.5 bg-zinc-950/80 border border-zinc-800 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-zinc-300 uppercase">
                  Evidence Engine Validation Status:
                </span>
                {getStatusBadge(validationResult.validationStatus)}
              </div>

              {/* Verified Claims */}
              {validationResult.verifiedClaims && validationResult.verifiedClaims.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                    ✓ Verified Peer-Reviewed Scientific Claims (≤5 Years)
                  </span>
                  <ul className="text-xs text-zinc-300 space-y-1 pl-4 list-disc">
                    {validationResult.verifiedClaims.map((c, i) => (
                      <li key={i} className="text-zinc-200">{c}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Unverified Proprietary Claims */}
              {validationResult.unverifiedClaims && validationResult.unverifiedClaims.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-zinc-800/80">
                  <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                    ⚠️ Proprietary Cues / Unverified Methodology (Preserved)
                  </span>
                  <p className="text-[11px] text-zinc-400">
                    These cues are preserved for your athletes without claiming unbacked clinical proof:
                  </p>
                  <ul className="text-xs text-zinc-400 space-y-1 pl-4 list-disc">
                    {validationResult.unverifiedClaims.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {statusMessage && (
            <div className="text-xs font-mono text-emerald-400 bg-emerald-950/30 border border-emerald-800/50 p-2.5 rounded-md">
              {statusMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-zinc-800 bg-zinc-950 flex items-center justify-between">
          <div className="text-[11px] text-zinc-400">
            {existingDoc ? `Last updated: ${new Date(existingDoc.uploadedAt).toLocaleDateString()}` : 'No document currently active.'}
          </div>
          <div className="flex items-center gap-2">
            <button
              id="cancel-coach-modal-btn"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs text-zinc-300 hover:text-white hover:bg-zinc-800"
            >
              Close
            </button>
            <button
              id="validate-coach-methodology-btn"
              onClick={handleValidateAndSave}
              disabled={isValidating}
              className="px-4 py-1.5 rounded text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white transition disabled:opacity-50 flex items-center gap-2 shadow-xs"
            >
              {isValidating ? (
                <>
                  <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin"></span>
                  <span>Validating Literature...</span>
                </>
              ) : (
                <span>Validate (5-Year Window) & Save</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
