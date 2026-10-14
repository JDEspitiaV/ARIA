import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import appletConfig from '../firebase-applet-config.json';
import { loadLocalReferenceStandards } from '../src/services/eventStandardsService';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || '',
  authDomain: appletConfig.authDomain,
  projectId: appletConfig.projectId,
  storageBucket: appletConfig.storageBucket,
  messagingSenderId: appletConfig.messagingSenderId,
  appId: appletConfig.appId
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app, (appletConfig as any).firestoreDatabaseId || "ai-studio-2e02a69f-fc8d-46cd-bbc1-146c884acf19");

async function main() {
  console.log('[Migration] Loading local event reference standards from .md files...');
  const standards = loadLocalReferenceStandards();
  console.log(`[Migration] Found ${standards.length} standards to migrate.`);

  for (const std of standards) {
    try {
      console.log(`[Migration] Uploading standard: ${std.id} (${std.eventName})...`);
      const docRef = doc(db, 'eventReferenceStandards', std.id);
      await setDoc(docRef, {
        id: std.id,
        eventName: std.eventName,
        sourceFile: std.sourceFile,
        lastUpdatedByCoach: std.lastUpdatedByCoach,
        content: std.content,
        keywords: std.keywords
      }, { merge: true });
      console.log(`[Migration] Successfully written: eventReferenceStandards/${std.id}`);
    } catch (err) {
      console.error(`[Migration] Error writing standard ${std.id}:`, err);
    }
  }

  console.log('[Migration] All event reference standards have been synced to Firestore!');
  process.exit(0);
}

main().catch(err => {
  console.error('[Migration] Fatal error:', err);
  process.exit(1);
});
