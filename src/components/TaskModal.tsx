import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  User, 
  Calendar, 
  MessageSquare, 
  Trash, 
  AlertTriangle, 
  Check, 
  Clock, 
  UserCheck, 
  CornerDownRight,
  Send,
  Trash2
} from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { Task, Comment, UserProfile } from '../types';
import { 
  doc, 
  onSnapshot, 
  updateDoc, 
  collection, 
  setDoc, 
  deleteDoc, 
  serverTimestamp, 
  query, 
  where,
  getDocs
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

interface TaskModalProps {
  projectId: string;
  taskId: string;
  onClose: () => void;
}

export default function TaskModal({ projectId, taskId, onClose }: TaskModalProps) {
  const { profile } = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [members, setMembers] = useState<UserProfile[]>([]);
  
  // Edit states
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedDesc, setEditedDesc] = useState('');
  const [editedPriority, setEditedPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [editedAssignee, setEditedAssignee] = useState('');
  const [editedDueDate, setEditedDueDate] = useState('');

  // Comment state
  const [newComment, setNewComment] = useState('');
  const [commentError, setCommentError] = useState('');
  
  // Subtasks state
  const [newSubtaskText, setNewSubtaskText] = useState('');
  
  const commentsEndRef = useRef<HTMLDivElement>(null);

  // 1. Listen to Task details in real-time
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'projects', projectId, 'tasks', taskId),
      (snap) => {
        if (snap.exists()) {
          const tData = snap.data() as Task;
          setTask(tData);
          setEditedTitle(tData.title);
          setEditedDesc(tData.description || '');
          setEditedPriority(tData.priority || 'medium');
          setEditedAssignee(tData.assigneeId || '');
          setEditedDueDate(tData.dueDate || '');
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, `projects/${projectId}/tasks/${taskId}`);
      }
    );
    return () => unsub();
  }, [projectId, taskId]);

  // 2. Fetch Project Members
  useEffect(() => {
    const fetchProjMembers = async () => {
      try {
        const memSnap = await getDocs(collection(db, 'projects', projectId, 'members'));
        const ids: string[] = [];
        memSnap.forEach(d => ids.push(d.id));

        if (ids.length > 0) {
          const profiles: UserProfile[] = [];
          for (const uid of ids) {
            const userSnap = await getDocs(query(collection(db, 'users'), where('userId', '==', uid)));
            userSnap.forEach(d => profiles.push(d.data() as UserProfile));
          }
          setMembers(profiles);
        }
      } catch (err) {
        console.warn("Couldn't retrieve project members list.", err);
      }
    };
    fetchProjMembers();
  }, [projectId]);

  // 3. Listen to task comments in real-time
  useEffect(() => {
    const q = collection(db, 'projects', projectId, 'tasks', taskId, 'comments');
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Comment[] = [];
        snap.forEach((doc) => {
          list.push(doc.data() as Comment);
        });
        
        // Sort comments chronologically
        list.sort((a, b) => {
          const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
          const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
          return tA - tB;
        });
        setComments(list);
        
        // Auto scroll to bottom of chat
        setTimeout(() => {
          commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 80);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `projects/${projectId}/tasks/${taskId}/comments`);
      }
    );
    return () => unsub();
  }, [projectId, taskId]);

  // Save changes helper
  const handleUpdateTaskField = async (fields: Partial<Task>) => {
    try {
      const taskRef = doc(db, 'projects', projectId, 'tasks', taskId);
      await updateDoc(taskRef, {
        ...fields,
        updatedAt: serverTimestamp()
      });
    } catch (err: any) {
      console.error('Failed to update task detail:', err);
      handleFirestoreError(err, OperationType.UPDATE, `projects/${projectId}/tasks/${taskId}`);
    }
  };

  // Add Comment
  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    setCommentError('');
    if (!newComment.trim() || !profile) return;

    const newCommentId = 'com-' + Math.random().toString(36).substring(2, 11);

    try {
      const commentRef = doc(db, 'projects', projectId, 'tasks', taskId, 'comments', newCommentId);
      const commentPayload: Comment = {
        commentId: newCommentId,
        taskId: taskId,
        authorId: profile.userId,
        authorName: profile.displayName,
        authorPhoto: profile.photoURL,
        text: newComment.trim(),
        createdAt: serverTimestamp()
      };

      await setDoc(commentRef, commentPayload);
      setNewComment('');
      
      // Send dynamic notifications to assignee (if assignee isn't user doing comment)
      if (task?.assigneeId && task.assigneeId !== profile.userId) {
        const notifId = 'notif-' + Math.random().toString(36).substring(2, 11);
        await setDoc(doc(db, 'users', task.assigneeId, 'notifications', notifId), {
          notificationId: notifId,
          userId: task.assigneeId,
          title: 'New Task Comment',
          message: `${profile.displayName} commented on task "${task.title}": "${newComment.substring(0, 40)}..."`,
          type: 'new_comment',
          projectId: projectId,
          taskId: taskId,
          read: false,
          createdAt: serverTimestamp()
        });
      }
    } catch (err: any) {
      console.error('Post comment failed: ', err);
      setCommentError('Failed to post comment. Verify access.');
      handleFirestoreError(err, OperationType.CREATE, `projects/${projectId}/tasks/${taskId}/comments/${newCommentId}`);
    }
  };

  // Delete Comment (only owned comments)
  const handleDeleteComment = async (commentId: string) => {
    if (!window.confirm("Remove comment permanently?")) return;
    try {
      await deleteDoc(doc(db, 'projects', projectId, 'tasks', taskId, 'comments', commentId));
    } catch (err: any) {
      console.error('Failed to remove comment: ', err);
      handleFirestoreError(err, OperationType.DELETE, `projects/${projectId}/tasks/${taskId}/comments/${commentId}`);
    }
  };

  // Add Subtask
  const handleAddSubTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtaskText.trim() || !task) return;
    
    const newSub = {
      subTaskId: 'sub-' + Math.random().toString(36).substring(2, 11),
      text: newSubtaskText.trim(),
      completed: false
    };

    const updatedSubtasks = [...(task.subtasks || []), newSub];
    await handleUpdateTaskField({ subtasks: updatedSubtasks });
    setNewSubtaskText('');
  };

  // Toggle Subtask
  const handleToggleSubTask = async (subTaskId: string) => {
    if (!task) return;
    const updatedSubtasks = (task.subtasks || []).map(sub => {
      if (sub.subTaskId === subTaskId) {
        return { ...sub, completed: !sub.completed };
      }
      return sub;
    });
    await handleUpdateTaskField({ subtasks: updatedSubtasks });
  };

  // Delete Subtask
  const handleRemoveSubTask = async (subTaskId: string) => {
    if (!task) return;
    const updatedSubtasks = (task.subtasks || []).filter(sub => sub.subTaskId !== subTaskId);
    await handleUpdateTaskField({ subtasks: updatedSubtasks });
  };

  if (!task) return null;

  return (
    <div id="modal_overlay_task" className="fixed inset-0 bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center p-4 z-40">
      <motion.div
        id="modal_container_task"
        initial={{ opacity: 0, scale: 0.98, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-2xl w-full max-w-4xl h-[90vh] flex flex-col md:flex-row overflow-hidden shadow-2xl relative"
      >
        {/* Main Details Panel (Left Column) */}
        <div id="modal_details_panel" className="flex-1 p-6 md:p-8 flex flex-col justify-between overflow-y-auto border-r border-slate-100">
          <div>
            {/* Header / Dismiss */}
            <div className="flex items-center justify-between mb-6">
              <span className="text-[10px] font-bold font-mono text-indigo-500 uppercase tracking-wider">
                CARD ID: {task.taskId}
              </span>
              <button
                id="btn_close_task_modal"
                onClick={onClose}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-all"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Task Title */}
            <div className="mb-6">
              <input
                id="input_edit_task_title"
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onBlur={() => {
                  if (editedTitle.trim() && editedTitle !== task.title) {
                    handleUpdateTaskField({ title: editedTitle.trim() });
                  }
                }}
                className="w-full text-xl font-sans font-semibold tracking-tight text-slate-900 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-indigo-500 focus:outline-none pb-1"
              />
            </div>

            {/* Grid Options for Assignment & Priority */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-8">
              {/* Assignee selection */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 flex items-center space-x-3.5">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                  <User className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <span className="block text-[9px] font-bold font-mono uppercase text-slate-400">ASSIGNED TO</span>
                  <select
                    id="select_edit_assignee"
                    value={editedAssignee}
                    onChange={(e) => {
                      setEditedAssignee(e.target.value);
                      handleUpdateTaskField({ assigneeId: e.target.value });
                    }}
                    className="w-full bg-transparent text-xs font-medium text-slate-700 pl-0 border-0 focus:ring-0 focus:outline-none pt-0.5"
                  >
                    <option value="">Unassigned</option>
                    {members.map(m => (
                      <option key={m.userId} value={m.userId}>{m.displayName}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Priority level */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 flex items-center space-x-3.5">
                <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <span className="block text-[9px] font-bold font-mono uppercase text-slate-400">PRIORITY</span>
                  <select
                    id="select_edit_priority"
                    value={editedPriority}
                    onChange={(e) => {
                      const newPri = e.target.value as 'low' | 'medium' | 'high';
                      setEditedPriority(newPri);
                      handleUpdateTaskField({ priority: newPri });
                    }}
                    className="w-full bg-transparent text-xs font-medium text-slate-700 pl-0 border-0 focus:ring-0 focus:outline-none pt-0.5"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>

              {/* Due date selection */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 flex items-center space-x-3.5">
                <div className="p-2 bg-rose-50 text-rose-600 rounded-lg">
                  <Calendar className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <span className="block text-[9px] font-bold font-mono uppercase text-slate-400">DUE DATE</span>
                  <input
                    id="input_edit_duedate"
                    type="date"
                    value={editedDueDate}
                    onChange={(e) => {
                      setEditedDueDate(e.target.value);
                      handleUpdateTaskField({ dueDate: e.target.value || null });
                    }}
                    className="w-full bg-transparent text-xs font-medium text-slate-700 border-0 p-0 focus:ring-0 focus:outline-none pt-0.5"
                  />
                </div>
              </div>

              {/* Column status */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 flex items-center space-x-3.5">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                  <Clock className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <span className="block text-[9px] font-bold font-mono uppercase text-slate-400">BOARD COLUMN</span>
                  <select
                    id="select_edit_status"
                    value={task.columnId}
                    onChange={(e) => handleUpdateTaskField({ columnId: e.target.value })}
                    className="w-full bg-transparent text-xs font-medium text-slate-700 pl-0 border-0 focus:ring-0 focus:outline-none pt-0.5"
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Completed</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Task Description / Action Guidelines */}
            <div className="mb-6">
              <span className="block text-[11px] font-bold font-mono uppercase text-slate-400 mb-2">Description</span>
              {isEditingDesc ? (
                <div className="space-y-3">
                  <textarea
                    id="textarea_edit_desc"
                    value={editedDesc}
                    onChange={(e) => setEditedDesc(e.target.value)}
                    placeholder="Provide guidelines for the assignee..."
                    className="w-full text-xs text-slate-700 p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 resize-none"
                    rows={4}
                  />
                  <div className="flex space-x-2">
                    <button
                      id="btn_save_desc"
                      onClick={() => {
                        handleUpdateTaskField({ description: editedDesc.trim() });
                        setIsEditingDesc(false);
                      }}
                      className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg"
                    >
                      Save
                    </button>
                    <button
                      id="btn_cancel_desc"
                      onClick={() => {
                        setEditedDesc(task.description || '');
                        setIsEditingDesc(false);
                      }}
                      className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-500 text-xs font-medium rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  id="desc_preview_click"
                  onClick={() => setIsEditingDesc(true)}
                  className="p-4 bg-slate-50 border border-slate-100 rounded-xl cursor-text text-xs text-slate-600 font-sans hover:bg-slate-100/50 min-h-[5rem] transition-colors"
                >
                  {task.description ? (
                    <p className="whitespace-pre-wrap">{task.description}</p>
                  ) : (
                    <span className="text-slate-400 italic">No description provided. Click to add details...</span>
                  )}
                </div>
              )}
            </div>

            {/* Subtasks Checklist */}
            <div className="mb-6 mt-8 p-4 bg-slate-50 border border-slate-100/80 rounded-2xl">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <Check className="h-4 w-4 text-emerald-500 stroke-[3]" />
                  <span className="text-[11px] font-bold font-mono uppercase text-slate-600">Subtask Steps</span>
                </div>
                {task.subtasks && task.subtasks.length > 0 && (
                  <span className="text-[10px] font-bold font-mono text-slate-400">
                    {task.subtasks.filter(s => s.completed).length} of {task.subtasks.length} ({Math.round((task.subtasks.filter(s => s.completed).length / task.subtasks.length) * 100)}%)
                  </span>
                )}
              </div>

              {/* Progress bar gauge */}
              {task.subtasks && task.subtasks.length > 0 && (
                <div className="h-1.5 w-full bg-slate-200/50 rounded-full overflow-hidden mb-4">
                  <motion.div
                    className="h-full bg-emerald-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${(task.subtasks.filter(s => s.completed).length / task.subtasks.length) * 100}%` }}
                    transition={{ duration: 0.2 }}
                  />
                </div>
              )}

              {/* Subtasks List */}
              <div className="space-y-2 max-h-48 overflow-y-auto mb-4 pr-1">
                {!task.subtasks || task.subtasks.length === 0 ? (
                  <p className="text-[11px] text-slate-400 italic py-2">No checklist items yet. Break this card down into manageable daily goals below!</p>
                ) : (
                  task.subtasks.map((sub) => (
                    <div 
                      key={sub.subTaskId}
                      className="flex items-center justify-between p-2.5 bg-white rounded-xl border border-slate-100 group shadow-sm transition-all hover:border-slate-200"
                    >
                      <button
                        type="button"
                        onClick={() => handleToggleSubTask(sub.subTaskId)}
                        className="flex items-center space-x-2.5 text-left flex-1"
                      >
                        {/* Checkbox circle indicator */}
                        <div className={`h-4.5 w-4.5 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                          sub.completed 
                            ? 'bg-emerald-500 border-emerald-500 text-white' 
                            : 'border-slate-300 bg-white hover:border-indigo-400'
                        }`}>
                          {sub.completed && <Check className="h-3 w-3 stroke-[3]" />}
                        </div>
                        <span className={`text-xs font-sans ${sub.completed ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                          {sub.text}
                        </span>
                      </button>

                      {/* Trash tool */}
                      <button
                        type="button"
                        onClick={() => handleRemoveSubTask(sub.subTaskId)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 rounded transition-opacity"
                        title="Delete subtask"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Add Subtask Input Form */}
              <form onSubmit={handleAddSubTask} className="flex items-center space-x-2">
                <input
                  type="text"
                  value={newSubtaskText}
                  onChange={(e) => setNewSubtaskText(e.target.value)}
                  placeholder="Assign minor milestones..."
                  className="w-full text-xs text-slate-700 px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 shadow-sm"
                />
                <button
                  type="submit"
                  disabled={!newSubtaskText.trim()}
                  className={`px-3 py-2 rounded-xl text-white font-medium text-xs transition-all shrink-0 ${
                    newSubtaskText.trim() ? 'bg-indigo-600 hover:bg-indigo-700 cursor-pointer' : 'bg-slate-100 text-slate-300'
                  }`}
                  title="Add checklist item"
                >
                  Add Milestone
                </button>
              </form>
            </div>
          </div>

          {/* Creation Audit */}
          <div className="border-t border-slate-100 pt-4 text-[10px] font-mono text-slate-400 flex items-center justify-between">
            <span>CREATED AT: {task.createdAt?.toDate ? task.createdAt?.toDate().toLocaleString() : 'N/A'}</span>
            <span>UPDATED AT: {task.updatedAt?.toDate ? task.updatedAt?.toDate().toLocaleString() : 'N/A'}</span>
          </div>
        </div>

        {/* Live Comments Chat Stream (Right Column) */}
        <div id="modal_comment_center" className="w-full md:w-96 bg-slate-50 flex flex-col h-full overflow-hidden">
          {/* Section Header */}
          <div className="p-5 border-b border-slate-200 bg-white flex items-center space-x-2">
            <MessageSquare className="h-4.5 w-4.5 text-indigo-500" />
            <h3 className="font-sans font-semibold text-sm text-slate-800">Task Discussions</h3>
            <span id="comment_total_indicator" className="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-bold">
              {comments.length}
            </span>
          </div>

          {/* Comments list stream */}
          <div id="comment_messages_stream" className="flex-1 p-5 overflow-y-auto space-y-4">
            {comments.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 bg-slate-50/50">
                <MessageSquare className="h-8 w-8 text-slate-300 mb-2" />
                <p className="text-[11px] font-sans text-slate-400">Comments synchronize instantly. Start chatting!</p>
              </div>
            ) : (
              comments.map((comm) => {
                const isMe = comm.authorId === profile?.userId;
                return (
                  <div
                    id={`message_bubble_${comm.commentId}`}
                    key={comm.commentId}
                    className={`flex items-start space-x-2.5 ${isMe ? 'flex-row-reverse space-x-reverse' : ''}`}
                  >
                    <img
                      src={comm.authorPhoto}
                      alt={comm.authorName}
                      className="h-7 w-7 rounded-full object-cover shrink-0"
                      referrerPolicy="no-referrer"
                    />
                    <div className="max-w-[80%]">
                      {/* Name & Time */}
                      <div className={`flex items-center space-x-1 px-1 mb-0.5 text-[10px] text-slate-400 font-mono ${isMe ? 'justify-end' : ''}`}>
                        <span className="font-sans font-semibold text-slate-700">{comm.authorName}</span>
                        <span>•</span>
                        <span>{comm.createdAt?.toDate ? comm.createdAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Syncing'}</span>
                      </div>
                      
                      {/* Message Bubble */}
                      <div className={`p-3 rounded-2xl text-xs font-sans relative group border border-slate-200/80 ${
                        isMe ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white text-slate-700 rounded-tl-none'
                      }`}>
                        <p className="whitespace-pre-wrap breakdown-words">{comm.text}</p>
                        
                        {/* Self Delete comment tool */}
                        {isMe && (
                          <button
                            id={`btn_delete_comment_${comm.commentId}`}
                            onClick={() => handleDeleteComment(comm.commentId)}
                            className="absolute -top-1 -right-1 p-1 bg-red-500 hover:bg-red-600 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity z-10"
                            title="Delete message"
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={commentsEndRef} />
          </div>

          {/* Comment send compose field */}
          <form 
            id="form_comment_composer"
            onSubmit={handlePostComment}
            className="p-4 border-t border-slate-200 bg-white"
          >
            <div className="flex items-center space-x-2 border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus-within:bg-white focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 shadow-sm">
              <input
                id="input_comment_text"
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Write a reply..."
                className="w-full bg-transparent text-xs text-slate-700 focus:outline-none placeholder-slate-400 pr-1.5 font-sans"
              />
              <button
                id="btn_submit_comment"
                type="submit"
                disabled={!newComment.trim()}
                className={`p-1.5 rounded-lg shrink-0 transition-all ${
                  newComment.trim() ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'text-slate-300'
                }`}
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
            {commentError && <p id="err_comment_field" className="text-[10px] font-mono text-red-500 mt-1">{commentError}</p>}
          </form>
        </div>
      </motion.div>
    </div>
  );
}
