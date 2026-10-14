import React from 'react';
import { ShieldCheck, Database, AlertTriangle, CheckCircle2, LogOut, Zap, Menu, BookOpen, Calendar } from 'lucide-react';
import { AthleteProfile, OnboardingGateDecision, PeriodizationContext } from '../types';

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

interface HeaderProps {
  athlete: AthleteProfile;
  isOnline: boolean;
  onboardingComplete?: boolean;
  gateDecision?: OnboardingGateDecision;
  periodizationContext?: PeriodizationContext | null;
  onResetInjuries?: () => void;
  onOpenCoachMethodology?: () => void;
  onOpenEventStandards?: () => void;
  onOpenPeriodization?: () => void;
  onToggleSidebar?: () => void;
  onSignOut?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  athlete,
  isOnline: _isOnline,
  onboardingComplete,
  gateDecision,
  periodizationContext,
  onResetInjuries,
  onOpenCoachMethodology,
  onOpenEventStandards,
  onOpenPeriodization,
  onToggleSidebar,
  onSignOut
}) => {
  const isReady = gateDecision ? (gateDecision.mode === 'none') : Boolean(onboardingComplete);
  const isCoach = athlete.role === 'COACH';

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md sticky top-0 z-30 px-4 py-3 font-sans">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Brand & System Title */}
        <div className="flex items-center gap-3">
          {onToggleSidebar && (
            <button
              id="toggle-threads-sidebar-btn"
              onClick={onToggleSidebar}
              className="p-1.5 rounded-md bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 md:hidden"
              title="Toggle Sessions History"
            >
              <Menu className="w-4 h-4" />
            </button>
          )}

          <div className="relative flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 font-mono font-bold text-lg shadow-[0_0_15px_rgba(16,185,129,0.2)] shrink-0">
            <span>S</span>
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full animate-ping opacity-75"></span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-mono font-bold text-sm tracking-wider text-zinc-100 uppercase">
                STRIDES <span className="text-emerald-400 text-xs">BETA</span>
              </h1>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                ARIA UNIFIED ENGINE
              </span>
            </div>
            <p className="text-xs text-zinc-400 font-mono">
              SYSTEM FOR TACTICAL RACE INSIGHT & DATA EXTRACTION
            </p>
          </div>
        </div>

        {/* System Badges & Telemetry */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          {/* Subscription State Badge */}
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-bold ${
            athlete.isSubscribed
              ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
              : 'bg-amber-950/60 border-amber-800 text-amber-300'
          }`}>
            <Zap className="w-3 h-3 text-amber-400" />
            <span>{athlete.isSubscribed ? "SUBSCRIBED ATHLETE" : "UNSUBSCRIBED ATHLETE"}</span>
          </div>

          {/* User Email */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-zinc-200 font-medium truncate max-w-[150px] sm:max-w-[180px]">{athlete.email}</span>
          </div>

          {/* Database Badge */}
          <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-400" title="Firestore Database ID: ai-studio-2e02a69f-fc8d-46cd-bbc1-146c884acf19">
            <Database className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-cyan-400 font-mono text-[11px]">users/{athlete.id}</span>
          </div>

          {/* Onboarding State */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded border ${
            isReady 
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400' 
              : 'bg-amber-950/40 border-amber-800/60 text-amber-400'
          }`}>
            {isReady ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[11px]">READY</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span className="text-[11px]">ONBOARDING</span>
              </>
            )}
          </div>

          {/* Coach Methodology Button (Strictly Role-Gated: Coach accounts only) */}
          {isCoach && onOpenCoachMethodology && (
            <button
              id="coach-methodology-btn"
              onClick={onOpenCoachMethodology}
              className={`px-2.5 py-1 rounded text-[11px] font-mono border flex items-center gap-1.5 transition-colors ${
                athlete.coachMethodologyDoc
                  ? 'bg-purple-950/70 border-purple-700 text-purple-300 hover:bg-purple-900'
                  : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-300'
              }`}
              title="Upload / Ingest Coach Training Methodology"
            >
              <BookOpen className="w-3 h-3 text-purple-400" />
              <span>COACH METHODOLOGY</span>
            </button>
          )}

          {/* Curated Event Standards Browser */}
          {onOpenEventStandards && (
            <button
              id="event-standards-btn"
              onClick={onOpenEventStandards}
              className="px-2.5 py-1 rounded text-[11px] font-mono border border-cyan-800/80 bg-cyan-950/50 hover:bg-cyan-900/60 text-cyan-300 flex items-center gap-1.5 transition-colors"
              title="Browse Curated Event Reference Standards & Biomechanical Benchmarks"
            >
              <Database className="w-3 h-3 text-cyan-400" />
              <span>EVENT STANDARDS</span>
            </button>
          )}

          {/* Periodization & Competition Calendar */}
          {onOpenPeriodization && (
            <button
              id="periodization-calendar-btn"
              onClick={onOpenPeriodization}
              className={`px-2.5 py-1 rounded text-[11px] font-mono border flex items-center gap-1.5 transition-colors ${
                periodizationContext?.inTaper
                  ? 'border-purple-600 bg-purple-950/70 hover:bg-purple-900/80 text-purple-300 animate-pulse'
                  : 'border-emerald-800/80 bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300'
              }`}
              title="View & Edit Annual Periodization Plan and Competition Calendar"
            >
              <Calendar className="w-3 h-3 text-emerald-400" />
              <span>
                {athlete.clubId ? 'PLAN CLUB' : 'CONTEXTO & CLUB'}
                {periodizationContext?.currentMesocycle ? (
                  <span className="ml-1 text-[10px] opacity-80">
                    [{periodizationContext.currentMesocycle.phase}{periodizationContext.daysToNextComp !== null ? ` · ${periodizationContext.daysToNextComp}d` : ''}]
                  </span>
                ) : ''}
              </span>
            </button>
          )}

          {/* Reset / Re-evaluate Injuries */}
          {onResetInjuries && (
            <button
              id="edit-injuries-btn"
              onClick={onResetInjuries}
              className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-mono border border-zinc-700 transition-colors"
              title="Update Active Injuries & Deficiencies"
            >
              EDIT INJURIES
            </button>
          )}

          {/* Sign Out */}
          {onSignOut && (
            <button
              id="header-signout-btn"
              onClick={onSignOut}
              className="p-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

