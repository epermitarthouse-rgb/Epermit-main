import { supabase } from '@/lib/supabase';
import type { ActivityType } from '@/types/activity';

export async function logProjectActivity(
  projectId: string,
  userId: string,
  activityType: ActivityType,
  title: string,
  description?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from('project_activity').insert([{
      project_id: projectId,
      user_id: userId,
      activity_type: activityType,
      title,
      description: description || null,
      metadata: metadata || {},
    }] as never);
  } catch (error) {
    console.error('Error logging activity:', error);
  }
}
