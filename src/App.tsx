import React, { useState, useEffect, useMemo, useRef } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { 
  auth, 
  getAthleteProfile, 
  logoutUser, 
  getChatThreads, 
  createChatThread, 
  deleteChatThread, 
  renameChatThread,
  getThreadMessages,
  saveChatMessage,
  saveThreadMessage,
  getThreadActualMessageCount,
  isDefaultThreadTitle,
  checkAndCleanupExpiredFiles,
  getAthletePeriodizationPlan,
  saveAthletePeriodizationPlan,
  getCompetitionCalendar,
  saveCompetitionCalendar,
  getInferredTrainingContext,
  joinClubByCode,
  leaveClub
} from './lib/firebase';
import { 
  AthleteProfile, 
  ChatMessage, 
  ChatThread, 
  OnboardingGateDecision, 
  OnboardingGateMode,
  AthletePeriodizationPlan,
  CompetitionCalendar,
  PeriodizationContext,
  InferredTrainingContext
} from './types';
import { 
  calculatePeriodizationContext, 
  getDefaultPeriodizationPlan, 
  getDefaultCompetitionCalendar 
} from './services/periodizationService';
import { Header } from './components/Header';
import { ChatContainer } from './components/ChatContainer';
import { ChatThreadSidebar } from './components/ChatThreadSidebar';
import { CoachMethodologyModal } from './components/CoachMethodologyModal';
import { AuthModal } from './components/AuthModal';
import { UnsubscribedOnboardingModal } from './components/UnsubscribedOnboardingModal';
import { EventStandardsModal } from './components/EventStandardsModal';
import { PeriodizationCalendarModal } from './components/PeriodizationCalendarModal';

