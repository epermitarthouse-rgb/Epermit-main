import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { 
  syncAllPending, 
  checkForServerUpdates,
  type ConflictResolutionStrategy,
  type SyncResult,
  type ConflictItem 
} from '@/lib/offlineSyncService';

const DB_NAME = 'inspection-checklists-db';
const DB_VERSION = 2; // Bumped for new conflict tracking
const CHECKLISTS_STORE = 'checklists';
const SYNC_QUEUE_STORE = 'sync-queue';
const SYNC_META_STORE = 'sync-meta';

const MAX_RETRY_ATTEMPTS = 3;
const SYNC_DEBOUNCE_MS = 2000;
const BACKGROUND_SYNC_INTERVAL_MS = 30000; // 30 seconds

export interface OfflineChecklist {
  id: string;
  projectId?: string;
  inspectionId?: string;
  formData: {
    projectName: string;
    projectAddress: string;
    inspectionType: string;
    inspectorName: string;
    permitNumber: string;
    inspectionDate: string;
    weather: string;
    temperature: string;
    generalNotes: string;
  };
  checklistItems: Array<{
    id: string;
    category: string;
    item: string;
    requirement: string;
    checked: boolean;
    notes: string;
    status: 'pending' | 'pass' | 'fail' | 'na';
  }>;
  customItems: Array<{
    id: string;
    category: string;
    item: string;
    requirement: string;
    checked: boolean;
    notes: string;
    status: 'pending' | 'pass' | 'fail' | 'na';
  }>;
  savedAt: string;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'conflict' | 'error';
  lastModified: string;
  serverVersion?: number;
  conflictData?: any;
}

export interface SyncQueueItem {
  id: string;
  type: 'checklist' | 'photo';
  action: 'create' | 'update' | 'delete';
  data: any;
  createdAt: string;
  attempts: number;
  lastAttempt?: string;
  error?: string;
}

interface SyncMeta {
  id: string;
  lastSyncTime: string;
  lastSyncResult: 'success' | 'partial' | 'failed';
  pendingConflicts: ConflictItem[];
}

let dbInstance: IDBDatabase | null = null;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open database'));
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create checklists store
      if (!db.objectStoreNames.contains(CHECKLISTS_STORE)) {
        const checklistStore = db.createObjectStore(CHECKLISTS_STORE, { keyPath: 'id' });
        checklistStore.createIndex('projectId', 'projectId', { unique: false });
        checklistStore.createIndex('inspectionId', 'inspectionId', { unique: false });
        checklistStore.createIndex('syncStatus', 'syncStatus', { unique: false });
        checklistStore.createIndex('lastModified', 'lastModified', { unique: false });
      }

      // Create sync queue store
      if (!db.objectStoreNames.contains(SYNC_QUEUE_STORE)) {
        const syncStore = db.createObjectStore(SYNC_QUEUE_STORE, { keyPath: 'id' });
        syncStore.createIndex('type', 'type', { unique: false });
        syncStore.createIndex('createdAt', 'createdAt', { unique: false });
        syncStore.createIndex('attempts', 'attempts', { unique: false });
      }

      // Create sync metadata store
      if (!db.objectStoreNames.contains(SYNC_META_STORE)) {
        db.createObjectStore(SYNC_META_STORE, { keyPath: 'id' });
      }
    };
  });
};

