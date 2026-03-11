"use client";

import React, { useState, useContext, ReactNode, useEffect } from "react";
import { ClientUser } from "@/types/user";
import { useAuth } from "@/contexts/auth.context";
import { ClientService } from "@/services/clients.service";

interface ClientContextProps {
  client?: ClientUser;
}

export const ClientContext = React.createContext<ClientContextProps>({
  client: undefined,
});

interface ClientProviderProps {
  children: ReactNode;
}

export function ClientProvider({ children }: ClientProviderProps) {
  const [client, setClient] = useState<ClientUser>();
  const { user } = useAuth();

  const [clientLoading, setClientLoading] = useState(true);

  const fetchClient = async () => {
    try {
      setClientLoading(true);
      const response = await ClientService.getClientById(
        user?.id as string,
        user?.email as string,
        user?.organization_id as string,
      );
      setClient(response);
    } catch (error) {
      console.error(error);
    }
    setClientLoading(false);
  };

  const fetchOrganization = async () => {
    if (!user?.organization_id) {
  return;
}
    try {
      setClientLoading(true);
      await ClientService.getOrganizationById(user.organization_id);
    } catch (error) {
      console.error(error);
    }
    setClientLoading(false);
  };

  useEffect(() => {
    if (user?.id) {
      fetchClient();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (user?.organization_id) {
      fetchOrganization();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.organization_id]);


  return (
    <ClientContext.Provider
      value={{
        client,
      }}
    >
      {children}
    </ClientContext.Provider>
  );
}

export const useClient = () => {
  const value = useContext(ClientContext);


  return value;
};
