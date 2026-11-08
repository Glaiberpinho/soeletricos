import { initializeApp, getApps } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

// Configuração pública do aplicativo Web Firebase, injetada pelo GitHub Actions
// durante o build por meio das variáveis VITE_FIREBASE_*.
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "seu-projeto.firebaseapp.com",
  projectId: "seu-projeto",
  storageBucket: "seu-projeto.firebasestorage.app",
  messagingSenderId: "123456789",
  appId: "1:123456:web:abcd"
};

export const firebaseReady = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.storageBucket &&
  firebaseConfig.messagingSenderId &&
  firebaseConfig.appId
)

let firebaseApp = null
let firebaseInitError = null

if (firebaseReady) {
  try {
    firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig)
  } catch (error) {
    firebaseInitError = error
    console.error('Falha ao inicializar Firebase:', error)
  }
}

export const app = firebaseApp
export const auth = firebaseApp ? getAuth(firebaseApp) : null
export const db = firebaseApp ? getFirestore(firebaseApp) : null
export const storage = firebaseApp ? getStorage(firebaseApp) : null
export const firebaseError = firebaseInitError
