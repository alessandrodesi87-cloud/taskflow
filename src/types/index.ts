// Tipi allineati con il database (snake_case, come restituiti da Supabase)

export interface User {
  id: string
  email?: string
  full_name?: string
  telegram_chat_id?: string
  phone?: string
  role: 'admin' | 'member'
  is_active?: boolean
  suspended_at?: string | null
  created_at: string
}

export interface Project {
  id: string
  name: string
  description?: string
  owner_id: string
  start_date: string
  end_date: string
  color?: string
  created_at: string
}

export interface ProjectMember {
  id: string
  project_id: string
  user_id: string
  role: 'owner' | 'co-owner' | 'member'
  added_at: string
}

export interface Task {
  id: string
  project_id: string
  title: string
  description?: string
  owner_id: string
  creator_id: string
  assignee_id?: string
  start_date: string
  due_date: string
  status: 'todo' | 'in_progress' | 'done'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  tags?: string[]
  google_task_id?: string
  email_origin?: string
  created_at: string
  updated_at: string
}

export interface Attachment {
  id: string
  task_id: string
  filename: string
  file_url: string
  file_size: number
  uploaded_at: string
}
