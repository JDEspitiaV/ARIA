import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Cpu, 
  User, 
  Activity, 
  AlertCircle, 
  ExternalLink, 
  ShieldAlert, 
  Award,
  Edit2,
  RotateCcw,
  Copy,
  Check,
  FileText,
  Image as ImageIcon,
  Clock
} from 'lucide-react';
import { ChatMessage, AttachedFile } from '../types';

interface ChatMessageItemProps {
  message: ChatMessage;
  messageIndex?: number;
  onSelectInjuryPrompt?: (promptText: string) => void;
  onEditMessage?: (message: ChatMessage) => void;
  onRegenerateResponse?: (message: ChatMessage) => void;
}

export const ChatMessageItem: React.FC<ChatMessageItemProps> = ({
  message,
  messageIndex,
  onSelectInjuryPrompt,
  onEditMessage,
  onRegenerateResponse
}) => {
  const [copied, setCopied] = useState(false);
  const isAssistant = message.role === 'assistant';
  const isSystem = message.role === 'system';
  const isUser = message.role === 'user';

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy markdown:', err);
    }
  };

  // Consolidate files from either files array or legacy fileUrl
  const attachedFiles: AttachedFile[] = Array.isArray(message.files) && message.files.length > 0
    ? message.files
    : message.fileUrl
    ? [{ url: message.fileUrl, type: message.fileType || 'application/octet-stream', name: message.fileName || 'Attachment' }]
    : [];

  return (
    <div className={`py-4 px-4 sm:px-6 rounded-xl border transition-all relative group ${
      isAssistant
        ? 'bg-zinc-900/90 border-zinc-800 text-zinc-100 shadow-lg'
        : isSystem
        ? 'bg-amber-950/20 border-amber-800/40 text-amber-200'
        : 'bg-zinc-950 border-emerald-900/40 text-zinc-100 ml-4 sm:ml-12'
    }`}>
      {/* Header Badge */}
      <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-zinc-800/80">
        <div className="flex items-center gap-2">
          {isAssistant ? (
            <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs font-bold uppercase tracking-wider">
              <Cpu className="w-4 h-4 text-emerald-400" />
              <span>ARIA UNIFIED ENGINE</span>
            </div>
          ) : isSystem ? (
            <div className="flex items-center gap-2 text-amber-400 font-mono text-xs font-bold uppercase">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <span>SYSTEM DIAGNOSTIC</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-zinc-300 font-mono text-xs font-bold uppercase">
              <User className="w-4 h-4 text-zinc-400" />
              <span>ATHLETE / COACH QUERY</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Copy Raw Markdown Button */}
          <button
            onClick={handleCopyMarkdown}
            title="Copiar markdown al portapapeles"
            className="opacity-80 group-hover:opacity-100 p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 text-xs font-mono flex items-center gap-1 transition-all"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline text-[10px]">{copied ? 'Copiado' : 'Copiar'}</span>
          </button>

          {/* Action Buttons: Edit for User, Regenerate for Assistant */}
          {isUser && onEditMessage && (
            <button
              onClick={() => onEditMessage(message)}
              title="Editar prompt y regenerar respuesta"
              className="opacity-80 group-hover:opacity-100 p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 text-xs font-mono flex items-center gap-1 transition-all"
            >
              <Edit2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-[10px]">Editar</span>
            </button>
          )}

          {isAssistant && onRegenerateResponse && (
            <button
              onClick={() => onRegenerateResponse(message)}
              title="Regenerar respuesta del motor STRIDES"
              className="opacity-80 group-hover:opacity-100 p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 text-xs font-mono flex items-center gap-1 transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-[10px]">Regenerar</span>
            </button>
          )}

          <span className="text-[11px] font-mono text-zinc-500">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>
      </div>

      {/* Render Attached Files (Cloudinary URLs, Google Drive, or 48h Expired State) */}
      {attachedFiles.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2.5">
          {attachedFiles.map((file, idx) => {
            if (file.expired || !file.url) {
              return (
                <div
                  key={idx}
                  className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800 text-zinc-400 text-xs font-mono"
                  title="El archivo original fue limpiado automáticamente tras 48h; el contexto analizado permanece registrado en esta sesión."
                >
                  <Clock className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  <span className="truncate">{file.name || '[Archivo expirado tras 48h - contexto en historial]'}</span>
                </div>
              );
            }

            if (file.isGoogleDrive) {
              return (
                <div
                  key={idx}
                  className="flex items-center gap-3 p-2.5 rounded-xl bg-zinc-900/90 border border-blue-500/30 hover:border-blue-400/60 transition-all group max-w-sm w-full"
                >
                  {file.thumbnailUrl ? (
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative w-12 h-12 rounded-lg overflow-hidden bg-zinc-950 shrink-0 border border-zinc-800 group-hover:border-blue-500/50 block"
                    >
                      <img
                        src={file.thumbnailUrl}
                        alt={file.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    </a>
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-blue-950/50 border border-blue-800/40 flex items-center justify-center shrink-0">
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                        <path d="M8.27 4.5l5.5 9.5-2.75 4.75L5.52 9.25 8.27 4.5z" fill="#4285F4"/>
                        <path d="M15.73 4.5h5.5l-5.5 9.5h-5.5l5.5-9.5z" fill="#FBBC05"/>
                        <path d="M2.75 18.75l2.77-4.75h11l-2.77 4.75H2.75z" fill="#34A853"/>
                      </svg>
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-950/80 border border-blue-800/60 text-blue-300 font-semibold uppercase tracking-wider">
                        Google Drive
                      </span>
                    </div>
                    <p className="text-xs font-mono font-medium text-zinc-200 truncate group-hover:text-blue-300 transition-colors">
                      {file.name}
                    </p>
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] font-mono text-blue-400 hover:text-blue-300 transition-colors mt-0.5"
                    >
                      <span>Abrir en Drive</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                </div>
              );
            }

            const isImage = file.type?.startsWith('image/') || file.url?.match(/\.(jpg|jpeg|png|webp|gif)/i);
            return (
              <a
                key={idx}
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700/80 hover:border-emerald-500 text-zinc-200 text-xs font-mono transition-all hover:bg-zinc-800/80 max-w-xs truncate"
              >
                {isImage ? (
                  <ImageIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                )}
                <span className="truncate">{file.name}</span>
                <ExternalLink className="w-3 h-3 text-zinc-500 shrink-0 ml-auto" />
              </a>
            );
          })}
        </div>
      )}

      {/* Content Rendering */}
      <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-zinc-800 prose-headings:font-mono prose-headings:text-emerald-400 prose-strong:text-emerald-300 text-sm sm:text-base">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ node, ...props }) => <h1 className="text-lg sm:text-xl font-mono font-bold text-emerald-400 border-b border-zinc-800 pb-1 mt-4 mb-2 uppercase tracking-wide" {...props} />,
            h2: ({ node, ...props }) => <h2 className="text-base sm:text-lg font-mono font-bold text-emerald-400 mt-4 mb-2 uppercase tracking-wide flex items-center gap-2" {...props} />,
            h3: ({ node, ...props }) => <h3 className="text-sm sm:text-base font-mono font-bold text-cyan-300 mt-3 mb-1.5 uppercase tracking-wide" {...props} />,
            table: ({ node, ...props }) => (
              <div className="overflow-x-auto my-3 border border-zinc-800 rounded-lg bg-zinc-950/80 p-1">
                <table className="w-full text-left border-collapse text-xs sm:text-sm font-mono" {...props} />
              </div>
            ),
            thead: ({ node, ...props }) => <thead className="bg-zinc-800/80 text-emerald-400 border-b border-zinc-700" {...props} />,
            th: ({ node, ...props }) => <th className="p-2 sm:p-2.5 font-bold uppercase tracking-wider text-xs" {...props} />,
            td: ({ node, ...props }) => <td className="p-2 sm:p-2.5 border-b border-zinc-800/50 text-zinc-300" {...props} />,
            code: ({ node, className, children, ...props }) => {
              return (
                <code className="bg-zinc-950 px-1.5 py-0.5 rounded text-emerald-300 font-mono text-xs border border-zinc-800" {...props}>
                  {children}
                </code>
              );
            },
            a: ({ node, href, children, ...props }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:text-cyan-300 underline inline-flex items-center gap-1 font-mono text-xs"
                {...props}
              >
                <span>{children}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            ),
            blockquote: ({ node, ...props }) => (
              <blockquote className="border-l-2 border-emerald-500/80 pl-3 py-1 my-2 bg-emerald-950/20 text-zinc-300 italic text-xs sm:text-sm" {...props} />
            )
          }}
        >
          {message.content}
        </ReactMarkdown>
      </div>

      {/* Quick Onboarding Action Buttons if Partial Onboarding Required */}
      {message.metadata?.isInjuryOnboardingResponse && onSelectInjuryPrompt && (
        <div className="mt-4 pt-3 border-t border-zinc-800 flex flex-wrap gap-2">
          <p className="w-full text-xs font-mono text-amber-300 font-bold mb-1 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            SELECT OR CUSTOMIZE YOUR ACTIVE INJURY DECLARATION:
          </p>
          <button
            onClick={() => onSelectInjuryPrompt("Active Injury Declaration: No active injuries. Tissue is 100% healthy, zero kinetic deficiencies reported.")}
            className="px-3 py-1.5 rounded bg-emerald-950 border border-emerald-700 hover:bg-emerald-900 text-emerald-300 text-xs font-mono transition-colors"
          >
            ✓ 100% Healthy (No Active Injuries)
          </button>
          <button
            onClick={() => onSelectInjuryPrompt("Active Injury Declaration: Left distal hamstring tightness/strain history (Grade 1). Pain at speeds >90% vMax. Right ankle dorsiflexion limit (12 deg).")}
            className="px-3 py-1.5 rounded bg-amber-950 border border-amber-700 hover:bg-amber-900 text-amber-300 text-xs font-mono transition-colors"
          >
            ⚠️ Left Hamstring Strain & Ankle Limit
          </button>
          <button
            onClick={() => onSelectInjuryPrompt("Active Injury Declaration: Patellar tendinopathy (right knee) & posterior hip impingement during maximal extension.")}
            className="px-3 py-1.5 rounded bg-amber-950 border border-amber-700 hover:bg-amber-900 text-amber-300 text-xs font-mono transition-colors"
          >
            ⚠️ Patellar Tendinopathy & Hip Impingement
          </button>
        </div>
      )}
    </div>
  );
};

