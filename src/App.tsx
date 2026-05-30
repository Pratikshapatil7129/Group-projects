import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Sidebar from './components/Sidebar';
import ProjectBoard from './components/ProjectBoard';
import TaskModal from './components/TaskModal';
import NotificationsPanel from './components/NotificationsPanel';
import { 
  Layers, 
  LogIn, 
  Activity, 
  MessageSquare, 
  Users, 
  Sparkles,
  CheckCircle2,
  Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

function Dashboard() {
  const { user, profile, loading, signInWithGoogle } = useAuth();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isOpenNotifications, setIsOpenNotifications] = useState(false);

  if (loading) {
    return (
      <div id="loader_screen" className="fixed inset-0 bg-slate-50 flex flex-col items-center justify-center space-y-4">
        <span className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></span>
        <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">Warming Up Sync Stage...</p>
      </div>
    );
  }

  // --- SIGN IN SPLASH CARD ---
  if (!user || !profile) {
    return (
      <div id="splash_screen" className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 rounded-3xl bg-white shadow-2xl border border-slate-100 overflow-hidden">
          {/* Brand/Pitch Banner */}
          <div className="bg-slate-900 p-8 md:p-12 text-white flex flex-col justify-between h-[300px] md:h-auto">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-indigo-600 rounded-xl text-white">
                <Layers className="h-6 w-6" />
              </div>
              <div>
                <h2 className="font-sans font-bold tracking-tight text-xl text-white">CoSync Boards</h2>
                <p className="text-[10px] text-indigo-400 font-mono tracking-wider uppercase">Workspace Stream</p>
              </div>
            </div>

            <div className="space-y-6">
              <h3 className="text-2xl md:text-3xl font-sans font-medium tracking-tight leading-tight text-slate-100">
                Collaborate in real-time. Make things happen.
              </h3>
              
              <div className="space-y-3">
                <div className="flex items-center space-x-3 text-sm text-slate-300">
                  <CheckCircle2 className="h-4.5 w-4.5 text-indigo-400 shrink-0" />
                  <span>Interactive Kanban lanes (Trello/Asana style)</span>
                </div>
                <div className="flex items-center space-x-3 text-sm text-slate-300">
                  <MessageSquare className="h-4.5 w-4.5 text-indigo-400 shrink-0" />
                  <span>Instant, synchronized task comments</span>
                </div>
                <div className="flex items-center space-x-3 text-sm text-slate-300">
                  <Users className="h-4.5 w-4.5 text-indigo-400 shrink-0" />
                  <span>Full crew assignments & inbox alert logs</span>
                </div>
              </div>
            </div>

            <p className="text-[10px] text-slate-500 font-mono">
              Powered by Firestore Live Snapshot Synchronization Engine.
            </p>
          </div>

          {/* Identity Login Prompt */}
          <div className="p-8 md:p-14 flex flex-col justify-center bg-white">
            <div className="max-w-sm mx-auto w-full text-center md:text-left space-y-6">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight font-sans mb-1.5">Sign In with Workspace</h1>
                <p className="text-xs text-slate-500 font-sans leading-relaxed">
                  Authenticate securely through Google Accounts to register your profile directory and access your shared projects board.
                </p>
              </div>

              <div className="bg-amber-50 rounded-xl p-4 border border-amber-200/60 text-amber-800 text-xs text-left leading-relaxed flex items-start space-x-2.5 font-sans">
                <Lock className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Sandbox Environment:</span> Since you are in the AI Studio live preview iframe, we use safe authorization popups to establish your profile safely.
                </div>
              </div>

              {/* Login Button */}
              <button
                id="btn_login_google_action"
                onClick={signInWithGoogle}
                className="w-full flex items-center justify-center space-x-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3.5 px-4 rounded-xl shadow-lg shadow-indigo-100 transition-all font-sans cursor-pointer"
              >
                <LogIn className="h-4.5 w-4.5" />
                <span>Sign In with Google</span>
              </button>

              <div className="text-center">
                <span className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">Verified Zero-Trust Access</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- LOGGED-IN LIVE WORKSPACE DASHBOARD ---
  return (
    <div id="dashboard_stage" className="h-screen w-screen flex bg-slate-50 overflow-hidden font-sans">
      {/* 1. Left Sidebar Navigation */}
      <Sidebar 
        activeProjectId={activeProjectId} 
        onSelectProject={(id) => {
          setActiveProjectId(id);
          setActiveTaskId(null); // Clear selected task on project shift
        }} 
        onOpenNotifications={() => setIsOpenNotifications(true)}
      />

      {/* 2. Main KanBan Board Area */}
      {activeProjectId ? (
        <ProjectBoard 
          projectId={activeProjectId} 
          onOpenTask={(taskId) => setActiveTaskId(taskId)}
        />
      ) : (
        <div id="stage_select_project_placeholder" className="flex-1 flex items-center justify-center p-8 bg-slate-50">
          <div className="text-center max-w-sm rounded-2xl p-10 bg-white border border-slate-200 shadow-sm">
            <Layers className="mx-auto h-12 w-12 text-slate-300 animate-pulse" />
            <h3 className="mt-4 text-sm font-semibold text-slate-900">Choose or start a project</h3>
            <p className="mt-2 text-xs text-slate-500 leading-relaxed font-sans">
              To operate collaborative task boards, select an existing board from the sidebar menu, or press the "+" tool to establish a new group workspace.
            </p>
          </div>
        </div>
      )}

      {/* 3. Sliding Task Details Overlay */}
      <AnimatePresence>
        {activeProjectId && activeTaskId && (
          <TaskModal 
            projectId={activeProjectId} 
            taskId={activeTaskId} 
            onClose={() => setActiveTaskId(null)}
          />
        )}
      </AnimatePresence>

      {/* 4. Sliding Notifications Drawer */}
      <AnimatePresence>
        {isOpenNotifications && (
          <NotificationsPanel 
            onClose={() => setIsOpenNotifications(false)}
            onNavigateToProject={(projId) => {
              setActiveProjectId(projId);
              setActiveTaskId(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Dashboard />
    </AuthProvider>
  );
}