export function useOfflineStorage() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isDBReady, setIsDBReady] = useState(false);
  const [savedChecklists, setSavedChecklists] = useState<OfflineChecklist[]>([]);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [conflictResolutionStrategy, setConflictResolutionStrategy] = 
    useState<ConflictResolutionStrategy>('merge');

  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const backgroundSyncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isSyncingRef = useRef(false);

  // Initialize database
  useEffect(() => {
    const initDB = async () => {
      try {
        await openDB();
        setIsDBReady(true);
        await loadSavedChecklists();
        await updatePendingSyncCount();
        await loadPendingConflicts();
      } catch (error) {
        console.error('Failed to initialize offline database:', error);
      }
    };

    initDB();
  }, []);

  // Online/offline status with debounced sync
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success('Connection restored', {
        description: 'Syncing offline changes...',
      });
      
      // Debounce sync to avoid rapid re-connections
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
      syncTimeoutRef.current = setTimeout(() => {
        syncPendingItems();
      }, SYNC_DEBOUNCE_MS);
    };

    const handleOffline = () => {
      setIsOnline(false);
      toast.warning('You are offline', {
        description: 'Changes will be saved locally and synced when connected.',
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  // Background sync interval
  useEffect(() => {
    if (isOnline && isDBReady) {
      backgroundSyncIntervalRef.current = setInterval(() => {
        if (!isSyncingRef.current && pendingSyncCount > 0) {
          syncPendingItems();
        }
      }, BACKGROUND_SYNC_INTERVAL_MS);
    }

    return () => {
      if (backgroundSyncIntervalRef.current) {
        clearInterval(backgroundSyncIntervalRef.current);
      }
    };
  }, [isOnline, isDBReady, pendingSyncCount]);

  const loadSavedChecklists = async () => {
    try {
      const db = await openDB();
      const transaction = db.transaction(CHECKLISTS_STORE, 'readonly');
      const store = transaction.objectStore(CHECKLISTS_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        setSavedChecklists(request.result || []);
      };
    } catch (error) {
      console.error('Failed to load checklists:', error);
    }
  };

  const updatePendingSyncCount = async () => {
    try {
      const db = await openDB();
      const transaction = db.transaction(SYNC_QUEUE_STORE, 'readonly');
      const store = transaction.objectStore(SYNC_QUEUE_STORE);
      const request = store.count();

      request.onsuccess = () => {
        setPendingSyncCount(request.result);
      };
    } catch (error) {
      console.error('Failed to count pending sync items:', error);
    }
  };

  const loadPendingConflicts = async () => {
    try {
      const db = await openDB();
      const transaction = db.transaction(SYNC_META_STORE, 'readonly');
      const store = transaction.objectStore(SYNC_META_STORE);
      
      const meta = await new Promise<SyncMeta | undefined>((resolve) => {
        const request = store.get('sync-meta');
        request.onsuccess = () => resolve(request.result);
      });

      if (meta?.pendingConflicts) {
        setConflicts(meta.pendingConflicts);
      }
    } catch (error) {
      console.error('Failed to load pending conflicts:', error);
    }
  };

  const saveSyncMeta = async (result: SyncResult) => {
    try {
      const db = await openDB();
      const transaction = db.transaction(SYNC_META_STORE, 'readwrite');
      const store = transaction.objectStore(SYNC_META_STORE);

      const meta: SyncMeta = {
        id: 'sync-meta',
        lastSyncTime: new Date().toISOString(),
        lastSyncResult: result.success ? 'success' : result.syncedCount > 0 ? 'partial' : 'failed',
        pendingConflicts: result.conflicts.filter(c => !c.resolvedWith),
      };

      store.put(meta);
    } catch (error) {
      console.error('Failed to save sync metadata:', error);
    }
  };

  const saveChecklist = useCallback(async (
    checklist: Omit<OfflineChecklist, 'id' | 'savedAt' | 'syncStatus' | 'lastModified'> & { id?: string }
  ) => {
    try {
      const db = await openDB();
      const now = new Date().toISOString();
      
      // Check if this is an update to an existing checklist
      let existingChecklist: OfflineChecklist | undefined;
      if (checklist.id) {
        const getTransaction = db.transaction(CHECKLISTS_STORE, 'readonly');
        const getStore = getTransaction.objectStore(CHECKLISTS_STORE);
        existingChecklist = await new Promise((resolve) => {
          const request = getStore.get(checklist.id!);
          request.onsuccess = () => resolve(request.result);
        });
      }

      const checklistToSave: OfflineChecklist = {
        id: checklist.id || `offline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        projectId: checklist.projectId,
        inspectionId: checklist.inspectionId,
        formData: checklist.formData,
        checklistItems: checklist.checklistItems,
        customItems: checklist.customItems,
        savedAt: existingChecklist?.savedAt || now,
        syncStatus: isOnline ? 'pending' : 'pending',
        lastModified: now,
        serverVersion: existingChecklist?.serverVersion,
      };

      const transaction = db.transaction(CHECKLISTS_STORE, 'readwrite');
      const store = transaction.objectStore(CHECKLISTS_STORE);
      
      await new Promise<void>((resolve, reject) => {
        const request = store.put(checklistToSave);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      // Add to sync queue
      await addToSyncQueue({
        type: 'checklist',
        action: existingChecklist ? 'update' : 'create',
        data: checklistToSave,
      });

      await loadSavedChecklists();
      await updatePendingSyncCount();

      // Trigger sync if online
      if (isOnline) {
        if (syncTimeoutRef.current) {
          clearTimeout(syncTimeoutRef.current);
        }
        syncTimeoutRef.current = setTimeout(() => {
          syncPendingItems();
        }, SYNC_DEBOUNCE_MS);
      }

      return checklistToSave;
    } catch (error) {
      console.error('Failed to save checklist:', error);
      throw error;
    }
  }, [isOnline]);

  const getChecklist = useCallback(async (id: string): Promise<OfflineChecklist | null> => {
    try {
      const db = await openDB();
      const transaction = db.transaction(CHECKLISTS_STORE, 'readonly');
      const store = transaction.objectStore(CHECKLISTS_STORE);
      
      return new Promise((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Failed to get checklist:', error);
      return null;
    }
  }, []);

  const deleteChecklist = useCallback(async (id: string) => {
    try {
      const db = await openDB();
      
      // Get checklist before deleting to add to sync queue
      const getTransaction = db.transaction(CHECKLISTS_STORE, 'readonly');
      const getStore = getTransaction.objectStore(CHECKLISTS_STORE);
      const checklist = await new Promise<OfflineChecklist | undefined>((resolve) => {
        const request = getStore.get(id);
        request.onsuccess = () => resolve(request.result);
      });

      const transaction = db.transaction(CHECKLISTS_STORE, 'readwrite');
      const store = transaction.objectStore(CHECKLISTS_STORE);
      
      await new Promise<void>((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      // Add delete to sync queue if it was a synced item
      if (checklist && !id.startsWith('offline-')) {
        await addToSyncQueue({
          type: 'checklist',
          action: 'delete',
          data: checklist,
        });
      }

      await loadSavedChecklists();
      await updatePendingSyncCount();
    } catch (error) {
      console.error('Failed to delete checklist:', error);
      throw error;
    }
  }, []);

  const addToSyncQueue = async (item: Omit<SyncQueueItem, 'id' | 'createdAt' | 'attempts'>) => {
    try {
      const db = await openDB();
      const transaction = db.transaction(SYNC_QUEUE_STORE, 'readwrite');
      const store = transaction.objectStore(SYNC_QUEUE_STORE);
      
      // Check for existing item to avoid duplicates
      const existingItems = await new Promise<SyncQueueItem[]>((resolve) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
      });

      const existingItem = existingItems.find(
        (existing) => existing.data?.id === item.data?.id && existing.type === item.type
      );

      if (existingItem) {
        // Update existing queue item
        existingItem.data = item.data;
        existingItem.action = item.action;
        await new Promise<void>((resolve, reject) => {
          const request = store.put(existingItem);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      } else {
        // Create new queue item
        const syncItem: SyncQueueItem = {
          id: `sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          ...item,
          createdAt: new Date().toISOString(),
          attempts: 0,
        };

        await new Promise<void>((resolve, reject) => {
          const request = store.put(syncItem);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      }

      await updatePendingSyncCount();
    } catch (error) {
      console.error('Failed to add to sync queue:', error);
    }
  };

  const updateChecklistSyncStatus = async (
    id: string, 
    status: OfflineChecklist['syncStatus'],
    conflictData?: any
  ) => {
    try {
      const db = await openDB();
      const transaction = db.transaction(CHECKLISTS_STORE, 'readwrite');
      const store = transaction.objectStore(CHECKLISTS_STORE);
      
      const checklist = await new Promise<OfflineChecklist | undefined>((resolve) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
      });

      if (checklist) {
        checklist.syncStatus = status;
        if (conflictData) {
          checklist.conflictData = conflictData;
        }
        store.put(checklist);
      }
    } catch (error) {
      console.error('Failed to update checklist sync status:', error);
    }
  };

  const syncPendingItems = useCallback(async () => {
    if (!isOnline || isSyncingRef.current) return;

    isSyncingRef.current = true;
    setIsSyncing(true);

    try {
      const db = await openDB();
      const transaction = db.transaction(SYNC_QUEUE_STORE, 'readonly');
      const store = transaction.objectStore(SYNC_QUEUE_STORE);
      
      const items: SyncQueueItem[] = await new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });

      // Filter out items that have exceeded max retries
      const itemsToSync = items.filter(item => item.attempts < MAX_RETRY_ATTEMPTS);
      const failedItems = items.filter(item => item.attempts >= MAX_RETRY_ATTEMPTS);

      if (itemsToSync.length === 0) {
        if (failedItems.length > 0) {
          toast.error(`${failedItems.length} items failed to sync after multiple attempts`);
        }
        return;
      }

      setSyncProgress({ current: 0, total: itemsToSync.length });

      // Update all checklists to syncing status
      for (const item of itemsToSync) {
        if (item.type === 'checklist') {
          await updateChecklistSyncStatus(item.data.id, 'syncing');
        }
      }

      const result = await syncAllPending(
        itemsToSync,
        conflictResolutionStrategy,
        (current, total) => {
          setSyncProgress({ current, total });
        }
      );

      setLastSyncResult(result);
      await saveSyncMeta(result);

      // Process results
      for (const item of itemsToSync) {
        const hadConflict = result.conflicts.some(c => c.id === item.data?.id);
        const hadError = result.errors.some(e => e.itemId === item.id);

        if (hadError) {
          // Update attempts and mark as error
          const updateTransaction = db.transaction(SYNC_QUEUE_STORE, 'readwrite');
          const updateStore = updateTransaction.objectStore(SYNC_QUEUE_STORE);
          item.attempts += 1;
          item.lastAttempt = new Date().toISOString();
          item.error = result.errors.find(e => e.itemId === item.id)?.error;
          updateStore.put(item);

          if (item.type === 'checklist') {
            await updateChecklistSyncStatus(item.data.id, 'error');
          }
        } else if (hadConflict) {
          const conflict = result.conflicts.find(c => c.id === item.data?.id);
          if (conflict?.resolvedWith) {
            // Conflict was auto-resolved, remove from queue
            const deleteTransaction = db.transaction(SYNC_QUEUE_STORE, 'readwrite');
            deleteTransaction.objectStore(SYNC_QUEUE_STORE).delete(item.id);
            
            if (item.type === 'checklist') {
              await updateChecklistSyncStatus(item.data.id, 'synced');
            }
          } else {
            // Conflict needs manual resolution
            if (item.type === 'checklist') {
              await updateChecklistSyncStatus(item.data.id, 'conflict', conflict?.serverVersion);
            }
          }
        } else {
          // Success - remove from queue
          const deleteTransaction = db.transaction(SYNC_QUEUE_STORE, 'readwrite');
          deleteTransaction.objectStore(SYNC_QUEUE_STORE).delete(item.id);

          if (item.type === 'checklist') {
            await updateChecklistSyncStatus(item.data.id, 'synced');
          }
        }
      }

      // Update conflicts state
      const unresolvedConflicts = result.conflicts.filter(c => !c.resolvedWith);
      setConflicts(unresolvedConflicts);

      await loadSavedChecklists();
      await updatePendingSyncCount();

      // Show result notification
      if (result.success) {
        toast.success(`Synced ${result.syncedCount} items`, {
          description: result.conflicts.length > 0 
            ? `${result.conflicts.length} conflicts auto-resolved`
            : undefined,
        });
      } else if (result.syncedCount > 0) {
        toast.warning(`Partially synced: ${result.syncedCount} of ${itemsToSync.length}`, {
          description: `${result.failedCount} items failed`,
        });
      } else {
        toast.error('Sync failed', {
          description: result.errors[0]?.error || 'Please try again later',
        });
      }
    } catch (error) {
      console.error('Failed to sync pending items:', error);
      toast.error('Sync error', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
      setSyncProgress({ current: 0, total: 0 });
    }
  }, [isOnline, conflictResolutionStrategy]);

  const resolveConflict = useCallback(async (
    checklistId: string,
    resolution: 'keep-local' | 'keep-server' | 'merge'
  ) => {
    try {
      const db = await openDB();
      const checklist = await getChecklist(checklistId);
      
      if (!checklist) return;

      let resolvedChecklist: OfflineChecklist;

      switch (resolution) {
        case 'keep-local':
          resolvedChecklist = { ...checklist, syncStatus: 'pending', conflictData: undefined };
          break;
        case 'keep-server':
          if (checklist.conflictData) {
            resolvedChecklist = {
              ...checklist,
              formData: checklist.conflictData.form_data || checklist.formData,
              checklistItems: checklist.conflictData.checklist_items || checklist.checklistItems,
              customItems: checklist.conflictData.custom_items || checklist.customItems,
              syncStatus: 'synced',
              conflictData: undefined,
            };
          } else {
            resolvedChecklist = { ...checklist, syncStatus: 'synced', conflictData: undefined };
          }
          break;
        case 'merge':
        default:
          // For merge, keep both local and server items
          resolvedChecklist = { ...checklist, syncStatus: 'pending', conflictData: undefined };
          break;
      }

      const transaction = db.transaction(CHECKLISTS_STORE, 'readwrite');
      const store = transaction.objectStore(CHECKLISTS_STORE);
      store.put(resolvedChecklist);

      // Remove from conflicts
      setConflicts(prev => prev.filter(c => c.id !== checklistId));

      // Re-add to sync queue if needed
      if (resolution !== 'keep-server') {
        await addToSyncQueue({
          type: 'checklist',
          action: 'update',
          data: resolvedChecklist,
        });
      }

      await loadSavedChecklists();
      await updatePendingSyncCount();

      toast.success('Conflict resolved');
    } catch (error) {
      console.error('Failed to resolve conflict:', error);
      toast.error('Failed to resolve conflict');
    }
  }, [getChecklist]);

  const clearAllData = useCallback(async () => {
    try {
      const db = await openDB();
      
      const checklistTransaction = db.transaction(CHECKLISTS_STORE, 'readwrite');
      checklistTransaction.objectStore(CHECKLISTS_STORE).clear();

      const syncTransaction = db.transaction(SYNC_QUEUE_STORE, 'readwrite');
      syncTransaction.objectStore(SYNC_QUEUE_STORE).clear();

      const metaTransaction = db.transaction(SYNC_META_STORE, 'readwrite');
      metaTransaction.objectStore(SYNC_META_STORE).clear();

      setConflicts([]);
      setLastSyncResult(null);

      await loadSavedChecklists();
      await updatePendingSyncCount();
    } catch (error) {
      console.error('Failed to clear data:', error);
      throw error;
    }
  }, []);

  const retryFailedItems = useCallback(async () => {
    try {
      const db = await openDB();
      const transaction = db.transaction(SYNC_QUEUE_STORE, 'readwrite');
      const store = transaction.objectStore(SYNC_QUEUE_STORE);
      
      const items: SyncQueueItem[] = await new Promise((resolve) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
      });

      // Reset attempts for failed items
      for (const item of items) {
        if (item.attempts >= MAX_RETRY_ATTEMPTS) {
          item.attempts = 0;
          item.error = undefined;
          store.put(item);
        }
      }

      await updatePendingSyncCount();
      
      // Trigger sync
      if (isOnline) {
        syncPendingItems();
      }
    } catch (error) {
      console.error('Failed to retry failed items:', error);
    }
  }, [isOnline, syncPendingItems]);

  return {
    isOnline,
    isDBReady,
    savedChecklists,
    pendingSyncCount,
    isSyncing,
    syncProgress,
    lastSyncResult,
    conflicts,
    conflictResolutionStrategy,
    setConflictResolutionStrategy,
    saveChecklist,
    getChecklist,
    deleteChecklist,
    syncPendingItems,
    resolveConflict,
    retryFailedItems,
    clearAllData,
    refreshChecklists: loadSavedChecklists,
  };
}
