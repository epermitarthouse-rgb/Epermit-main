import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { 
  MessageSquare, 
  Send, 
  Reply, 
  CheckCircle2, 
  AtSign,
  MoreVertical,
  Trash2,
  Loader2
} from 'lucide-react';
import { format } from 'date-fns';
import { useDocumentComments, DocumentComment } from '@/hooks/useDocumentComments';
import { useProjectTeam } from '@/hooks/useProjectTeam';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface CommentThreadProps {
  projectId: string;
  documentId?: string;
  className?: string;
}

export function CommentThread({ projectId, documentId, className }: CommentThreadProps) {
  const { user } = useAuth();
  const { comments, loading, addComment, resolveComment, deleteComment } = 
    useDocumentComments(projectId, documentId);
  const { members } = useProjectTeam(projectId);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [sending, setSending] = useState(false);

  const getInitials = (name: string | null | undefined) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const extractMentions = (content: string): string[] => {
    const mentionRegex = /@\[([^\]]+)\]\(([^)]+)\)/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.push(match[2]);
    }
    return mentions;
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || sending) return;
    setSending(true);
    
    const mentions = extractMentions(newComment);
    const displayContent = newComment.replace(/@\[([^\]]+)\]\(([^)]+)\)/g, '@$1');
    
    await addComment(displayContent, mentions, { documentId: documentId || undefined });
    setNewComment('');
    setSending(false);
  };

  const handleReply = async (parentId: string) => {
    if (!replyContent.trim() || sending) return;
    setSending(true);
    
    const mentions = extractMentions(replyContent);
    const displayContent = replyContent.replace(/@\[([^\]]+)\]\(([^)]+)\)/g, '@$1');
    
    await addComment(displayContent, mentions, { 
      documentId: documentId || undefined,
      parentCommentId: parentId 
    });
    setReplyContent('');
    setReplyingTo(null);
    setSending(false);
  };

  const handleMention = (member: { user_id: string; profile?: { full_name: string | null } }, isReply: boolean) => {
    const name = member.profile?.full_name || 'User';
    const mentionText = `@[${name}](${member.user_id}) `;
    
    if (isReply) {
      setReplyContent(prev => prev.replace(/@\w*$/, '') + mentionText);
    } else {
      setNewComment(prev => prev.replace(/@\w*$/, '') + mentionText);
    }
    setShowMentions(false);
  };

  const handleInputChange = (value: string, isReply: boolean) => {
    if (isReply) {
      setReplyContent(value);
    } else {
      setNewComment(value);
    }
    
    const lastWord = value.split(' ').pop() || '';
    if (lastWord.startsWith('@') && lastWord.length > 1) {
      setMentionSearch(lastWord.slice(1).toLowerCase());
      setShowMentions(true);
    } else if (!lastWord.startsWith('@')) {
      setShowMentions(false);
    }
  };

  const filteredMembers = members.filter(m => 
    m.profile?.full_name?.toLowerCase().includes(mentionSearch) ||
    m.user_id.includes(mentionSearch)
  );

  const renderComment = (comment: DocumentComment, isReply = false) => {
    const isOwn = comment.user_id === user?.id;

    return (
      <motion.div
        key={comment.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          'p-3 rounded-lg',
          isReply ? 'ml-8 bg-muted/30' : 'bg-muted/50',
          comment.resolved && 'opacity-60'
        )}
      >
        <div className="flex items-start gap-3">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="text-xs">
              {getInitials(comment.user_profile?.full_name)}
            </AvatarFallback>
          </Avatar>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">
                {comment.user_profile?.full_name || 'Unknown'}
              </span>
              <span className="text-xs text-muted-foreground">
                {format(new Date(comment.created_at), 'MMM d, h:mm a')}
              </span>
              {comment.resolved && (
                <Badge variant="secondary" className="text-xs">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Resolved
                </Badge>
              )}
            </div>
            
            <p className="text-sm mt-1 whitespace-pre-wrap">
              {comment.content.split(/(@\w+)/g).map((part, i) => (
                part.startsWith('@') ? (
                  <span key={i} className="text-primary font-medium">{part}</span>
                ) : part
              ))}
            </p>

            <div className="flex items-center gap-2 mt-2">
              {!isReply && !comment.resolved && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                >
                  <Reply className="h-3 w-3 mr-1" />
                  Reply
                </Button>
              )}
              
              {!comment.resolved && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => resolveComment(comment.id)}
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Resolve
                </Button>
              )}

              {isOwn && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <MoreVertical className="h-3 w-3" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-32 p-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start text-destructive"
                      onClick={() => deleteComment(comment.id)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        </div>

        {/* Replies */}
        {comment.replies && comment.replies.length > 0 && (
          <div className="mt-3 space-y-2">
            {comment.replies.map(reply => renderComment(reply, true))}
          </div>
        )}

        {/* Reply input */}
        <AnimatePresence>
          {replyingTo === comment.id && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 ml-8"
            >
              <Textarea
                value={replyContent}
                onChange={(e) => handleInputChange(e.target.value, true)}
                placeholder="Write a reply... Use @ to mention"
                rows={2}
                className="text-sm"
              />
              <div className="flex justify-end gap-2 mt-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setReplyingTo(null)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleReply(comment.id)}
                  disabled={!replyContent.trim() || sending}
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                  Reply
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="flex items-center gap-2 p-3 border-b">
        <MessageSquare className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Comments</h3>
        <Badge variant="secondary">{comments.length}</Badge>
      </div>

      <ScrollArea className="flex-1 p-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : comments.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No comments yet</p>
            <p className="text-sm">Start a discussion!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {comments.map(comment => renderComment(comment))}
          </div>
        )}
      </ScrollArea>

      {/* Mention suggestions */}
      <AnimatePresence>
        {showMentions && filteredMembers.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="border-t bg-background max-h-32 overflow-y-auto"
          >
            {filteredMembers.map((member) => (
              <button
                key={member.user_id}
                className="w-full flex items-center gap-2 p-2 hover:bg-muted text-left"
                onClick={() => handleMention(member, replyingTo !== null)}
              >
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-xs">
                    {getInitials(member.profile?.full_name)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm">{member.profile?.full_name || 'Unknown'}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* New comment input */}
      <div className="p-3 border-t">
        <Textarea
          value={newComment}
          onChange={(e) => handleInputChange(e.target.value, false)}
          placeholder="Add a comment... Use @ to mention team members"
          rows={3}
          className="text-sm"
        />
        <div className="flex justify-between items-center mt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowMentions(!showMentions)}
          >
            <AtSign className="h-4 w-4 mr-1" />
            Mention
          </Button>
          <Button
            size="sm"
            onClick={handleAddComment}
            disabled={!newComment.trim() || sending}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
}
