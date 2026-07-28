// Google integration (Google Tasks + Gmail)

import { supabase } from '@/lib/supabase'
import { Task } from '@/types'

interface GoogleTasksTask {
  id: string
  title: string
  notes?: string
  due?: string
  status?: string
  updated?: string
}

export async function linkGmailAccount(userId: string, email: string, accessToken: string, refreshToken: string) {
  // Store gmail account credentials
  const { data, error } = await supabase
    .from('gmail_accounts')
    .insert({
      user_id: userId,
      email,
      access_token: accessToken,
      refresh_token: refreshToken,
    })
    .select()

  if (error) throw error
  return data[0]
}

export async function syncGoogleTasks(userId: string, projectId: string, accessToken: string) {
  try {
    // Get tasks from Google Tasks API
    // This requires google-auth-library and googleapis

    // Pseudo-code:
    // const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URL)
    // oauth2Client.setCredentials({ access_token: accessToken })
    // const tasks = google.tasks({ version: 'v1', auth: oauth2Client })
    // const res = await tasks.tasklists.list()

    console.log('Syncing Google Tasks for user:', userId)
    // This would import tasks from Google Tasks and create them in the app

    return { synced: 0, created: 0, updated: 0 }
  } catch (error) {
    console.error('Error syncing Google Tasks:', error)
    throw error
  }
}

export async function markTaskDoneInGoogle(googleTaskId: string, tasklistId: string, accessToken: string) {
  try {
    // Mark task as done in Google Tasks
    // This requires the Google Tasks API

    console.log('Marking task as done in Google:', googleTaskId)
    // Pseudo-code:
    // const tasks = google.tasks({ version: 'v1', auth: oauth2Client })
    // await tasks.tasks.update({
    //   tasklist: tasklistId,
    //   task: googleTaskId,
    //   resource: { status: 'completed' }
    // })

    return { success: true }
  } catch (error) {
    console.error('Error marking task as done in Google:', error)
    throw error
  }
}

export async function getEmailsForTask(emailOrigin: string, accessToken: string) {
  try {
    // Fetch emails related to the task using Gmail API
    // This would search Gmail for emails matching the task origin

    console.log('Fetching emails for:', emailOrigin)
    // Pseudo-code:
    // const gmail = google.gmail({ version: 'v1', auth: oauth2Client })
    // const res = await gmail.users.messages.list({
    //   userId: 'me',
    //   q: emailOrigin
    // })

    return []
  } catch (error) {
    console.error('Error fetching emails:', error)
    throw error
  }
}

export async function importTasksFromGmail(userId: string, gmailEmail: string, accessToken: string, defaultProjectId: string) {
  try {
    // Search for tasks in Gmail (e.g., emails with [TASK] label)
    // Create tasks from matching emails

    console.log('Importing tasks from Gmail:', gmailEmail)
    // This would scan Gmail labels for [TASK] emails and create tasks

    return { imported: 0 }
  } catch (error) {
    console.error('Error importing tasks from Gmail:', error)
    throw error
  }
}
