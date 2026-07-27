import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDZ5G4pBPLlzTd9QL5ikBM0tgNNwJHtkmE",
  authDomain: "chat-ba2e0.firebaseapp.com",
  projectId: "chat-ba2e0",
  storageBucket: "chat-ba2e0.firebasestorage.app",
  messagingSenderId: "781903850019",
  appId: "1:781903850019:web:477a8a299ab34270afdf96"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
