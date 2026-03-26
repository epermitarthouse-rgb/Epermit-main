import { useState, useEffect } from "react";
import { WifiOff, Wifi, Database } from "lucide-react";
import { cn } from "@/lib/utils";

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showReconnected, setShowReconnected] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowReconnected(true);
      setTimeout(() => setShowReconnected(false), 3000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowReconnected(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Check for pending sync items in IndexedDB
    const checkPendingSync = async () => {
      try {
        const request = indexedDB.open('inspection-checklists-db', 1);
        request.onsuccess = () => {
          const db = request.result;
          if (db.objectStoreNames.contains('sync-queue')) {
            const transaction = db.transaction('sync-queue', 'readonly');
            const store = transaction.objectStore('sync-queue');
            const countRequest = store.count();
            countRequest.onsuccess = () => {
              setPendingSync(countRequest.result);
            };
          }
        };
      } catch (error) {
        // IndexedDB not available or not initialized yet
      }
    };

    checkPendingSync();
    const interval = setInterval(checkPendingSync, 5000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, []);

  if (isOnline && !showReconnected && pendingSync === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 py-2 px-4 text-sm font-medium transition-all duration-300",
        isOnline
          ? showReconnected 
            ? "bg-green-500/90 text-white animate-in slide-in-from-top"
            : "bg-blue-500/90 text-white"
          : "bg-destructive/90 text-destructive-foreground"
      )}
    >
      {isOnline ? (
        showReconnected ? (
          <>
            <Wifi className="h-4 w-4" />
            <span>Back online</span>
          </>
        ) : pendingSync > 0 ? (
          <>
            <Database className="h-4 w-4" />
            <span>{pendingSync} item{pendingSync !== 1 ? 's' : ''} pending sync</span>
          </>
        ) : null
      ) : (
        <>
          <WifiOff className="h-4 w-4" />
          <span>You're offline - checklists will be saved locally</span>
        </>
      )}
    </div>
  );
}
