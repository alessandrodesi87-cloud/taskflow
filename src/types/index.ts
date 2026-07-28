// User
export interface User {
  id: string
  email: string
  fullName: string
  telegramChatId?: string
  phone?: string
  role: 'admin' | 'member'
  createdAt: string
}

// Project
export interface Project {
  id: string
  name: string
  description?: string
  ownerId: string
  startDate: string
  endDate: string
  color?: string
  createdAt: string
}

export interface ProjectMember {
  id: string
  projectId: string
  userId: string
  role: 'owner' | 'co-owner' | 'member'
  addedAt: string
}

// Task
export interface Task {
  id: string
  projectId: string
  title: string
  description?: string
  ownerId: string
  creatorId: string
  assigneeId?: string
  startDate: string
  dueDate: string
  status: 'todo' | 'in_progress' | 'done'
  priority: 'low' | 'medium' | 'high'
  tags?: string[]
  googleTaskId?: string
  emailOrigin?: string
  createdAt: string
  updatedAt: string
}

// Attachment
export interface Attachment {
  id: string
  taskId: string
  filename: string
  fileUrl: string
  fileSize: number
  uploadedAt: string
}

// Audit Log
export interface AuditLog {
  id: string
  userId: string
  action: string
  entityType: string
  entityId: string
  changes?: Record<string, any>
  createdAt: string
}

// Gmail Account
export interface GmailAccount {
  id: string
  userId: string
  email: string
  accessToken: string
  refreshToken: string
  defaultProjectId: string
  connectedAt: string
}
