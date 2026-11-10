import { initializeApp, getApps } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// Configuração do aplicativo Web Firebase — projeto Só Elétricos.
const firebaseConfig = {
  apiKey: "AIzaSyBktJKVM6N7QOrU0SgwgtqFKbtqqthTq-M",
  authDomain: "soeletricos-app-ee1e6.firebaseapp.com",
  projectId: "soeletricos-app-ee1e6",
  storageBucket: "soeletricos-app-ee1e6.firebasestorage.app",
  messagingSenderId: "706881545139",
  appId: "1:706881545139:web:def368ea3e3548676fa1c6",
  measurementId: "G-0WDL03408J"
}

export const firebaseReady = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
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

// --- TRUQUE PARA O PLANO 100% GRATUITO (SPARK) ---
// Criamos um Storage falso para enganar o formulário e evitar o erro '_location'
export const storage = {
  _delegate: {},
  _location: { bucket: firebaseConfig.storageBucket }
}

export const firebaseError = firebaseInitError
