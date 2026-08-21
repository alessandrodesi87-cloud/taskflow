import type { SupabaseClient } from '@supabase/supabase-js'

export const PERSONAL_INBOX_NAME = 'Inbox personale'

export interface PersonalInboxProject {
  id: string
  name: string
  owner_id: string
  is_personal: boolean
}

export async function ensurePersonalInbox(
  admin: SupabaseClient,
  userId: string,
): Promise<PersonalInboxProject> {
  const { data: existing, error: readError } = await admin
    .from('projects')
    .select('id, name, owner_id, is_personal')
    .eq('owner_id', userId)
    .eq('is_personal', true)
    .maybeSingle()

  if (readError) throw new Error('Impossibile leggere l’Inbox personale')
  if (existing) return existing as PersonalInboxProject

  const today = new Date().toISOString().slice(0, 10)
  const { data: created, error: createError } = await admin
    .from('projects')
    .insert({
      name: PERSONAL_INBOX_NAME,
      description: 'Task ancora da classificare in un progetto.',
      owner_id: userId,
      start_date: today,
      end_date: today,
      color: '#64748b',
      is_personal: true,
    })
    .select('id, name, owner_id, is_personal')
    .single()

  if (!createError && created) return created as PersonalInboxProject
  if (createError?.code !== '23505') {
    throw new Error('Impossibile creare l’Inbox personale')
  }

  const { data: concurrentInbox, error: concurrentError } = await admin
    .from('projects')
    .select('id, name, owner_id, is_personal')
    .eq('owner_id', userId)
    .eq('is_personal', true)
    .single()

  if (concurrentError || !concurrentInbox) {
    throw new Error('Impossibile recuperare l’Inbox personale')
  }
  return concurrentInbox as PersonalInboxProject
}
