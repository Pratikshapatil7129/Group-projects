import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  GoogleAuthProvider, 
  User as FirebaseUser 
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, getDocFromServer } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile } from '../types';

interface AuthContextType {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  logOut: () => Promise<void>;
  allUsers: UserProfile[];
  refreshAllUsers: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);

  // Test connection to Firestore on initialization (as described in system guidelines)
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration or network status.");
        }
      }
    }
    testConnection();
  }, []);

  // Sync users list to allow searching/inviting others
  const fetchAllUsers = async () => {
    if (!user) return;
    try {
      // In a real production app we'd fetch with limits, but here we can load user profiles
      const { collection, getDocs } = await import('firebase/firestore');
      const usersSnap = await getDocs(collection(db, 'users'));
      const list: UserProfile[] = [];
      usersSnap.forEach((doc) => {
        list.push(doc.data() as UserProfile);
      });
      setAllUsers(list);
    } catch (e) {
      console.warn("Could not fetch user directory list. This might be due to rules restrictions.", e);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Enforce verified email. Google sign-on always returns emailVerified = true
        // Let's create user profile doc if it doesn't exist
        const userDocRef = doc(db, 'users', currentUser.uid);
        try {
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists()) {
            setProfile(userDoc.data() as UserProfile);
          } else {
            // Profile payload conforming perfectly to isValidUser schemas (with serverTime)
            const newProfile: UserProfile = {
              userId: currentUser.uid,
              displayName: currentUser.displayName || currentUser.email?.split('@')[0] || 'Anonymous',
              email: currentUser.email || '',
              photoURL: currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(currentUser.email || 'user')}`,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            
            await setDoc(userDocRef, newProfile);
            // Fetch updated doc to get normal dates
            const freshlyCreated = await getDoc(userDocRef);
            setProfile(freshlyCreated.data() as UserProfile);
          }
        } catch (error) {
          console.error('Error handling user profile: ', error);
          // Standard error handling wrap
          handleFirestoreError(error, OperationType.WRITE, `users/${currentUser.uid}`);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      fetchAllUsers();
    } else {
      setAllUsers([]);
    }
  }, [user]);

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    // Enforce custom prompt choice
    provider.setCustomParameters({
      prompt: 'select_account'
    });
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Google Sign In failed: ', error);
      throw error;
    }
  };

  const logOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Sign Out failed: ', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider 
      value={{ 
        user, 
        profile, 
        loading, 
        signInWithGoogle, 
        logOut, 
        allUsers, 
        refreshAllUsers: fetchAllUsers 
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
