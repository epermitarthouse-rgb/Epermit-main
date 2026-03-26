import { createContext, useContext, useState, ReactNode } from "react";

export interface LeadData {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  role?: string;
  phone?: string;
  interestedTools?: string[];
  source?: string;
}

interface LeadCaptureContextType {
  isLeadCaptured: boolean;
  leadData: LeadData | null;
  captureLead: (data: LeadData) => void;
  showLeadModal: boolean;
  setShowLeadModal: (show: boolean) => void;
  pendingDemoId: string | null;
  setPendingDemoId: (id: string | null) => void;
}

const LeadCaptureContext = createContext<LeadCaptureContextType | undefined>(undefined);

export function LeadCaptureProvider({ children }: { children: ReactNode }) {
  const [isLeadCaptured, setIsLeadCaptured] = useState(false);
  const [leadData, setLeadData] = useState<LeadData | null>(null);
  const [showLeadModal, setShowLeadModal] = useState(false);
  const [pendingDemoId, setPendingDemoId] = useState<string | null>(null);

  const captureLead = (data: LeadData) => {
    setLeadData(data);
    setIsLeadCaptured(true);
    setShowLeadModal(false);
    // In a real app, this would send to a backend/CRM
    console.log("Lead captured:", data);
  };

  return (
    <LeadCaptureContext.Provider
      value={{
        isLeadCaptured,
        leadData,
        captureLead,
        showLeadModal,
        setShowLeadModal,
        pendingDemoId,
        setPendingDemoId,
      }}
    >
      {children}
    </LeadCaptureContext.Provider>
  );
}

export function useLeadCapture() {
  const context = useContext(LeadCaptureContext);
  if (context === undefined) {
    throw new Error("useLeadCapture must be used within a LeadCaptureProvider");
  }
  return context;
}
