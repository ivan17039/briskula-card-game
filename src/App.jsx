"use client";

import { useState, useEffect } from "react";
import { SocketProvider, useSocket } from "./SocketContext";
import { ToastProvider, useToast } from "./ToastProvider";
import Login from "./Login";
import GameTypeSelector from "./GameTypeSelector";
import GameModeSelector from "./GameModeSelector";
import GameLobby from "./GameLobby";
import Matchmaking from "./Matchmaking";
import Game from "./Game";
import Game2v2 from "./Game2v2";
import ReconnectDialog from "./ReconnectDialog";
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

  // Check if user is already logged in when component mounts
  useEffect(() => {
    if (user && appState === "login") {
      setAppState("gameSelect");
    } else if (!user && appState !== "login") {
      // If user is logged out, go back to login
      setAppState("login");
      setGameData(null);
      setGameType(null);
      setGameMode("1v1");
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

  const handleModeSelect = (mode) => {
    setGameMode(mode);
    if (mode === "custom") {
      setAppState("lobby");
    } else {
      setAppState("matchmaking");
    }
  };

  const handleLobbyGameStart = (data) => {
    setGameData(data);
    setAppState("game");
  };

  const handleBackToLobby = () => {
    setAppState("lobby");
  };

  const handleGameStart = (data) => {
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
  };

  const handleLogout = async () => {
    await logout();
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
          <GameTypeSelector
            onGameTypeSelect={handleGameTypeSelect}
            onLogout={handleLogout}
            user={user}
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

    case "modeSelect":
      return (
        <>
          <GameModeSelector
            onModeSelect={(modeData) => {
              if (modeData.gameMode === "1vAI") {
                // 👉 Direktno u Game (bez matchmakinga)
                const aiGameData = {
                  gameMode: "1vAI",
                  opponent: { name: "AI Bot", isAI: true },
                  gameType: gameType, // preuzima odabran tip (briskula/treseta)
                  gameState: {}, // Game.jsx sam generira špil
                };

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

    case "matchmaking":
      return (
        <>
          <Matchmaking
            onGameStart={handleGameStart}
            gameMode={gameMode}
            gameType={gameType}
            onBackToModeSelect={handleBackToModeSelect}
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
      return gameMode === "2v2" ? (
        <Game2v2 gameData={gameData} onGameEnd={handleGameEnd} />
      ) : (
        <Game gameData={gameData} onGameEnd={handleGameEnd} />
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
