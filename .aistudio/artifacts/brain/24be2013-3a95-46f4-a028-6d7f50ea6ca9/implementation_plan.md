# Web Speech Voice Input for ARIA Chat

Enable athletes to dictate and record verbal training logs, workout debriefs, and recovery updates while on the move using the browser's native Web Speech API with real-time feedback and minimalist glow ergonomics.

## User Review & Critical Decisions

> [!IMPORTANT]
> Key design and behavior decisions confirmed with the user:
> - **Input Target**: Captured speech transcribes directly into the composer input field as the athlete dictates, allowing them to review, append, or edit their training notes before submitting to ARIA.
> - **Visual Feedback**: Minimalist emerald/cyan glow effect framing the composer input bar while recording is active, paired with an active recording state on the microphone button.
> - **Recording Controls**: Tap-to-toggle activation (single tap starts listening, second tap or silence detection stops recording).
> - **Browser Compatibility**: Graceful fallback and user-friendly notice if the browser or platform environment does not support `webkitSpeechRecognition` or `SpeechRecognition`.

---

## 1. Overview & Core Concept

- **What It Does**: Adds a dedicated microphone button adjacent to the attachment controls in the `ChatContainer` composer. Athletes on the track, in the gym, or recovering post-workout can tap to dictate updates (e.g. *"Ran 6x200m at 24.5s with 3 minutes rest, felt slight tightness in right hamstring"*), seeing live speech converted into structured text without needing to type on a small touch keyboard.
- **Target Audience / Persona**: Track and field athletes, sprinters, distance runners, and coaches logging verbal metrics while physically active or wearing gloves.
- **Key Value**: Low-friction hands-free voice logging directly into ARIA's coaching intelligence pipeline with zero third-party audio service latency.

---

## 2. User Experience & Visual Design

- **Ergonomics & Layout Placement**:
  - The microphone button sits in the composer toolbar between the Google Drive picker button and the text input field.
  - Touch target adheres to mobile ergonomics ($\ge 44 \times 44\text{px}$ touch target) for easy tapping with sweaty hands or on mobile devices.
- **Visual Identity & Glow Effects**:
  - **Idle State**: Subtle zinc-800 button with a clean `Mic` icon matching the adjacent Paperclip and Google Drive tools.
  - **Active Recording State**: Button transitions to an active emerald/red recording state with an animated audio ring and `MicOff` or recording icon.
  - **Composer Glow**: The input field wrapper illuminates with a smooth, pulsing emerald/cyan border glow (`ring-2 ring-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.25)]`) indicating ARIA is actively listening to the athlete.
  - **Live Interim Preview**: Words appear dynamically as spoken; when silence is detected or the user taps the mic again, the transcript settles cleanly in the input field ready to be dispatched or complemented with files.
- **Accessibility & Fallback States**:
  - Clear tooltips indicating "Dictate training update" or "Stop recording".
  - If microphone permissions are denied or unsupported by the browser, a subtle inline notification guides the athlete to enable microphone access.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Native Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`)**
  - *Chosen Approach*: Use client-side Web Speech recognition with continuous interim results.
  - *Why*: Instantaneous on-device transcription with zero server costs, low latency, and native multilingual support without uploading heavy audio blobs over mobile cellular connections.
  - *Alternatives Considered*: Server-side Whisper or Gemini audio upload. Rejected because uploading audio files requires substantial bandwidth and induces round-trip latency when athletes simply want fast text input into ARIA.
- **Decision 2: Tap-to-Toggle with Automatic Silence & Finalization Handling**
  - *Chosen Approach*: Single tap to toggle on/off, with automatic restart protection on short pauses and auto-stop on prolonged silence or explicit input submission.
  - *Why*: Ensures athletes running or stretching do not have to continuously hold down a button while talking.
- **Decision 3: Non-Destructive Text Appending**
  - *Chosen Approach*: Speech appends smoothly to any already typed draft text in the composer, allowing combined typing and dictation.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ARIA ChatContainer                              │
│                                                                        │
│   ┌───────────────────────────┐   ┌────────────────────────────────┐   │
│   │   Staged Attachments      │   │   Google Drive File Previews   │   │
│   └─────────────┬─────────────┘   └───────────────┬────────────────┘   │
│                 └─────────────────┬───────────────┘                    │
│                                   ▼                                    │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     Composer Input Toolbar                       │  │
│  │                                                                  │  │
│  │  [📎 Attach]  [📁 Drive Picker]  [🎙️ Mic Dictate]                 │  │
│  │                                         │                        │  │
│  │                                         ▼                        │  │
│  │  ┌────────────────────────────────────────────────────────────┐  │  │
│  │  │  Input Field with Minimalist Glow (ring-emerald-500/50)    │  │  │
│  │  │  "Ran 6x200m at 24.5s... (listening)"        [➤ Send]      │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                   │                                    │
│                     Web Speech API Engine Hook                         │
│             (webkitSpeechRecognition / SpeechRecognition)              │
└────────────────────────────────────────────────────────────────────────┘
```

### State Model & Speech Lifecycle
- `isListening: boolean`: Controls active recording state, button color, and glowing composer frame.
- `speechSupported: boolean`: Detects browser support for `window.SpeechRecognition || window.webkitSpeechRecognition`.
- `interimTranscript: string`: Holds transient speech phrases before finalization.
- `baseInputBeforeSpeech: string`: Preserves existing text typed before recording started so spoken words append cleanly.

### Interactive Component & State Transitions
1. Athlete clicks Microphone button:
   - Request microphone permissions via `SpeechRecognition.start()`.
   - Set `isListening = true`.
   - Composer input displays glowing aura and placeholder switches to "Listening to training update...".
2. Athlete speaks:
   - `onresult` event fires with `event.results`.
   - Finalized segments update `inputMessage`.
   - Interim speech displays immediately in real-time.
3. Athlete taps mic button again, pauses for extended silence, or presses Enter:
   - `recognition.stop()` is triggered.
   - `isListening = false`.
   - Glow fades smoothly (`transition-all duration-300`).
   - Final message remains in `inputMessage` ready for instant submission via Send button or Enter key.