// Evaluates onboarding status based on explicit data completeness:
// a. hasCoreData: heightCm > 0 && weightKg > 0 && inseamCm > 0 && targetEvents.length > 0 (Steps 1-3 baseline completed)
// b. hasInjuryHistory: injuryHistory array exists & has >= 1 entry OR explicit injuryHistoryReviewed flag
export const evaluateOnboardingDecision = (profile: AthleteProfile | null): OnboardingGateDecision => {
  if (!profile) return { showModal: false, mode: 'full', hasCoreData: false, hasInjuryHistory: false };

  const hasCoreData = Boolean(
    profile.anthropometrics &&
    profile.anthropometrics.heightCm > 0 &&
    profile.anthropometrics.weightKg > 0 &&
    profile.anthropometrics.inseamCm !== null &&
    profile.anthropometrics.inseamCm !== undefined &&
    profile.anthropometrics.inseamCm > 0 &&
    profile.targetEvents &&
    profile.targetEvents.length > 0
  );

  const hasInjuryHistory = Boolean(
    (profile.injuryHistory && profile.injuryHistory.length > 0) ||
    profile.injuryHistoryReviewed
  );

  console.log('[STRIDES GATE] Evaluating profile payload for routing:', JSON.stringify(profile, null, 2));
  console.log('[STRIDES GATE] Gating components:', {
    hasAnthro: Boolean(profile.anthropometrics),
    heightCm: profile.anthropometrics?.heightCm,
    weightKg: profile.anthropometrics?.weightKg,
    inseamCm: profile.anthropometrics?.inseamCm,
    targetEvents: profile.targetEvents,
    hasCoreData,
    hasInjuryHistory
  });

  if (!hasCoreData) {
    return { showModal: true, mode: 'full', hasCoreData, hasInjuryHistory };
  } else if (!hasInjuryHistory) {
    return { showModal: true, mode: 'partial', hasCoreData, hasInjuryHistory };
  } else {
    return { showModal: false, mode: 'none', hasCoreData, hasInjuryHistory };
  }
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [athlete, setAthlete] = useState<AthleteProfile | null>(null);
  
  // Chat Threads & Messages State
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Modals
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [showCoachModal, setShowCoachModal] = useState(false);
  const [showStandardsModal, setShowStandardsModal] = useState(false);
  const [showPeriodizationModal, setShowPeriodizationModal] = useState(false);
  const [periodizationPlan, setPeriodizationPlan] = useState<AthletePeriodizationPlan | null>(null);
  const [competitionCalendar, setCompetitionCalendar] = useState<CompetitionCalendar | null>(null);
  const [inferredContext, setInferredContext] = useState<InferredTrainingContext | null>(null);
  const [onboardingMode, setOnboardingMode] = useState<OnboardingGateMode>('full');
  const [isProfileLoading, setIsProfileLoading] = useState(true);

  // Periodization Context (Real-time macro/meso/taper evaluation)
  const periodizationContext = useMemo(() => {
    if (!periodizationPlan || !competitionCalendar) return null;
    return calculatePeriodizationContext(periodizationPlan, competitionCalendar, new Date());
  }, [periodizationPlan, competitionCalendar]);

  // Stable key based on primitive values to prevent gate re-evaluations on every render
  const athleteGateKey = athlete 
    ? `${athlete.id}_${athlete.anthropometrics?.heightCm}_${athlete.anthropometrics?.weightKg}_${athlete.anthropometrics?.inseamCm}_${(athlete.targetEvents || []).join(',')}_${(athlete.injuryHistory || []).length}_${athlete.injuryHistoryReviewed}`
    : 'none';

  // Derive gateDecision with memoization keyed on stable primitive values
  const gateDecision: OnboardingGateDecision = useMemo(() => {
    return evaluateOnboardingDecision(athlete);
  }, [athleteGateKey]);

  // Session-level gate to prevent cleanup from executing more than once per browser session
  const hasRunCleanupRef = useRef(false);

  // Safe cleanup for orphaned empty threads (Session-gated, Subcollection-verified, Hard-capped)
  const cleanupOrphanedThreads = async (
    userId: string, 
    currentThreads: ChatThread[], 
    options?: { isManualTrigger?: boolean }
  ) => {
    const isManual = options?.isManualTrigger ?? false;

    // Requirement 6: Do not run silently on every app load / state update — gate behind session check
    if (!isManual) {
      if (hasRunCleanupRef.current) {
        console.log('[CLEANUP] Skipped: thread cleanup already executed in this runtime session.');
        return;
      }
      const sessionKey = `aria_cleanup_run_${userId}`;
      if (typeof window !== 'undefined' && sessionStorage.getItem(sessionKey)) {
        console.log('[CLEANUP] Skipped: thread cleanup already completed in current sessionStorage.');
        return;
      }
    }

    // Mark as executed for this session
    hasRunCleanupRef.current = true;
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(`aria_cleanup_run_${userId}`, 'true');
      } catch (e) {
        // ignore storage quota / sandbox restrictions
      }
    }

    console.log(`[CLEANUP] Initiating thread audit for user ${userId}. Total threads: ${currentThreads.length}. (Trigger: ${isManual ? 'Manual Action' : 'Session Init'})`);

    try {
      // Requirement 1 & 2:
      // Remove reliance on messageCount entirely. Candidate must have a default un-renamed title.
      // We skip index 0 (the most recent session) to preserve the user's active/current entry.
      const candidateThreads = currentThreads.slice(1).filter(t => isDefaultThreadTitle(t.title));

      if (candidateThreads.length === 0) {
        console.log('[CLEANUP] Audit complete: No candidate default-titled threads found.');
        return;
      }

      console.log(`[CLEANUP] Found ${candidateThreads.length} candidate default-titled thread(s). Verifying real subcollection message counts via Firestore aggregation...`);

      const verifiedEmptyThreads: ChatThread[] = [];

      for (const t of candidateThreads) {
        // Requirement 1: Query actual message subcollection count directly from Firestore
        const actualMsgCount = await getThreadActualMessageCount(userId, t.id);

        // Requirement 2: Only consider empty if BOTH title is default AND real message subcollection count is 0.
        // A thread with even one real message (actualMsgCount >= 1) or unverified count (-1) MUST NEVER be deleted.
        if (actualMsgCount === 0) {
          console.log(`[CLEANUP AUDIT] Candidate verified empty -> ID: "${t.id}", Title: "${t.title}", Subcollection Message Count: 0`);
          verifiedEmptyThreads.push(t);
        } else {
          console.log(`[CLEANUP AUDIT] Preserved thread -> ID: "${t.id}", Title: "${t.title}", Subcollection Message Count: ${actualMsgCount} (NOT empty, preserving history)`);
        }
      }

      if (verifiedEmptyThreads.length === 0) {
        console.log('[CLEANUP] Audit complete: 0 verified empty threads. All candidate threads contain real messages.');
        return;
      }

      // Requirement 4: Hard safety rail — NEVER delete more than a small sane threshold (3) per run without explicit confirmation
      const MAX_AUTO_DELETE_THRESHOLD = 3;

      if (verifiedEmptyThreads.length > MAX_AUTO_DELETE_THRESHOLD && !isManual) {
        console.warn(
          `[CLEANUP SAFETY RAIL ACTIVATED] Found ${verifiedEmptyThreads.length} verified empty thread candidates, which exceeds the safe automatic threshold of ${MAX_AUTO_DELETE_THRESHOLD}. Aborting automatic deletion to prevent mass deletion or unintended data loss. User confirmation or manual cleanup required.`
        );
        return;
      }

      // Cap deletions per run at threshold
      const threadsToDelete = verifiedEmptyThreads.slice(0, MAX_AUTO_DELETE_THRESHOLD);

      let deletedCount = 0;
      for (const t of threadsToDelete) {
        // Requirement 5: console.log of every threadId and title being deleted, BEFORE deletion happens
        console.log(`[CLEANUP AUDIT] DELETING verified empty thread -> ID: "${t.id}", Title: "${t.title}", Subcollection Message Count: 0`);
        await deleteChatThread(userId, t.id);
        deletedCount++;
      }

      if (deletedCount > 0) {
        console.log(`[CLEANUP AUDIT] Successfully deleted ${deletedCount} verified empty orphaned thread(s).`);
        // Reload threads to reflect deletions cleanly
        const updatedThreads = await getChatThreads(userId);
        setThreads(updatedThreads);
      }
    } catch (err) {
      console.error('[CLEANUP] Error during thread cleanup audit:', err);
    }
  };

  // Load threads for authenticated user
  const loadUserThreads = async (userId: string) => {
    try {
      const userThreads = await getChatThreads(userId);
      setThreads(userThreads);
      
      const profile = await getAthleteProfile(userId);
      const userName = profile?.name?.split(' ')[0] || 'Atleta';
      const greetingMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: `Hola ${userName}, listo para tu sesión de hoy.`,
        timestamp: new Date().toISOString()
      };

      // Run cleanup async in background
      cleanupOrphanedThreads(userId, userThreads);
      checkAndCleanupExpiredFiles(userId).then(count => {
        if (count > 0) console.log(`[48h-CLEANUP] Cleaned ${count} expired files for user ${userId}`);
      }).catch(err => console.warn('[48h-CLEANUP] Background check error:', err));

      // Commercial LLM UX (ChatGPT/Claude style):
      // On page load/open, ALWAYS present a fresh session with greeting.
      // If the most recent thread is purely empty or only has an unsent greeting, attach to it.
      // If the thread has real conversation history (messageCount > 1), NEVER auto-load it on open — user accesses it via sidebar.
      const latestThread = userThreads[0];
      if (latestThread && (latestThread.messageCount === 0 || (latestThread.messageCount === 1 && latestThread.lastMessagePreview?.includes('listo para tu sesión')))) {
        setActiveThreadId(latestThread.id);
        const threadMsgs = await getThreadMessages(userId, latestThread.id);
        if (threadMsgs.length === 0) {
          setMessages([greetingMsg]);
          await saveThreadMessage(userId, latestThread.id, greetingMsg);
        } else {
          setMessages([greetingMsg]);
        }
      } else {
        // Fresh new session state on open
        setActiveThreadId(null);
        setMessages([greetingMsg]);
      }
    } catch (err) {
      console.warn('Error loading threads:', err);
    }
  };

  // Monitor Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      setAuthInitialized(true);

      if (user) {
        setShowAuthModal(false);
        setIsProfileLoading(true);
        
        // Direct read from Firestore `/users/{uid}`
        const profile = await getAthleteProfile(user.uid);
        setAthlete(profile);

        // Load periodization plan & competition calendar & inferred context
        const isClub = Boolean(profile?.clubId && profile.clubId.trim().length > 0);
        try {
          const [userPlan, userCal, userInferred] = await Promise.all([
            getAthletePeriodizationPlan(user.uid),
            getCompetitionCalendar(user.uid),
            getInferredTrainingContext(user.uid)
          ]);
          setPeriodizationPlan(userPlan || (isClub ? null : getDefaultPeriodizationPlan(user.uid)));
          setCompetitionCalendar(userCal || (isClub ? null : getDefaultCompetitionCalendar(user.uid)));
          setInferredContext(userInferred);
        } catch (planErr) {
          console.warn('Error loading periodization plan or inferred context:', planErr);
          setPeriodizationPlan(isClub ? null : getDefaultPeriodizationPlan(user.uid));
          setCompetitionCalendar(isClub ? null : getDefaultCompetitionCalendar(user.uid));
        }

        const decision = evaluateOnboardingDecision(profile);
        setOnboardingMode(decision.mode);
        setShowOnboardingModal(decision.showModal);
        
        // Load threads
        await loadUserThreads(user.uid);

        setIsProfileLoading(false);
      } else {
        // If unauthenticated, display Auth Modal with zero-flash
        setShowAuthModal(true);
        setIsProfileLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Handle manual login/auth from AuthModal
  const handleAuthenticated = async (userId: string) => {
    setShowAuthModal(false);
    setIsProfileLoading(true);
    const profile = await getAthleteProfile(userId);
    setAthlete(profile);

    const isClub = Boolean(profile?.clubId && profile.clubId.trim().length > 0);
    try {
      const [userPlan, userCal, userInferred] = await Promise.all([
        getAthletePeriodizationPlan(userId),
        getCompetitionCalendar(userId),
        getInferredTrainingContext(userId)
      ]);
      setPeriodizationPlan(userPlan || (isClub ? null : getDefaultPeriodizationPlan(userId)));
      setCompetitionCalendar(userCal || (isClub ? null : getDefaultCompetitionCalendar(userId)));
      setInferredContext(userInferred);
    } catch (planErr) {
      console.warn('Error loading periodization plan or inferred context:', planErr);
      setPeriodizationPlan(isClub ? null : getDefaultPeriodizationPlan(userId));
      setCompetitionCalendar(isClub ? null : getDefaultCompetitionCalendar(userId));
    }

    const decision = evaluateOnboardingDecision(profile);
    setOnboardingMode(decision.mode);
    setShowOnboardingModal(decision.showModal);
    
    await loadUserThreads(userId);
    setIsProfileLoading(false);
  };

  const handleJoinClub = async (joinCode: string) => {
    if (!athlete) return { success: false, error: 'No hay atleta activo' };
    const res = await joinClubByCode(athlete.id, joinCode);
    if (res.success && res.club) {
      setAthlete(prev => prev ? ({ ...prev, clubId: res.club!.id }) : null);
      return { success: true };
    }
    return { success: false, error: res.error || 'Código no válido' };
  };

  const handleLeaveClub = async () => {
    if (!athlete || !athlete.clubId) return false;
    const ok = await leaveClub(athlete.id, athlete.clubId);
    if (ok) {
      setAthlete(prev => prev ? ({ ...prev, clubId: null }) : null);
      return true;
    }
    return false;
  };

  const handleSavePlanAndCalendar = async (newPlan: AthletePeriodizationPlan, newCalendar: CompetitionCalendar) => {
    if (!athlete) return;
    await Promise.all([
      saveAthletePeriodizationPlan(athlete.id, newPlan),
      saveCompetitionCalendar(athlete.id, newCalendar)
    ]);
    setPeriodizationPlan(newPlan);
    setCompetitionCalendar(newCalendar);
  };

  // Handle switching threads
  const handleSelectThread = async (threadId: string) => {
    if (!athlete) return;
    setActiveThreadId(threadId);
    try {
      const threadMsgs = await getThreadMessages(athlete.id, threadId);
      setMessages(threadMsgs);
    } catch (err) {
      console.warn('Error switching thread:', err);
    }
  };

  // Handle creating a new thread (locally only)
  const handleNewThread = async () => {
    if (!athlete) return;
    try {
      setActiveThreadId(null);
      const userName = athlete.name?.split(' ')[0] || 'Atleta';
      setMessages([{
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: `Hola ${userName}, listo para tu sesión de hoy.`,
        timestamp: new Date().toISOString()
      }]);
    } catch (err) {
      console.warn('Error setting up new thread:', err);
    }
  };

  // Called by ChatContainer when a user sends a message but no thread exists
  const handleRequireThread = async (greetingMsgToSave?: ChatMessage): Promise<string> => {
    if (!athlete) throw new Error("No athlete found");
    const targetDiscipline = athlete.targetEvents?.[0] || 'Tactical Session';
    const sessionCount = threads.length + 1;
    const newThread = await createChatThread(athlete.id, `${targetDiscipline} #${sessionCount}`);
    setThreads(prev => [newThread, ...prev]);
    setActiveThreadId(newThread.id);
    
    // Persist the greeting message if there is one
    if (greetingMsgToSave) {
      await saveThreadMessage(athlete.id, newThread.id, greetingMsgToSave);
      await saveChatMessage(athlete.id, greetingMsgToSave);
    }
    
    return newThread.id;
  };

  // Handle deleting a thread
  const handleDeleteThread = async (threadId: string) => {
    if (!athlete) return;
    console.log(`[DEBUG] handleDeleteThread called for threadId: ${threadId}`);
    try {
      console.log(`[DEBUG] Calling deleteChatThread...`);
      await deleteChatThread(athlete.id, threadId);
      console.log(`[DEBUG] deleteChatThread succeeded.`);
      
      const remaining = threads.filter(t => t.id !== threadId);
      console.log(`[DEBUG] Remaining threads count: ${remaining.length}`);
      setThreads(remaining);
      
      if (activeThreadId === threadId) {
        if (remaining.length > 0) {
          console.log(`[DEBUG] Selecting next available thread: ${remaining[0].id}`);
          handleSelectThread(remaining[0].id);
        } else {
          console.log(`[DEBUG] No remaining threads, invoking handleNewThread()`);
          handleNewThread();
        }
      }
    } catch (err: any) {
      console.error('[DEBUG] Error inside handleDeleteThread catch block:', err);
      alert(err.message || 'No se pudo eliminar la sesión, intenta de nuevo.');
    }
  };

  // Handle manual rename of a thread
  const handleRenameThread = async (threadId: string, newTitle: string) => {
    if (!athlete) return;
    const cleanTitle = newTitle.trim();
    if (!cleanTitle) return;
    try {
      await renameChatThread(athlete.id, threadId, cleanTitle);
      setThreads(prev => prev.map(t => t.id === threadId ? { ...t, title: cleanTitle } : t));
    } catch (err) {
      console.warn('Error renaming thread:', err);
    }
  };

  // Handle auto-generated thread title from first exchange
  const handleThreadTitleUpdated = (threadId: string, newTitle: string) => {
    setThreads(prev => prev.map(t => t.id === threadId ? { ...t, title: newTitle } : t));
  };

  // Handle completed onboarding
  const handleOnboardingComplete = (updatedProfile: AthleteProfile) => {
    setAthlete(updatedProfile);
    setShowOnboardingModal(false);
  };

  // Sign out handler
  const handleSignOut = async () => {
    await logoutUser();
    setCurrentUser(null);
    setAthlete(null);
    setMessages([]);
    setThreads([]);
    setActiveThreadId(null);
    setShowAuthModal(true);
  };

  const handleResetInjuries = () => {
    setOnboardingMode('partial');
    setShowOnboardingModal(true);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-zinc-950">
      
      {/* Zero-Flash Loading Cover: Gated on full Firestore read */}
      {(!authInitialized || isProfileLoading) && (
        <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col items-center justify-center font-sans">
          <div className="flex items-center gap-3 text-emerald-400 font-mono text-sm">
            <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            <span>STRIDES High-Performance Engine Initializing...</span>
          </div>
        </div>
      )}

      {/* Step 1: Authentication Gate */}
      {showAuthModal && (
        <AuthModal onAuthenticated={handleAuthenticated} />
      )}

      {/* Step 2: Stepped / Gated Onboarding Modal (Rendered as overlay modal) */}
      {!showAuthModal && showOnboardingModal && athlete && !isProfileLoading && (
        <UnsubscribedOnboardingModal
          athlete={athlete}
          mode={onboardingMode === 'none' ? 'partial' : onboardingMode}
          onOnboardingComplete={handleOnboardingComplete}
          onClose={() => setShowOnboardingModal(false)}
        />
      )}

      {/* Coach Methodology Modal (5-Year Rolling Literature Verification) */}
      {showCoachModal && athlete && athlete.role === 'COACH' && (
        <CoachMethodologyModal
          athlete={athlete}
          setAthlete={setAthlete}
          isOpen={showCoachModal}
          onClose={() => setShowCoachModal(false)}
        />
      )}

      {/* Curated Event Reference Standards Modal */}
      <EventStandardsModal
        isOpen={showStandardsModal}
        onClose={() => setShowStandardsModal(false)}
      />

      {/* Periodization & Competition Calendar Modal */}
      {showPeriodizationModal && athlete && periodizationPlan && competitionCalendar && periodizationContext && (
        <PeriodizationCalendarModal
          isOpen={showPeriodizationModal}
          onClose={() => setShowPeriodizationModal(false)}
          athlete={athlete}
          plan={periodizationPlan}
          calendar={competitionCalendar}
          context={periodizationContext}
          inferredContext={inferredContext}
          onSavePlanAndCalendar={handleSavePlanAndCalendar}
          onJoinClub={handleJoinClub}
          onLeaveClub={handleLeaveClub}
        />
      )}

      {/* Header Bar */}
      {athlete && !isProfileLoading && (
        <Header
          athlete={athlete}
          isOnline={true}
          gateDecision={gateDecision}
          onboardingComplete={gateDecision.mode === 'none'}
          periodizationContext={periodizationContext}
          onResetInjuries={handleResetInjuries}
          onOpenCoachMethodology={() => setShowCoachModal(true)}
          onOpenEventStandards={() => setShowStandardsModal(true)}
          onOpenPeriodization={() => setShowPeriodizationModal(true)}
          onToggleSidebar={() => setSidebarOpen(prev => !prev)}
          onSignOut={handleSignOut}
        />
      )}

      {/* Main Layout: Chat Thread Sidebar + Unified Chat Interface */}
      <div className="flex-1 flex overflow-hidden">
        {athlete && !isProfileLoading && (
          <ChatThreadSidebar
            threads={threads}
            activeThreadId={activeThreadId}
            onSelectThread={handleSelectThread}
            onNewThread={handleNewThread}
            onDeleteThread={handleDeleteThread}
            onRenameThread={handleRenameThread}
            onCleanupEmptyThreads={async () => {
              if (athlete) {
                await cleanupOrphanedThreads(athlete.id, threads, { isManualTrigger: true });
              }
            }}
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          />
        )}

        <main className="flex-1 flex flex-col min-w-0 bg-zinc-950">
          {athlete && !isProfileLoading ? (
            <ChatContainer
              athlete={athlete}
              setAthlete={setAthlete}
              messages={messages}
              setMessages={setMessages}
              activeThreadId={activeThreadId}
              gateDecision={gateDecision}
              periodizationPlan={periodizationPlan}
              competitionCalendar={competitionCalendar}
              inferredContext={inferredContext}
              onInferredContextUpdated={(ctx) => setInferredContext(ctx)}
              onPeriodizationPlanUpdated={(newPlan, newCal) => {
                setPeriodizationPlan(newPlan);
                setCompetitionCalendar(newCal);
              }}
              onResetInjuries={handleResetInjuries}
              onThreadTitleUpdated={handleThreadTitleUpdated}
              onRequireThread={handleRequireThread}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
