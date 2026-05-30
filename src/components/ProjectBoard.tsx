import React, { useState, useEffect } from 'react';
import { 
  Users, 
  UserPlus, 
  Search, 
  Plus, 
  ArrowRight, 
  Calendar, 
  MessageSquare, 
  ChevronsUpDown, 
  Trash2, 
  Eye, 
  ArrowLeft,
  ChevronLeft,
  Grid,
  Activity,
  Pencil
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { Project, Task, ProjectMember, UserProfile, Notification } from '../types';
import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  serverTimestamp,
  arrayUnion,
  getDocs
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

interface ProjectBoardProps {
  projectId: string;
  onOpenTask: (taskId: string) => void;
}

export default function ProjectBoard({ projectId, onOpenTask }: ProjectBoardProps) {
  const { profile, allUsers } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [commentCounts, setCommentCounts] = useState<{ [taskId: string]: number }>({});
  
  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAssignee, setSelectedAssignee] = useState('all');
  const [selectedPriority, setSelectedPriority] = useState('all');

  // Inline forms state
  const [isAddingTask, setIsAddingTask] = useState<string | null>(null); // columnId
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [taskDueDate, setTaskDueDate] = useState('');

  // Invitation state
  const [isInviting, setIsInviting] = useState(false);
  const [searchEmail, setSearchEmail] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');

  // Drag-and-Drop & Analytics dynamic state settings
  const [draggingOverColumn, setDraggingOverColumn] = useState<string | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  
  // Custom Project editing preferences
  const [isEditingProjSettings, setIsEditingProjSettings] = useState(false);
  const [editedProjName, setEditedProjName] = useState('');
  const [editedProjDesc, setEditedProjDesc] = useState('');

  // 1. Listen to Project Metadata
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'projects', projectId), (snap) => {
      if (snap.exists()) {
        const pData = snap.data() as Project;
        setProject(pData);
        setEditedProjName(pData.name);
        setEditedProjDesc(pData.description || '');
      }
    });
    return () => unsub();
  }, [projectId]);

  // 2. Fetch/Listen Project Member public profiles
  useEffect(() => {
    const q = collection(db, 'projects', projectId, 'members');
    const unsub = onSnapshot(q, async (snap) => {
      const memberIds: string[] = [];
      snap.forEach((doc) => {
        memberIds.push(doc.id);
      });

      // Fetch user profile stats for active members
      if (memberIds.length > 0) {
        try {
          const fetchedProfiles: UserProfile[] = [];
          for (const uid of memberIds) {
            const userSnap = await getDocs(query(collection(db, 'users'), where('userId', '==', uid)));
            userSnap.forEach((d) => {
              fetchedProfiles.push(d.data() as UserProfile);
            });
          }
          setMembers(fetchedProfiles);
        } catch (err) {
          console.error("Could not fetch member profiles", err);
        }
      }
    });

    return () => unsub();
  }, [projectId]);

  // 3. Listen to Task Cards
  useEffect(() => {
    const q = collection(db, 'projects', projectId, 'tasks');
    const unsub = onSnapshot(q, (snap) => {
      const list: Task[] = [];
      snap.forEach((doc) => {
        list.push(doc.data() as Task);
      });
      // Sort tasks by updated/created Timestamp
      list.sort((a, b) => {
        const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return tB - tA;
      });
      setTasks(list);

      // Listen comment count of each task dynamically
      list.forEach((tk) => {
        const commRef = collection(db, 'projects', projectId, 'tasks', tk.taskId, 'comments');
        onSnapshot(commRef, (cSnap) => {
          setCommentCounts(prev => ({
            ...prev,
            [tk.taskId]: cSnap.size
          }));
        });
      });
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `projects/${projectId}/tasks`);
    });

    return () => unsub();
  }, [projectId]);

  // Handle Invitation
  const handleInviteMem = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError('');
    setInviteSuccess('');

    if (!project || !profile) return;
    if (project.ownerId !== profile.userId) {
      setInviteError('Only project owners can invite members.');
      return;
    }

    const emailToFind = searchEmail.trim().toLowerCase();
    if (!emailToFind) return;

    // Find user in general users registry
    // The email must match exactly
    try {
      const usersQuery = query(collection(db, 'users'), where('email', '==', emailToFind));
      const usersSnap = await getDocs(usersQuery);

      if (usersSnap.empty) {
        setInviteError('User with this email not found in directory. Advise them to sign in first!');
        return;
      }

      let targetUser: UserProfile | null = null;
      usersSnap.forEach((d) => {
        targetUser = d.data() as UserProfile;
      });

      if (!targetUser) return;
      const invitedUid = (targetUser as UserProfile).userId;

      if (project.memberUids.includes(invitedUid)) {
        setInviteError('User is already a project member.');
        return;
      }

      // Check member count boundary (fortress rules limits to size <= 20)
      if (project.memberUids.length >= 20) {
        setInviteError('This project has reached the maximum of 20 members.');
        return;
      }

      // 1. Create member doc
      await setDoc(doc(db, 'projects', projectId, 'members', invitedUid), {
        userId: invitedUid,
        role: 'member',
        addedAt: serverTimestamp()
      });

      // 2. Add to memberUids in project doc
      await updateDoc(doc(db, 'projects', projectId), {
        memberUids: arrayUnion(invitedUid),
        updatedAt: serverTimestamp()
      });

      // 3. Dispatch real-time in-app notification
      const notifId = 'notif-' + Math.random().toString(36).substring(2, 11);
      await setDoc(doc(db, 'users', invitedUid, 'notifications', notifId), {
        notificationId: notifId,
        userId: invitedUid,
        title: 'Project Invitation',
        message: `${profile.displayName} added you to project "${project.name}"`,
        type: 'project_invite',
        projectId: projectId,
        taskId: '',
        read: false,
        createdAt: serverTimestamp()
      });

      setInviteSuccess(`Successfully added ${targetUser.displayName}!`);
      setSearchEmail('');
      setTimeout(() => setIsInviting(false), 2000);
    } catch (err: any) {
      console.error(err);
      setInviteError('Failed to invite user due to authorization rules.');
    }
  };

  // Create Task Card
  const handleCreateTask = async (columnId: string) => {
    if (!taskTitle.trim() || !project || !profile) return;

    const newTaskId = 'task-' + Math.random().toString(36).substring(2, 11);
    
    try {
      const taskDocRef = doc(db, 'projects', projectId, 'tasks', newTaskId);
      const newTaskPayload: Task = {
        taskId: newTaskId,
        projectId: projectId,
        title: taskTitle.trim(),
        description: taskDesc.trim(),
        columnId: columnId,
        assigneeId: taskAssignee,
        priority: taskPriority,
        dueDate: taskDueDate || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      await setDoc(taskDocRef, newTaskPayload);

      // If assignee is specified, create notification for them!
      if (taskAssignee && taskAssignee !== profile.userId) {
        const notifId = 'notif-' + Math.random().toString(36).substring(2, 11);
        await setDoc(doc(db, 'users', taskAssignee, 'notifications', notifId), {
          notificationId: notifId,
          userId: taskAssignee,
          title: 'Task Assigned',
          message: `${profile.displayName} assigned task "${taskTitle.trim()}" to you.`,
          type: 'task_assigned',
          projectId: projectId,
          taskId: newTaskId,
          read: false,
          createdAt: serverTimestamp()
        });
      }

      // Reset inline forms
      setTaskTitle('');
      setTaskDesc('');
      setTaskAssignee('');
      setTaskPriority('medium');
      setTaskDueDate('');
      setIsAddingTask(null);
    } catch (err: any) {
      console.error('Task creation failed: ', err);
      handleFirestoreError(err, OperationType.CREATE, `projects/${projectId}/tasks/${newTaskId}`);
    }
  };

  // Move Column position
  const handleMoveTask = async (task: Task, toColumnId: string) => {
    try {
      const taskRef = doc(db, 'projects', projectId, 'tasks', task.taskId);
      await updateDoc(taskRef, {
        columnId: toColumnId,
        updatedAt: serverTimestamp()
      });
    } catch (err: any) {
      console.error('Failed to move task: ', err);
      handleFirestoreError(err, OperationType.UPDATE, `projects/${projectId}/tasks/${task.taskId}`);
    }
  };

  // Delete Task card
  const handleDeleteTask = async (taskId: string) => {
    if (!window.confirm("Delete this card permanently?")) return;
    try {
      await deleteDoc(doc(db, 'projects', projectId, 'tasks', taskId));
    } catch (err: any) {
      console.error('Failed to delete task', err);
      handleFirestoreError(err, OperationType.DELETE, `projects/${projectId}/tasks/${taskId}`);
    }
  };

  // Update Project Settings
  const handleUpdateProjectSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editedProjName.trim() || !project) return;
    try {
      await updateDoc(doc(db, 'projects', projectId), {
        name: editedProjName.trim(),
        description: editedProjDesc.trim(),
        updatedAt: serverTimestamp()
      });
      setIsEditingProjSettings(false);
    } catch (err: any) {
      console.error('Failed to update project details:', err);
      handleFirestoreError(err, OperationType.UPDATE, `projects/${projectId}`);
    }
  };

  // Cascade Delete Project
  const handleDeleteProject = async () => {
    if (!project) return;
    if (!window.confirm("ARE YOU SURE you want to delete this project? This will permanently delete the project, all of its members, task cards, and discussions! This action is irreversible.")) return;
    
    try {
      const { writeBatch } = await import('firebase/firestore');
      const batch = writeBatch(db);

      // Delete member registry docs
      const membersSnap = await getDocs(collection(db, 'projects', projectId, 'members'));
      membersSnap.forEach((mDoc) => {
        batch.delete(doc(db, 'projects', projectId, 'members', mDoc.id));
      });

      // Delete tasks docs
      const tasksSnap = await getDocs(collection(db, 'projects', projectId, 'tasks'));
      tasksSnap.forEach((tDoc) => {
        batch.delete(doc(db, 'projects', projectId, 'tasks', tDoc.id));
      });

      // Delete project root doc
      batch.delete(doc(db, 'projects', projectId));

      await batch.commit();
    } catch (err: any) {
      console.error('Failed to purge project:', err);
      handleFirestoreError(err, OperationType.DELETE, `projects/${projectId}`);
    }
  };

  // Filters logic
  const filteredTasks = tasks.filter(task => {
    const matchesSearch = task.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          task.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesAssignee = selectedAssignee === 'all' || task.assigneeId === selectedAssignee;
    const matchesPriority = selectedPriority === 'all' || task.priority === selectedPriority;
    return matchesSearch && matchesAssignee && matchesPriority;
  });

  const columns = [
    { id: 'todo', name: 'To Do', color: 'bg-slate-100 border-slate-200' },
    { id: 'in_progress', name: 'In Progress', color: 'bg-indigo-50/40 border-indigo-100' },
    { id: 'done', name: 'Completed', color: 'bg-emerald-50/40 border-emerald-100' }
  ];

  if (!project) {
    return (
      <div id="project_board_empty" className="flex-grow flex items-center justify-center p-8 bg-slate-50">
        <div className="text-center max-w-sm rounded-xl p-8 bg-white border border-slate-200 shadow-sm">
          <Grid className="mx-auto h-12 w-12 text-slate-300 animate-pulse" />
          <h3 className="mt-4 text-sm font-sans font-medium text-slate-900">Select or create a project</h3>
          <p className="mt-2 text-xs text-slate-500 font-sans">
            Choose a group workspace from the sidebar to view your real-time collaborative tasks board.
          </p>
        </div>
      </div>
    );
  }

  const isOwner = project.ownerId === profile?.userId;

  return (
    <div id="project_board_main" className="flex-1 flex flex-col h-full bg-[#f8fafc] overflow-hidden select-none">
      {/* Board Header */}
      <div id="project_header" className="bg-white border-b border-slate-200 p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0 shadow-sm shrink-0">
        <div>
          {isEditingProjSettings ? (
            <form onSubmit={handleUpdateProjectSettings} className="space-y-2 bg-slate-50 p-4 rounded-xl border border-slate-200 text-slate-800 max-w-lg">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-bold font-mono tracking-wider uppercase text-slate-400">Owner Access Controls</span>
                <button 
                  type="button" 
                  onClick={handleDeleteProject}
                  className="text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-100 text-[10px] font-mono font-bold px-2 py-0.5 rounded cursor-pointer transition-colors"
                >
                  DELETE PROJECT
                </button>
              </div>
              <div>
                <input
                  type="text"
                  value={editedProjName}
                  onChange={(e) => setEditedProjName(e.target.value)}
                  placeholder="Project Title"
                  required
                  className="w-full text-xs font-semibold px-2.5 py-1 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <textarea
                  value={editedProjDesc}
                  onChange={(e) => setEditedProjDesc(e.target.value)}
                  placeholder="Insert group goals, rules, or roadmap info..."
                  rows={2}
                  className="w-full text-xs text-slate-650 px-2.5 py-1 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 resize-none font-sans"
                />
              </div>
              <div className="flex space-x-1.5 justify-end">
                <button
                  type="button"
                  onClick={() => setIsEditingProjSettings(false)}
                  className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-600 rounded text-[11px] font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  Save Settings
                </button>
              </div>
            </form>
          ) : (
            <div>
              <div className="flex items-center space-x-2.5 mb-1 flex-wrap">
                <h2 className="text-xl font-sans font-semibold tracking-tight text-slate-900">{project.name}</h2>
                {isOwner && (
                  <button
                    id="btn_edit_project_settings"
                    onClick={() => setIsEditingProjSettings(true)}
                    className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-600 transition-colors cursor-pointer"
                    title="Change Project Guidelines"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                <span id="badge_project_mode" className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-mono border border-slate-200 uppercase">
                  Collab Shared
                </span>
              </div>
              <p className="text-xs text-slate-500 font-sans max-w-xl">{project.description || "No project guidelines specified."}</p>
            </div>
          )}
        </div>

        {/* Team Collaboration Panel */}
        <div id="project_collaboration" className="flex items-center space-x-4">
          <div className="flex items-center space-x-1">
            <div className="flex -space-x-1.5 overflow-hidden pr-2 border-r border-slate-200 mr-2">
              {members.slice(0, 5).map((member) => (
                <img
                  key={member.userId}
                  src={member.photoURL}
                  alt={member.displayName}
                  title={`${member.displayName} (${member.userId === project.ownerId ? 'Owner' : 'Member'})`}
                  className={`h-7 w-7 rounded-full object-cover ring-2 ring-white ${member.userId === project.ownerId ? 'border border-indigo-500' : ''}`}
                  referrerPolicy="no-referrer"
                />
              ))}
              {members.length > 5 && (
                <div className="h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center text-[10px] text-slate-500 font-semibold ring-2 ring-white border border-slate-200">
                  +{members.length - 5}
                </div>
              )}
            </div>

            <div className="text-[11px] text-slate-400 font-mono flex items-center space-x-1.5">
              <Users className="h-3.5 w-3.5 text-slate-400" />
              <span>{members.length} {members.length === 1 ? 'member' : 'members'}</span>
            </div>
          </div>

          {/* Invitation Trigger */}
          {isOwner && (
            <div className="relative">
              <button
                id="btn_invite_trigger"
                onClick={() => setIsInviting(!isInviting)}
                className="flex items-center space-x-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-xs font-semibold rounded-lg shadow-sm transition-all shadow-indigo-100"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Invite</span>
              </button>

              <AnimatePresence>
                {isInviting && (
                  <motion.form
                    id="form_invite_member"
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    onSubmit={handleInviteMem}
                    className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-lg p-4 shadow-xl z-30"
                  >
                    <span className="block text-xs font-semibold text-slate-700 mb-1">Add Team Member</span>
                    <span className="block text-[11px] text-slate-400 mb-3">Lookup registry user by email to extend board access.</span>
                    
                    <div className="flex space-x-2">
                      <input
                        id="input_invite_email"
                        type="email"
                        value={searchEmail}
                        onChange={(e) => setSearchEmail(e.target.value)}
                        placeholder="collaborator@domain.com"
                        required
                        className="flex-1 text-xs border border-slate-300 rounded px-2 py-1.5 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        id="btn_submit_invite"
                        type="submit"
                        className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1.5 font-medium rounded"
                      >
                        Add
                      </button>
                    </div>

                    {inviteError && <p id="err_invite" className="text-[10px] font-mono text-red-500 mt-2">{inviteError}</p>}
                    {inviteSuccess && <p id="success_invite" className="text-[10px] font-mono text-green-600 mt-2">{inviteSuccess}</p>}
                  </motion.form>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Filter and Control Bar */}
      <div id="board_filter_bar" className="bg-white border-b border-slate-200 px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center space-x-2.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 w-full sm:w-80">
          <Search className="h-4 w-4 text-slate-400 shrink-0" />
          <input
            id="input_board_search"
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search task cards..."
            className="w-full bg-transparent text-xs text-slate-700 focus:outline-none placeholder-slate-400"
          />
        </div>

        <div className="flex items-center space-x-3.5 flex-wrap">
          {/* Assignee filter dropdown */}
          <div className="flex items-center space-x-1.5">
            <span className="text-[10px] font-bold text-slate-400 font-mono uppercase">Assignee</span>
            <select
              id="select_filter_assignee"
              value={selectedAssignee}
              onChange={(e) => setSelectedAssignee(e.target.value)}
              className="text-xs bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-slate-600 focus:outline-none"
            >
              <option value="all">All Members</option>
              {members.map(m => (
                <option key={m.userId} value={m.userId}>{m.displayName}</option>
              ))}
            </select>
          </div>

          {/* Priority filter dropdown */}
          <div className="flex items-center space-x-1.5 font-sans">
            <span className="text-[10px] font-bold text-slate-400 font-mono uppercase">Priority</span>
            <select
              id="select_filter_priority"
              value={selectedPriority}
              onChange={(e) => setSelectedPriority(e.target.value)}
              className="text-xs bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-slate-600 focus:outline-none"
            >
              <option value="all">All Priorities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          {/* Metrics button */}
          <button
            id="btn_toggle_analytics"
            onClick={() => setShowAnalytics(!showAnalytics)}
            className={`flex items-center space-x-1.5 px-3 py-1.5 border rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              showAnalytics 
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-bold' 
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Activity className="h-3.5 w-3.5 text-indigo-500" />
            <span>Metrics Breakdown</span>
          </button>
        </div>
      </div>

      {/* Dynamic Analytics Bento Grid */}
      <AnimatePresence>
        {showAnalytics && (
          <motion.div
            id="board_analytics_pane"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-white border-b border-slate-200 px-6 py-5 overflow-hidden shrink-0 shadow-inner bg-[radial-gradient(#f1f5f9_1.2px,transparent_1.2px)] [background-size:16px_16px]"
          >
            <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Box 1: Overall Progress */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4.5 shadow-sm space-y-3">
                <span className="block text-[10px] font-bold font-mono tracking-wider text-slate-400 uppercase font-sans">Completion Rate</span>
                
                {(() => {
                  const doneCount = tasks.filter(t => t.columnId === 'done').length;
                  const totalCount = tasks.length;
                  const percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
                  
                  return (
                    <div className="flex items-center space-x-4">
                      {/* Radial Progress */}
                      <div className="relative h-14 w-14 flex items-center justify-center shrink-0">
                        <svg className="absolute inset-0 h-full w-full transform -rotate-90" viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="16" fill="transparent" stroke="#f1f5f9" strokeWidth="3" />
                          <circle cx="18" cy="18" r="16" fill="transparent" stroke="#10b981" strokeWidth="3" strokeDasharray="100" strokeDashoffset={100 - percent} strokeLinecap="round" className="transition-all duration-300" />
                        </svg>
                        <span className="text-xs font-bold text-slate-800 font-mono">{percent}%</span>
                      </div>
                      
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-slate-800 leading-tight">
                          {percent === 100 && totalCount > 0 
                            ? 'All tasks completed!' 
                            : `${doneCount} of ${totalCount} cards completed`}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-1 font-sans">
                          Track daily milestones using active task checklist items!
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Box 2: Priority Distro */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4.5 shadow-sm space-y-2">
                <span className="block text-[10px] font-bold font-mono tracking-wider text-slate-400 uppercase font-sans">Priority Distribution</span>
                
                {(() => {
                  const high = tasks.filter(t => t.priority === 'high').length;
                  const med = tasks.filter(t => t.priority === 'medium').length;
                  const low = tasks.filter(t => t.priority === 'low').length;

                  return (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center space-x-1.5 text-rose-650 font-medium font-sans">
                          <span className="h-2 w-2 rounded-full bg-red-500" />
                          <span>High Priority</span>
                        </span>
                        <span className="font-bold text-slate-700 font-mono">{high}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center space-x-1.5 text-amber-650 font-medium font-sans">
                          <span className="h-2 w-2 rounded-full bg-amber-500" />
                          <span>Medium Priority</span>
                        </span>
                        <span className="font-bold text-slate-700 font-mono">{med}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center space-x-1.5 text-emerald-650 font-medium font-sans">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                          <span>Low Priority</span>
                        </span>
                        <span className="font-bold text-slate-700 font-mono">{low}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Box 3: Workloads */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4.5 shadow-sm space-y-2 overflow-y-auto max-h-[115px]">
                <span className="block text-[10px] font-bold font-mono tracking-wider text-slate-400 uppercase font-sans font-sans">Team Workloads</span>
                
                <div className="space-y-2">
                  {members.map(mem => {
                    const assigned = tasks.filter(t => t.assigneeId === mem.userId).length;
                    const pct = tasks.length > 0 ? Math.round((assigned / tasks.length) * 100) : 0;
                    return (
                      <div key={mem.userId} className="flex items-center justify-between text-xs font-sans">
                        <div className="flex items-center space-x-1.5 truncate">
                          <img src={mem.photoURL} alt={mem.displayName} className="h-4.5 w-4.5 rounded-full object-cover" />
                          <span className="truncate text-slate-700 max-w-[80px]">{mem.displayName}</span>
                        </div>
                        <div className="flex items-center space-x-1.5 shrink-0">
                          <span className="h-1.5 w-12 bg-slate-100 rounded-full overflow-hidden inline-block relative">
                            <span className="absolute left-0 top-0 h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                          </span>
                          <span className="font-bold text-slate-700 font-mono text-[9px]">{assigned} cards</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Board Columns Stage */}
      <div id="board_columns_stage" className="flex-1 p-6 overflow-x-auto overflow-y-hidden flex space-x-4 items-start">
        {columns.map((col) => {
          const colTasks = filteredTasks.filter(t => t.columnId === col.id);
          return (
            <div
              id={`col_container_${col.id}`}
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault();
                if (draggingOverColumn !== col.id) {
                  setDraggingOverColumn(col.id);
                }
              }}
              onDragLeave={() => {
                setDraggingOverColumn(null);
              }}
              onDrop={async (e) => {
                e.preventDefault();
                setDraggingOverColumn(null);
                const idOfCard = e.dataTransfer.getData('text/plain');
                if (idOfCard) {
                  const matchedTask = tasks.find(t => t.taskId === idOfCard);
                  if (matchedTask && matchedTask.columnId !== col.id) {
                    await handleMoveTask(matchedTask, col.id);
                  }
                }
              }}
              className={`w-96 flex flex-col max-h-full rounded-xl border ${col.color} p-4 shrink-0 bg-slate-50 transition-all ${
                draggingOverColumn === col.id ? 'ring-2 ring-indigo-500 ring-offset-2 scale-[1.01]' : ''
              }`}
            >
              {/* Column Title */}
              <div id={`col_header_${col.id}`} className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <h3 className="font-sans font-semibold text-sm text-slate-800">{col.name}</h3>
                  <span id={`col_count_${col.id}`} className="px-1.5 py-0.5 bg-white text-slate-500 rounded-full text-[10px] font-bold font-mono border border-slate-200/80">
                    {colTasks.length}
                  </span>
                </div>

                <button
                  id={`btn_new_task_${col.id}`}
                  onClick={() => setIsAddingTask(isAddingTask === col.id ? null : col.id)}
                  className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-slate-700 transition-all"
                  title="Insert task card"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              {/* Add Task Quick Form */}
              <AnimatePresence>
                {isAddingTask === col.id && (
                  <motion.div
                    id={`form_new_task_${col.id}`}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="bg-white p-4 rounded-lg border border-slate-200 mb-3 space-y-3 shadow-md border-t-2 border-t-indigo-500"
                  >
                    <div>
                      <input
                        id={`input_title_${col.id}`}
                        type="text"
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                        placeholder="Task Title *"
                        required
                        className="w-full text-xs font-semibold border-b border-slate-100 pb-1 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <textarea
                        id={`textarea_desc_${col.id}`}
                        value={taskDesc}
                        onChange={(e) => setTaskDesc(e.target.value)}
                        placeholder="Enter brief guidelines..."
                        rows={2}
                        className="w-full text-xs text-slate-500 focus:outline-none resize-none"
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[9px] font-bold font-mono uppercase text-slate-400 mb-1">Assignee</label>
                        <select
                          id={`select_assignee_${col.id}`}
                          value={taskAssignee}
                          onChange={(e) => setTaskAssignee(e.target.value)}
                          className="w-full text-[11px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-slate-600 focus:outline-none"
                        >
                          <option value="">Unassigned</option>
                          {members.map(m => (
                            <option key={m.userId} value={m.userId}>{m.displayName}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[9px] font-bold font-mono uppercase text-slate-400 mb-1">Priority</label>
                        <select
                          id={`select_priority_${col.id}`}
                          value={taskPriority}
                          onChange={(e) => setTaskPriority(e.target.value as any)}
                          className="w-full text-[11px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-slate-600 focus:outline-none"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[9px] font-bold font-mono uppercase text-slate-400 mb-1">Due Date</label>
                      <input
                        id={`input_duedate_${col.id}`}
                        type="date"
                        value={taskDueDate}
                        onChange={(e) => setTaskDueDate(e.target.value)}
                        className="w-full text-[11px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-slate-600 focus:outline-none"
                      />
                    </div>

                    <div className="flex space-x-2 pt-1">
                      <button
                        id={`btn_create_submit_${col.id}`}
                        onClick={() => handleCreateTask(col.id)}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-505 text-white text-xs font-semibold py-1.5 rounded"
                      >
                        Add Card
                      </button>
                      <button
                        id={`btn_create_cancel_${col.id}`}
                        onClick={() => setIsAddingTask(null)}
                        className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-500 text-xs py-1.5 rounded"
                      >
                        Cancel
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Tasks List */}
              <div id={`task_list_${col.id}`} className="flex-1 space-y-3 overflow-y-auto pr-1">
                {colTasks.length === 0 ? (
                  <div className="h-32 flex items-center justify-center border border-dashed border-slate-200/80 rounded-lg text-slate-400 text-xs font-sans">
                    Drop items here
                  </div>
                ) : (
                  colTasks.map((task) => {
                    const assigneeProfile = members.find(m => m.userId === task.assigneeId);
                    const priColors = {
                      low: 'bg-[#f0fdf4] text-emerald-700 border-emerald-100',
                      medium: 'bg-[#fffbeb] text-amber-700 border-amber-100',
                      high: 'bg-[#fef2f2] text-red-700 border-red-100'
                    }[task.priority || 'medium'];

                    return (
                      <motion.div
                        id={`task_card_${task.taskId}`}
                        key={task.taskId}
                        layoutId={task.taskId}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', task.taskId);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all cursor-grab active:cursor-grabbing relative group flex flex-col justify-between"
                        onClick={() => onOpenTask(task.taskId)}
                      >
                        <div>
                          {/* Priority Badge */}
                          <div className="flex items-center justify-between mb-2">
                            <span className={`text-[9px] font-bold font-mono tracking-wider uppercase px-2 py-0.5 rounded border ${priColors}`}>
                              {task.priority || 'medium'}
                            </span>

                            <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {/* Move Controls: Trello move buttons */}
                              {col.id !== 'todo' && (
                                <button
                                  id={`btn_move_left_${task.taskId}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const prevCol = col.id === 'done' ? 'in_progress' : 'todo';
                                    handleMoveTask(task, prevCol);
                                  }}
                                  className="p-1 hover:bg-slate-100 rounded text-slate-500 hover:text-indigo-600 transition-all"
                                  title="Move Left"
                                >
                                  <ArrowLeft className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {col.id !== 'done' && (
                                <button
                                  id={`btn_move_right_${task.taskId}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const nextCol = col.id === 'todo' ? 'in_progress' : 'done';
                                    handleMoveTask(task, nextCol);
                                  }}
                                  className="p-1 hover:bg-slate-100 rounded text-slate-500 hover:text-indigo-600 transition-all"
                                  title="Move Right"
                                >
                                  <ArrowRight className="h-3.5 w-3.5" />
                                </button>
                              )}
                              <button
                                id={`btn_delete_task_${task.taskId}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteTask(task.taskId);
                                }}
                                className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-600 transition-all ml-1"
                                title="Delete permanently"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          <h4 className="font-sans font-medium text-sm text-slate-800 line-clamp-2 pr-2 mb-1">
                            {task.title}
                          </h4>
                          
                          {task.description && (
                            <p className="text-slate-500 text-xs font-sans line-clamp-2 mb-3">
                              {task.description}
                            </p>
                          )}

                          {task.subtasks && task.subtasks.length > 0 && (
                            <div className="flex items-center space-x-2 mt-2 mb-1" title="Milestones progress">
                              <div className="h-1 w-12 bg-slate-100 rounded-full overflow-hidden shrink-0 relative">
                                <span 
                                  className="absolute left-0 top-0 h-full bg-emerald-500 rounded-full transition-all duration-300"
                                  style={{ width: `${(task.subtasks.filter(s => s.completed).length / task.subtasks.length) * 100}%` }}
                                />
                              </div>
                              <span className="text-[9px] font-bold text-slate-400 font-mono">
                                {task.subtasks.filter(s => s.completed).length}/{task.subtasks.length} steps
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Card Footer: Comments bubble, Due Date, Assignee */}
                        <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 mt-2 text-[10px] text-slate-400 font-mono">
                          <div className="flex items-center space-x-2">
                            {task.dueDate && (
                              <div className="flex items-center space-x-1" title="Due Date">
                                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                                <span className="font-sans text-[11px]">{task.dueDate}</span>
                              </div>
                            )}

                            <div className="flex items-center space-x-1" title="Active comments log">
                              <MessageSquare className="h-3.5 w-3.5 text-slate-400" />
                              <span>{commentCounts[task.taskId] || 0}</span>
                            </div>
                          </div>

                          {/* Assignee Avatar */}
                          {assigneeProfile ? (
                            <img
                              src={assigneeProfile.photoURL}
                              alt={assigneeProfile.displayName}
                              title={`Assigned to ${assigneeProfile.displayName}`}
                              className="h-5.5 w-5.5 rounded-full object-cover border border-slate-200"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="h-5.5 w-5.5 rounded-full border border-dashed border-slate-300 flex items-center justify-center bg-slate-50" title="Unassigned">
                              <span className="text-[9px] text-slate-400 font-bold">+</span>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
