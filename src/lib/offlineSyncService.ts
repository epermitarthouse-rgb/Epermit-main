import { supabase } from '@/lib/supabase';
import type { OfflineChecklist, SyncQueueItem } from '@/hooks/useOfflineStorage';

export type ConflictResolutionStrategy = 'local-wins' | 'server-wins' | 'merge' | 'manual';

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  conflicts: ConflictItem[];
  errors: SyncError[];
}

export interface ConflictItem {
  id: string;
  localVersion: OfflineChecklist;
  serverVersion: any;
  conflictType: 'update-update' | 'delete-update' | 'update-delete';
  resolvedWith?: ConflictResolutionStrategy;
}

export interface SyncError {
  itemId: string;
  error: string;
  attempts: number;
}

interface ServerChecklist {
  id: string;
  project_id: string;
  inspection_id: string;
  form_data: any;
  checklist_items: any[];
  custom_items: any[];
  updated_at: string;
  created_at: string;
  user_id: string;
}

// Helper to convert local checklist to server format
const toServerFormat = (checklist: OfflineChecklist): Partial<ServerChecklist> => ({
  id: checklist.id.startsWith('offline-') ? undefined : checklist.id,
  project_id: checklist.projectId || '',
  inspection_id: checklist.inspectionId || '',
  form_data: checklist.formData,
  checklist_items: checklist.checklistItems,
  custom_items: checklist.customItems,
  updated_at: checklist.lastModified,
});

// Helper to convert server checklist to local format
const toLocalFormat = (server: ServerChecklist): OfflineChecklist => ({
  id: server.id,
  projectId: server.project_id,
  inspectionId: server.inspection_id,
  formData: server.form_data,
  checklistItems: server.checklist_items || [],
  customItems: server.custom_items || [],
  savedAt: server.created_at,
  syncStatus: 'synced',
  lastModified: server.updated_at,
});

// Merge two checklists - combines items from both, preferring newer changes
const mergeChecklists = (local: OfflineChecklist, server: any): OfflineChecklist => {
  const localTime = new Date(local.lastModified).getTime();
  const serverTime = new Date(server.updated_at).getTime();

  // For form data, use the newer version
  const formData = localTime > serverTime ? local.formData : server.form_data;

  // Merge checklist items - combine unique items, prefer newer for duplicates
  const mergedItems = new Map<string, any>();
  
  // Add server items first
  (server.checklist_items || []).forEach((item: any) => {
    mergedItems.set(item.id, { ...item, source: 'server' });
  });
  
  // Add/override with local items if they're newer
  local.checklistItems.forEach((item) => {
    const existing = mergedItems.get(item.id);
    if (!existing || localTime > serverTime) {
      mergedItems.set(item.id, { ...item, source: 'local' });
    }
  });

  // Merge custom items
  const mergedCustomItems = new Map<string, any>();
  
  (server.custom_items || []).forEach((item: any) => {
    mergedCustomItems.set(item.id, item);
  });
  
  local.customItems.forEach((item) => {
    const existing = mergedCustomItems.get(item.id);
    if (!existing || localTime > serverTime) {
      mergedCustomItems.set(item.id, item);
    }
  });

  return {
    ...local,
    formData,
    checklistItems: Array.from(mergedItems.values()).map(({ source, ...item }) => item),
    customItems: Array.from(mergedCustomItems.values()),
    lastModified: new Date().toISOString(),
    syncStatus: 'synced',
  };
};

// Detect conflicts between local and server versions
const detectConflict = (
  local: OfflineChecklist,
  server: any | null,
  action: 'create' | 'update' | 'delete'
): ConflictItem | null => {
  if (action === 'create' && server) {
    // Server already has this item - potential conflict
    const serverTime = new Date(server.updated_at).getTime();
    const localTime = new Date(local.lastModified).getTime();
    
    if (Math.abs(serverTime - localTime) > 1000) {
      return {
        id: local.id,
        localVersion: local,
        serverVersion: server,
        conflictType: 'update-update',
      };
    }
  }

  if (action === 'update') {
    if (!server) {
      // Server version was deleted
      return {
        id: local.id,
        localVersion: local,
        serverVersion: null,
        conflictType: 'update-delete',
      };
    }

    // Check if server was updated after our local save
    const serverTime = new Date(server.updated_at).getTime();
    const localSaveTime = new Date(local.savedAt).getTime();

    if (serverTime > localSaveTime) {
      return {
        id: local.id,
        localVersion: local,
        serverVersion: server,
        conflictType: 'update-update',
      };
    }
  }

  if (action === 'delete' && server) {
    const serverTime = new Date(server.updated_at).getTime();
    const localTime = new Date(local.lastModified).getTime();

    if (serverTime > localTime) {
      return {
        id: local.id,
        localVersion: local,
        serverVersion: server,
        conflictType: 'delete-update',
      };
    }
  }

  return null;
};

