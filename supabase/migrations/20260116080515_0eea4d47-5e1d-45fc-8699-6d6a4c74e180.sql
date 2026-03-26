-- Create comments table for documents/drawings
CREATE TABLE public.document_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.project_documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  parent_comment_id UUID REFERENCES public.document_comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  mentions UUID[] DEFAULT '{}',
  position_x FLOAT,
  position_y FLOAT,
  resolved BOOLEAN DEFAULT false,
  resolved_by UUID,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create annotations table for markup tools
CREATE TABLE public.document_annotations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.project_documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  annotation_type TEXT NOT NULL CHECK (annotation_type IN ('redline', 'callout', 'revision_cloud', 'arrow', 'rectangle', 'circle', 'freehand', 'text', 'highlight')),
  data JSONB NOT NULL DEFAULT '{}',
  color TEXT DEFAULT '#ef4444',
  stroke_width FLOAT DEFAULT 2,
  layer_order INTEGER DEFAULT 0,
  visible BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create project chat messages table
CREATE TABLE public.project_chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  mentions UUID[] DEFAULT '{}',
  reply_to_id UUID REFERENCES public.project_chat_messages(id) ON DELETE SET NULL,
  edited_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create mention notifications table
CREATE TABLE public.mention_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  mentioned_by UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  reference_type TEXT NOT NULL CHECK (reference_type IN ('comment', 'chat', 'annotation')),
  reference_id UUID NOT NULL,
  content_preview TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.document_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mention_notifications ENABLE ROW LEVEL SECURITY;

-- Comments policies
CREATE POLICY "Users can view comments on projects they have access to"
  ON public.document_comments FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can create comments on projects they have access to"
  ON public.document_comments FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id) AND auth.uid() = user_id);

CREATE POLICY "Users can update their own comments"
  ON public.document_comments FOR UPDATE
  USING (auth.uid() = user_id OR public.has_project_admin_access(auth.uid(), project_id));

CREATE POLICY "Users can delete their own comments"
  ON public.document_comments FOR DELETE
  USING (auth.uid() = user_id OR public.has_project_admin_access(auth.uid(), project_id));

-- Annotations policies
CREATE POLICY "Users can view annotations on projects they have access to"
  ON public.document_annotations FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can create annotations on projects they have access to"
  ON public.document_annotations FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id) AND auth.uid() = user_id);

CREATE POLICY "Users can update their own annotations"
  ON public.document_annotations FOR UPDATE
  USING (auth.uid() = user_id OR public.has_project_admin_access(auth.uid(), project_id));

CREATE POLICY "Users can delete their own annotations"
  ON public.document_annotations FOR DELETE
  USING (auth.uid() = user_id OR public.has_project_admin_access(auth.uid(), project_id));

-- Chat policies
CREATE POLICY "Users can view chat messages on projects they have access to"
  ON public.project_chat_messages FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can create chat messages on projects they have access to"
  ON public.project_chat_messages FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id) AND auth.uid() = user_id);

CREATE POLICY "Users can update their own chat messages"
  ON public.project_chat_messages FOR UPDATE
  USING (auth.uid() = user_id);

-- Mention notifications policies
CREATE POLICY "Users can view their own mention notifications"
  ON public.mention_notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create mention notifications"
  ON public.mention_notifications FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update their own mention notifications"
  ON public.mention_notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- Enable realtime for chat and comments
ALTER PUBLICATION supabase_realtime ADD TABLE public.document_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.mention_notifications;

-- Create triggers for updated_at
CREATE TRIGGER update_document_comments_updated_at
  BEFORE UPDATE ON public.document_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_document_annotations_updated_at
  BEFORE UPDATE ON public.document_annotations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();