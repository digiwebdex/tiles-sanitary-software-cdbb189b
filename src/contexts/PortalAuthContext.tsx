import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import {
  bindAuthUser,
  getPortalContext,
  touchLastLogin,
  type PortalContext,
} from "@/services/portalService";
import { portalAuthBridge, type PortalSessionUser } from "@/lib/portalAuthBridge";

interface PortalAuthValue {
  user: PortalSessionUser | null;
  context: PortalContext | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<PortalAuthValue | null>(null);

export function usePortalAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePortalAuth must be used within PortalAuthProvider");
  return v;
}

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PortalSessionUser | null>(null);
  const [context, setContext] = useState<PortalContext | null>(null);
  const [loading, setLoading] = useState(true);
  const initRef = useRef(true);

  async function loadContext() {
    await bindAuthUser();
    await touchLastLogin();
    const ctx = await getPortalContext();
    setContext(ctx);
  }

  useEffect(() => {
    let mounted = true;

    const bootstrap = async (sessionUser: PortalSessionUser | null) => {
      setUser(sessionUser);
      if (sessionUser) {
        await loadContext();
      } else {
        setContext(null);
      }
    };

    const init = async () => {
      try {
        await bootstrap(portalAuthBridge.getSessionUser());
      } finally {
        if (mounted) {
          initRef.current = false;
          setLoading(false);
        }
      }
    };
    void init();

    const unsubscribe = portalAuthBridge.onAuthStateChange(() => {
      if (!mounted) return;
      if (initRef.current) return;
      setLoading(true);
      const sessionUser = portalAuthBridge.getSessionUser();
      void (async () => {
        try {
          await bootstrap(sessionUser);
        } finally {
          if (mounted) setLoading(false);
        }
      })();
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await portalAuthBridge.signOut();
    setUser(null);
    setContext(null);
  };

  return (
    <Ctx.Provider value={{ user, context, loading, signOut }}>
      {children}
    </Ctx.Provider>
  );
}
