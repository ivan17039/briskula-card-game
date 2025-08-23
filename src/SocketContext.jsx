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
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [gameState, setGameState] = useState(null);

  // Load user and game state from localStorage on mount
  useEffect(() => {
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        setUser(userData);
      } catch (error) {
        console.error("Error parsing saved user data:", error);
        localStorage.removeItem("user");
      }
    }

    const savedGameState = localStorage.getItem("gameState");
    if (savedGameState) {
      try {
        const gameData = JSON.parse(savedGameState);
        setGameState(gameData);
      } catch (error) {
        console.error("Error parsing saved game state:", error);
        localStorage.removeItem("gameState");
      }
    }
  }, []);

  useEffect(() => {
    const serverUrl =
      import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
    console.log("🔗 Connecting to server:", serverUrl);

    const newSocket = io(serverUrl, {
      transports: ["websocket", "polling"],
      timeout: 5000,
    });

    newSocket.on("connect", () => {
      console.log("✅ Spojeno na server:", newSocket.id);
      setIsConnected(true);
      setConnectionError(null);
      setReconnectAttempts(0);

      // If we have a saved game state and user, just register user
      // Don't auto-reconnect - let user choose via ReconnectDialog
      const savedGameState = localStorage.getItem("gameState");
      const savedUser = localStorage.getItem("user");

      if (savedGameState && savedUser) {
        try {
          const gameData = JSON.parse(savedGameState);
          const userData = JSON.parse(savedUser);

          console.log(
            "🔄 User has saved game state, registering user but not auto-reconnecting"
          );
          // Just register the user
          newSocket.emit("register", userData);
        } catch (error) {
          console.error("Error during registration with saved state:", error);
        }
      }
    });

    newSocket.on("disconnect", (reason) => {
      console.log("❌ Odspojeno od servera:", reason);
      setIsConnected(false);

      // Don't clear user on disconnect - keep for reconnection
      // Only clear user on manual logout
    });

    newSocket.on("connect_error", (error) => {
      console.error("🔴 Greška konekcije:", error);
      setConnectionError("Nije moguće spojiti se na server");
      setIsConnected(false);
      setReconnectAttempts((prev) => prev + 1);
    });

    // Reconnection success
    newSocket.on("reconnected", (data) => {
      console.log("✅ Uspješno reconnectan u igru:", data);
      if (data.gameState) {
        // Create complete gameData object for reconnection
        const reconnectGameData = {
          roomId: data.roomId,
          playerNumber: data.playerNumber,
          opponent: data.opponent,
          gameType: data.gameType,
          gameMode: data.gameMode,
          gameState: {
            ...data.gameState,
            playableCards: data.playableCards || data.gameState.playableCards,
          },
        };

        setGameState(reconnectGameData);
        localStorage.setItem("gameState", JSON.stringify(reconnectGameData));
      }
    });

    // Reconnection failed
    newSocket.on("reconnectFailed", (data) => {
      console.log("❌ Reconnection failed:", data.message);
      // Clear invalid game state
      clearGameState();
      setConnectionError(data.message);
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
          // Save user to localStorage for persistence
          localStorage.setItem("user", JSON.stringify(response.user));
          resolve(response);
        } else {
          reject(new Error(response.message || "Registracija neuspjela"));
        }
      });

      socket.emit("register", userData);
    });
  };

  const findMatch = (gameMode = "1v1", gameType = "briskula") => {
    if (socket && user) {
      socket.emit("findMatch", { gameMode, gameType });
    }
  };

  const rematch = (
    gameMode = "1v1",
    gameType = "briskula",
    opponentId = null
  ) => {
    if (socket && user) {
      // Ako imamo opponent ID, pokušaj s istim protivnikom
      if (opponentId) {
        socket.emit("requestRematch", { gameMode, gameType, opponentId });
      } else {
        // Inače traži novog protivnika
        socket.emit("findMatch", { gameMode, gameType });
      }
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

  const logout = async () => {
    // If user is not a guest, logout from Supabase too
    if (user && !user.isGuest) {
      const { auth } = await import("./supabase.js");
      await auth.signOut();
    }

    setUser(null);
    setGameState(null);
    // Clear locally stored user data and game state
    localStorage.removeItem("user");
    localStorage.removeItem("gameState");
  };

  const saveGameState = (gameData) => {
    setGameState(gameData);
    localStorage.setItem("gameState", JSON.stringify(gameData));
  };

  const clearGameState = () => {
    setGameState(null);
    localStorage.removeItem("gameState");
  };

  const reconnectToGame = () => {
    return new Promise((resolve, reject) => {
      if (socket && gameState && user) {
        console.log("🔄 Attempting to reconnect to game:", gameState.roomId);

        // Set up one-time listeners for reconnection result
        const handleReconnected = (data) => {
          socket.off("reconnected", handleReconnected);
          socket.off("reconnectFailed", handleReconnectFailed);
          console.log("✅ Reconnection successful:", data);

          // Create proper gameData format for App.jsx
          const gameDataFormat = {
            roomId: data.roomId,
            playerNumber: data.playerNumber,
            opponent: data.opponent,
            gameType: data.gameType,
            gameMode: data.gameMode,
            gameState: {
              ...data.gameState,
              playableCards:
                data.playableCards || data.gameState.playableCards || [],
            },
            success: true,
          };

          resolve(gameDataFormat);
        };

        const handleReconnectFailed = (data) => {
          socket.off("reconnected", handleReconnected);
          socket.off("reconnectFailed", handleReconnectFailed);
          console.log("❌ Reconnection failed:", data.message);
          reject(new Error(data.message));
        };

        socket.on("reconnected", handleReconnected);
        socket.on("reconnectFailed", handleReconnectFailed);

        console.log("📤 Sending reconnection data:", {
          roomId: gameState.roomId,
          userId: user.userId || user.id,
          playerName: user.name,
          isGuest: user.isGuest,
          gameType: gameState.gameType,
          gameMode: gameState.gameMode,
        });

        socket.emit("reconnectToGame", {
          roomId: gameState.roomId,
          userId: user.userId || user.id,
          playerName: user.name,
          isGuest: user.isGuest,
          gameType: gameState.gameType,
          gameMode: gameState.gameMode,
        });
      } else {
        console.log("❌ Missing data for reconnection:", {
          hasSocket: !!socket,
          hasGameState: !!gameState,
          hasUser: !!user,
        });
        reject(new Error("Nedostaju potrebni podaci za reconnection"));
      }
    });
  };

  const value = {
    socket,
    isConnected,
    connectionError,
    reconnectAttempts,
    user,
    gameState,
    savedGameState: gameState, // Alias for compatibility
    registerUser,
    findMatch,
    rematch,
    cancelMatch,
    playCard,
    leaveRoom,
    logout,
    saveGameState,
    clearGameState,
    reconnectToGame,
  };

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
};

export default SocketContext;
