import { useActionQuery } from "@agent-native/core/client/hooks";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";

import { CreateSessionDialog } from "@/components/sessions/create-session-dialog";

interface NewSession {
  open: () => void;
}

const NewSessionContext = createContext<NewSession | null>(null);

export function NewSessionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: defaultModelData } = useActionQuery("get-default-model", {});
  const open = useCallback(() => setDialogOpen(true), []);
  const value = useMemo(() => ({ open }), [open]);

  return (
    <NewSessionContext.Provider value={value}>
      {children}
      <CreateSessionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultModel={defaultModelData?.model}
        onCreated={(sessionId) => navigate(`/sessions/${sessionId}`)}
      />
    </NewSessionContext.Provider>
  );
}

export function useNewSession(): NewSession {
  const context = useContext(NewSessionContext);
  if (!context) {
    throw new Error("useNewSession must be used inside NewSessionProvider");
  }
  return context;
}
