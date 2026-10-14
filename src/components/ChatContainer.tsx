import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  RefreshCw, 
  AlertTriangle, 
  Zap, 
  ShieldAlert, 
  Cpu, 
  Sparkles, 
  CheckCircle, 
  Flame, 
  Paperclip, 
  X,
  FileText,
  Image as ImageIcon,
  Clock,
  UploadCloud,
  Mic,
  MicOff,
  Volume2
} from 'lucide-react';
import { 
  AthleteProfile, 
  ChatMessage, 
  AttachedFile, 
  OnboardingGateDecision,
  AthletePeriodizationPlan,
  CompetitionCalendar,
  InferredTrainingContext
} from '../types';
import { ChatMessageItem } from './ChatMessageItem';
import { 
  getAthleteProfile,
  updateAthleteProfile, 
  saveChatMessage, 
  saveThreadMessage, 
  saveChatThread, 
  getUserPastThreadFacts, 
  uploadChatFiles,
  deleteThreadMessages,
  saveAthletePeriodizationPlan,
  saveCompetitionCalendar,
  requestDriveAccessToken
} from '../lib/firebase';
import { showGoogleDrivePicker } from '../lib/googlePicker';

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

interface ChatContainerProps {
  athlete: AthleteProfile;
  setAthlete: React.Dispatch<React.SetStateAction<AthleteProfile>>;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  activeThreadId?: string | null;
  gateDecision: OnboardingGateDecision;
  periodizationPlan?: AthletePeriodizationPlan | null;
  competitionCalendar?: CompetitionCalendar | null;
  inferredContext?: InferredTrainingContext | null;
  onPeriodizationPlanUpdated?: (newPlan: AthletePeriodizationPlan, newCalendar: CompetitionCalendar) => void;
  onInferredContextUpdated?: (context: InferredTrainingContext) => void;
  onResetInjuries: () => void;
  onThreadTitleUpdated?: (threadId: string, newTitle: string) => void;
  onRequireThread?: (greetingMsgToSave?: ChatMessage) => Promise<string>;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({
  athlete,
  setAthlete,
  messages,
  setMessages,
  activeThreadId,
  gateDecision,
  periodizationPlan,
  competitionCalendar,
  inferredContext,
  onPeriodizationPlanUpdated,
  onInferredContextUpdated,
  onResetInjuries,
  onThreadTitleUpdated,
  onRequireThread
}) => {
  const [inputMessage, setInputMessage] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [attachedDriveFiles, setAttachedDriveFiles] = useState<AttachedFile[]>([]);
  const [isOpeningPicker, setIsOpeningPicker] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isPreloading, setIsPreloading] = useState(false);
  const [statusLog, setStatusLog] = useState<string>('');
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isSlowWarning, setIsSlowWarning] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isSendingRef = useRef(false);
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  // Voice Recording (Web Speech API) & Live Audio Waveform / Volume Meter
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [audioVolume, setAudioVolume] = useState<number>(0); // 0-100%
  const [waveformBars, setWaveformBars] = useState<number[]>([15, 20, 25, 30, 25, 20, 15, 12]);
  const recognitionRef = useRef<any>(null);
  const silenceTimeoutRef = useRef<any>(null);
  const baseTextBeforeSpeechRef = useRef<string>('');
  const accumulatedSpeechRef = useRef<string>('');
  const isListeningRef = useRef<boolean>(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const simulatedTimerRef = useRef<any>(null);

  // Stop audio analyzer and cleanup microphone tracks
  const stopAudioVisualizer = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (simulatedTimerRef.current) {
      clearInterval(simulatedTimerRef.current);
      simulatedTimerRef.current = null;
    }
    if (mediaStreamRef.current) {
      try {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      } catch {}
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioVolume(0);
    setWaveformBars([12, 16, 20, 16, 12, 16, 12, 10]);
  };

  // Organic simulated waveform fallback if getUserMedia is denied/unsupported
  const startSimulatedVisualizer = () => {
    let tick = 0;
    if (simulatedTimerRef.current) clearInterval(simulatedTimerRef.current);
    simulatedTimerRef.current = setInterval(() => {
      if (!isListeningRef.current) {
        clearInterval(simulatedTimerRef.current);
        return;
      }
      tick++;
      const base = 25 + Math.sin(tick * 0.45) * 18;
      const bars = [
        Math.max(12, Math.round(base * 0.7 + Math.sin(tick * 0.6) * 14)),
        Math.max(14, Math.round(base * 1.1 + Math.cos(tick * 0.8) * 22)),
        Math.max(18, Math.round(base * 1.4 + Math.sin(tick * 0.5) * 28)),
        Math.max(20, Math.round(base * 1.8 + Math.cos(tick * 0.7) * 36)),
        Math.max(18, Math.round(base * 1.5 + Math.sin(tick * 0.9) * 26)),
        Math.max(14, Math.round(base * 1.2 + Math.cos(tick * 0.4) * 22)),
        Math.max(12, Math.round(base * 0.9 + Math.sin(tick * 0.7) * 16)),
        Math.max(10, Math.round(base * 0.6 + Math.cos(tick * 0.5) * 12)),
      ];
      setWaveformBars(bars);
      setAudioVolume(Math.min(95, Math.round(base * 1.4)));
    }, 85);
  };

  // Start real-time audio visualizer using Web Audio API
  const startAudioVisualizer = async () => {
    stopAudioVisualizer();
    try {
      if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        startSimulatedVisualizer();
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isListeningRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) {
        startSimulatedVisualizer();
        return;
      }

      const ctx = new AudioCtx();
      audioContextRef.current = ctx;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64; // 32 frequency bins
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const renderFrame = () => {
        if (!isListeningRef.current || !analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        // Scale to 0 - 100%
        const normalizedVol = Math.min(100, Math.round((avg / 135) * 100));
        setAudioVolume(normalizedVol);

        // 8 waveform bars across frequency spectrum
        const binStep = Math.max(1, Math.floor(dataArray.length / 8));
        const bars: number[] = [];
        for (let i = 0; i < 8; i++) {
          const val = dataArray[i * binStep] || 0;
          // Scale to percentage height (12% minimum so bars remain cleanly visible)
          const barH = Math.max(12, Math.min(100, Math.round((val / 200) * 100)));
          bars.push(barH);
        }
        setWaveformBars(bars);

        animationFrameRef.current = requestAnimationFrame(renderFrame);
      };

      animationFrameRef.current = requestAnimationFrame(renderFrame);
    } catch (err) {
      console.warn('[WebAudio] Fallback to simulated audio waveform:', err);
      startSimulatedVisualizer();
    }
  };

  // Stop listening cleanly
  const stopListening = () => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    isListeningRef.current = false;
    setIsListening(false);
    stopAudioVisualizer();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore already stopped
      }
    }
  };

  // Reset silence timer: auto-stop after 3.5 seconds of silence
  const resetSilenceTimer = () => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
    silenceTimeoutRef.current = setTimeout(() => {
      stopListening();
    }, 3500);
  };

  // Start speech recognition
  const startListening = () => {
    setSpeechError(null);
    const SpeechRecognition =
      (typeof window !== 'undefined' &&
        ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) ||
      null;

    if (!SpeechRecognition) {
      setSpeechError('Web Speech API no está soportada en este navegador.');
      setTimeout(() => setSpeechError(null), 4000);
      return;
    }

    try {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }

      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'es-ES';

      baseTextBeforeSpeechRef.current = inputMessage;
      accumulatedSpeechRef.current = '';

      recognition.onstart = () => {
        isListeningRef.current = true;
        setIsListening(true);
        resetSilenceTimer();
        startAudioVisualizer();
      };

      recognition.onresult = (event: any) => {
        resetSilenceTimer();
        let interim = '';
        let newFinal = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          const transcript = item[0]?.transcript || '';
          if (item.isFinal) {
            newFinal += transcript;
          } else {
            interim += transcript;
          }
        }

        if (newFinal) {
          accumulatedSpeechRef.current += (accumulatedSpeechRef.current ? ' ' : '') + newFinal.trim();
        }

        const spokenSoFar = (accumulatedSpeechRef.current + (interim ? ' ' + interim.trim() : '')).trim();
        const base = baseTextBeforeSpeechRef.current.trim();
        const updated = base ? `${base} ${spokenSoFar}` : spokenSoFar;
        setInputMessage(updated);
      };

      recognition.onerror = (event: any) => {
        console.warn('[WebSpeech] Recognition error:', event.error);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setSpeechError('Acceso al micrófono denegado. Permite el micrófono en tu navegador.');
          setTimeout(() => setSpeechError(null), 5000);
          stopListening();
        } else if (event.error === 'no-speech') {
          // Athlete paused; normal lifecycle
        } else {
          setSpeechError(`Aviso de voz: ${event.error}`);
          setTimeout(() => setSpeechError(null), 4000);
        }
      };

      recognition.onend = () => {
        if (isListeningRef.current) {
          stopListening();
        }
      };

      recognition.start();
    } catch (err: any) {
      console.error('[WebSpeech] Failed to start recognition:', err);
      setSpeechError(err?.message || 'No se pudo activar el micrófono.');
      setTimeout(() => setSpeechError(null), 4000);
      setIsListening(false);
      isListeningRef.current = false;
      stopAudioVisualizer();
    }
  };

  const toggleVoiceRecording = () => {
    if (isListening) {
      stopListening();
      inputRef.current?.focus();
    } else {
      startListening();
    }
  };

  // Cleanup Web Speech recognition & Web Audio visualizer on unmount
  useEffect(() => {
    return () => {
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }
      stopAudioVisualizer();
    };
  }, []);

  // Timer for tracking active query duration (triggers non-blocking notice at >20s)
  useEffect(() => {
    let interval: any = null;
    if (isLoading) {
      setElapsedSeconds(0);
      interval = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isLoading]);

  useEffect(() => {
    if (activeThreadId) {
      setIsPreloading(true);
      fetch('/api/context/preload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athleteProfile: athlete, activeThreadId })
      }).finally(() => {
        setIsPreloading(false);
      });
    }
  }, [activeThreadId, athlete]);

  // Auto scroll
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, statusLog, isLoading]);

  // Initial System Onboarding / Welcome Message driven strictly by gateDecision from App.tsx
  // CRITICAL: NEVER overwrite existing user messages or active conversation
  useEffect(() => {
    if (!athlete) return;
    if (messages.length > 0) return; // Keep existing conversation intact!

    if (gateDecision.mode === 'partial') {
      // mode 'partial' (hasCoreData: true, hasInjuryHistory: false)
      const content = `### STRIDES HIGH-PERFORMANCE SYSTEM
**Profile & Performance Data Calibrated**

To finalize integral load management and tissue bulletproofing, please declare any active injuries, tight tissue, or kinetic chain history.

*Select a quick preset below, type your status, or click **"EDIT INJURIES"** in the top bar.*`;

      const initialPartialMsg: ChatMessage = {
        id: 'init-partial-1',
        role: 'assistant',
        content,
        timestamp: new Date().toISOString(),
        metadata: {
          isInjuryOnboardingResponse: true
        }
      };
      setMessages([initialPartialMsg]);

    } else if (gateDecision.mode === 'full') {
      // mode 'full' (!hasCoreData) -> full calibration required
      const content = `### STRIDES HIGH-PERFORMANCE SYSTEM
**Calibration Required**

To configure your ARIA integral tactical programming, complete your initial setup:
1. **Biometrics & Discipline Targets** (Anthropometrics, primary events)
2. **Performance Benchmarks** (Current PBs/marks & key 1RMs)
3. **Kinetic History** (Active tissue flags or injury status)

*Use the guided onboarding modal or message directly below.*`;

      const initialFullMsg: ChatMessage = {
        id: 'init-full-1',
        role: 'assistant',
        content,
        timestamp: new Date().toISOString(),
        metadata: {
          isUnsubscribedOnboardingPrompt: true
        }
      };
      setMessages([initialFullMsg]);

    } else {
      // mode 'none' (hasCoreData && hasInjuryHistory both true)
      const targetSummary = athlete.targetEvents && athlete.targetEvents.length > 0
        ? athlete.targetEvents.join(' / ')
        : 'Track & Field';

      const content = `### STRIDES HIGH-PERFORMANCE SYSTEM
**Entrenador Integral Activo** • ${targetSummary}

La programación táctica del evento, el desarrollo de fuerza y el resguardo estructural están calibrados. ¿Qué sesión, objetivo de microciclo o consulta técnica vamos a abordar hoy?`;

      const initialReadyMsg: ChatMessage = {
        id: 'init-ready-1',
        role: 'assistant',
        content,
        timestamp: new Date().toISOString(),
        metadata: {}
      };
      setMessages([initialReadyMsg]);
    }
  }, [athlete?.id, gateDecision?.mode, messages.length]);

  // Handle Quick Action Pill Clicks with Instant Persistence
  const handleSelectInjuryPrompt = async (prompt: string) => {
    setInputMessage(prompt);
    
    // Explicitly update Firestore with reviewed status to ensure persistence
    if (prompt.includes("100% healthy") || prompt.includes("No active injuries")) {
      const updates: Partial<AthleteProfile> = {
        injuryHistory: [],
        activeInjuries: ['None reported (Tissue Ready / Fully Cleared)'],
        kineticDeficiencies: [],
        injuryHistoryReviewed: true,
        onboardingComplete: true
      };
      await updateAthleteProfile(athlete.id, updates);
      setAthlete(prev => ({ ...prev, ...updates }));
    } else if (prompt.includes("Left Hamstring")) {
      const updates: Partial<AthleteProfile> = {
        injuryHistory: [{
          bodypart: 'Left Hamstring (Distal)',
          type: 'Grade 1 Strain / Tightness',
          severity: 'MILD',
          date: new Date().toISOString().split('T')[0],
          status: 'ACTIVE'
        }],
        activeInjuries: ['Left Hamstring (Distal) - Grade 1 Strain / Tightness (MILD, ACTIVE)'],
        kineticDeficiencies: ['Right ankle dorsiflexion limit (12 deg)'],
        injuryHistoryReviewed: true,
        onboardingComplete: true
      };
      await updateAthleteProfile(athlete.id, updates);
      setAthlete(prev => ({ ...prev, ...updates }));
    } else if (prompt.includes("Patellar")) {
      const updates: Partial<AthleteProfile> = {
        injuryHistory: [{
          bodypart: 'Right Knee (Patellar Tendon)',
          type: 'Tendinopathy & Posterior Hip Impingement',
          severity: 'MODERATE',
          date: new Date().toISOString().split('T')[0],
          status: 'ACTIVE'
        }],
        activeInjuries: ['Right Knee (Patellar Tendon) - Tendinopathy (MODERATE, ACTIVE)'],
        kineticDeficiencies: ['Posterior hip impingement during maximal extension'],
        injuryHistoryReviewed: true,
        onboardingComplete: true
      };
      await updateAthleteProfile(athlete.id, updates);
      setAthlete(prev => ({ ...prev, ...updates }));
    }

    // Call dual-agent chat API
    handleSendMessage(prompt);
  };

  // Handle Multi-file selection & Drag-and-Drop (Max 10 files, 15MB per file, 50MB combined limit)
  const processSelectedFiles = (selectedList: File[]) => {
    const MAX_FILE_COUNT = 10;
    const MAX_SINGLE_FILE_SIZE = 15 * 1024 * 1024; // 15MB
    const MAX_COMBINED_SIZE = 50 * 1024 * 1024; // 50MB
    
    if (attachedFiles.length + selectedList.length > MAX_FILE_COUNT) {
      alert(`Puedes subir un máximo de ${MAX_FILE_COUNT} archivos por mensaje.`);
      return;
    }

    const currentTotalSize = attachedFiles.reduce((acc, f) => acc + f.size, 0);
    let newBatchSize = 0;
    const validFiles: File[] = [];

    for (const f of selectedList) {
      if (f.size > MAX_SINGLE_FILE_SIZE) {
        alert(`El archivo "${f.name}" excede el límite individual de 15MB.`);
      } else if (currentTotalSize + newBatchSize + f.size > MAX_COMBINED_SIZE) {
        alert(`El tamaño total de adjuntos excede el límite combinado de 50MB.`);
        break;
      } else {
        validFiles.push(f);
        newBatchSize += f.size;
      }
    }

    if (validFiles.length > 0) {
      setAttachedFiles(prev => [...prev, ...validFiles]);
    }
  };

  const handleFileSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    processSelectedFiles(Array.from(e.target.files));
    e.target.value = ''; // Reset input to allow selecting same file again if desired
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processSelectedFiles(Array.from(e.dataTransfer.files));
    }
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const removeAttachedDriveFile = (index: number) => {
    setAttachedDriveFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleOpenGooglePicker = async () => {
    if (isLoading || isUploading || isPreloading || isOpeningPicker) return;
    try {
      setIsOpeningPicker(true);
      setStatusLog('Conectando con Google Drive...');
      const token = await requestDriveAccessToken();
      await showGoogleDrivePicker({
        accessToken: token,
        multiselect: true,
        onPick: (files) => {
          setIsOpeningPicker(false);
          const newDriveAttachments: AttachedFile[] = files.map(df => ({
            url: df.url,
            type: df.mimeType || 'application/vnd.google-apps.document',
            name: df.name,
            size: df.sizeBytes || 0,
            driveFileId: df.id,
            thumbnailUrl: df.thumbnailUrl,
            iconUrl: df.iconUrl,
            embedUrl: df.embedUrl,
            mimeType: df.mimeType,
            isGoogleDrive: true,
            description: df.description,
            uploadedAt: new Date().toISOString()
          }));
          setAttachedDriveFiles(prev => [...prev, ...newDriveAttachments]);
        },
        onCancel: () => {
          setIsOpeningPicker(false);
        }
      });
    } catch (err: any) {
      console.error('Error opening Google Drive picker:', err);
      setIsOpeningPicker(false);
      alert(`No se pudo conectar con Google Drive: ${err?.message || 'Error de autenticación'}`);
    }
  };

  // Edit message handler: Truncates thread back to edited message and loads into input
  const handleEditMessage = async (msg: ChatMessage) => {
    const msgIndex = messages.findIndex(m => m.id === msg.id);
    if (msgIndex === -1) return;

    // Load message text into input
    setInputMessage(msg.content);
    inputRef.current?.focus();

    // Collect IDs of this message and any subsequent messages to purge from Firestore
    const messagesToPurge = messages.slice(msgIndex);
    const idsToPurge = messagesToPurge.map(m => m.id);

    // Update local state immediately
    const remainingMessages = messages.slice(0, msgIndex);
    setMessages(remainingMessages);

    // Delete purged messages from Firestore
    if (activeThreadId && idsToPurge.length > 0) {
      await deleteThreadMessages(athlete.id, activeThreadId, idsToPurge);
    }
  };

  // Regenerate response handler: Removes assistant response and triggers re-generation
  const handleRegenerateResponse = async (assistantMsg: ChatMessage) => {
    const assistantIndex = messages.findIndex(m => m.id === assistantMsg.id);
    if (assistantIndex === -1) return;

    // Find preceding user message
    let precedingUserMsg: ChatMessage | null = null;
    for (let i = assistantIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        precedingUserMsg = messages[i];
        break;
      }
    }

    if (!precedingUserMsg) return;

    // Remove assistant message and any subsequent messages from state and Firestore
    const messagesToPurge = messages.slice(assistantIndex);
    const idsToPurge = messagesToPurge.map(m => m.id);

    const remainingMessages = messages.slice(0, assistantIndex);
    setMessages(remainingMessages);

    if (activeThreadId && idsToPurge.length > 0) {
      await deleteThreadMessages(athlete.id, activeThreadId, idsToPurge);
    }

    // Re-dispatch synthesis for that user prompt
    handleSendMessage(precedingUserMsg.content, remainingMessages);
  };

  // Function to handle user message submission
  const handleSendMessage = async (textToSend?: string, customBaseMessages?: ChatMessage[]) => {
    if (isListeningRef.current) {
      stopListening();
    }
    const text = textToSend || inputMessage;
    const hasFiles = attachedFiles.length > 0 || attachedDriveFiles.length > 0;
    if ((!text.trim() && !hasFiles) || isLoading || isUploading || isSendingRef.current) return;

    isSendingRef.current = true;
    setIsLoading(true);

    let currentThreadId = activeThreadId;
    if (!currentThreadId && onRequireThread) {
      // Lazy create thread if it doesn't exist
      const existingGreeting = messages.find(m => m.role === 'assistant');
      currentThreadId = await onRequireThread(existingGreeting);
    }

    let uploadedFiles: AttachedFile[] = [];
    
    if (attachedFiles.length > 0 && !textToSend) { // Only upload attached local files for new user messages
      setIsUploading(true);
      setStatusLog(`Uploading ${attachedFiles.length} file(s) to Cloudinary CDN...`);
      try {
        uploadedFiles = await uploadChatFiles(athlete.id, attachedFiles);
      } catch (err: any) {
        console.error('File upload failed:', err);
        alert(`Could not upload file attachments: ${err.message || 'Storage error'}`);
        setIsUploading(false);
        setIsLoading(false);
        isSendingRef.current = false;
        return;
      }
      setIsUploading(false);
    }

    if (attachedDriveFiles.length > 0 && !textToSend) {
      uploadedFiles = [...uploadedFiles, ...attachedDriveFiles];
    }

    const fileSummary = uploadedFiles.map(f => f.name).join(', ');
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text || (fileSummary ? `[Attached Files: ${fileSummary}]` : ''),
      timestamp: new Date().toISOString(),
      ...(uploadedFiles.length > 0 && {
        files: uploadedFiles,
        // Legacy single-file fields for backward compatibility
        fileUrl: uploadedFiles[0].url,
        fileType: uploadedFiles[0].type,
        fileName: uploadedFiles[0].name
      })
    };

    const baseList = customBaseMessages || messages;
    const newMessages = [...baseList, userMsg];
    setMessages(newMessages);

    if (!textToSend) {
      setInputMessage('');
      setAttachedFiles([]);
      setAttachedDriveFiles([]);
    }

    // Save user message to Firebase Firestore
    saveChatMessage(athlete.id, userMsg);
    if (currentThreadId) {
      await saveThreadMessage(athlete.id, currentThreadId, userMsg);
    }

    // Step-by-step telemetry status logs
    let streamingAssistantId: string | null = null;
    const requestStartTime = Date.now();
    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;

    // 60-second top-level hard timeout for entire chat request
    const TOTAL_TIMEOUT_MS = 60000;
    const totalTimeoutId = setTimeout(() => {
      try {
        abortController.abort(new Error('TIMEOUT_60S'));
      } catch {}
    }, TOTAL_TIMEOUT_MS);

    // 15-second client-side watchdog timer: alerts athlete if no first chunk arrives
    const WATCHDOG_MS = 15000;
    let watchdogTimer: any = setTimeout(() => {
      setIsSlowWarning(true);
      setStatusLog('Esto está tardando más de lo normal...');
    }, WATCHDOG_MS);

    try {
      setStatusLog('Consultando perfil del atleta...');
      
      // Ensure athlete profile is fresh from Firestore on the authenticated client before dispatch
      let profileToSend = athlete;
      try {
        const freshProfile = await getAthleteProfile(athlete.id);
        if (freshProfile) {
          profileToSend = freshProfile;
          setAthlete(freshProfile);
        }
      } catch (profileErr) {
        console.warn('Could not refresh profile from Firestore on client:', profileErr);
      }

      // Retrieve past thread key facts for cross-session continuity
      const pastFacts = await getUserPastThreadFacts(athlete.id, currentThreadId || undefined);

      setStatusLog('Analizando evidencia biomecánica y metodológica...');
      setStatusLog('Sintetizando prescripción táctica y salud estructural...');

      // Call Express server-side backend API route `/api/chat` with AbortController signal
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          messages: newMessages.map(m => ({ 
            role: m.role, 
            content: m.content,
            files: m.files,
            ...(m.fileUrl && { fileUrl: m.fileUrl, fileType: m.fileType, fileName: m.fileName })
          })),
          athleteId: athlete.id,
          activeThreadId: currentThreadId || undefined,
          athleteProfile: profileToSend,
          videoAnalyses: profileToSend.videoAnalyses || athlete.videoAnalyses,
          pastThreadFacts: pastFacts,
          periodizationPlan: periodizationPlan || undefined,
          competitionCalendar: competitionCalendar || undefined,
          inferredTrainingContext: profileToSend.inferredTrainingContext || athlete.inferredTrainingContext || inferredContext || undefined
        })
      });

      if (!res.ok) {
        let errDetails = `HTTP ${res.status}`;
        try {
          const errData = await res.json();
          if (errData?.error) errDetails = errData.error;
        } catch {}
        throw new Error(errDetails);
      }

      setLastFailedPrompt(null);

      // Create streaming placeholder assistant message
      streamingAssistantId = `assistant-${Date.now()}`;
      let accumulatedContent = '';
      let functionCallPayload: any = null;

      // Add empty assistant message to thread immediately so chunks render character-by-character
      const initialAssistantMsg: ChatMessage = {
        id: streamingAssistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, initialAssistantMsg]);

      // Read SSE stream
      const reader = res.body?.getReader();
      const decoder = new TextDecoder('utf-8');

      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Keep last incomplete line in buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              try {
                const eventData = JSON.parse(trimmed.slice(6));
                if (eventData.type === 'chunk' && typeof eventData.text === 'string') {
                  // Cancel watchdog on first received chunk
                  if (watchdogTimer) {
                    clearTimeout(watchdogTimer);
                    watchdogTimer = null;
                  }
                  setIsSlowWarning(false);

                  accumulatedContent += eventData.text;
                  setMessages(prev => 
                    prev.map(m => m.id === streamingAssistantId ? { ...m, content: accumulatedContent } : m)
                  );
                } else if (typeof eventData.text === 'string' && !eventData.type) {
                  // Standard SSE text payload fallback
                  if (watchdogTimer) {
                    clearTimeout(watchdogTimer);
                    watchdogTimer = null;
                  }
                  setIsSlowWarning(false);

                  accumulatedContent += eventData.text;
                  setMessages(prev => 
                    prev.map(m => m.id === streamingAssistantId ? { ...m, content: accumulatedContent } : m)
                  );
                } else if (eventData.type === 'done') {
                  if (eventData.text && !accumulatedContent) {
                    accumulatedContent = eventData.text;
                    setMessages(prev => 
                      prev.map(m => m.id === streamingAssistantId ? { ...m, content: accumulatedContent } : m)
                    );
                  }
                  if (eventData.functionCall) {
                    functionCallPayload = eventData.functionCall;
                  }
                } else if (eventData.type === 'error') {
                  throw new Error(eventData.error || 'Streaming error');
                }
              } catch (parseErr: any) {
                if (parseErr.message && !parseErr.message.includes('JSON')) {
                  throw parseErr;
                }
              }
            }
          }
        }
      }

      // Stage 6: Response Rendered Logging
      console.log(`[ARIA Stage 6: Response Rendered] Accumulated characters: ${accumulatedContent.length}, Function call executed: ${functionCallPayload ? functionCallPayload.name : 'none'}`);

      // If nothing was accumulated and no function call, trigger honest error state
      if (!accumulatedContent && !functionCallPayload) {
        throw new Error("Analysis failed — received empty response from AI model. Please try again.");
      }

      // Optimistic UI updates based on structured function call
      if (functionCallPayload && functionCallPayload.name === 'updateAthleteData') {
        const args = functionCallPayload.arguments || {};
        
        const updates: Partial<AthleteProfile> = {};
        if (args.personalBests) updates.personalBests = { ...athlete.personalBests, ...args.personalBests };
        if (args.activeInjuries) updates.activeInjuries = args.activeInjuries;
        if (args.kineticDeficiencies) updates.kineticDeficiencies = args.kineticDeficiencies;
        if (args.targetEvents) updates.targetEvents = args.targetEvents;
        if (args.injuryReports) updates.injuryHistory = args.injuryReports;
        
        updates.onboardingComplete = true;
        updates.injuryHistoryReviewed = true;

        setStatusLog('Sincronizando telemetría del atleta...');
        await updateAthleteProfile(athlete.id, updates);
        setAthlete(prev => ({ ...prev, ...updates }));
      } else if (functionCallPayload && functionCallPayload.name === 'updatePeriodizationPlan') {
        const args = functionCallPayload.arguments || {};
        setStatusLog('Sincronizando plan de periodización...');

        let newPlan = periodizationPlan;
        let newCal = competitionCalendar;

        if (args.macrocycle || args.mesocycles || args.season) {
          newPlan = {
            athleteId: athlete.id,
            season: args.season || periodizationPlan?.season || '2026',
            createdBy: 'coach',
            lastUpdated: new Date().toISOString(),
            macrocycle: args.macrocycle || periodizationPlan?.macrocycle || {
              startDate: '2026-01-06',
              endDate: '2026-11-15',
              goal: 'Juegos Nacionales / Selección'
            },
            mesocycles: args.mesocycles || periodizationPlan?.mesocycles || []
          };
          await saveAthletePeriodizationPlan(athlete.id, newPlan);
        }

        if (args.competitions) {
          newCal = {
            athleteId: athlete.id,
            competitions: args.competitions
          };
          await saveCompetitionCalendar(athlete.id, newCal);
        }

        if (onPeriodizationPlanUpdated && newPlan && newCal) {
          onPeriodizationPlanUpdated(newPlan, newCal);
        }
      } else if (functionCallPayload && functionCallPayload.name === 'updateInferredTrainingContext') {
        const args = functionCallPayload.arguments || {};
        setStatusLog('Actualizando contexto de entrenamiento...');
        const updatedInferred: InferredTrainingContext = {
          athleteId: athlete.id,
          currentPhase: args.currentPhase || 'GPP',
          proximityToCompetition: args.proximityToCompetition || 'Sin especificar',
          nextCompetition: args.nextCompetition,
          notes: args.notes || '',
          lastUpdated: args.lastUpdated || new Date().toISOString()
        };
        // Update local state (Firestore writes for inferredContext are restricted to backend only)
        setAthlete(prev => ({
          ...prev,
          inferredTrainingContext: updatedInferred
        }));
        if (onInferredContextUpdated) {
          onInferredContextUpdated(updatedInferred);
        }
      } else if (functionCallPayload && functionCallPayload.name === 'updateClinicalAndGeneticProfile') {
        const args = functionCallPayload.arguments || {};
        setStatusLog('Sincronizando perfil clínico y genético...');
        const updates: Partial<AthleteProfile> = {};
        if (args.clinicalHistory && Array.isArray(args.clinicalHistory)) {
          updates.clinicalHistory = [
            ...(athlete.clinicalHistory || []),
            ...args.clinicalHistory
          ];
        }
        if (args.geneticPredispositions && Array.isArray(args.geneticPredispositions)) {
          updates.geneticPredispositions = [
            ...(athlete.geneticPredispositions || []),
            ...args.geneticPredispositions
          ];
        }
        if (Object.keys(updates).length > 0) {
          await updateAthleteProfile(athlete.id, updates);
          setAthlete(prev => ({ ...prev, ...updates }));
        }
      }

      const finalAssistantMsg: ChatMessage = {
        id: streamingAssistantId,
        role: 'assistant',
        content: accumulatedContent,
        timestamp: new Date().toISOString()
      };

      const updatedChat = [...newMessages, finalAssistantMsg];
      saveChatMessage(athlete.id, finalAssistantMsg);
      if (currentThreadId) {
        await saveThreadMessage(athlete.id, currentThreadId, finalAssistantMsg);

        // Auto-generate concise 3-6 word title for this new thread after first exchange
        if (updatedChat.length <= 3) {
          fetch('/api/thread/generate-title', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userMessage: text,
              assistantResponse: finalAssistantMsg.content,
              messages: updatedChat
            })
          })
          .then(r => r.json())
          .then(titleData => {
            if (titleData.title && typeof titleData.title === 'string' && titleData.title.trim().length > 0) {
              const cleanTitle = titleData.title.trim();
              saveChatThread(athlete.id, {
                id: currentThreadId,
                title: cleanTitle
              });
              if (onThreadTitleUpdated) {
                onThreadTitleUpdated(currentThreadId, cleanTitle);
              }
            }
          })
          .catch(err => {
            console.warn('Auto title generation failed, preserving default title:', err);
          });
        }

        // Periodically summarize key facts asynchronously for cross-session continuity
        if (updatedChat.length >= 2 && updatedChat.length % 2 === 0) {
          fetch('/api/thread/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: updatedChat })
          })
          .then(r => r.json())
          .then(summaryData => {
            if (summaryData.summary) {
              saveChatThread(athlete.id, {
                id: currentThreadId,
                keyFactSummary: summaryData.summary
              });
            }
          })
          .catch(() => {});
        }
      }

    } catch (err: any) {
      console.error('[ARIA Stage 6: FAILED] Error during chat processing:', err);
      setLastFailedPrompt(text);

      const isTimeout = err?.name === 'AbortError' || err?.message === 'TIMEOUT_60S' || abortController.signal.aborted;

      // Clean up incomplete or empty streaming message placeholder
      setMessages(prev => prev.filter(m => m.id !== streamingAssistantId || (m.content && m.content.trim().length > 0)));
      
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: isTimeout
          ? `### ⏱️ La solicitud tardó demasiado, intenta de nuevo\n\nEl servidor superó el tiempo máximo de espera sin completar la respuesta.\n\n*Hacé clic en **"Reintentar consulta"** para volver a intentarlo.*`
          : `### ❌ Analysis failed — please try again\n\n**Error details**: \`${err?.message || 'Server connection error'}\`\n\n*Click **"Retry Query"** below to re-submit your message.*`,
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      if (totalTimeoutId) clearTimeout(totalTimeoutId);
      if (watchdogTimer) clearTimeout(watchdogTimer);
      activeAbortControllerRef.current = null;
      setIsSlowWarning(false);
      setIsLoading(false);
      isSendingRef.current = false;
      setStatusLog('');
    }
  };

  return (
    <div 
      className="flex flex-col h-[calc(100vh-65px)] max-w-5xl mx-auto w-full px-2 sm:px-4 py-3 font-sans relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag and Drop Visual Highlight Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-zinc-950/90 backdrop-blur-xs border-2 border-dashed border-emerald-500 rounded-2xl flex flex-col items-center justify-center p-6 text-center animate-fadeIn pointer-events-none">
          <UploadCloud className="w-14 h-14 text-emerald-400 mb-3 animate-bounce" />
          <p className="text-xl font-bold text-zinc-100 font-mono">Arrastrá tus archivos acá</p>
          <p className="text-sm text-zinc-300 mt-1 max-w-md">
            Hasta 10 archivos (imágenes, videos cinemáticos, PDFs de analíticas, resonancias o laboratorios)
          </p>
          <div className="mt-3 px-3 py-1 bg-emerald-950/70 border border-emerald-500/40 rounded-full text-emerald-300 text-xs font-mono">
            {attachedFiles.length}/10 archivos actualmente adjuntos
          </div>
        </div>
      )}

      {/* Messages Thread Window */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin scrollbar-thumb-zinc-800">
        {messages.map((msg, idx) => (
          <ChatMessageItem
            key={msg.id}
            message={msg}
            messageIndex={idx}
            onSelectInjuryPrompt={handleSelectInjuryPrompt}
            onEditMessage={handleEditMessage}
            onRegenerateResponse={handleRegenerateResponse}
          />
        ))}

        {/* Preloading Progress Log */}
        {isPreloading && !isLoading && (
          <div className="p-4 rounded-xl bg-zinc-900 border border-purple-500/30 flex items-center gap-3 text-purple-400 font-mono text-xs sm:text-sm animate-pulse">
            <Sparkles className="w-5 h-5 text-purple-400 animate-spin" />
            <div>
              <p className="font-bold text-purple-300">PRIMING STRIDES CONTEXT ENGINE...</p>
              <p className="text-zinc-400 text-xs">Pre-loading biometric and scientific context...</p>
            </div>
          </div>
        )}

        {/* Loading Progress Log */}
        {(isLoading || isUploading) && (
          <div className="space-y-2">
            <div className="p-4 rounded-xl bg-zinc-900 border border-emerald-500/30 flex items-center gap-3 text-emerald-400 font-mono text-xs sm:text-sm animate-pulse">
              <Cpu className="w-5 h-5 text-emerald-400 animate-spin" />
              <div>
                <p className="font-bold text-emerald-300">ARIA COMPUTING INTEGRAL ANALYSIS... ({elapsedSeconds}s)</p>
                <p className="text-zinc-400 text-xs">{statusLog || 'Processing tactical mechanics & multi-source evidence...'}</p>
              </div>
            </div>

            {/* 15s Watchdog Warning for first chunk delay */}
            {isSlowWarning && (
              <div className="p-3 rounded-lg bg-amber-950/60 border border-amber-500/70 flex items-center gap-3 text-amber-300 text-xs font-mono animate-fadeIn">
                <Clock className="w-4 h-4 text-amber-400 shrink-0 animate-spin" />
                <div>
                  <span className="font-bold text-amber-200">Esto está tardando más de lo normal...</span>
                  <span className="text-amber-300/90 ml-1">
                    Conectando con el modelo y consolidando la prescripción. Aguarda unos segundos más.
                  </span>
                </div>
              </div>
            )}

            {/* Non-Blocking Time Warning for queries taking > 20s */}
            {elapsedSeconds >= 20 && !isSlowWarning && (
              <div className="p-3 rounded-lg bg-cyan-950/40 border border-cyan-700/60 flex items-center gap-3 text-cyan-300 text-xs font-mono animate-fadeIn">
                <Clock className="w-4 h-4 text-cyan-400 shrink-0 animate-spin" />
                <div>
                  <span className="font-bold text-cyan-200">🔬 Multi-Source Evidence Retrieval in Progress:</span>
                  <span className="text-cyan-300/90 ml-1">
                    Analizando literatura biomecánica (PubMed/Crossref), doctrina de entrenadores y bases cinemáticas. La respuesta se completará en breve.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Retry Banner on Error */}
        {lastFailedPrompt && !isLoading && (
          <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/60 flex items-center justify-between gap-3 text-rose-300 text-xs font-mono">
            <div className="truncate">
              <span className="font-bold text-rose-400">Consulta no completada:</span> "{lastFailedPrompt}"
            </div>
            <button
              onClick={() => {
                const promptToRetry = lastFailedPrompt;
                setLastFailedPrompt(null);
                handleSendMessage(promptToRetry);
              }}
              className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs whitespace-nowrap transition shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <span>Reintentar consulta</span>
              <span>⟳</span>
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompt Suggestions */}
      <div className="mt-2 mb-1 flex items-center gap-2 overflow-x-auto py-1 scrollbar-none text-xs font-mono">
        <span className="text-zinc-500 text-[10px] uppercase font-bold shrink-0">Tactical Prompts:</span>
        <button
          onClick={() => {
            const prompt = `Calculate 7-day microcycle peaking taper for my target events (${athlete.targetEvents?.join(', ') || 'sprints'}), factoring in current kinetic strain.`;
            setInputMessage(prompt);
            handleSendMessage(prompt);
          }}
          className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-emerald-400 shrink-0 text-xs"
        >
          ⚡ Peaking Taper Microcycle
        </button>
        <button
          onClick={() => {
            const prompt = `Prescribe an integrated RFD gym session with cross-disciplinary transfer (weightlifting & gymnastics SSC) for tendon stiffness and structural health.`;
            setInputMessage(prompt);
            handleSendMessage(prompt);
          }}
          className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-cyan-400 shrink-0 text-xs"
        >
          🏋️ RFD & Cross-Disciplinary Gym
        </button>
        <button
          onClick={() => {
            const prompt = `Analyze biomechanical ground contact time and deceleration phase mechanics for ${athlete.targetEvents?.[0] || '100m'}.`;
            setInputMessage(prompt);
            handleSendMessage(prompt);
          }}
          className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-amber-400 shrink-0 text-xs"
        >
          🔬 Biomechanical Kinematics
        </button>
      </div>

      {/* Multi-file Staged Preview Chips (Local Files & Google Drive Files) */}
      {(attachedFiles.length > 0 || attachedDriveFiles.length > 0) && (
        <div className="mb-2 p-2 bg-zinc-900 border border-zinc-800 rounded-lg flex flex-wrap gap-2 text-xs font-mono text-zinc-300">
          {/* Local files */}
          {attachedFiles.map((file, idx) => {
            const isImage = file.type.startsWith('image/');
            const formattedSize = file.size < 1024 * 1024 
              ? `${(file.size / 1024).toFixed(0)} KB` 
              : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
            return (
              <div 
                key={`local-${idx}`}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-800 border border-zinc-700/80 rounded-md text-xs"
              >
                {isImage ? (
                  <ImageIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                )}
                <span className="truncate max-w-[140px] sm:max-w-[200px] text-zinc-200">{file.name}</span>
                <span className="text-[10px] text-zinc-500">({formattedSize})</span>
                <button 
                  onClick={() => removeAttachedFile(idx)} 
                  className="ml-1 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer"
                  title="Eliminar archivo"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}

          {/* Google Drive files */}
          {attachedDriveFiles.map((file, idx) => {
            return (
              <div 
                key={`drive-${idx}`}
                className="flex items-center gap-2 px-2.5 py-1 bg-blue-950/40 border border-blue-600/40 rounded-md text-xs"
              >
                {file.thumbnailUrl ? (
                  <img
                    src={file.thumbnailUrl}
                    alt={file.name}
                    className="w-4 h-4 rounded object-cover shrink-0"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
                    <path d="M8.27 4.5l5.5 9.5-2.75 4.75L5.52 9.25 8.27 4.5z" fill="#4285F4"/>
                    <path d="M15.73 4.5h5.5l-5.5 9.5h-5.5l5.5-9.5z" fill="#FBBC05"/>
                    <path d="M2.75 18.75l2.77-4.75h11l-2.77 4.75H2.75z" fill="#34A853"/>
                  </svg>
                )}
                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Drive</span>
                <span className="truncate max-w-[140px] sm:max-w-[200px] text-zinc-200">{file.name}</span>
                <button 
                  onClick={() => removeAttachedDriveFile(idx)} 
                  className="ml-1 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer"
                  title="Eliminar archivo de Drive"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}

          <div className="text-[11px] text-zinc-500 self-center ml-auto">
            {attachedFiles.length + attachedDriveFiles.length}/10 archivos
          </div>
        </div>
      )}

      {/* Voice recording live badge indicator */}
      {isListening && (
        <div className="flex items-center gap-2 px-3 py-1 bg-emerald-950/60 border border-emerald-500/40 rounded-lg text-xs text-emerald-400 mb-1.5 font-mono shadow-[0_0_12px_rgba(16,185,129,0.15)]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-[11px] font-semibold tracking-wide text-emerald-300">ARIA Voice Live:</span>
          {/* Mini waveform equalizer in top badge */}
          <div className="flex items-center gap-0.5 h-3">
            {waveformBars.slice(0, 5).map((bar, idx) => (
              <span
                key={idx}
                className="w-0.5 rounded-full bg-emerald-400 transition-all duration-75"
                style={{ height: `${Math.max(3, Math.round((bar / 100) * 12))}px` }}
              />
            ))}
          </div>
          <span className="text-[11px] text-zinc-300 truncate max-w-xs sm:max-w-md">
            {inputMessage.trim() ? `"${inputMessage}"` : 'Habla ahora para registrar tu entrenamiento...'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 border border-emerald-500/30">
              Mic {audioVolume}%
            </span>
            <span className="text-[10px] text-emerald-500/80 hidden sm:inline">Pausa o toca el mic para terminar</span>
          </div>
        </div>
      )}

      {/* Voice recording error banner */}
      {speechError && (
        <div className="flex items-center gap-2 px-3 py-1 bg-rose-950/50 border border-rose-500/40 rounded-lg text-xs text-rose-300 mb-1.5 font-mono">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          <span className="text-[11px]">{speechError}</span>
        </div>
      )}

      {/* Input Box Bar */}
      <div className="mt-1 relative flex items-center gap-2">
        <label 
          className="cursor-pointer p-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-emerald-400 transition-colors shrink-0 flex items-center justify-center"
          title="Adjuntar archivo local (PDF, imagen, texto, etc.)"
        >
          <Paperclip className="w-4 h-4" />
          <input
            type="file"
            multiple
            className="hidden"
            accept="image/*,.pdf,.txt,.csv,.doc,.docx"
            onChange={handleFileSelection}
          />
        </label>
        <button
          type="button"
          onClick={handleOpenGooglePicker}
          disabled={isLoading || isUploading || isPreloading || isOpeningPicker}
          title="Adjuntar desde Google Drive (Google Picker)"
          className="cursor-pointer p-2.5 rounded-lg bg-zinc-800 hover:bg-blue-950/60 text-zinc-400 hover:text-blue-400 border border-transparent hover:border-blue-500/40 transition-colors shrink-0 flex items-center justify-center disabled:opacity-50"
        >
          <svg className={`w-4 h-4 ${isOpeningPicker ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none">
            <path d="M8.27 4.5l5.5 9.5-2.75 4.75L5.52 9.25 8.27 4.5z" fill="#4285F4"/>
            <path d="M15.73 4.5h5.5l-5.5 9.5h-5.5l5.5-9.5z" fill="#FBBC05"/>
            <path d="M2.75 18.75l2.77-4.75h11l-2.77 4.75H2.75z" fill="#34A853"/>
          </svg>
        </button>
        <button
          type="button"
          onClick={toggleVoiceRecording}
          disabled={isLoading || isUploading || isPreloading}
          title={
            isListening 
              ? 'Detener grabación de voz (o esperar silencio)' 
              : 'Dictar actualización verbal a ARIA con micrófono'
          }
          className={`cursor-pointer p-2.5 rounded-lg border transition-all shrink-0 flex items-center justify-center disabled:opacity-50 ${
            isListening
              ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 ring-2 ring-emerald-500/50 shadow-[0_0_14px_rgba(52,211,153,0.45)]'
              : 'bg-zinc-800 hover:bg-zinc-700 border-transparent text-zinc-400 hover:text-emerald-400'
          }`}
        >
          {isListening ? (
            <MicOff className="w-4 h-4 text-emerald-300 animate-pulse" />
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </button>
        <div className={`relative flex-1 rounded-xl transition-all duration-300 ${
          isListening 
            ? 'ring-2 ring-emerald-400/90 shadow-[0_0_22px_rgba(52,211,153,0.4)]' 
            : ''
        }`}>
          <input
            ref={inputRef}
            type="text"
            value={inputMessage}
            disabled={isLoading || isUploading || isPreloading}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder={
              isListening
                ? 'Escuchando voz para ARIA... Di tu reporte de entrenamiento...'
                : 'Instruct ARIA (e.g. "Completed 6x200m track session, felt smooth")...'
            }
            className={`w-full bg-zinc-900 border rounded-xl px-4 py-3 text-zinc-100 text-xs sm:text-sm font-mono placeholder-zinc-500 focus:outline-none transition-all shadow-inner disabled:opacity-50 ${
              isListening 
                ? 'border-emerald-400/90 bg-emerald-950/20 text-emerald-100 pr-36 sm:pr-44' 
                : 'border-zinc-700/80 focus:border-emerald-500 pr-12'
            }`}
          />

          {/* Animated Waveform and Live Volume Level Indicator inside Input Field */}
          {isListening && (
            <div 
              className="absolute right-12 top-1/2 -translate-y-1/2 flex items-center gap-2 px-2.5 py-1 rounded-lg bg-zinc-900/90 border border-emerald-500/50 backdrop-blur-sm pointer-events-none select-none shadow-[0_0_12px_rgba(16,185,129,0.25)]"
              title={`Volumen detectado: ${audioVolume}%`}
            >
              {/* Dynamic Animated Waveform Bars */}
              <div className="flex items-center gap-[3px] h-5 px-0.5" aria-hidden="true">
                {waveformBars.map((bar, idx) => {
                  const isActiveLevel = audioVolume > 5;
                  const barHeight = isActiveLevel 
                    ? Math.max(4, Math.round((bar / 100) * 18)) 
                    : 4;
                  return (
                    <span
                      key={idx}
                      className="w-1 rounded-full transition-all duration-75"
                      style={{
                        height: `${barHeight}px`,
                        backgroundColor: audioVolume > 50
                          ? '#34d399' // emerald-400
                          : audioVolume > 15
                            ? '#10b981' // emerald-500
                            : '#065f46', // emerald-800
                        boxShadow: audioVolume > 15 
                          ? '0 0 6px rgba(52,211,153,0.6)' 
                          : 'none',
                      }}
                    />
                  );
                })}
              </div>

              {/* Volume Level Indicator & Numerical Readout */}
              <div className="flex items-center gap-1.5 pl-1.5 border-l border-emerald-500/30">
                <Volume2 className={`w-3.5 h-3.5 transition-colors ${
                  audioVolume > 10 ? 'text-emerald-400' : 'text-emerald-600/70'
                }`} />
                <span className="text-[11px] font-mono font-bold tracking-tight text-emerald-400 min-w-[28px] text-right">
                  {audioVolume}%
                </span>
              </div>
            </div>
          )}

          <button
            onClick={() => handleSendMessage()}
            disabled={(!inputMessage.trim() && attachedFiles.length === 0 && attachedDriveFiles.length === 0) || isLoading || isUploading || isPreloading}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 text-zinc-950 disabled:text-zinc-600 transition-colors shadow-md"
            title="Enviar mensaje a ARIA"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

