export interface UserProfile {
  userId: string;
  displayName: string;
  email: string;
  photoURL: string;
  createdAt: any; // Timestamp or Date
  updatedAt: any;
}

export interface Project {
  projectId: string;
  name: string;
  description: string;
  ownerId: string;
  memberUids: string[];
  createdAt: any;
  updatedAt: any;
}

export interface ProjectMember {
  userId: string;
  role: 'owner' | 'member';
  addedAt: any;
}

export interface SubTask {
  subTaskId: string;
  text: string;
  completed: boolean;
}

export interface Task {
  taskId: string;
  projectId: string;
  title: string;
  description: string;
  columnId: string; // "todo" | "in_progress" | "done"
  assigneeId: string;
  priority: 'low' | 'medium' | 'high';
  dueDate: string | null; // string date/time or empty
  subtasks?: SubTask[];
  createdAt: any;
  updatedAt: any;
}

export interface Comment {
  commentId: string;
  taskId: string;
  authorId: string;
  authorName: string;
  authorPhoto: string;
  text: string;
  createdAt: any;
}

export interface Notification {
  notificationId: string;
  userId: string;
  title: string;
  message: string;
  type: 'task_assigned' | 'new_comment' | 'project_invite';
  projectId: string;
  taskId: string;
  read: boolean;
  createdAt: any;
}
