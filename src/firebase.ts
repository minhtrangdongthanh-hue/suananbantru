import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  disableNetwork,
  enableNetwork,
  getFirestore,
  setLogLevel,
} from 'firebase/firestore';
import defaultFirebaseConfig from '../firebase-applet-config.json';

// Silence internal @firebase/firestore backoff/quota console.error spam
// so quota exhaustion on free-tier Spark databases is handled cleanly by HybridLocalStore
try {
  setLogLevel('silent');
} catch {
  // ignore if setLogLevel is unavailable
}

export const CUSTOM_FIREBASE_CONFIG_KEY = 'THCS_DONG_THANH_CUSTOM_FIREBASE_CONFIG';
export const EXHAUSTED_DEFAULT_PROJECT_ID = 'seraphic-infinity-cnm9t';

export interface ActiveFirebaseConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  isCustom?: boolean;
}

export function getActiveFirebaseConfig(): ActiveFirebaseConfig {
  try {
    const raw = localStorage.getItem(CUSTOM_FIREBASE_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ActiveFirebaseConfig;
      if (parsed && parsed.projectId && parsed.apiKey && parsed.authDomain) {
        return {
          ...parsed,
          isCustom: true,
        };
      }
    }
  } catch {
    // ignore invalid custom config
  }
  return {
    ...defaultFirebaseConfig,
    isCustom: false,
  };
}

export function saveCustomFirebaseConfig(config: ActiveFirebaseConfig | null): void {
  if (!config) {
    localStorage.removeItem(CUSTOM_FIREBASE_CONFIG_KEY);
  } else {
    localStorage.setItem(CUSTOM_FIREBASE_CONFIG_KEY, JSON.stringify(config));
  }
  window.location.reload();
}

export const activeFirebaseConfig = getActiveFirebaseConfig();

const app = initializeApp(activeFirebaseConfig);
export const db = activeFirebaseConfig.firestoreDatabaseId
  ? getFirestore(app, activeFirebaseConfig.firestoreDatabaseId)
  : getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

export async function setFirestoreNetworkEnabled(enabled: boolean): Promise<void> {
  try {
    if (enabled) {
      await enableNetwork(db);
    } else {
      await disableNetwork(db);
    }
  } catch {
    // ignore network toggle errors
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  throw new Error(JSON.stringify(errInfo));
}
