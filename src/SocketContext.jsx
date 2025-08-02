"use client";

import { createContext, useContext, useEffect, useState } from "react";
import io from "socket.io-client";

const SocketContext = createContext();

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error("useSocket must be used within a SocketProvider");
  }
  return context;
};

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [user, setUser] = useState(null);
  const [connectionError, setConnectionError] = useState(null);

  useEffect(() => {
    const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
    console.log("🔗 Connecting to server:", serverUrl);
    
    const newSocket = io(serverUrl, {
      transports: ["websocket", "polling"],
      timeout: 5000,
    });

    newSocket.on("connect", () => {
      console.log("✅ Spojeno na server:", newSocket.id);
      setIsConnected(true);
      setConnectionError(null);
    });

    newSocket.on("disconnect", (reason) => {
      console.log("❌ Odspojeno od servera:", reason);
      setIsConnected(false);
      setUser(null);
    });

    newSocket.on("connect_error", (error) => {
      console.error("🔴 Greška konekcije:", error);
      setConnectionError("Nije moguće spojiti se na server");
      setIsConnected(false);
    });

    newSocket.on("registered", (data) => {
      if (data.success) {
        console.log("✅ Korisnik registriran:", data.user);
        setUser(data.user);
      }
    });

    newSocket.on("error", (data) => {
      console.error("🔴 Server greška:", data.message);
      setConnectionError(data.message);
    });

    setSocket(newSocket);

    return () => {
      console.log("🔌 Zatvaranje Socket konekcije");
      newSocket.close();
    };
  }, []);

  const registerUser = (userData) => {
    return new Promise((resolve, reject) => {
      if (!socket || !isConnected) {
        reject(new Error("Nema konekcije sa serverom"));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error("Registracija je predugačka - pokušajte ponovno"));
      }, 10000);

      socket.once("registered", (response) => {
        clearTimeout(timeout);
        if (response.success) {
          setUser(response.user);
          resolve(response);
        } else {
          reject(new Error(response.message || "Registracija neuspjela"));
        }
      });

      socket.emit("register", userData);
    });
  };

  const findMatch = (gameMode = "1v1") => {
    if (socket && user) {
      socket.emit("findMatch", { gameMode });
    }
  };

  const cancelMatch = () => {
    if (socket) {
      socket.emit("cancelMatch");
    }
  };

  const playCard = (roomId, card) => {
    if (socket) {
      socket.emit("playCard", { roomId, card });
    }
  };

  const leaveRoom = (roomId) => {
    if (socket) {
      socket.emit("leaveRoom", roomId);
    }
  };

  const value = {
    socket,
    isConnected,
    connectionError,
    user,
    registerUser,
    findMatch,
    cancelMatch,
    playCard,
    leaveRoom,
  };

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
};

export default SocketContext;
