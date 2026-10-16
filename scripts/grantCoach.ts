import * as admin from 'firebase-admin';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';

dotenv.config();

const app = !getApps().length ? initializeApp({
    projectId: process.env.VITE_FIREBASE_PROJECT_ID
}) : getApps()[0];

const db = getFirestore(app);

async function grantCoach(uid: string) {
    if (!uid) {
        console.error("Usage: tsx scripts/grantCoach.ts <uid>");
        process.exit(1);
    }
    
    await db.collection('roles').doc(uid).set({ role: 'COACH' });
    console.log(`Successfully granted COACH role to ${uid}`);
}

grantCoach(process.argv[2]);
