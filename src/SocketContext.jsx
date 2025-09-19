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
  // Stable guest identity
  const getStableGuestId = () => {
    if (typeof window === "undefined") return null;
    let gid = localStorage.getItem("guestId");
    if (!gid) {
      gid = "guest_" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("guestId", gid);
    }
    return gid;
  };

  const getStableUserId = (existing) => {
    if (existing) return existing;
    return getStableGuestId();
  };

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
        // Backfill missing userId for older saved entries
        if (!userData.userId) {
          userData.userId = getStableUserId();
          localStorage.setItem("user", JSON.stringify(userData));
        }
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
            userId: getStableUserId(userData.userId),
            // Include sessionToken if it exists (for reconnection)
            ...(userData.sessionToken && {
              sessionToken: userData.sessionToken,
            }),
          };

          newSocket.emit("register", registrationData);

          // --- New auto-reconnect logic: use resumeGame event ---
          if (savedGameState && !userData.forfeited) {
            try {
              const gameData = JSON.parse(savedGameState);

              // Use sessionToken and roomId for resumeGame
              if (gameData.roomId && userData.sessionToken) {
                setTimeout(() => {
                  console.log("🔄 Auto-resuming game with sessionToken...", {
                    roomId: gameData.roomId,
                    sessionToken: userData.sessionToken,
                  });
                  newSocket.emit("resumeGame", {
                    roomId: gameData.roomId,
                    sessionToken: userData.sessionToken,
                  });
                }, 300);
              }
            } catch (err) {
              console.error("Error parsing saved game state for resume:", err);
            }
          } else {
            // Alternative: try with playerId/roomId from localStorage
            const savedPlayerId = localStorage.getItem("playerId");
            const savedRoomId = localStorage.getItem("roomId");

            if (
              savedPlayerId &&
              savedRoomId &&
              userData.sessionToken &&
              !userData.forfeited
            ) {
              setTimeout(() => {
                console.log("🔄 Auto-resuming game with playerId/roomId...", {
                  roomId: savedRoomId,
                  playerId: savedPlayerId,
                  sessionToken: userData.sessionToken,
                });
                newSocket.emit("resumeGame", {
                  roomId: savedRoomId,
                  sessionToken: userData.sessionToken,
                });
              }, 300);
            } else if (userData.forfeited) {
              console.log("❌ Skipping auto-reconnect - user has forfeited");
              clearGameState();
            }
          }
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

    const handleUnifiedReconnected = (data) => {
      console.log("✅ Uspješno reconnectan u igru (unified):", data);
      console.log("🔍 Data.gameState.myHand:", data?.gameState?.myHand);
      console.log(
        "🔍 PlayerHand direct:",
        data?.gameState?.[`player${data.playerNumber}Hand`]
      );

      if (data?.gameState) {
        let reconnectGameData;

        if (data.gameMode === "2v2") {
          // 2v2 game: reconstruct teams
          const me =
            data.players?.find((p) => p.userId === user?.userId) ||
            data.players?.find((p) => p.playerNumber === data.playerNumber);
          const myTeam = me?.team || data.myTeam;
          const teammates =
            data.players?.filter((p) => p.team === myTeam) || [];
          const opponents =
            data.players?.filter((p) => p.team !== myTeam) || [];

          // Extract my hand - try multiple sources
          const myHand =
            data.gameState.myHand ||
            data.gameState[`player${data.playerNumber}Hand`] ||
            data.myHand ||
            [];

          console.log(
            "🃏 Extracted myHand for 2v2:",
            myHand,
            "length:",
            myHand.length
          );

          // If server sends empty hand but we have saved data, try to use it as fallback
          let finalMyHand = myHand;
          if (!myHand || myHand.length === 0) {
            console.log(
              "🔄 Server sent empty hand, checking localStorage fallback"
            );
            try {
              const savedGameStateStr = localStorage.getItem("gameState");
              if (savedGameStateStr) {
                const savedData = JSON.parse(savedGameStateStr);
                if (savedData?.gameState?.myHand?.length > 0) {
                  console.log(
                    "✅ Using saved hand as fallback:",
                    savedData.gameState.myHand.length,
                    "cards"
                  );
                  finalMyHand = savedData.gameState.myHand;
                }
              }
            } catch (e) {
              console.warn("Failed to parse saved game state for fallback:", e);
            }
          }

          reconnectGameData = {
            roomId: data.roomId,
            playerNumber: data.playerNumber,
            myTeam: myTeam,
            gameType: data.gameType,
            gameMode: data.gameMode,
            akuzeEnabled: data.akuzeEnabled,
            players: data.players,
            teammates: teammates,
            opponents: opponents,
            gameState: {
              ...data.gameState,
              myHand: finalMyHand,
              playableCards:
                data.playableCards || data.gameState.playableCards || [],
            },
          };
        } else {
          // 1v1 game: find opponent
          const opponent = data.players?.find(
            (p) => p.playerNumber !== data.playerNumber
          );

          reconnectGameData = {
            roomId: data.roomId,
            playerNumber: data.playerNumber,
            opponent: opponent || data.opponent,
            gameType: data.gameType,
            gameMode: data.gameMode,
            players: data.players,
            gameState: {
              ...data.gameState,
              myHand:
                data.playerNumber === 1
                  ? data.gameState.player1Hand
                  : data.gameState.player2Hand,
              opponentHand:
                data.playerNumber === 1
                  ? data.gameState.player2Hand
                  : data.gameState.player1Hand,
              playableCards:
                data.playableCards || data.gameState.playableCards || [],
            },
          };
        }

        console.log("[v1] Mapped reconnect game data:", reconnectGameData);
        // Use the enhanced saveGameState method
        saveGameState(reconnectGameData);

        // Save reconnect data if provided
        if (data.playerId && data.roomId) {
          localStorage.setItem("playerId", data.playerId);
          localStorage.setItem("roomId", data.roomId);
        }
      }
    };
    newSocket.on("reconnected", handleUnifiedReconnected); // legacy
    newSocket.on("gameStateReconnected", handleUnifiedReconnected); // new canonical

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
          userId: getStableUserId(data.user.userId || data.user.id),
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
          userId: getStableUserId(data.user.userId || data.user.id),
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

    // Add new event handlers for forfeit and spectator updates
    newSocket.on("playerForfeited", (data) => {
      console.log("⚠️ Player forfeited:", data);
      // Set forfeited flag to prevent auto-reconnect attempts
      if (data.playerName === user?.name) {
        setUser((prev) => ({ ...prev, forfeited: true }));
        clearGameState(); // Clear game state for forfeited player
      }
    });

    newSocket.on("spectatorUpdate", (data) => {
      console.log("👁️ Spectator update received:", data.roomId);
      // Update game state if we're spectating this room
      if (gameState?.roomId === data.roomId && gameState?.spectator) {
        setGameState((prev) => ({
          ...prev,
          gameState: data.gameState,
          players: data.players,
        }));
      }
    });

    newSocket.on("gameRoomDeleted", (data) => {
      console.log("🗑️ Game room deleted:", data.message);
      clearGameState();
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

      // Ensure we always include stable userId for persistence
      const stableUserId = getStableGuestId();
      const registrationData = {
        ...userData,
        userId: stableUserId, // Always include stable userId
      };

      const existingUser = localStorage.getItem("user");
      if (existingUser) {
        try {
          const parsedUser = JSON.parse(existingUser);
          if (parsedUser.sessionToken) {
            registrationData.sessionToken = parsedUser.sessionToken;
            console.log("🔄 Including existing session token for continuity");
          }
          // Also preserve the existing userId if it exists
          if (parsedUser.userId) {
            registrationData.userId = parsedUser.userId;
            console.log(
              "🔄 Using existing userId for continuity:",
              parsedUser.userId
            );
          }
        } catch (error) {
          console.warn("Could not parse existing user data:", error);
        }
      }

      console.log(
        "📤 Registering with stable userId:",
        registrationData.userId
      );
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

  const forfeitMatch = (roomId, reason = "forfeit") => {
    if (socket) {
      console.log("🏳️ Forfeiting match:", { roomId, reason });
      socket.emit("forfeitMatch", { roomId, reason });
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

  // Environment detection
  const isProduction = () => {
    return (
      import.meta.env.PROD ||
      (import.meta.env.VITE_SERVER_URL &&
        !import.meta.env.VITE_SERVER_URL.includes("localhost"))
    );
  };

  // Enhanced state persistence that supports both localStorage and external storage
  const saveGameState = (gameData) => {
    console.log("💾 [SocketContext] Saving game state:", {
      gameType: gameData?.gameType,
      gameMode: gameData?.gameMode,
      roomId: gameData?.roomId,
      isProduction: isProduction(),
    });

    // Don't update the context gameState - this is just for persistence
    // The calling component manages its own state

    // Always save to localStorage for immediate access
    try {
      localStorage.setItem("gameState", JSON.stringify(gameData));

      // Additional state saving for easy access
      if (gameData?.gameType) {
        localStorage.setItem("gameType", gameData.gameType);
      }
      if (gameData?.gameMode) {
        localStorage.setItem("gameMode", gameData.gameMode);
      }
    } catch (error) {
      console.error(
        "❌ [SocketContext] Error saving game state to localStorage:",
        error
      );
    }

    // In production, also attempt to save to external storage (handled by server/backend)
    if (isProduction() && socket && gameData?.roomId && user?.sessionToken) {
      console.log("☁️ [SocketContext] Requesting server to persist game state");
      socket.emit("persistGameState", {
        roomId: gameData.roomId,
        sessionToken: user.sessionToken,
        gameState: gameData,
      });
    }
  };

  const clearGameState = () => {
    console.log("🧹 [SocketContext] Clearing game state");
    setGameState(null);
    try {
      localStorage.removeItem("gameState");
      localStorage.removeItem("playerId");
      localStorage.removeItem("roomId");
      // Clear cached game info
      localStorage.removeItem("gameType");
      localStorage.removeItem("gameMode");
    } catch (error) {
      console.error("❌ [SocketContext] Error clearing localStorage:", error);
    }
  };

  const reconnectToGame = () => {
    return new Promise((resolve, reject) => {
      if (socket && user) {
        console.log("🔄 Attempting to reconnect to game...");

        const handleReconnected = (data) => {
          socket.off("reconnected", handleReconnected);
          socket.off("gameStateReconnected", handleReconnected);
          socket.off("reconnectFailed", handleReconnectFailed);
          socket.off("reconnectError", handleReconnectFailed);
          console.log("✅ Reconnection successful (promise):", data);

          // Pass through server data directly - it's already personalized
          const gameDataFormat = {
            ...data,
            success: true,
            gameState: {
              ...data.gameState,
              myHand:
                data.playerNumber === 1
                  ? data.gameState.player1Hand
                  : data.gameState.player2Hand,
              opponentHand:
                data.playerNumber === 1
                  ? data.gameState.player2Hand
                  : data.gameState.player1Hand,
              playableCards:
                data.playableCards || data.gameState.playableCards || [],
            },
          };

          resolve(gameDataFormat);
        };

        const handleReconnectFailed = (data) => {
          socket.off("reconnected", handleReconnected);
          socket.off("gameStateReconnected", handleReconnected);
          socket.off("reconnectFailed", handleReconnectFailed);
          socket.off("reconnectError", handleReconnectFailed);
          console.log("❌ Reconnection failed:", data.message, data.reason);

          if (
            data.reason === "permanentlyLeft" ||
            data.reason === "roomDeleted" ||
            data.reason === "playerNotFound" ||
            data.message?.includes("napustili") ||
            data.message?.includes("ne postoji")
          ) {
            clearGameState();
          }

          const error = new Error(data.message);
          error.reason = data.reason;
          reject(error);
        };

        socket.on("reconnected", handleReconnected); // legacy support
        socket.on("gameStateReconnected", handleReconnected); // new canonical
        socket.on("reconnectFailed", handleReconnectFailed);
        socket.on("reconnectError", handleReconnectFailed);

        // Try new reconnect method first (playerId/roomId)
        const savedPlayerId = localStorage.getItem("playerId");
        const savedRoomId = localStorage.getItem("roomId");

        if (savedPlayerId && savedRoomId && user.sessionToken) {
          console.log("🔄 Using playerId/roomId reconnect with sessionToken:", {
            playerId: savedPlayerId,
            roomId: savedRoomId,
            hasSessionToken: !!user.sessionToken,
          });

          socket.emit("reconnectToGame", {
            playerId: savedPlayerId,
            roomId: savedRoomId,
            sessionToken: user.sessionToken,
            playerName: user.name,
            userId: user.userId || user.id,
          });
        } else if (gameState?.roomId) {
          console.log("🔄 Fallback to gameState reconnect method", {
            roomId: gameState.roomId,
            playerName: user.name,
            userId: user.userId || user.id,
            hasSessionToken: !!user.sessionToken,
          });
          socket.emit("reconnectToGame", {
            roomId: gameState.roomId,
            playerId: user.id, // Add current socket ID as playerId fallback
            userId: user.userId || user.id,
            playerName: user.name,
            isGuest: user.isGuest,
            gameType: gameState.gameType,
            gameMode: gameState.gameMode,
            // Include sessionToken if available, but don't require it
            ...(user.sessionToken && { sessionToken: user.sessionToken }),
          });
        } else {
          // Try to get gameState from localStorage as last resort
          try {
            const savedGameStateStr = localStorage.getItem("gameState");
            if (savedGameStateStr) {
              const savedGameState = JSON.parse(savedGameStateStr);
              if (savedGameState?.roomId) {
                console.log(
                  "🔄 Last resort: using localStorage gameState for reconnect"
                );
                socket.emit("reconnectToGame", {
                  roomId: savedGameState.roomId,
                  playerId: user.id,
                  userId: user.userId || user.id,
                  playerName: user.name,
                  isGuest: user.isGuest,
                  gameType: savedGameState.gameType,
                  gameMode: savedGameState.gameMode,
                  ...(user.sessionToken && { sessionToken: user.sessionToken }),
                });
                return; // Don't reject, we found data
              }
            }
          } catch (error) {
            console.warn("Could not parse localStorage gameState:", error);
          }

          console.log("❌ No reconnect data available - missing:", {
            savedPlayerId: !!savedPlayerId,
            savedRoomId: !!savedRoomId,
            gameStateRoomId: !!gameState?.roomId,
            sessionToken: !!user.sessionToken,
          });
          reject(new Error("Nedostaju potrebni podaci za reconnection"));
        }
      } else {
        console.log("❌ Missing data for reconnection:", {
          hasSocket: !!socket,
          hasUser: !!user,
        });
        reject(new Error("Nedostaju potrebni podaci za reconnection"));
      }
    });
  };

  const dismissReconnect = () => {
    const savedRoomId = localStorage.getItem("roomId");
    const roomId = gameState?.roomId || savedRoomId;

    if (socket && roomId) {
      console.log("🚫 Dismissing reconnection to room:", roomId);
      socket.emit("dismissReconnect", roomId);
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
    forfeitMatch,
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
