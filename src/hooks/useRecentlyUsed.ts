import { useState, useCallback, useEffect } from "react";
import { useLocation } from "react-router-dom";

const MAX_RECENT_ITEMS = 5;

interface PageVisit {
  href: string;
  title: string;
  timestamp: number;
}

// Page title mappings
const PAGE_TITLES: Record<string, string> = {
  "/": "Home",
  "/dashboard": "Dashboard",
  "/projects": "Projects",
  "/analytics": "Analytics",
  "/settings": "Settings",
  "/code-compliance": "AI Compliance",
  "/code-reference": "Code Library",
  "/roi-calculator": "ROI Calculator",
  "/jurisdictions/map": "Jurisdiction Map",
  "/jurisdictions/compare": "Compare Jurisdictions",
  "/permit-intelligence": "Permit Intelligence",
  "/demos": "Demos",
  "/pricing": "Pricing",
  "/contact": "Contact",
  "/faq": "FAQ",
  "/api-documentation": "Documentation",
  "/checklist-history": "Checklists",
  "/consolidation-calculator": "Consolidation Calculator",
  "/response-matrix": "Response Matrix",
  "/comment-review": "Comment Review",
  "/classified-comments": "Classified Comments",
};

// Pages to exclude from tracking
const EXCLUDED_PATHS = ["/auth", "/portal", "/embed"];

const RECENT_STORAGE_KEY = "app-recent-pages";
const FAVORITES_STORAGE_KEY = "app-favorite-pages";

// Legacy hook for backward compatibility
export function useRecentlyUsed(storageKey: string) {
  const [recentItems, setRecentItems] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(recentItems));
    } catch {
      // Ignore storage errors
    }
  }, [recentItems, storageKey]);

  const addRecentItem = useCallback((value: string) => {
    setRecentItems((prev) => {
      const filtered = prev.filter((item) => item !== value);
      const updated = [value, ...filtered].slice(0, MAX_RECENT_ITEMS);
      return updated;
    });
  }, []);

  const clearRecentItems = useCallback(() => {
    setRecentItems([]);
  }, []);

  return { recentItems, addRecentItem, clearRecentItems };
}

// New hook for page navigation tracking
export function useNavigationHistory() {
  const location = useLocation();
  const [recentPages, setRecentPages] = useState<PageVisit[]>([]);
  const [favorites, setFavorites] = useState<PageVisit[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const storedRecent = localStorage.getItem(RECENT_STORAGE_KEY);
      const storedFavorites = localStorage.getItem(FAVORITES_STORAGE_KEY);
      
      if (storedRecent) {
        setRecentPages(JSON.parse(storedRecent));
      }
      if (storedFavorites) {
        setFavorites(JSON.parse(storedFavorites));
      }
    } catch (error) {
      console.error("Error loading navigation history:", error);
    }
  }, []);

  // Track page visits
  useEffect(() => {
    const currentPath = location.pathname;
    
    // Skip excluded paths
    if (EXCLUDED_PATHS.some(path => currentPath.startsWith(path))) {
      return;
    }

    // Skip if no title mapping
    const title = PAGE_TITLES[currentPath];
    if (!title) {
      return;
    }

    setRecentPages(prev => {
      const filtered = prev.filter(page => page.href !== currentPath);
      const updated = [
        { href: currentPath, title, timestamp: Date.now() },
        ...filtered,
      ].slice(0, MAX_RECENT_ITEMS);

      try {
        localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(updated));
      } catch (error) {
        console.error("Error saving recent pages:", error);
      }

      return updated;
    });
  }, [location.pathname]);

  const addFavorite = useCallback((href: string, title?: string) => {
    const pageTitle = title || PAGE_TITLES[href] || href;
    
    setFavorites(prev => {
      if (prev.some(page => page.href === href)) {
        return prev;
      }

      const updated = [...prev, { href, title: pageTitle, timestamp: Date.now() }];

      try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(updated));
      } catch (error) {
        console.error("Error saving favorites:", error);
      }

      return updated;
    });
  }, []);

  const removeFavorite = useCallback((href: string) => {
    setFavorites(prev => {
      const updated = prev.filter(page => page.href !== href);

      try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(updated));
      } catch (error) {
        console.error("Error saving favorites:", error);
      }

      return updated;
    });
  }, []);

  const toggleFavorite = useCallback((href: string, title?: string) => {
    if (favorites.some(page => page.href === href)) {
      removeFavorite(href);
    } else {
      addFavorite(href, title);
    }
  }, [favorites, addFavorite, removeFavorite]);

  const isFavorite = useCallback((href: string) => {
    return favorites.some(page => page.href === href);
  }, [favorites]);

  const clearRecent = useCallback(() => {
    setRecentPages([]);
    try {
      localStorage.removeItem(RECENT_STORAGE_KEY);
    } catch (error) {
      console.error("Error clearing recent pages:", error);
    }
  }, []);

  return {
    recentPages,
    favorites,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    isFavorite,
    clearRecent,
  };
}
