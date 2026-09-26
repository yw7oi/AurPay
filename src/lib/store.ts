"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "./urpay";

type SessionState = {
  token: string | null;
  user: User | null;
  setSession: (token: string, user: User) => void;
  setUser: (user: User) => void;
  logout: () => void;
};

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setSession: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: "urpay-session" },
  ),
);

type UiState = {
  authTab: "login" | "register";
  setAuthTab: (t: "login" | "register") => void;
};

export const useUi = create<UiState>((set) => ({
  authTab: "login",
  setAuthTab: (t) => set({ authTab: t }),
}));
