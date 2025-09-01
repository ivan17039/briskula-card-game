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

  const isAIMode = () => {
    if (typeof window !== "undefined") {
      const gameMode = document
        .querySelector("[data-game-mode]")
        ?.getAttribute("data-game-mode");
      return gameMode === "1vAI";
    }
    return false;
  };

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
    if (isAIMode()) {
      console.log("[v0] 🤖 AI mode detected, skipping socket connection");
      setIsConnected(true); // Set as connected for AI mode
      setConnectionError(null);

      // Set mock user for AI mode if none exists
      if (!user) {
        const mockUser = { id: "player1", name: "Igrač", isGuest: true };
        setUser(mockUser);
        localStorage.setItem("user", JSON.stringify(mockUser));
      }
      return;
    }

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

      const savedGameState = localStorage.getItem("gameState");
      const savedUser = localStorage.getItem("user");

      // Auto-register if user has saved session data
      if (savedUser) {
        try {
          const userData = JSON.parse(savedUser);

          console.log("🔄 User found in localStorage, auto-registering...", {
            hasSessionToken: !!userData.sessionToken,
          });

          const registrationData = {
            ...userData,
            // Include sessionToken if it exists (for reconnection)
            ...(userData.sessionToken && {
              sessionToken: userData.sessionToken,
            }),
          };

          newSocket.emit("register", registrationData);
        } catch (error) {
          console.error("Error during auto-registration:", error);
          localStorage.removeItem("user");
          localStorage.removeItem("gameState");
        }
      }
    });

    newSocket.on("disconnect", (reason) => {
      console.log("❌ Odspojeno od servera:", reason);
      setIsConnected(false);
    });

    newSocket.on("connect_error", (error) => {
      console.error("🔴 Greška konekcije:", error);
      setConnectionError("Nije moguće spojiti se na server");
      setIsConnected(false);
      setReconnectAttempts((prev) => prev + 1);
    });

    newSocket.on("reconnected", (data) => {
      console.log("✅ Uspješno reconnectan u igru:", data);
      if (data.gameState) {
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

    newSocket.on("reconnectFailed", (data) => {
      console.log("❌ Reconnection failed:", data.message, data.reason);
      clearGameState();
      setConnectionError(data.message);

      if (data.reason) {
        localStorage.setItem("reconnectFailureReason", data.reason);
      }
    });

    newSocket.on("roomDeleted", (data) => {
      console.log("🗑️ Room deleted:", data.message);
      clearGameState();
      localStorage.setItem("roomDeletionMessage", data.message);

      if (data.redirectToMenu) {
        window.location.hash = "";
        window.location.reload();
      }
    });

    newSocket.on("registered", (data) => {
      if (data.success) {
        console.log(
          "✅ Korisnik registriran:",
          data.user,
          "Session:",
          data.session
        );

        // Include sessionToken in user object
        const userWithSession = {
          ...data.user,
          sessionToken: data.session?.sessionToken,
        };

        setUser(userWithSession);
        localStorage.setItem("user", JSON.stringify(userWithSession));
      }
    });

    newSocket.on("sessionReconnected", (data) => {
      if (data.success) {
        console.log(
          "✅ Sesija reconnected:",
          data.user,
          "Session:",
          data.session
        );

        // Include sessionToken in user object for reconnected sessions too
        const userWithSession = {
          ...data.user,
          sessionToken: data.session?.sessionToken,
        };

        setUser(userWithSession);
        localStorage.setItem("user", JSON.stringify(userWithSession));

        if (window.showToast) {
          window.showToast(
            data.message || "Uspješno ste se reconnectali!",
            "success"
          );
        }
      }
    });

    newSocket.on("registrationError", (data) => {
      console.error("❌ Registration error:", data.message);
      setConnectionError(data.message);
      localStorage.removeItem("user");
      setUser(null);

      if (window.showToast) {
        window.showToast(data.message || "Greška pri registraciji", "error");
      }
    });

    newSocket.on("sessionExpired", (data) => {
      console.log("⏰ Session expired:", data.message);
      localStorage.removeItem("user");
      setUser(null);

      if (window.showToast) {
        window.showToast(
          "Sesija je istekla, molimo registrirajte se ponovno",
          "warning"
        );
      }
    });

    newSocket.on("forceLogoutComplete", (data) => {
      console.log("🧹 Force logout completed:", data.message);

      if (window.showToast) {
        window.showToast(
          data.message || "Sesija je potpuno obrisana",
          "success"
        );
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
      if (isAIMode()) {
        console.log("[v0] 🤖 AI mode: Setting user data locally");
        setUser(userData);
        localStorage.setItem("user", JSON.stringify(userData));
        resolve({ success: true, user: userData });
        return;
      }

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
          localStorage.setItem("user", JSON.stringify(response.user));
          resolve(response);
        } else {
          reject(new Error(response.message || "Registracija neuspjela"));
        }
      });

      const existingUser = localStorage.getItem("user");
      const registrationData = { ...userData };

      if (existingUser) {
        try {
          const parsedUser = JSON.parse(existingUser);
          if (parsedUser.sessionToken) {
            registrationData.sessionToken = parsedUser.sessionToken;
            console.log("🔄 Including existing session token for continuity");
          }
        } catch (error) {
          console.warn("Could not parse existing user data:", error);
        }
      }

      socket.emit("register", registrationData);
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
      if (opponentId) {
        socket.emit("requestRematch", { gameMode, gameType, opponentId });
      } else {
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

  const leaveRoomPermanently = (roomId) => {
    if (socket) {
      socket.emit("leaveRoomPermanently", roomId);
    }
  };

  const logout = async () => {
    if (user && !user.isGuest) {
      const { auth } = await import("./supabase.js");
      await auth.signOut();
    }

    setUser(null);
    setGameState(null);
    localStorage.removeItem("user");
    localStorage.removeItem("gameState");
  };

  const clearUserSession = () => {
    console.log("🧹 Clearing complete user session for development");

    setUser(null);
    setGameState(null);

    localStorage.removeItem("user");
    localStorage.removeItem("gameState");
    localStorage.removeItem("reconnectFailureReason");
    localStorage.removeItem("roomDeletionMessage");

    if (socket && user?.sessionToken) {
      socket.emit("forceLogout", { sessionToken: user.sessionToken });
    }

    if (window.showToast) {
      window.showToast("Sesija je potpuno obrisana", "success");
    }
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

        const handleReconnected = (data) => {
          socket.off("reconnected", handleReconnected);
          socket.off("reconnectFailed", handleReconnectFailed);
          console.log("✅ Reconnection successful:", data);

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
          console.log("❌ Reconnection failed:", data.message, data.reason);

          if (
            data.reason === "permanentlyLeft" ||
            data.reason === "roomDeleted" ||
            data.reason === "playerNotFound"
          ) {
            clearGameState();
          }

          const error = new Error(data.message);
          error.reason = data.reason;
          reject(error);
        };

        socket.on("reconnected", handleReconnected);
        socket.on("reconnectFailed", handleReconnectFailed);

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

  const dismissReconnect = () => {
    if (socket && gameState) {
      console.log("🚫 Dismissing reconnection to room:", gameState.roomId);
      socket.emit("dismissReconnect", gameState.roomId);
      clearGameState();
    }
  };

  const value = {
    socket,
    isConnected,
    connectionError,
    reconnectAttempts,
    user,
    gameState,
    savedGameState: gameState,
    isAIMode: isAIMode(), // Added isAIMode to context value
    registerUser,
    findMatch,
    rematch,
    cancelMatch,
    playCard,
    leaveRoom,
    leaveRoomPermanently,
    logout,
    clearUserSession,
    saveGameState,
    clearGameState,
    reconnectToGame,
    dismissReconnect,
  };

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
};

export default SocketContext;
