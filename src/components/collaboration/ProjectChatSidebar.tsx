import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { 
  MessageSquare, 
  Send, 
  X, 
  AtSign, 
  MoreVertical,
  Edit,
  Trash2,
  Reply,
  Loader2
} from 'lucide-react';
import { format } from 'date-fns';
import { useProjectChat, ChatMessage } from '@/hooks/useProjectChat';
import { useProjectTeam } from '@/hooks/useProjectTeam';
import { useAuth } from '@/hooks/useAuth';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface ProjectChatSidebarProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ProjectChatSidebar({ projectId, isOpen, onClose }: ProjectChatSidebarProps) {
  const { user } = useAuth();
  const { messages, loading, sendMessage, editMessage, deleteMessage } = useProjectChat(projectId);
  const { members } = useProjectTeam(projectId);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const extractMentions = (content: string): string[] => {
    const mentionRegex = /@\[([^\]]+)\]\(([^)]+)\)/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.push(match[2]);
    }
    return mentions;
  };

  const handleSend = async () => {
    if (!newMessage.trim() || sending) return;

    setSending(true);
    const mentions = extractMentions(newMessage);
    const displayContent = newMessage.replace(/@\[([^\]]+)\]\(([^)]+)\)/g, '@$1');
    
    await sendMessage(displayContent, mentions);
    setNewMessage('');
    setSending(false);
  };

  const handleMention = (member: { user_id: string; profile?: { full_name: string | null } }) => {
    const name = member.profile?.full_name || 'User';
    const mentionText = `@[${name}](${member.user_id}) `;
    setNewMessage(prev => prev.replace(/@\w*$/, '') + mentionText);
    setShowMentions(false);
    inputRef.current?.focus();
  };

  const handleInputChange = (value: string) => {
    setNewMessage(value);
    const lastWord = value.split(' ').pop() || '';
    if (lastWord.startsWith('@') && lastWord.length > 1) {
      setMentionSearch(lastWord.slice(1).toLowerCase());
      setShowMentions(true);
    } else if (!lastWord.startsWith('@')) {
      setShowMentions(false);
    }
  };

  const handleEdit = async (messageId: string) => {
    if (!editContent.trim()) return;
    await editMessage(messageId, editContent);
    setEditingId(null);
    setEditContent('');
  };

  const filteredMembers = members.filter(m => 
    m.profile?.full_name?.toLowerCase().includes(mentionSearch) ||
    m.user_id.includes(mentionSearch)
  );

  const getInitials = (name: string | null | undefined) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const renderMessageContent = (content: string) => {
    // Highlight @mentions
    const parts = content.split(/(@\w+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return (
          <span key={i} className="text-primary font-medium">
            {part}
          </span>
        );
      }
      return part;
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="fixed right-0 top-0 h-full w-80 md:w-96 bg-background border-l shadow-xl z-50 flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Team Chat</h3>
              <Badge variant="secondary" className="text-xs">
                {messages.length}
              </Badge>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No messages yet</p>
                <p className="text-sm">Start the conversation!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((msg) => {
                  const isOwn = msg.user_id === user?.id;
                  const isEditing = editingId === msg.id;

                  return (
                    <div
                      key={msg.id}
                      className={cn(
                        'flex gap-3',
                        isOwn && 'flex-row-reverse'
                      )}
                    >
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarFallback className="text-xs">
                          {getInitials(msg.user_profile?.full_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className={cn('flex-1 max-w-[80%]', isOwn && 'text-right')}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium">
                            {msg.user_profile?.full_name || 'Unknown'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(msg.created_at), 'h:mm a')}
                          </span>
                          {msg.edited_at && (
                            <span className="text-xs text-muted-foreground">(edited)</span>
                          )}
                        </div>

                        {isEditing ? (
                          <div className="flex gap-2">
                            <Input
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleEdit(msg.id)}
                              autoFocus
                            />
                            <Button size="sm" onClick={() => handleEdit(msg.id)}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <div
                            className={cn(
                              'rounded-lg px-3 py-2 inline-block text-left',
                              isOwn
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted'
                            )}
                          >
                            <p className="text-sm whitespace-pre-wrap">
                              {renderMessageContent(msg.content)}
                            </p>
                          </div>
                        )}

                        {isOwn && !isEditing && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6 ml-1">
                                <MoreVertical className="h-3 w-3" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-32 p-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start"
                                onClick={() => {
                                  setEditingId(msg.id);
                                  setEditContent(msg.content);
                                }}
                              >
                                <Edit className="h-4 w-4 mr-2" />
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start text-destructive"
                                onClick={() => deleteMessage(msg.id)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </Button>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {/* Mention Suggestions */}
          <AnimatePresence>
            {showMentions && filteredMembers.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute bottom-20 left-4 right-4 bg-background border rounded-lg shadow-lg max-h-40 overflow-y-auto"
              >
                {filteredMembers.map((member) => (
                  <button
                    key={member.user_id}
                    className="w-full flex items-center gap-2 p-2 hover:bg-muted text-left"
                    onClick={() => handleMention(member)}
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

          {/* Input */}
          <div className="p-4 border-t">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  ref={inputRef}
                  value={newMessage}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                  placeholder="Type a message... Use @ to mention"
                  className="pr-10"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowMentions(!showMentions)}
                >
                  <AtSign className="h-4 w-4" />
                </Button>
              </div>
              <Button onClick={handleSend} disabled={!newMessage.trim() || sending}>
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
