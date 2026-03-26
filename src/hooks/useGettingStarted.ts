import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';

export interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  action: string;
  route?: string;
  completed: boolean;
}

const DEFAULT_CHECKLIST: Omit<ChecklistItem, 'completed'>[] = [
  {
    id: 'complete_profile',
    title: 'Complete your profile',
    description: 'Add your name and company details',
    action: 'Go to Settings',
    route: '/settings',
  },
  {
    id: 'create_project',
    title: 'Create your first project',
    description: 'Start tracking a permit project',
    action: 'Create Project',
    route: '/projects',
  },
  {
    id: 'explore_jurisdictions',
    title: 'Explore jurisdiction data',
    description: 'Find permit requirements for any jurisdiction',
    action: 'View Map',
    route: '/jurisdictions/map',
  },
  {
    id: 'try_roi_calculator',
    title: 'Calculate your ROI',
    description: 'See how much time and money you can save',
    action: 'Open Calculator',
    route: '/roi-calculator',
  },
  {
    id: 'check_compliance',
    title: 'Try AI compliance checking',
    description: 'Upload drawings for automated code review',
    action: 'Check Compliance',
    route: '/code-compliance',
  },
];

interface GettingStartedState {
  checklist: ChecklistItem[];
  dismissed: boolean;
  seenTooltips: string[];
}

export function useGettingStarted() {
  const { user } = useAuth();
  const [state, setState] = useState<GettingStartedState>({
    checklist: DEFAULT_CHECKLIST.map(item => ({ ...item, completed: false })),
    dismissed: false,
    seenTooltips: [],
  });

  const storageKey = user ? `getting_started_${user.id}` : null;

  // Load state from localStorage
  useEffect(() => {
    if (!storageKey) return;

    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setState({
          checklist: DEFAULT_CHECKLIST.map(item => ({
            ...item,
            completed: parsed.completedItems?.includes(item.id) || false,
          })),
          dismissed: parsed.dismissed || false,
          seenTooltips: parsed.seenTooltips || [],
        });
      } catch {
        // Reset to defaults on parse error
      }
    }
  }, [storageKey]);

  // Save state to localStorage
  const saveState = useCallback((newState: GettingStartedState) => {
    if (!storageKey) return;
    
    localStorage.setItem(storageKey, JSON.stringify({
      completedItems: newState.checklist.filter(i => i.completed).map(i => i.id),
      dismissed: newState.dismissed,
      seenTooltips: newState.seenTooltips,
    }));
  }, [storageKey]);

  const completeItem = useCallback((itemId: string) => {
    setState(prev => {
      const newState = {
        ...prev,
        checklist: prev.checklist.map(item =>
          item.id === itemId ? { ...item, completed: true } : item
        ),
      };
      saveState(newState);
      return newState;
    });
  }, [saveState]);

  const dismissChecklist = useCallback(() => {
    setState(prev => {
      const newState = { ...prev, dismissed: true };
      saveState(newState);
      return newState;
    });
  }, [saveState]);

  const showChecklist = useCallback(() => {
    setState(prev => {
      const newState = { ...prev, dismissed: false };
      saveState(newState);
      return newState;
    });
  }, [saveState]);

  const markTooltipSeen = useCallback((tooltipId: string) => {
    setState(prev => {
      if (prev.seenTooltips.includes(tooltipId)) return prev;
      const newState = {
        ...prev,
        seenTooltips: [...prev.seenTooltips, tooltipId],
      };
      saveState(newState);
      return newState;
    });
  }, [saveState]);

  const hasSeenTooltip = useCallback((tooltipId: string) => {
    return state.seenTooltips.includes(tooltipId);
  }, [state.seenTooltips]);

  const resetProgress = useCallback(() => {
    const newState = {
      checklist: DEFAULT_CHECKLIST.map(item => ({ ...item, completed: false })),
      dismissed: false,
      seenTooltips: [],
    };
    setState(newState);
    saveState(newState);
  }, [saveState]);

  const completedCount = state.checklist.filter(i => i.completed).length;
  const totalCount = state.checklist.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const isComplete = completedCount === totalCount;

  return {
    checklist: state.checklist,
    dismissed: state.dismissed,
    completedCount,
    totalCount,
    progress,
    isComplete,
    completeItem,
    dismissChecklist,
    showChecklist,
    markTooltipSeen,
    hasSeenTooltip,
    resetProgress,
  };
}
