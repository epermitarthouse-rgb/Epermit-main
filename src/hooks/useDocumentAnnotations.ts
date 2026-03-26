import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import type { Json } from '@/integrations/supabase/types';

export type AnnotationType = 'redline' | 'callout' | 'revision_cloud' | 'arrow' | 'rectangle' | 'circle' | 'freehand' | 'text' | 'highlight';

export interface AnnotationData {
  points?: { x: number; y: number }[];
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
}

export interface DocumentAnnotation {
  id: string;
  project_id: string;
  document_id: string | null;
  user_id: string;
  annotation_type: AnnotationType;
  data: AnnotationData;
  color: string;
  stroke_width: number;
  layer_order: number;
  visible: boolean;
  created_at: string;
  updated_at: string;
  user_profile?: {
    full_name: string | null;
  };
}

export function useDocumentAnnotations(projectId: string | null, documentId?: string | null) {
  const { user } = useAuth();
  const [annotations, setAnnotations] = useState<DocumentAnnotation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAnnotations = useCallback(async () => {
    if (!projectId) return;

    try {
      let query = supabase
        .from('document_annotations')
        .select('*')
        .eq('project_id', projectId)
        .order('layer_order', { ascending: true });

      if (documentId) {
        query = query.eq('document_id', documentId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const userIds = [...new Set(data?.map(a => a.user_id) || [])];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

      const annotationsWithProfiles = data?.map(ann => ({
        ...ann,
        annotation_type: ann.annotation_type as AnnotationType,
        data: ann.data as AnnotationData,
        user_profile: profileMap.get(ann.user_id) || { full_name: 'Unknown' }
      })) || [];

      setAnnotations(annotationsWithProfiles);
    } catch (err) {
      console.error('Error fetching annotations:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, documentId]);

  useEffect(() => {
    fetchAnnotations();
  }, [fetchAnnotations]);

  const addAnnotation = async (
    type: AnnotationType,
    data: AnnotationData,
    options?: {
      documentId?: string;
      color?: string;
      strokeWidth?: number;
    }
  ) => {
    if (!projectId || !user) return null;

    try {
      const maxOrder = Math.max(...annotations.map(a => a.layer_order), 0);

      const insertData = {
        project_id: projectId,
        document_id: options?.documentId || null,
        user_id: user.id,
        annotation_type: type,
        data: data as Json,
        color: options?.color || '#ef4444',
        stroke_width: options?.strokeWidth || 2,
        layer_order: maxOrder + 1
      };

      const { data: newAnnotation, error } = await supabase
        .from('document_annotations')
        .insert([insertData])
        .select()
        .single();

      if (error) throw error;
      
      await fetchAnnotations();
      return newAnnotation;
    } catch (err) {
      console.error('Error adding annotation:', err);
      toast.error('Failed to add annotation');
      return null;
    }
  };

  const updateAnnotation = async (annotationId: string, updates: { color?: string; stroke_width?: number; visible?: boolean }) => {
    try {
      const { error } = await supabase
        .from('document_annotations')
        .update(updates)
        .eq('id', annotationId);

      if (error) throw error;
      await fetchAnnotations();
      return true;
    } catch (err) {
      console.error('Error updating annotation:', err);
      toast.error('Failed to update annotation');
      return false;
    }
  };

  const deleteAnnotation = async (annotationId: string) => {
    try {
      const { error } = await supabase
        .from('document_annotations')
        .delete()
        .eq('id', annotationId);

      if (error) throw error;
      await fetchAnnotations();
      toast.success('Annotation deleted');
      return true;
    } catch (err) {
      console.error('Error deleting annotation:', err);
      toast.error('Failed to delete annotation');
      return false;
    }
  };

  const clearAllAnnotations = async () => {
    if (!projectId || !user) return false;

    try {
      let query = supabase
        .from('document_annotations')
        .delete()
        .eq('project_id', projectId)
        .eq('user_id', user.id);

      if (documentId) {
        query = query.eq('document_id', documentId);
      }

      const { error } = await query;
      if (error) throw error;

      await fetchAnnotations();
      toast.success('Annotations cleared');
      return true;
    } catch (err) {
      console.error('Error clearing annotations:', err);
      toast.error('Failed to clear annotations');
      return false;
    }
  };

  return {
    annotations,
    loading,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    clearAllAnnotations,
    refetch: fetchAnnotations
  };
}
