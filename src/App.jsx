"use client";

import { useState, useEffect } from "react";
import { SocketProvider, useSocket } from "./SocketContext";
import { ToastProvider, useToast } from "./ToastProvider";
import Login from "./Login";
import GameTypeSelector from "./GameTypeSelector";
import GameModeSelector from "./GameModeSelector";
import GameLobby from "./GameLobby";
import TournamentLobby from "./TournamentLobby";
import Game from "./Game";
import Game2v2 from "./Game2v2";
import ReconnectDialog from "./ReconnectDialog";
import Header from "./Header";
import Leaderboard from "./Leaderboard";
import Footer from "./Footer";
import BugReportModal from "./BugReportModal";
import AboutModal from "./AboutModal";
import PrivacyModal from "./PrivacyModal";
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
  const [showBugReportModal, setShowBugReportModal] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [pendingJoinCode, setPendingJoinCode] = useState(null);

  // Check for join code in URL on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const joinCode = urlParams.get("join");

    if (joinCode && joinCode.length === 6) {
      console.log("🔗 Detected join code in URL:", joinCode);
      // Store the join code
      setPendingJoinCode(joinCode.toUpperCase());
      localStorage.setItem("pendingJoinCode", joinCode.toUpperCase());
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    } else {
      // Check if there's a stored pending join code
      const storedCode = localStorage.getItem("pendingJoinCode");
      if (storedCode) {
        setPendingJoinCode(storedCode);
      }
    }
  }, []);

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
        hasSavedGameState: !!savedGameState,
      });

      // Priority: savedGameState > localStorage for gameMode
      let finalGameMode = savedGameState?.gameMode || savedGameMode;
      let finalGameType = savedGameState?.gameType || savedGameType;

      if (finalGameType) {
        setGameType(finalGameType);
      }

      if (finalGameMode) {
        setGameMode(finalGameMode);
      }

      // If we have saved game state, restore directly to game
      if (savedGameState) {
        // Don't restore if the saved state is from a finished game
        if (
          savedGameState.gamePhase === "finished" ||
          savedGameState.gamePhase === "partidaFinished" ||
          savedGameState.gameInterrupted
        ) {
          console.log(
            "⚠️ [App] Saved game state is finished, clearing and going to gameSelect",
          );
          clearGameState();
          localStorage.removeItem("reconnectFailureReason");
          setAppState("gameSelect");
        } else {
          console.log(
            "🔄 Restoring game state from localStorage:",
            savedGameState,
          );
          setGameData(savedGameState);
          setAppState("game");
        }
      } else if (savedAppState && savedAppState !== "login") {
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
  }, [user, appState, savedGameState]);

  // Check for saved game state when user connects - only show if not currently in a game
  useEffect(() => {
    if (isConnected && user && savedGameState) {
      // Don't show reconnect dialog for finished games
      if (
        savedGameState.gamePhase === "finished" ||
        savedGameState.gamePhase === "partidaFinished" ||
        savedGameState.gameInterrupted
      ) {
        console.log(
          "⚠️ [App] Saved game is finished, clearing and not showing reconnect dialog",
        );
        clearGameState();
        localStorage.removeItem("reconnectFailureReason");
        setShowReconnectDialog(false);
        return;
      }

      if (appState === "game") {
        // If we're already in game state (from automatic restore), don't show reconnect dialog
        setShowReconnectDialog(false);
      } else if (appState !== "game") {
        // Only show reconnect dialog if we're not in a game and haven't auto-restored
        setShowReconnectDialog(true);
      }
    } else if (appState === "game") {
      // If we're in a game, don't show reconnect dialog
      setShowReconnectDialog(false);
    }
  }, [isConnected, user, savedGameState, appState, clearGameState]);

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
      "reconnectFailureReason",
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
    const response = await registerUser(userData);

    // Check if server found an existing game to reconnect to
    if (response.gameData) {
      console.log(
        "🎮 Server found existing game during registration:",
        response.gameData,
      );
      setGameData(response.gameData);
      setGameType(response.gameData.gameType);
      setGameMode(response.gameData.gameMode);
      setAppState("game");
      return; // Skip join code handling if reconnecting to existing game
    }

    // Check if there's a pending join code after login
    if (pendingJoinCode) {
      console.log(
        "🔑 Processing pending join code after login:",
        pendingJoinCode,
      );
      // We don't know the game type yet, so go to game selection first
      // The GameLobby will handle the auto-join
      setAppState("gameSelect");
      // Don't clear the pending code yet - GameLobby will need it
    } else {
      setAppState("gameSelect");
    }
  };

  const handleClearPendingJoinCode = () => {
    console.log("🧹 Clearing pending join code");
    setPendingJoinCode(null);
    localStorage.removeItem("pendingJoinCode");
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
    } else if (mode === "tournament") {
      setAppState("tournament-lobby");
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
    // Preserve tournament metadata if present
    setGameData({ ...data });
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
    setGameData({ ...data });
    setAppState("game");
  };

  const handleGameEnd = () => {
    setGameData(null);
    setAppState("modeSelect");
  };

  const handleBackToModeSelect = () => {
    setAppState("modeSelect");
  };

  // Listen for global tournament exit event (emitted from bracket)
  useEffect(() => {
    const handler = () => {
      localStorage.removeItem("tournamentView");
      setAppState("modeSelect");
    };
    window.addEventListener("tournamentExit", handler);
    return () => window.removeEventListener("tournamentExit", handler);
  }, []);

  const handleBackToGameSelect = () => {
    setAppState("gameSelect");
  };

  const handleOpenLeaderboard = () => {
    setAppState("leaderboard");
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
    localStorage.removeItem("pendingJoinCode");
    setPendingJoinCode(null);
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
          <Header onBugReport={() => setShowBugReportModal(true)} />
          <Login onLogin={handleLogin} pendingJoinCode={pendingJoinCode} />
          <Footer
            onBugReport={() => setShowBugReportModal(true)}
            onAbout={() => setShowAboutModal(true)}
            onPrivacy={() => setShowPrivacyModal(true)}
          />
          {showReconnectDialog && (
            <ReconnectDialog
              gameState={savedGameState}
              onReconnect={handleReconnectToGame}
              onDismiss={handleDismissReconnect}
            />
          )}
          {showBugReportModal && (
            <BugReportModal onClose={() => setShowBugReportModal(false)} />
          )}
          {showAboutModal && (
            <AboutModal onClose={() => setShowAboutModal(false)} />
          )}
          {showPrivacyModal && (
            <PrivacyModal onClose={() => setShowPrivacyModal(false)} />
          )}
        </>
      );

    case "gameSelect":
      return (
        <>
          <Header
            user={user}
            onLogout={handleLogout}
            onLeaderboard={handleOpenLeaderboard}
            onBugReport={() => setShowBugReportModal(true)}
          />
          <GameTypeSelector
            onGameTypeSelect={handleGameTypeSelect}
            pendingJoinCode={pendingJoinCode}
          />
          <Footer
            onBugReport={() => setShowBugReportModal(true)}
            onAbout={() => setShowAboutModal(true)}
            onPrivacy={() => setShowPrivacyModal(true)}
          />
          {showReconnectDialog && (
            <ReconnectDialog
              gameState={savedGameState}
              onReconnect={handleReconnectToGame}
              onDismiss={handleDismissReconnect}
            />
          )}
          {showBugReportModal && (
            <BugReportModal onClose={() => setShowBugReportModal(false)} />
          )}
          {showAboutModal && (
            <AboutModal onClose={() => setShowAboutModal(false)} />
          )}
          {showPrivacyModal && (
            <PrivacyModal onClose={() => setShowPrivacyModal(false)} />
          )}
        </>
      );

    case "modeSelect":
      return (
        <>
          <Header
            user={user}
            onLogout={handleLogout}
            onLeaderboard={handleOpenLeaderboard}
            onBugReport={() => setShowBugReportModal(true)}
          />
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
                  ...(modeData.akuzeEnabled !== undefined && {
                    akuzeEnabled: modeData.akuzeEnabled,
                  }),
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

          <Footer
            onBugReport={() => setShowBugReportModal(true)}
            onAbout={() => setShowAboutModal(true)}
            onPrivacy={() => setShowPrivacyModal(true)}
          />

          {showReconnectDialog && (
            <ReconnectDialog
              gameState={savedGameState}
              onReconnect={handleReconnectToGame}
              onDismiss={handleDismissReconnect}
            />
          )}
          {showBugReportModal && (
            <BugReportModal onClose={() => setShowBugReportModal(false)} />
          )}
          {showAboutModal && (
            <AboutModal onClose={() => setShowAboutModal(false)} />
          )}
          {showPrivacyModal && (
            <PrivacyModal onClose={() => setShowPrivacyModal(false)} />
          )}
        </>
      );

    case "lobby":
      return (
        <>
          <Header
            user={user}
            onLogout={handleLogout}
            onLeaderboard={handleOpenLeaderboard}
            onBugReport={() => setShowBugReportModal(true)}
          />
          <GameLobby
            onGameStart={handleLobbyGameStart}
            gameType={gameType}
            onBack={handleBackToModeSelect}
            clearPendingJoinCode={handleClearPendingJoinCode}
          />
          <Footer
            onBugReport={() => setShowBugReportModal(true)}
            onAbout={() => setShowAboutModal(true)}
            onPrivacy={() => setShowPrivacyModal(true)}
          />
          {showReconnectDialog && (
            <ReconnectDialog
              gameState={savedGameState}
              onReconnect={handleReconnectToGame}
              onDismiss={handleDismissReconnect}
            />
          )}
          {showBugReportModal && (
            <BugReportModal onClose={() => setShowBugReportModal(false)} />
          )}
          {showAboutModal && (
            <AboutModal onClose={() => setShowAboutModal(false)} />
          )}
          {showPrivacyModal && (
            <PrivacyModal onClose={() => setShowPrivacyModal(false)} />
          )}
        </>
      );

    case "tournament-lobby":
      return (
        <>
          <Header
            user={user}
            onLogout={handleLogout}
            onLeaderboard={handleOpenLeaderboard}
            onBugReport={() => setShowBugReportModal(true)}
          />
          <TournamentLobby
            gameType={gameType || "treseta"} // Default to treseta if gameType is null
            onBack={handleBackToModeSelect}
            onGameStart={handleLobbyGameStart}
            // signal parent for mode select exit
            onExitModeSelect={handleBackToModeSelect}
          />
          <Footer
            onBugReport={() => setShowBugReportModal(true)}
            onAbout={() => setShowAboutModal(true)}
            onPrivacy={() => setShowPrivacyModal(true)}
          />
          {showReconnectDialog && (
            <ReconnectDialog
              gameState={savedGameState}
              onReconnect={handleReconnectToGame}
              onDismiss={handleDismissReconnect}
            />
          )}
          {showAboutModal && (
            <AboutModal onClose={() => setShowAboutModal(false)} />
          )}
          {showPrivacyModal && (
            <PrivacyModal onClose={() => setShowPrivacyModal(false)} />
          )}
        </>
      );

    case "leaderboard":
      return (
        <>
          <Leaderboard
            onBack={handleBackToGameSelect}
            onLogout={handleLogout}
            onBugReport={() => setShowBugReportModal(true)}
          />
          <Footer
            onBugReport={() => setShowBugReportModal(true)}
            onAbout={() => setShowAboutModal(true)}
            onPrivacy={() => setShowPrivacyModal(true)}
          />
          {showBugReportModal && (
            <BugReportModal onClose={() => setShowBugReportModal(false)} />
          )}
          {showAboutModal && (
            <AboutModal onClose={() => setShowAboutModal(false)} />
          )}
          {showPrivacyModal && (
            <PrivacyModal onClose={() => setShowPrivacyModal(false)} />
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
          <Login onLogin={handleLogin} pendingJoinCode={pendingJoinCode} />
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
