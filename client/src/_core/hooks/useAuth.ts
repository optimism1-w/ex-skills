import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";

export const useAuth = () => {
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const { data, error } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (data) {
      setUser(data);
      setIsLoading(false);
    } else if (error) {
      const isLocal = window.location.hostname === 'localhost' || 
                      window.location.hostname === '127.0.0.1';
      
      if (isLocal) {
        setUser({ id: 1, name: "本地用户", openId: "local-user" });
      } else {
        setUser(null);
      }
      setIsLoading(false);
    }
  }, [data, error]);

  const logout = async () => {
    try {
      await trpc.auth.logout.mutate();
    } catch (e) {}
    setUser(null);
  };

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout,
    login: async () => {},
    register: async () => {},
  };
};