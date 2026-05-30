import { useEffect, useState } from 'react';
import { 
  X, 
  Bell, 
  Check, 
  MessageSquare, 
  FolderCheck, 
  UserPlus2, 
  Trash2, 
  Clock 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { Notification } from '../types';
import { 
  collection, 
  onSnapshot, 
  query, 
  doc, 
  updateDoc, 
  deleteDoc, 
  serverTimestamp,
  orderBy
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

interface NotificationsPanelProps {
  onClose: () => void;
  onNavigateToProject: (projectId: string) => void;
}

export default function NotificationsPanel({ onClose, onNavigateToProject }: NotificationsPanelProps) {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  // Monitor notifications in real-time
  useEffect(() => {
    if (!profile) return;

    const q = query(
      collection(db, 'users', profile.userId, 'notifications')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Notification[] = [];
        snapshot.forEach((doc) => {
          list.push(doc.data() as Notification);
        });
        
        // Sort notifications chronologically (newest first)
        list.sort((a, b) => {
          const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
          const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
          return tB - tA;
        });

        setNotifications(list);
        setLoading(false);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `users/${profile.userId}/notifications`);
      }
    );

    return () => unsubscribe();
  }, [profile]);

  // Mark single as read
  const handleMarkAsRead = async (notificationId: string) => {
    if (!profile) return;
    try {
      const notifRef = doc(db, 'users', profile.userId, 'notifications', notificationId);
      await updateDoc(notifRef, {
        read: true
      });
    } catch (err: any) {
      console.error('Failed to mark notification read:', err);
      handleFirestoreError(err, OperationType.UPDATE, `users/${profile.userId}/notifications/${notificationId}`);
    }
  };

  // Delete notification
  const handleDeleteNotification = async (notificationId: string) => {
    if (!profile) return;
    try {
      await deleteDoc(doc(db, 'users', profile.userId, 'notifications', notificationId));
    } catch (err: any) {
      console.error('Failed to delete notification:', err);
      handleFirestoreError(err, OperationType.DELETE, `users/${profile.userId}/notifications/${notificationId}`);
    }
  };

  // Mark all as read
  const handleMarkAllRead = async () => {
    if (!profile) return;
    try {
      const { writeBatch } = await import('firebase/firestore');
      const batch = writeBatch(db);
      const unreadList = notifications.filter(n => !n.read);

      unreadList.forEach((notif) => {
        const ref = doc(db, 'users', profile.userId, 'notifications', notif.notificationId);
        batch.update(ref, { read: true });
      });

      await batch.commit();
    } catch (e) {
      console.error('Failed to mark all notifications read', e);
    }
  };

  return (
    <div id="modal_overlay_notifications" className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px] flex justify-end z-50">
      <motion.div
        id="panel_container_notifications"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        className="bg-white w-full max-w-md h-full flex flex-col shadow-2xl relative border-l border-slate-100"
      >
        {/* Panel Header */}
        <div id="notifications_header" className="p-6 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center space-x-2.5">
            <Bell className="h-4.5 w-4.5 text-indigo-600" />
            <h2 className="font-sans font-semibold tracking-tight text-slate-900 text-lg">Inbox Alerts</h2>
          </div>
          
          <div className="flex items-center space-x-2">
            {notifications.some(n => !n.read) && (
              <button
                id="btn_mark_all_read"
                onClick={handleMarkAllRead}
                className="text-[11px] font-mono hover:text-indigo-600 border border-slate-200 px-2.5 py-1 rounded hover:bg-slate-50 transition-all text-slate-500"
              >
                Mark all read
              </button>
            )}
            <button
              id="btn_close_notifications"
              onClick={onClose}
              className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-all font-sans"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Notifications list */}
        <div id="notifications_list_container" className="flex-1 p-5 overflow-y-auto space-y-4 bg-[#fcfdfe]">
          {loading ? (
            <div className="py-20 flex justify-center items-center">
              <span className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></span>
            </div>
          ) : notifications.length === 0 ? (
            <div className="text-center py-24 px-6 text-slate-400">
              <Bell className="mx-auto h-10 w-10 text-slate-200 mb-2.5" />
              <p className="text-xs font-sans">Your alerts inbox is currently empty.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {notifications.map((notif) => {
                const iconMap = {
                  task_assigned: <FolderCheck className="h-4 w-4 text-emerald-600" />,
                  new_comment: <MessageSquare className="h-4 w-4 text-indigo-600" />,
                  project_invite: <UserPlus2 className="h-4 w-4 text-amber-600" />
                }[notif.type || 'task_assigned'];

                const bgTone = {
                  task_assigned: 'bg-emerald-50/50 hover:bg-emerald-50',
                  new_comment: 'bg-indigo-50/50 hover:bg-indigo-50',
                  project_invite: 'bg-amber-50/50 hover:bg-amber-50'
                }[notif.type || 'task_assigned'];

                return (
                  <div
                    id={`notification_item_${notif.notificationId}`}
                    key={notif.notificationId}
                    className={`p-4 rounded-xl border border-slate-150 transition-all flex items-start space-x-3.5 relative group cursor-pointer ${
                      notif.read ? 'bg-white hover:bg-slate-50/80 border-slate-100' : `${bgTone} border-indigo-150 shadow-sm shadow-indigo-50/50`
                    }`}
                    onClick={() => {
                      if (!notif.read) {
                        handleMarkAsRead(notif.notificationId);
                      }
                      if (notif.projectId) {
                        onNavigateToProject(notif.projectId);
                        onClose();
                      }
                    }}
                  >
                    {/* Status Dot */}
                    {!notif.read && (
                      <span className="absolute left-2 top-2 h-2 w-2 bg-indigo-505 rounded-full bg-indigo-500" />
                    )}

                    {/* Icon Container */}
                    <div className="p-2 bg-white border border-slate-100 rounded-lg shrink-0">
                      {iconMap}
                    </div>

                    {/* Notification Alert Message */}
                    <div className="flex-1 min-w-0 pr-4">
                      <h4 className="font-sans font-medium text-xs text-slate-800 leading-tight mb-1 truncate">
                        {notif.title}
                      </h4>
                      <p className="text-[11px] font-sans text-slate-500 mb-2 leading-relaxed">
                        {notif.message}
                      </p>
                      
                      <div className="flex items-center space-x-1.5 text-[10px] font-mono text-slate-400">
                        <Clock className="h-3 w-3" />
                        <span>{notif.createdAt?.toDate ? notif.createdAt.toDate().toLocaleDateString() + ' ' + notif.createdAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Syncing...'}</span>
                      </div>
                    </div>

                    {/* Right-Aligned Quick Controls */}
                    <div className="absolute right-3.5 top-3.5 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {!notif.read && (
                        <button
                          id={`btn_read_mark_${notif.notificationId}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMarkAsRead(notif.notificationId);
                          }}
                          className="p-1 hover:bg-white rounded text-slate-400 hover:text-indigo-600"
                          title="Mark as read"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        id={`btn_delete_notif_${notif.notificationId}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteNotification(notif.notificationId);
                        }}
                        className="p-1 hover:bg-white rounded text-slate-400 hover:text-red-500"
                        title="Delete alert log"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
