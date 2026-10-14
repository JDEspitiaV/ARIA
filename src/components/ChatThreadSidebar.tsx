import React, { useState } from 'react';
import { Edit2, Trash2, Check, X, Sparkles, MessageSquare, AlertTriangle } from 'lucide-react';
import { ChatThread } from '../types';

interface ChatThreadSidebarProps {
  threads: ChatThread[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  onDeleteThread: (threadId: string) => void;
  onRenameThread?: (threadId: string, newTitle: string) => void;
  onCleanupEmptyThreads?: () => Promise<void>;
  isOpen: boolean;
  onClose: () => void;
}

export const ChatThreadSidebar: React.FC<ChatThreadSidebarProps> = ({
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  onRenameThread,
  onCleanupEmptyThreads,
  isOpen,
  onClose
}) => {
  const [searchFilter, setSearchFilter] = useState('');
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editTitleInput, setEditTitleInput] = useState('');
  const [threadToDelete, setThreadToDelete] = useState<ChatThread | null>(null);
  const [isCleaning, setIsCleaning] = useState(false);

  const filteredThreads = threads.filter(t => 
    t.title.toLowerCase().includes(searchFilter.toLowerCase()) ||
    (t.lastMessagePreview && t.lastMessagePreview.toLowerCase().includes(searchFilter.toLowerCase()))
  );

  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 3600 * 24));
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  const handleStartRename = (thread: ChatThread, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingThreadId(thread.id);
    setEditTitleInput(thread.title);
  };

  const handleSaveRename = (threadId: string, e?: React.MouseEvent | React.FormEvent) => {
    if (e) e.stopPropagation();
    const clean = editTitleInput.trim();
    if (clean && onRenameThread) {
      onRenameThread(threadId, clean);
    }
    setEditingThreadId(null);
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingThreadId(null);
    setEditTitleInput('');
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          id="chat-sidebar-backdrop"
          onClick={onClose}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 md:hidden"
        />
      )}

      {/* Sidebar Container */}
      <aside 
        id="chat-threads-sidebar"
        className={`fixed md:static inset-y-0 left-0 z-40 w-72 md:w-64 lg:w-72 bg-zinc-950 border-r border-zinc-800/80 flex flex-col transition-transform duration-200 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Sidebar Header */}
        <div className="p-3 border-b border-zinc-800/80 flex flex-col gap-2 bg-zinc-900/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold tracking-wider text-zinc-300 uppercase flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Tactical Sessions
            </span>
            <button
              id="close-sidebar-btn"
              onClick={onClose}
              className="md:hidden p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 text-xs min-w-[32px] min-h-[32px] flex items-center justify-center"
              title="Close sidebar"
            >
              ✕
            </button>
          </div>

          <button
            id="new-tactical-session-btn"
            onClick={() => {
              onNewThread();
              if (window.innerWidth < 768) onClose();
            }}
            className="w-full py-2 px-3 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded text-xs tracking-wide flex items-center justify-center gap-2 transition shadow-xs min-h-[38px]"
          >
            <span className="text-base leading-none font-black">+</span>
            <span>NEW TACTICAL SESSION</span>
          </button>

          <input
            id="search-threads-input"
            type="text"
            placeholder="Search sessions..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-hidden focus:border-zinc-600"
          />
        </div>

        {/* Thread List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
          {filteredThreads.length === 0 ? (
            <div className="p-4 text-center text-xs text-zinc-500">
              {searchFilter ? 'No matching sessions' : 'No previous sessions logged. Start a new session above.'}
            </div>
          ) : (
            filteredThreads.map(thread => {
              const isActive = thread.id === activeThreadId;
              const isEditing = editingThreadId === thread.id;

              return (
                <div
                  key={thread.id}
                  id={`thread-item-${thread.id}`}
                  onClick={() => {
                    if (!isEditing) {
                      onSelectThread(thread.id);
                      if (window.innerWidth < 768) onClose();
                    }
                  }}
                  className={`group relative p-2.5 rounded-md cursor-pointer text-left transition border ${
                    isActive 
                      ? 'bg-zinc-800/90 border-zinc-700 text-white shadow-xs' 
                      : 'bg-zinc-900/30 border-transparent hover:bg-zinc-900 hover:border-zinc-800 text-zinc-300'
                  }`}
                >
                  {/* Inline Rename Form or Display Title */}
                  {isEditing ? (
                    <div 
                      className="flex items-center gap-1 my-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        id={`rename-input-${thread.id}`}
                        type="text"
                        value={editTitleInput}
                        onChange={(e) => setEditTitleInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename(thread.id, e);
                          if (e.key === 'Escape') handleCancelRename(e as any);
                        }}
                        autoFocus
                        className="flex-1 bg-zinc-950 border border-emerald-500 rounded px-1.5 py-1 text-xs text-white focus:outline-hidden"
                      />
                      <button
                        id={`save-rename-${thread.id}`}
                        onClick={(e) => handleSaveRename(thread.id, e)}
                        className="p-1 text-emerald-400 hover:bg-emerald-950/60 rounded"
                        title="Save Title"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        id={`cancel-rename-${thread.id}`}
                        onClick={handleCancelRename}
                        className="p-1 text-zinc-400 hover:bg-zinc-800 rounded"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-semibold text-xs truncate flex-1 text-zinc-100">
                        {thread.title}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] font-mono text-zinc-500 whitespace-nowrap hidden md:block md:group-hover:hidden">
                          {formatDate(thread.updatedAt)}
                        </span>
                        
                        <div className="touch-action-btn flex items-center gap-1 md:hidden md:group-hover:flex">
                          {onRenameThread && (
                            <button
                              id={`rename-thread-${thread.id}`}
                              onClick={(e) => handleStartRename(thread, e)}
                              className="touch-action-btn rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition min-w-[36px] min-h-[36px] flex items-center justify-center"
                              title="Rename session"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            id={`delete-thread-${thread.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setThreadToDelete(thread);
                            }}
                            className="touch-action-btn rounded text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 transition min-w-[36px] min-h-[36px] flex items-center justify-center"
                            title="Delete session"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {thread.lastMessagePreview && !isEditing && (
                    <p className="text-[11px] text-zinc-400 truncate line-clamp-1">
                      {thread.lastMessagePreview}
                    </p>
                  )}

                  {thread.keyFactSummary && !isEditing && (
                    <div className="mt-1.5 pt-1 border-t border-zinc-800/60 flex items-center gap-1 text-[10px] text-emerald-400/90 font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                      <span className="truncate">Memory synced</span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Cross-Thread Memory Status Footer */}
        <div className="p-2.5 border-t border-zinc-800/80 bg-zinc-900/40 text-[11px] text-zinc-400">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span className="font-medium text-zinc-300">Cross-Thread Memory Active</span>
          </div>
          <p className="text-[10px] text-zinc-500 mt-0.5 leading-tight">
            Key athletic facts & kinetic history carry over automatically across sessions.
          </p>
          {onCleanupEmptyThreads && (
            <button
              id="audit-clean-empty-threads-btn"
              type="button"
              onClick={async () => {
                setIsCleaning(true);
                try {
                  await onCleanupEmptyThreads();
                } finally {
                  setIsCleaning(false);
                }
              }}
              disabled={isCleaning}
              className="mt-2 w-full py-1 px-2 text-[10px] font-mono text-zinc-400 hover:text-zinc-200 bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/50 rounded transition flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              title="Audit and clean orphaned empty sessions (verifies subcollection message count)"
            >
              <Trash2 className="w-2.5 h-2.5" />
              <span>{isCleaning ? 'Auditing sessions...' : 'Clean empty sessions'}</span>
            </button>
          )}
        </div>
      </aside>

      {/* Custom In-App Delete Confirmation Modal */}
      {threadToDelete && (
        <div 
          id="delete-thread-modal-backdrop"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setThreadToDelete(null)}
        >
          <div 
            id="delete-thread-modal"
            className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-white tracking-wide">
                  ¿Eliminar esta sesión?
                </h3>
                <p className="text-xs text-zinc-300 font-semibold mt-1 truncate">
                  «{threadToDelete.title}»
                </p>
                <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                  Esta acción no se puede deshacer y se borrará el historial de esta sesión táctica.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800/80">
              <button
                id="cancel-delete-thread-btn"
                type="button"
                onClick={() => setThreadToDelete(null)}
                className="px-3.5 py-2 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700/80 border border-zinc-700/80 rounded-lg transition min-h-[36px] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                id="confirm-delete-thread-btn"
                type="button"
                onClick={() => {
                  if (threadToDelete) {
                    onDeleteThread(threadToDelete.id);
                    setThreadToDelete(null);
                  }
                }}
                className="px-3.5 py-2 text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition flex items-center gap-1.5 shadow-sm min-h-[36px] cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
