import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface ChatMessage {
  id: string;
  project_id: string;
  user_id: string;
  content: string;
  mentions: string[];
  reply_to_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  user_profile?: {
    full_name: string | null;
    email?: string;
  };
}

export function useProjectChat(projectId: string | null) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMessages = useCallback(async () => {
    if (!projectId) return;

    try {
      const { data, error } = await supabase
        .from('project_chat_messages')
        .select('*')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Fetch user profiles for messages
      const userIds = [...new Set(data?.map(m => m.user_id) || [])];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

      const messagesWithProfiles = data?.map(msg => ({
        ...msg,
        user_profile: profileMap.get(msg.user_id) || { full_name: 'Unknown User' }
      })) || [];

      setMessages(messagesWithProfiles);
    } catch (err) {
      console.error('Error fetching chat messages:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Real-time subscription
  useEffect(() => {
    if (!projectId) return;

    const channel = supabase
      .channel(`chat-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'project_chat_messages',
          filter: `project_id=eq.${projectId}`
        },
        () => {
          fetchMessages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, fetchMessages]);

  const sendMessage = async (content: string, mentions: string[] = [], replyToId?: string) => {
    if (!projectId || !user) return null;

    try {
      const { data, error } = await supabase
        .from('project_chat_messages')
        .insert({
          project_id: projectId,
          user_id: user.id,
          content,
          mentions,
          reply_to_id: replyToId || null
        })
        .select()
        .single();

      if (error) throw error;

      // Create mention notifications
      if (mentions.length > 0) {
        const notifications = mentions.map(mentionedUserId => ({
          user_id: mentionedUserId,
          mentioned_by: user.id,
          project_id: projectId,
          reference_type: 'chat' as const,
          reference_id: data.id,
          content_preview: content.slice(0, 100)
        }));

        await supabase.from('mention_notifications').insert(notifications);
      }

      return data;
    } catch (err) {
      console.error('Error sending message:', err);
      toast.error('Failed to send message');
      return null;
    }
  };

  const editMessage = async (messageId: string, newContent: string) => {
    if (!user) return false;

    try {
      const { error } = await supabase
        .from('project_chat_messages')
        .update({ content: newContent, edited_at: new Date().toISOString() })
        .eq('id', messageId)
        .eq('user_id', user.id);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Error editing message:', err);
      toast.error('Failed to edit message');
      return false;
    }
  };

  const deleteMessage = async (messageId: string) => {
    if (!user) return false;

    try {
      const { error } = await supabase
        .from('project_chat_messages')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', messageId)
        .eq('user_id', user.id);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Error deleting message:', err);
      toast.error('Failed to delete message');
      return false;
    }
  };

  return {
    messages,
    loading,
    sendMessage,
    editMessage,
    deleteMessage,
    refetch: fetchMessages
  };
}
