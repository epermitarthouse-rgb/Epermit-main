export type ActivityType =
  | 'project_created'
  | 'project_updated'
  | 'project_status_changed'
  | 'document_uploaded'
  | 'document_version_uploaded'
  | 'document_deleted'
  | 'team_member_invited'
  | 'team_member_joined'
  | 'team_member_removed'
  | 'team_member_role_changed'
  | 'inspection_scheduled'
  | 'inspection_updated'
  | 'inspection_passed'
  | 'inspection_failed'
  | 'inspection_cancelled'
  | 'punch_item_created'
  | 'punch_item_updated'
  | 'punch_item_resolved'
  | 'punch_item_verified'
  | 'comment_added';

export interface ProjectActivity {
  id: string;
  project_id: string;
  user_id: string;
  activity_type: ActivityType;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export const ACTIVITY_TYPE_CONFIG: Record<ActivityType, {
  label: string;
  icon: string;
  color: string;
  bgColor: string;
}> = {
  project_created: {
    label: 'Project Created',
    icon: 'FolderPlus',
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-100',
  },
  project_updated: {
    label: 'Project Updated',
    icon: 'Pencil',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
  },
  project_status_changed: {
    label: 'Status Changed',
    icon: 'ArrowRightLeft',
    color: 'text-purple-600',
    bgColor: 'bg-purple-100',
  },
  document_uploaded: {
    label: 'Document Uploaded',
    icon: 'FileUp',
    color: 'text-teal-600',
    bgColor: 'bg-teal-100',
  },
  document_version_uploaded: {
    label: 'New Version',
    icon: 'FilePlus2',
    color: 'text-teal-600',
    bgColor: 'bg-teal-100',
  },
  document_deleted: {
    label: 'Document Deleted',
    icon: 'FileX',
    color: 'text-red-600',
    bgColor: 'bg-red-100',
  },
  team_member_invited: {
    label: 'Member Invited',
    icon: 'UserPlus',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-100',
  },
  team_member_joined: {
    label: 'Member Joined',
    icon: 'UserCheck',
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-100',
  },
  team_member_removed: {
    label: 'Member Removed',
    icon: 'UserMinus',
    color: 'text-red-600',
    bgColor: 'bg-red-100',
  },
  team_member_role_changed: {
    label: 'Role Changed',
    icon: 'UserCog',
    color: 'text-amber-600',
    bgColor: 'bg-amber-100',
  },
  inspection_scheduled: {
    label: 'Inspection Scheduled',
    icon: 'CalendarPlus',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
  },
  inspection_updated: {
    label: 'Inspection Updated',
    icon: 'CalendarCog',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
  },
  inspection_passed: {
    label: 'Inspection Passed',
    icon: 'CheckCircle2',
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-100',
  },
  inspection_failed: {
    label: 'Inspection Failed',
    icon: 'XCircle',
    color: 'text-red-600',
    bgColor: 'bg-red-100',
  },
  inspection_cancelled: {
    label: 'Inspection Cancelled',
    icon: 'CalendarX',
    color: 'text-slate-600',
    bgColor: 'bg-slate-100',
  },
  punch_item_created: {
    label: 'Punch Item Created',
    icon: 'ListPlus',
    color: 'text-orange-600',
    bgColor: 'bg-orange-100',
  },
  punch_item_updated: {
    label: 'Punch Item Updated',
    icon: 'ListTodo',
    color: 'text-amber-600',
    bgColor: 'bg-amber-100',
  },
  punch_item_resolved: {
    label: 'Item Resolved',
    icon: 'ListCheck',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
  },
  punch_item_verified: {
    label: 'Item Verified',
    icon: 'BadgeCheck',
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-100',
  },
  comment_added: {
    label: 'Comment Added',
    icon: 'MessageSquare',
    color: 'text-slate-600',
    bgColor: 'bg-slate-100',
  },
};