// Resolve a conflict based on strategy
const resolveConflict = async (
  conflict: ConflictItem,
  strategy: ConflictResolutionStrategy
): Promise<OfflineChecklist> => {
  switch (strategy) {
    case 'local-wins':
      conflict.resolvedWith = 'local-wins';
      return conflict.localVersion;

    case 'server-wins':
      conflict.resolvedWith = 'server-wins';
      return conflict.serverVersion ? toLocalFormat(conflict.serverVersion) : conflict.localVersion;

    case 'merge':
      conflict.resolvedWith = 'merge';
      if (conflict.serverVersion) {
        return mergeChecklists(conflict.localVersion, conflict.serverVersion);
      }
      return conflict.localVersion;

    case 'manual':
    default:
      // Return local version but don't mark as resolved - needs manual intervention
      return conflict.localVersion;
  }
};

// Main sync function
export const syncChecklistToServer = async (
  item: SyncQueueItem,
  strategy: ConflictResolutionStrategy = 'merge'
): Promise<{ success: boolean; conflict?: ConflictItem; error?: string }> => {
  const checklist = item.data as OfflineChecklist;

  try {
    // For offline-created items, we need to create them on server
    if (checklist.id.startsWith('offline-')) {
      const serverData = toServerFormat(checklist);
      delete serverData.id; // Let server generate ID

      // Note: This would sync to an inspection_checklists table if it existed
      // For now, we'll simulate the sync by just marking as successful
      console.log('Would create checklist on server:', serverData);
      
      return { success: true };
    }

    // For existing items, check for conflicts first
    // This is a simulation - in real implementation, query the server
    const serverVersion = null; // await getServerChecklist(checklist.id);

    const conflict = detectConflict(checklist, serverVersion, item.action);

    if (conflict) {
      if (strategy === 'manual') {
        return { success: false, conflict };
      }

      const resolved = await resolveConflict(conflict, strategy);
      
      // Update server with resolved version
      console.log('Would update server with resolved checklist:', resolved);
      
      return { success: true, conflict };
    }

    // No conflict - proceed with sync
    if (item.action === 'update') {
      console.log('Would update checklist on server:', toServerFormat(checklist));
    } else if (item.action === 'delete') {
      console.log('Would delete checklist from server:', checklist.id);
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown sync error',
    };
  }
};

// Batch sync all pending items
export const syncAllPending = async (
  items: SyncQueueItem[],
  strategy: ConflictResolutionStrategy = 'merge',
  onProgress?: (current: number, total: number) => void
): Promise<SyncResult> => {
  const result: SyncResult = {
    success: true,
    syncedCount: 0,
    failedCount: 0,
    conflicts: [],
    errors: [],
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress?.(i + 1, items.length);

    const syncResult = await syncChecklistToServer(item, strategy);

    if (syncResult.success) {
      result.syncedCount++;
      if (syncResult.conflict) {
        result.conflicts.push(syncResult.conflict);
      }
    } else {
      result.failedCount++;
      if (syncResult.conflict) {
        result.conflicts.push(syncResult.conflict);
      }
      if (syncResult.error) {
        result.errors.push({
          itemId: item.id,
          error: syncResult.error,
          attempts: item.attempts + 1,
        });
      }
    }
  }

  result.success = result.failedCount === 0;
  return result;
};

// Check if server has newer data (for pull sync)
export const checkForServerUpdates = async (
  localChecklists: OfflineChecklist[]
): Promise<{ hasUpdates: boolean; updates: any[] }> => {
  // In a real implementation, this would query the server for checklists
  // updated since the last sync time
  console.log('Checking for server updates for', localChecklists.length, 'checklists');
  
  return { hasUpdates: false, updates: [] };
};
