import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { useQuery, useQueryClient } from "react-query";
import * as api from "../lib/api";
import type { AppConfig, User } from "../types";
import { cn, setGooglePhotosEnabled } from "../lib/utils";

type ToastKind = "success" | "error" | "info";
type Toast = { id: number; kind: ToastKind; title: string; description?: string };

type AppContextValue = {
  user: Partial<User> | null;
  isLoggedIn: boolean;
  authChecked: boolean;
  config: AppConfig | undefined;
  completeSignIn: (token: string, user: Partial<User>) => void;
  signOut: () => Promise<void>;
  showToast: (toast: { title: string; description?: string; type?: ToastKind }) => void;
};

const AppContext = createContext<AppContextValue | undefined>(undefined);

export const AppContextProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<Partial<User> | null>(() => (api.authStorage.getToken() ? api.authStorage.getUser() : null));
  const [authChecked, setAuthChecked] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const { data: config } = useQuery("app-config", api.fetchConfig, {
    staleTime: 10 * 60 * 1000,
    retry: 1,
    onSuccess: (cfg) => setGooglePhotosEnabled(cfg.photos?.google !== false),
  });

  const showToast = useCallback(({ title, description, type = "success" }: { title: string; description?: string; type?: ToastKind }) => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-3), { id, kind: type, title, description }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), type === "error" ? 6500 : 4000);
  }, []);

  // Validate the stored session once on load (token or httpOnly cookie).
  useEffect(() => {
    let cancelled = false;
    api
      .fetchSession()
      .then(({ user: fresh }) => {
        if (cancelled) return;
        if (!fresh) {
          api.authStorage.clear();
          setUser(null);
          return;
        }
        setUser(fresh);
        const token = api.authStorage.getToken();
        if (token) api.authStorage.setSession(token, fresh);
      })
      .catch(() => {
        if (cancelled) return;
        api.authStorage.clear();
        setUser(null);
      })
      .finally(() => !cancelled && setAuthChecked(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // The API client fires this when a request comes back 401 (expired session).
  useEffect(() => {
    const onSignedOut = () => {
      setUser(null);
      queryClient.removeQueries("my-bookings");
      queryClient.removeQueries("my-hotels");
    };
    window.addEventListener("staysmart:signed-out", onSignedOut);
    return () => window.removeEventListener("staysmart:signed-out", onSignedOut);
  }, [queryClient]);

  const completeSignIn = useCallback(
    (token: string, signedInUser: Partial<User>) => {
      api.authStorage.setSession(token, signedInUser);
      setUser(signedInUser);
      setAuthChecked(true);
      queryClient.invalidateQueries();
    },
    [queryClient]
  );

  const signOut = useCallback(async () => {
    try {
      await api.signOut();
    } catch {
      /* clear local state regardless */
    }
    api.authStorage.clear();
    setUser(null);
    queryClient.removeQueries("my-bookings");
    queryClient.removeQueries("my-hotels");
  }, [queryClient]);

  const value = useMemo(
    () => ({ user, isLoggedIn: Boolean(user), authChecked, config, completeSignIn, signOut, showToast }),
    [user, authChecked, config, completeSignIn, signOut, showToast]
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-white p-4 shadow-large animate-slide-up",
              toast.kind === "success" && "border-emerald-200",
              toast.kind === "error" && "border-red-200",
              toast.kind === "info" && "border-primary-200"
            )}
          >
            {toast.kind === "success" && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />}
            {toast.kind === "error" && <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />}
            {toast.kind === "info" && <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
              {toast.description && <p className="mt-0.5 text-sm text-slate-600">{toast.description}</p>}
            </div>
            <button
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              onClick={() => setToasts((list) => list.filter((t) => t.id !== toast.id))}
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used inside AppContextProvider");
  return ctx;
};
