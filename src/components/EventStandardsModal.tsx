import React, { useState, useEffect } from 'react';
import { X, BookOpen, Search, CheckCircle, FileText, Sparkles, Activity } from 'lucide-react';
import Markdown from 'react-markdown';

interface EventStandardSummary {
  id: string;
  eventName: string;
  sourceFile: string;
  lastUpdatedByCoach: string;
  contentLength: number;
  preview: string;
}

interface EventStandardDetail {
  id: string;
  eventName: string;
  sourceFile: string;
  lastUpdatedByCoach: string;
  content: string;
  keywords: string[];
}

interface EventStandardsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EventStandardsModal: React.FC<EventStandardsModalProps> = ({ isOpen, onClose }) => {
  const [standards, setStandards] = useState<EventStandardSummary[]>([]);
  const [selectedStandard, setSelectedStandard] = useState<EventStandardDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    const fetchStandards = async () => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/reference-standards');
        const data = await res.json();
        if (data.standards) {
          setStandards(data.standards);
          if (data.standards.length > 0 && !selectedStandard) {
            loadStandardDetail(data.standards[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load reference standards:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchStandards();
  }, [isOpen]);

  const loadStandardDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/reference-standards/${id}`);
      const data = await res.json();
      if (data.standard) {
        setSelectedStandard(data.standard);
      }
    } catch (err) {
      console.error('Failed to load standard details:', err);
    }
  };

  if (!isOpen) return null;

  const filteredStandards = standards.filter(s =>
    s.eventName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.sourceFile.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        id="event-standards-modal"
        className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-zinc-800 flex items-center justify-between gap-4 bg-zinc-950/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-950/80 border border-cyan-500/40 text-cyan-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-mono font-bold text-zinc-100">
                  EVENT REFERENCE STANDARDS
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
                  CURATED KINEMATICS & BENCHMARKS
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Manually curated biomechanical models, step geometry, and competitive benchmark matrices ingested into ARIA.
              </p>
            </div>
          </div>
          <button
            id="close-standards-modal-btn"
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Sidebar / List */}
          <div className="w-full md:w-72 border-b md:border-b-0 md:border-r border-zinc-800 bg-zinc-950/30 flex flex-col shrink-0">
            <div className="p-3 border-b border-zinc-800">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Filter events..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {isLoading ? (
                <div className="p-4 text-center text-xs text-zinc-500 font-mono">
                  Loading standards...
                </div>
              ) : filteredStandards.length === 0 ? (
                <div className="p-4 text-center text-xs text-zinc-500">
                  No standards matching search.
                </div>
              ) : (
                filteredStandards.map(std => {
                  const isSelected = selectedStandard?.id === std.id;
                  return (
                    <button
                      key={std.id}
                      onClick={() => loadStandardDetail(std.id)}
                      className={`w-full text-left p-2.5 rounded-xl text-xs font-mono transition-colors flex items-start gap-2.5 ${
                        isSelected
                          ? 'bg-cyan-950/50 border border-cyan-800 text-cyan-200'
                          : 'hover:bg-zinc-800/60 text-zinc-400 border border-transparent'
                      }`}
                    >
                      <FileText className={`w-4 h-4 shrink-0 mt-0.5 ${isSelected ? 'text-cyan-400' : 'text-zinc-500'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate text-zinc-200">{std.eventName}</div>
                        <div className="text-[10px] text-zinc-500 truncate mt-0.5">{std.sourceFile}</div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Viewer Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-zinc-900/50">
            {selectedStandard ? (
              <div className="max-w-3xl mx-auto space-y-4">
                <div className="pb-3 border-b border-zinc-800">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                      ID: {selectedStandard.id}
                    </span>
                    <span className="text-[11px] font-mono text-zinc-500">
                      Source: {selectedStandard.sourceFile}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-zinc-100 font-mono">
                    {selectedStandard.eventName}
                  </h3>
                  <p className="text-xs text-zinc-400 font-mono mt-1">
                    Curated Standard • Grounded in World Athletics Biomechanical Reports
                  </p>
                </div>

                <div className="prose prose-invert prose-xs sm:prose-sm max-w-none text-zinc-300 font-sans leading-relaxed">
                  <Markdown>{selectedStandard.content}</Markdown>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-zinc-500 font-mono">
                Select an event reference standard to view.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-between text-xs text-zinc-500 font-mono shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Injected directly into ARIA context for kinematic precision</span>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
