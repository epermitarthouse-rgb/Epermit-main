import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface InspectionPhoto {
  id: string;
  user_id: string;
  project_id: string | null;
  inspection_id: string | null;
  punch_list_item_id: string | null;
  checklist_item_id: string | null;
  file_path: string;
  file_name: string;
  file_size: number | null;
  caption: string | null;
  location: string | null;
  taken_at: string | null;
  created_at: string;
  updated_at: string;
  url?: string;
}

interface UploadPhotoParams {
  file: File;
  projectId?: string;
  inspectionId?: string;
  punchListItemId?: string;
  checklistItemId?: string;
  caption?: string;
  location?: string;
}

export function useInspectionPhotos(projectId?: string | null) {
  const { user } = useAuth();
  const [photos, setPhotos] = useState<InspectionPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const fetchPhotos = useCallback(async () => {
    if (!user) {
      setPhotos([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      let query = supabase
        .from('inspection_photos')
        .select('*')
        .order('created_at', { ascending: false });

      if (projectId) {
        query = query.eq('project_id', projectId);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Get public URLs for each photo
      const photosWithUrls = await Promise.all(
        (data || []).map(async (photo) => {
          const { data: urlData } = supabase.storage
            .from('inspection-photos')
            .getPublicUrl(photo.file_path);
          
          return {
            ...photo,
            url: urlData.publicUrl,
          };
        })
      );

      setPhotos(photosWithUrls);
    } catch (err) {
      console.error('Error fetching photos:', err);
      toast.error('Failed to load photos');
    } finally {
      setLoading(false);
    }
  }, [user, projectId]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  const uploadPhoto = async ({
    file,
    projectId: projId,
    inspectionId,
    punchListItemId,
    checklistItemId,
    caption,
    location,
  }: UploadPhotoParams): Promise<InspectionPhoto | null> => {
    if (!user) {
      toast.error('You must be logged in to upload photos');
      return null;
    }

    try {
      setUploading(true);

      // Generate unique file path
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('inspection-photos')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('inspection-photos')
        .getPublicUrl(filePath);

      // Save metadata to database
      const { data: photoData, error: dbError } = await supabase
        .from('inspection_photos')
        .insert([{
          user_id: user.id,
          project_id: projId || projectId || null,
          inspection_id: inspectionId || null,
          punch_list_item_id: punchListItemId || null,
          checklist_item_id: checklistItemId || null,
          file_path: filePath,
          file_name: file.name,
          file_size: file.size,
          caption: caption || null,
          location: location || null,
          taken_at: new Date().toISOString(),
        }])
        .select()
        .single();

      if (dbError) throw dbError;

      const newPhoto: InspectionPhoto = {
        ...photoData,
        url: urlData.publicUrl,
      };

      setPhotos(prev => [newPhoto, ...prev]);
      toast.success('Photo uploaded successfully');
      return newPhoto;
    } catch (err) {
      console.error('Error uploading photo:', err);
      toast.error('Failed to upload photo');
      return null;
    } finally {
      setUploading(false);
    }
  };

  const deletePhoto = async (photoId: string): Promise<boolean> => {
    if (!user) {
      toast.error('You must be logged in to delete photos');
      return false;
    }

    try {
      const photo = photos.find(p => p.id === photoId);
      if (!photo) return false;

      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from('inspection-photos')
        .remove([photo.file_path]);

      if (storageError) {
        console.error('Storage delete error:', storageError);
      }

      // Delete from database
      const { error: dbError } = await supabase
        .from('inspection_photos')
        .delete()
        .eq('id', photoId);

      if (dbError) throw dbError;

      setPhotos(prev => prev.filter(p => p.id !== photoId));
      toast.success('Photo deleted');
      return true;
    } catch (err) {
      console.error('Error deleting photo:', err);
      toast.error('Failed to delete photo');
      return false;
    }
  };

  const updatePhotoCaption = async (photoId: string, caption: string): Promise<boolean> => {
    if (!user) return false;

    try {
      const { error } = await supabase
        .from('inspection_photos')
        .update({ caption })
        .eq('id', photoId);

      if (error) throw error;

      setPhotos(prev =>
        prev.map(p => (p.id === photoId ? { ...p, caption } : p))
      );
      return true;
    } catch (err) {
      console.error('Error updating caption:', err);
      return false;
    }
  };

  const getPhotosByChecklistItem = (checklistItemId: string): InspectionPhoto[] => {
    return photos.filter(p => p.checklist_item_id === checklistItemId);
  };

  const getPhotosByInspection = (inspectionId: string): InspectionPhoto[] => {
    return photos.filter(p => p.inspection_id === inspectionId);
  };

  return {
    photos,
    loading,
    uploading,
    uploadPhoto,
    deletePhoto,
    updatePhotoCaption,
    getPhotosByChecklistItem,
    getPhotosByInspection,
    refetch: fetchPhotos,
  };
}
