import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface DocumentComment {
  id: string;
  project_id: string;
  document_id: string | null;
  user_id: string;
  parent_comment_id: string | null;
  content: string;
  mentions: string[];
  position_x: number | null;
  position_y: number | null;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  user_profile?: {
    full_name: string | null;
  };
  replies?: DocumentComment[];
}

export function useDocumentComments(projectId: string | null, documentId?: string | null) {
  const { user } = useAuth();
  const [comments, setComments] = useState<DocumentComment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchComments = useCallback(async () => {
    if (!projectId) return;

    try {
      let query = supabase
        .from('document_comments')
        .select('id, project_id, document_id, user_id, parent_comment_id, content, mentions, position_x, position_y, resolved, resolved_by, resolved_at, created_at, updated_at')
        .eq('project_id', projectId)
        .is('parent_comment_id', null)
        .order('created_at', { ascending: false });

      if (documentId) {
        query = query.eq('document_id', documentId);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Fetch replies
      const commentIds = data?.map(c => c.id) || [];
      const { data: replies } = await supabase
        .from('document_comments')
        .select('id, project_id, document_id, user_id, parent_comment_id, content, mentions, position_x, position_y, resolved, resolved_by, resolved_at, created_at, updated_at')
        .in('parent_comment_id', commentIds)
        .order('created_at', { ascending: true });

      // Fetch profiles
      const allComments = [...(data || []), ...(replies || [])];
      const userIds = [...new Set(allComments.map(c => c.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
      const replyMap = new Map<string, DocumentComment[]>();

      replies?.forEach(reply => {
        const parentId = reply.parent_comment_id!;
        if (!replyMap.has(parentId)) {
          replyMap.set(parentId, []);
        }
        replyMap.get(parentId)!.push({
          ...reply,
          user_profile: profileMap.get(reply.user_id) || { full_name: 'Unknown' }
        });
      });

      const commentsWithReplies = data?.map(comment => ({
        ...comment,
        user_profile: profileMap.get(comment.user_id) || { full_name: 'Unknown' },
        replies: replyMap.get(comment.id) || []
      })) || [];

      setComments(commentsWithReplies);
    } catch (err) {
      console.error('Error fetching comments:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, documentId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Real-time subscription
  useEffect(() => {
    if (!projectId) return;

    const channel = supabase
      .channel(`comments-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'document_comments',
          filter: `project_id=eq.${projectId}`
        },
        () => {
          fetchComments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, fetchComments]);

  const addComment = async (
    content: string,
    mentions: string[] = [],
    options?: {
      documentId?: string;
      parentCommentId?: string;
      positionX?: number;
      positionY?: number;
    }
  ) => {
    if (!projectId || !user) return null;

    try {
      const { data, error } = await supabase
        .from('document_comments')
        .insert({
          project_id: projectId,
          document_id: options?.documentId || null,
          user_id: user.id,
          parent_comment_id: options?.parentCommentId || null,
          content,
          mentions,
          position_x: options?.positionX || null,
          position_y: options?.positionY || null
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
          reference_type: 'comment' as const,
          reference_id: data.id,
          content_preview: content.slice(0, 100)
        }));

        await supabase.from('mention_notifications').insert(notifications);
      }

      toast.success('Comment added');
      return data;
    } catch (err) {
      console.error('Error adding comment:', err);
      toast.error('Failed to add comment');
      return null;
    }
  };

  const resolveComment = async (commentId: string) => {
    if (!user) return false;

    try {
      const { error } = await supabase
        .from('document_comments')
        .update({
          resolved: true,
          resolved_by: user.id,
          resolved_at: new Date().toISOString()
        })
        .eq('id', commentId);

      if (error) throw error;
      toast.success('Comment resolved');
      return true;
    } catch (err) {
      console.error('Error resolving comment:', err);
      toast.error('Failed to resolve comment');
      return false;
    }
  };

  const deleteComment = async (commentId: string) => {
    try {
      const { error } = await supabase
        .from('document_comments')
        .delete()
        .eq('id', commentId);

      if (error) throw error;
      toast.success('Comment deleted');
      return true;
    } catch (err) {
      console.error('Error deleting comment:', err);
      toast.error('Failed to delete comment');
      return false;
    }
  };

  return {
    comments,
    loading,
    addComment,
    resolveComment,
    deleteComment,
    refetch: fetchComments
  };
}
