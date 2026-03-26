import { useState, useRef } from 'react';
import { Camera, Upload, X, Image as ImageIcon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useInspectionPhotos, InspectionPhoto } from '@/hooks/useInspectionPhotos';
import { cn } from '@/lib/utils';

interface ChecklistPhotoUploadProps {
  checklistItemId: string;
  projectId?: string;
  onPhotoAdded?: (photo: InspectionPhoto) => void;
  compact?: boolean;
}

export function ChecklistPhotoUpload({
  checklistItemId,
  projectId,
  onPhotoAdded,
  compact = false,
}: ChecklistPhotoUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<InspectionPhoto | null>(null);
  const [caption, setCaption] = useState('');

  const { 
    uploading, 
    uploadPhoto, 
    deletePhoto,
    getPhotosByChecklistItem 
  } = useInspectionPhotos(projectId);

  const photos = getPhotosByChecklistItem(checklistItemId);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return;
    }

    const photo = await uploadPhoto({
      file,
      projectId,
      checklistItemId,
      caption,
    });

    if (photo) {
      onPhotoAdded?.(photo);
      setCaption('');
    }

    // Reset input
    e.target.value = '';
  };

  const handleViewPhoto = (photo: InspectionPhoto) => {
    setSelectedPhoto(photo);
    setPreviewOpen(true);
  };

  const handleDeletePhoto = async (photoId: string) => {
    await deletePhoto(photoId);
    if (selectedPhoto?.id === photoId) {
      setPreviewOpen(false);
      setSelectedPhoto(null);
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        {photos.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6 relative"
              >
                <ImageIcon className="h-3 w-3" />
                <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] rounded-full h-4 w-4 flex items-center justify-center">
                  {photos.length}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="start">
              <div className="grid grid-cols-3 gap-1">
                {photos.map(photo => (
                  <button
                    key={photo.id}
                    onClick={() => handleViewPhoto(photo)}
                    className="aspect-square rounded overflow-hidden border hover:border-primary transition-colors"
                  >
                    <img
                      src={photo.url}
                      alt={photo.caption || 'Inspection photo'}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelect}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileSelect}
        />

        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <Camera className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-1" align="start">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera className="h-4 w-4" />
                Take Photo
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                Upload
              </Button>
            </PopoverContent>
          </Popover>
        )}

        {/* Photo Preview Dialog */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {selectedPhoto?.caption || 'Inspection Photo'}
              </DialogTitle>
            </DialogHeader>
            {selectedPhoto && (
              <div className="space-y-4">
                <div className="relative rounded-lg overflow-hidden">
                  <img
                    src={selectedPhoto.url}
                    alt={selectedPhoto.caption || 'Inspection photo'}
                    className="w-full max-h-[60vh] object-contain bg-muted"
                  />
                </div>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    {new Date(selectedPhoto.created_at).toLocaleDateString()} at{' '}
                    {new Date(selectedPhoto.created_at).toLocaleTimeString()}
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDeletePhoto(selectedPhoto.id)}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Full version for larger displays
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelect}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileSelect}
        />

        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => cameraInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Camera className="h-4 w-4" />
          )}
          Camera
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="h-4 w-4" />
          Upload
        </Button>

        {photos.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {photos.length} photo{photos.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Photo Grid */}
      {photos.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {photos.map(photo => (
            <div
              key={photo.id}
              className="relative aspect-square rounded-lg overflow-hidden border group cursor-pointer"
              onClick={() => handleViewPhoto(photo)}
            >
              <img
                src={photo.url}
                alt={photo.caption || 'Inspection photo'}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white h-8 w-8"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeletePhoto(photo.id);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Photo Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedPhoto?.caption || 'Inspection Photo'}
            </DialogTitle>
          </DialogHeader>
          {selectedPhoto && (
            <div className="space-y-4">
              <div className="relative rounded-lg overflow-hidden">
                <img
                  src={selectedPhoto.url}
                  alt={selectedPhoto.caption || 'Inspection photo'}
                  className="w-full max-h-[60vh] object-contain bg-muted"
                />
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {new Date(selectedPhoto.created_at).toLocaleDateString()} at{' '}
                  {new Date(selectedPhoto.created_at).toLocaleTimeString()}
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDeletePhoto(selectedPhoto.id)}
                >
                  <X className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
