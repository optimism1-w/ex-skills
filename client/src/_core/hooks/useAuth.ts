import { useMemo } from "react";

export const useAuth = () => {
  return useMemo(() => ({
    user: { id: "local-user", name: "本地用户" },
    isLoading: false,
    isAuthenticated: true,
    logout: async () => {},
    login: async () => {},
    register: async () => {},
  }), []);
};