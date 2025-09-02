"use client";

import { useState, useEffect } from "react";
import { SocketProvider, useSocket } from "./SocketContext";
import { ToastProvider, useToast } from "./ToastProvider";
import Login from "./Login";
import GameTypeSelector from "./GameTypeSelector";
import GameModeSelector from "./GameModeSelector";
import GameLobby from "./GameLobby";
import Game from "./Game";
import Game2v2 from "./Game2v2";
import ReconnectDialog from "./ReconnectDialog";
import UserHeader from "./UserHeader";
import "./App.css";

function AppContent() {
  const {
    isConnected,
    connectionError,
    user,
    registerUser,
    logout,
    savedGameState,
    clearGameState,
    reconnectToGame,
  } = useSocket();

  const { addToast } = useToast();
  const [appState, setAppState] = useState("login");
  const [gameType, setGameType] = useState(null); // 'briskula' | 'treseta'
  const [gameMode, setGameMode] = useState("1v1");
  const [gameData, setGameData] = useState(null);
  const [showReconnectDialog, setShowReconnectDialog] = useState(false);

  // Save state to localStorage when it changes
  useEffect(() => {
    if (appState !== "login") {
      localStorage.setItem("appState", appState);
    }
  }, [appState]);

  useEffect(() => {
    if (gameType) {
      localStorage.setItem("gameType", gameType);
    }
  }, [gameType]);

  useEffect(() => {
    localStorage.setItem("gameMode", gameMode);
  }, [gameMode]);

  // Check if user is already logged in when component mounts
  useEffect(() => {
    if (user && appState === "login") {
      // User is logged in, try to restore their previous state
      const savedAppState = localStorage.getItem("appState");
      const savedGameType = localStorage.getItem("gameType");
      const savedGameMode = localStorage.getItem("gameMode");

      console.log("🔄 Restoring user state:", {
        savedAppState,
        savedGameType,
        savedGameMode,
      });

      if (savedGameType) {
        setGameType(savedGameType);
      }

      if (savedGameMode) {
        setGameMode(savedGameMode);
      }

      if (savedAppState && savedAppState !== "login") {
        setAppState(savedAppState);
      } else {
        setAppState("gameSelect");
      }
    } else if (!user && appState !== "login") {
      // If user is logged out, go back to login and clear saved states
      console.log("🔄 User logged out, clearing state");
      setAppState("login");
      setGameData(null);
      setGameType(null);
      setGameMode("1v1");
      localStorage.removeItem("appState");
      localStorage.removeItem("gameType");
      localStorage.removeItem("gameMode");
    }
  }, [user, appState]);

  // Check for saved game state when user connects - only show if not currently in a game
  useEffect(() => {
    if (isConnected && user && savedGameState && appState !== "game") {
      // Only show reconnect dialog if we're not currently in a game
      setShowReconnectDialog(true);
    } else if (appState === "game") {
      // If we're in a game, don't show reconnect dialog
      setShowReconnectDialog(false);
    }
  }, [isConnected, user, savedGameState, appState]);

  // Check for stored Toast messages from reconnection failures or room deletions
  useEffect(() => {
    // Check for room deletion message
    const roomDeletionMessage = localStorage.getItem("roomDeletionMessage");
    if (roomDeletionMessage) {
      addToast(roomDeletionMessage, "error");
      localStorage.removeItem("roomDeletionMessage");
    }

    // Check for reconnection failure reason
    const reconnectFailureReason = localStorage.getItem(
      "reconnectFailureReason"
    );
    if (reconnectFailureReason) {
      let message = "Reconnection failed";
      switch (reconnectFailureReason) {
        case "permanentlyLeft":
          message = "Ne možete se vratiti u igru koju ste napustili.";
          break;
        case "roomDeleted":
          message = "Soba više ne postoji.";
          break;
        case "playerNotFound":
          message = "Niste dio ove igre.";
          break;
      }
      addToast(message, "warning");
      localStorage.removeItem("reconnectFailureReason");
    }
  }, [addToast]);

  const handleLogin = async (userData) => {
    await registerUser(userData);
    setAppState("gameSelect");
  };

  const handleGameTypeSelect = (type) => {
    setGameType(type);
    setAppState("modeSelect");
  };

  const handleModeSelect = (modeData) => {
    // Handle both string mode and object with akuze data
    const mode =
      typeof modeData === "string" ? modeData : modeData.gameMode || modeData;
    setGameMode(mode);

    if (mode === "custom") {
      setAppState("lobby");
    } else if (
      typeof modeData === "object" &&
      modeData.akuzeEnabled !== undefined
    ) {
      // AI mode with akuze settings - go directly to game
      setGameData({
        gameType: gameType,
        gameMode: "1vAI",
        akuzeEnabled: modeData.akuzeEnabled,
        opponent: { name: "AI Bot", isAI: true },
        gameState: {},
      });
      setAppState("game");
    } else {
      setAppState("matchmaking");
    }
  };

  const handleLobbyGameStart = (data) => {
    // Ensure we set the UI game mode based on the incoming game data
    // Server may include a explicit gameMode, otherwise infer from payload
    if (data?.gameMode) {
      setGameMode(data.gameMode);
    } else if (data?.players && data.players.length === 4) {
      setGameMode("2v2");
    } else if (data?.opponent) {
      setGameMode("1v1");
    }

    setGameData(data);
    setAppState("game");
  };

  const handleBackToLobby = () => {
    setAppState("lobby");
  };

  const handleGameStart = (data) => {
    // Matchmaking may not have set client-side gameMode; infer it here
    if (data?.gameMode) {
      setGameMode(data.gameMode);
    } else if (data?.players && data.players.length === 4) {
      setGameMode("2v2");
    } else if (data?.opponent) {
      setGameMode("1v1");
    }

    setGameData(data);
    setAppState("game");
  };

  const handleGameEnd = () => {
    setGameData(null);
    setAppState("modeSelect");
  };

  const handleBackToModeSelect = () => {
    setAppState("modeSelect");
  };

  const handleBackToGameSelect = () => {
    setAppState("gameSelect");
  };

  const handleBackToLogin = () => {
    // Only allow going back to login if user logs out
    logout();
    setAppState("login");
    // Clear saved states when explicitly logging out
    localStorage.removeItem("appState");
    localStorage.removeItem("gameType");
    localStorage.removeItem("gameMode");
  };

  const handleLogout = async () => {
    await logout();
    // Clear saved states when logging out
    localStorage.removeItem("appState");
    localStorage.removeItem("gameType");
    localStorage.removeItem("gameMode");
    // useEffect će automatski prebaciti na login state
  };

  const handleReconnectToGame = async () => {
    try {
      const result = await reconnectToGame();
      if (result.success) {
        setGameData(result);
        setGameType(result.gameType);
        setGameMode(result.gameMode);
        setAppState("game");
        setShowReconnectDialog(false);
      }
    } catch (error) {
      console.error("Reconnection failed:", error);
      // Dialog će pokazati grešku, ne zatvaramo ga
    }
  };

  const handleDismissReconnect = () => {
    clearGameState();
    setShowReconnectDialog(false);
    // Reset sve i vrati na game select
    setGameData(null);
    setGameType(null);
    setGameMode("1v1");
    setAppState("gameSelect");
  };

  if (connectionError) {
    return (
      <div className="connection-error">
        <h2>❌ Greška konekcije</h2>
        <p>{connectionError}</p>
        <p>Molimo provjerite internetsku vezu i pokušajte ponovno</p>
        <button onClick={() => window.location.reload()}>
          🔄 Pokušaj ponovno
        </button>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <h2>Spajanje na server...</h2>
        <p>Molimo pričekajte</p>
      </div>
    );
  }

  switch (appState) {
    case "login":
      return (
        <>
          <Login onLogin={handleLogin} />
          {showReconnectDialog && (
            <ReconnectDialog
              gameState={savedGameState}
              onReconnect={handleReconnectToGame}
              onDismiss={handleDismissReconnect}
            />
          )}
        </>
      );

    case "gameSelect":
      return (
        <>
          <UserHeader user={user} onLogout={handleLogout} />
          <GameTypeSelector onGameTypeSelect={handleGameTypeSelect} />
          {showReconnectDialog && (
            <ReconnectDialog
              gameState={savedGameState}
              onReconnect={handleReconnectToGame}
              onDismiss={handleDismissReconnect}
            />
          )}
        </>
      );

    case "modeSelect":
      return (
        <>
          <UserHeader user={user} onLogout={handleLogout} />
          <GameModeSelector
            onModeSelect={(modeData) => {
              console.log("[App.jsx] Mode selected:", modeData);
              if (modeData.gameMode === "1vAI") {
                // 👉 Direktno u Game (bez matchmakinga)
                const aiGameData = {
                  gameMode: "1vAI",
                  opponent: { name: "AI Bot", isAI: true },
                  gameType: gameType, // preuzima odabran tip (briskula/treseta)
                  gameState: {}, // Game.jsx sam generira špil
                  // Include akuze setting from modeData
                  ...(modeData.akuzeEnabled !== undefined && { akuzeEnabled: modeData.akuzeEnabled }),
                };

                console.log("[App.jsx] AI Game Data:", aiGameData);
                setGameData(aiGameData);
                setGameMode("1vAI");
                setAppState("game");
              } else {
                // 👉 Sve ostalo ide normalno
                handleModeSelect(modeData);
              }
            }}
            onBack={handleBackToGameSelect}
            gameType={gameType}
          />

          {showReconnectDialog && (
            <ReconnectDialog
              gameState={savedGameState}
              onReconnect={handleReconnectToGame}
              onDismiss={handleDismissReconnect}
            />
          )}
        </>
      );

    case "lobby":
      return (
        <>
          <UserHeader user={user} onLogout={handleLogout} />
          <GameLobby
            onGameStart={handleLobbyGameStart}
            gameType={gameType}
            onBack={handleBackToModeSelect}
          />
          {showReconnectDialog && (
            <ReconnectDialog
              gameState={savedGameState}
              onReconnect={handleReconnectToGame}
              onDismiss={handleDismissReconnect}
            />
          )}
        </>
      );

    case "game":
      return (
        <>
          {gameMode === "2v2" ? (
            <Game2v2 gameData={gameData} onGameEnd={handleGameEnd} />
          ) : (
            <Game gameData={gameData} onGameEnd={handleGameEnd} />
          )}
        </>
      );

    default:
      return (
        <>
          <Login onLogin={handleLogin} />
          {showReconnectDialog && (
            <ReconnectDialog
              gameState={savedGameState}
              onReconnect={handleReconnectToGame}
              onDismiss={handleDismissReconnect}
            />
          )}
        </>
      );
  }
}

function App() {
  return (
    <ToastProvider>
      <SocketProvider>
        <div className="App">
          <AppContent />
        </div>
      </SocketProvider>
    </ToastProvider>
  );
}

export default App;
