import React, { useState, useEffect } from 'react';
import { 
  FolderPlus, 
  Layers, 
  LogOut, 
  Bell, 
  CheckCircle, 
  UserPlus, 
  Folder, 
  ChevronRight, 
  Grid
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { Project, Notification } from '../types';
import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  doc, 
  setDoc, 
  serverTimestamp, 
  writeBatch,
  updateDoc
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

interface SidebarProps {
  activeProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
  onOpenNotifications: () => void;
}

export default function Sidebar({ activeProjectId, onSelectProject, onOpenNotifications }: SidebarProps) {
  const { profile, logOut } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isCreatingProj, setIsCreatingProj] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Monitor projects the user belongs to in real-time (using query enforcer on memberUids)
  useEffect(() => {
    if (!profile) return;

    const q = query(
      collection(db, 'projects'),
      where('memberUids', 'array-contains', profile.userId)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Project[] = [];
        snapshot.forEach((doc) => {
          list.push(doc.data() as Project);
        });
        // Sort projects by updated / created time
        list.sort((a, b) => {
          const tA = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
          const tB = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
          return tB - tA;
        });
        setProjects(list);
        setLoading(false);
        
        // Auto-select first project if none is active
        if (list.length > 0 && !activeProjectId) {
          onSelectProject(list[0].projectId);
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'projects');
      }
    );

    return () => unsubscribe();
  }, [profile]);

  // Monitor unread notifications in real-time
  useEffect(() => {
    if (!profile) return;

    const q = query(
      collection(db, 'users', profile.userId, 'notifications'),
      where('read', '==', false)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Notification[] = [];
        snapshot.forEach((doc) => {
          list.push(doc.data() as Notification);
        });
        setNotifications(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `users/${profile.userId}/notifications`);
      }
    );

    return () => unsubscribe();
  }, [profile]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !newProjName.trim()) return;

    setError('');
    const idSafe = 'proj-' + Math.random().toString(36).substring(2, 11);

    try {
      // 1. Prepare batch to create project and member doc atomically
      const batch = writeBatch(db);

      const projectRef = doc(db, 'projects', idSafe);
      const projectPayload: Project = {
        projectId: idSafe,
        name: newProjName.trim(),
        description: newProjDesc.trim(),
        ownerId: profile.userId,
        memberUids: [profile.userId],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      
      batch.set(projectRef, projectPayload);

      // Create member document
      const memberRef = doc(db, 'projects', idSafe, 'members', profile.userId);
      batch.set(memberRef, {
        userId: profile.userId,
        role: 'owner',
        addedAt: serverTimestamp(),
      });

      await batch.commit();

      setNewProjName('');
      setNewProjDesc('');
      setIsCreatingProj(false);
      onSelectProject(idSafe);
    } catch (err: any) {
      console.error('Project creation failed: ', err);
      setError('Failed to create project. Please verify permissions.');
      handleFirestoreError(err, OperationType.CREATE, `projects/${idSafe}`);
    }
  };

  return (
    <div id="sidebar_main" className="w-80 bg-slate-900 text-white flex flex-col h-full border-r border-slate-800">
      {/* Sidebar Header */}
      <div id="sidebar_brand" className="p-6 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-indigo-600 rounded-lg text-white">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-sans font-semibold tracking-tight text-lg text-slate-100">CoSync Board</h1>
            <p className="text-[10px] text-slate-400 font-mono">Real-Time Workspace</p>
          </div>
        </div>
        
        {/* Notifications Trigger */}
        <button 
          id="btn_notifications_trigger"
          onClick={onOpenNotifications}
          className="relative p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-all"
        >
          <Bell className="h-4 w-4" />
          {notifications.length > 0 && (
            <span id="unread_indicator" className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-slate-900">
              {notifications.length}
            </span>
          )}
        </button>
      </div>

      {/* User Information */}
      {profile && (
        <div id="sidebar_user" className="px-6 py-4 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img 
              id="sidebar_user_avatar"
              src={profile.photoURL} 
              alt={profile.displayName}
              referrerPolicy="no-referrer"
              className="h-10 w-10 rounded-full border border-slate-700 object-cover"
            />
            <div className="overflow-hidden">
              <h4 className="font-sans font-medium text-sm text-slate-200 truncate pr-2">{profile.displayName}</h4>
              <p className="text-[11px] text-slate-500 font-mono truncate pr-2">{profile.email}</p>
            </div>
          </div>
          <button 
            id="btn_logout"
            onClick={logOut}
            title="Sign Out"
            className="p-1.5 text-slate-500 hover:text-red-400 rounded hover:bg-slate-800/80 transition-all"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Project Selector List */}
      <div id="sidebar_projects_container" className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between px-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 font-mono">Projects</span>
          <button 
            id="btn_add_project"
            onClick={() => setIsCreatingProj(!isCreatingProj)}
            className="p-1 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded transition-all"
            title="Create Group Project"
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        </div>

        {/* Project creation inline form */}
        <AnimatePresence>
          {isCreatingProj && (
            <motion.form 
              id="form_create_project"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              onSubmit={handleCreateProject}
              className="bg-slate-800/50 p-3.5 rounded-lg border border-slate-705 space-y-3 overflow-hidden text-slate-200"
            >
              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1">Project Name</label>
                <input 
                  id="input_project_name"
                  type="text" 
                  value={newProjName}
                  onChange={(e) => setNewProjName(e.target.value)}
                  placeholder="e.g. Q3 Launch Marketing"
                  required
                  maxLength={100}
                  className="w-full text-xs font-sans bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1">Description</label>
                <textarea 
                  id="textarea_project_desc"
                  value={newProjDesc}
                  onChange={(e) => setNewProjDesc(e.target.value)}
                  placeholder="Focus areas & group guidelines"
                  rows={2}
                  maxLength={1000}
                  className="w-full text-xs font-sans bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>
              
              {error && <p id="err_project_form" className="text-[11px] font-mono text-red-400">{error}</p>}

              <div className="flex space-x-2 pt-1.5">
                <button 
                  id="btn_submit_project"
                  type="submit"
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-sans text-xs font-medium py-1.5 rounded transition-all"
                >
                  Create
                </button>
                <button 
                  id="btn_cancel_project"
                  type="button"
                  onClick={() => setIsCreatingProj(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 font-sans text-xs py-1.5 rounded transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Project List */}
        <div id="project_items_list" className="space-y-1">
          {loading ? (
            <div className="py-8 flex justify-center items-center">
              <span className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></span>
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-8 px-4 text-slate-500 text-xs font-sans">
              No active projects. Click "+" above to start.
            </div>
          ) : (
            projects.map((proj) => {
              const isActive = proj.projectId === activeProjectId;
              return (
                <button
                  id={`project_btn_${proj.projectId}`}
                  key={proj.projectId}
                  onClick={() => onSelectProject(proj.projectId)}
                  className={`w-full text-left flex items-center justify-between px-3.5 py-3 rounded-lg transition-all group ${
                    isActive 
                      ? 'bg-indigo-600/15 text-indigo-300 font-medium border-l-[3px] border-indigo-500 pl-2.5' 
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center space-x-3 overflow-hidden">
                    <Folder className={`h-4 w-4 shrink-0 ${isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
                    <span className="truncate text-sm font-sans">{proj.name}</span>
                  </div>
                  <ChevronRight className={`h-3 w-3 opacity-0 group-hover:opacity-100 transition-all ${isActive ? 'text-indigo-400' : 'text-slate-600'}`} />
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Footer Info */}
      <div id="sidebar_footer" className="p-4 border-t border-slate-800 text-center text-[10px] font-mono text-slate-600">
        CoSync Workspace v1.2
      </div>
    </div>
  );
}
