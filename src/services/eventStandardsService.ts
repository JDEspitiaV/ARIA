/**
 * ARIA Event Reference Standards Service
 * Manages manually curated biomechanical and kinematic benchmark standards
 * stored in the `eventReferenceStandards` collection.
 */

import fs from 'fs';
import path from 'path';

export interface EventReferenceStandard {
  id: string;
  eventName: string;
  lastUpdatedByCoach: string;
  content: string;
  sourceFile: string;
  keywords: string[];
}

const STANDARDS_DIR = path.join(process.cwd(), 'src', 'data', 'eventReferenceStandards');

export const CURATED_EVENT_METADATA: Record<string, { eventName: string; sourceFile: string; keywords: string[] }> = {
  high_jump: {
    eventName: 'Salto de Altura (High Jump)',
    sourceFile: 'high_jump.md',
    keywords: ['high jump', 'salto alto', 'salto de altura', 'altura', 'flop', 'fosbury']
  },
  horizontal_jumps: {
    eventName: 'Saltos Horizontales (Long Jump & Triple Jump)',
    sourceFile: 'horizontal_jumps.md',
    keywords: ['long jump', 'triple jump', 'salto largo', 'salto de longitud', 'salto triple', 'longitud']
  },
  hurdles: {
    eventName: 'Carreras de Vallas (100mH, 110mH, 400mH)',
    sourceFile: 'hurdles.md',
    keywords: ['hurdles', 'vallas', '100mh', '110mh', '400mh', '60mh', 'paso de valla']
  },
  middle_distance: {
    eventName: 'Medio Fondo (800m - 3000m)',
    sourceFile: 'middle_distance.md',
    keywords: ['800m', '1500m', '3000m', 'medio fondo', 'middle distance', 'mile', 'milla', 'fondo']
  },
  pole_vault: {
    eventName: 'Salto con Garrocha / Pértiga (Pole Vault)',
    sourceFile: 'pole_vault.md',
    keywords: ['pole vault', 'garrocha', 'pértiga', 'pertiga', 'duplantis']
  },
  sprints: {
    eventName: 'Carreras de Velocidad (100m, 200m, 400m)',
    sourceFile: 'sprints.md',
    keywords: ['100m', '200m', '400m', 'sprint', 'velocidad', 'velocista']
  },
  throws: {
    eventName: 'Lanzamientos (Bala, Disco, Jabalina, Martillo)',
    sourceFile: 'throws.md',
    keywords: ['shot put', 'discus', 'javelin', 'hammer', 'bala', 'peso', 'disco', 'jabalina', 'martillo', 'lanzamiento', 'lanzador']
  }
};

/**
 * Loads all curated reference standards from local UTF-8 markdown files.
 */
export function loadLocalReferenceStandards(): EventReferenceStandard[] {
  const standards: EventReferenceStandard[] = [];

  for (const [id, meta] of Object.entries(CURATED_EVENT_METADATA)) {
    try {
      const filePath = path.join(STANDARDS_DIR, meta.sourceFile);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        standards.push({
          id,
          eventName: meta.eventName,
          lastUpdatedByCoach: '2026-09-04T12:00:00Z',
          content,
          sourceFile: meta.sourceFile,
          keywords: meta.keywords
        });
      }
    } catch (err) {
      console.warn(`[EventStandardsService] Could not load ${meta.sourceFile}:`, err);
    }
  }

  return standards;
}

/**
 * Finds the most relevant event reference standard for an athlete given their target events and query.
 */
export function getRelevantEventStandard(
  athleteEvents: string[] = [],
  query: string = ''
): EventReferenceStandard | null {
  const standards = loadLocalReferenceStandards();
  const searchCorpus = `${athleteEvents.join(' ')} ${query}`.toLowerCase();

  for (const std of standards) {
    for (const kw of std.keywords) {
      if (searchCorpus.includes(kw.toLowerCase())) {
        return std;
      }
    }
  }

  // Default fallback to sprints if track event or not found
  const sprintStd = standards.find(s => s.id === 'sprints');
  return sprintStd || standards[0] || null;
}
