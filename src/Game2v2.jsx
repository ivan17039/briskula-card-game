"use client";

import { useState, useEffect, useRef } from "react";
import Card from "./Card";
import { useSocket } from "./SocketContext";
import { useToast } from "./ToastProvider";
import { checkAkuze } from "../core/tresetaCommon.js";
import "./Game.css";
import "./Card.css";
import "./Game2v2.css";

function calculatePoints(cards) {
  return cards.reduce((total, card) => total + (card.points || 0), 0);
}

/**
 * Vraća pravilnu riječ za broj karata u hrvatskom jeziku
 * @param {number} count - Broj karata
 * @returns {string} - Pravilna riječ (karta/karte/karata)
 */
function getCardCountText(count) {
  if (count === 1) {
    return `${count} karta`;
  } else if (count >= 2 && count <= 4) {
    return `${count} karte`;
  } else {
    return `${count} karata`;
  }
}

/**
 * Sortira karte po boji i jačini i grupiraj po bojama
 * @param {Array} cards - Array karata za sortiranje
 * @param {string} gameType - Tip igre (briskula ili treseta)
 * @returns {Array} - Sortirane karte s dodatnim gap-om između boja
 */
function sortCards(cards, gameType = "briskula") {
  if (!cards || cards.length === 0) return cards;

  // Definiranje redoslijeda boja (Kupe, Bati, Spadi, Dinari)
  const suitOrder = { Kupe: 1, Bati: 2, Spadi: 3, Dinari: 4 };

  // Definiranje jačine karata ovisno o tipu igre
  const getCardStrength = (card) => {
    if (gameType === "treseta") {
      // Trešeta: Trica > Duja > As > Kralj > Konj > Fanat > 7 > 6 > 5 > 4
      const tresetaStrength = {
        3: 10, // Trica - najjača
        2: 9, // Duja
        1: 8, // As
        13: 7, // Kralj
        12: 6, // Konj
        11: 5, // Fanat
        7: 4, // 7
        6: 3, // 6
        5: 2, // 5
        4: 1, // 4 - najslabija
      };
      return tresetaStrength[card.value] || 0;
    } else {
      // Briskula: As > Trica > Kralj > Konj > Fanat > 7 > 6 > 5 > 4 > Duja
      const briskulaStrength = {
        1: 10, // As - najjači
        3: 9, // Trica
        13: 8, // Kralj
        12: 7, // Konj
        11: 6, // Fanat
        7: 5, // 7
        6: 4, // 6
        5: 3, // 5
        4: 2, // 4
        2: 1, // Duja - najslabija
      };
      return briskulaStrength[card.value] || 0;
    }
  };

  return [...cards].sort((a, b) => {
    // Prvo sortiraj po boji
    const suitComparison = suitOrder[a.suit] - suitOrder[b.suit];
    if (suitComparison !== 0) {
      return suitComparison;
    }

    // Ako su iste boje, sortiraj po jačini (od najjače prema najslabijoj)
    return getCardStrength(b) - getCardStrength(a);
  });
}

function Game2v2({ gameData, onGameEnd }) {
  const {
    socket,
    user,
    playCard,
    leaveRoom,
    leaveRoomPermanently,
    findMatch,
    saveGameState,
    clearGameState,
    savedGameState,
  } = useSocket();

  const { addToast } = useToast();

  // Add state to prevent rapid card clicking
  const [isCardPlaying, setIsCardPlaying] = useState(false);

  // State for disconnection handling
  const [playerDisconnected, setPlayerDisconnected] = useState(false);
  const [disconnectionInfo, setDisconnectionInfo] = useState(null);
  const [graceTimeLeft, setGraceTimeLeft] = useState(0);

  const initializeGameState = () => {
    if (!gameData) return null;

    console.log("🎮 Game2v2 gameData:", gameData);
    console.log("🎯 MyTeam from gameData:", gameData.myTeam);

    const myPlayerNumber = gameData.playerNumber;

    // Try multiple sources for myHand - server might send it in different places
    const myHand =
      gameData.gameState?.myHand || // From server reconnection
      gameData.gameState?.[`player${myPlayerNumber}Hand`] || // Direct player hand
      gameData.myHand || // Sometimes at root level
      [];

    // Try multiple sources for myTeam
    const myTeam =
      gameData.myTeam || // Direct from server
      gameData.gameState?.myTeam || // Nested in gameState
      gameData.players?.find((p) => p.playerNumber === myPlayerNumber)?.team; // Extract from players

    console.log("🃏 Resolved myHand:", myHand?.length || 0, "cards");
    console.log("🎯 Resolved myTeam:", myTeam);

    // Ensure all hands exist and have proper fallbacks
    const player1Hand = gameData.gameState.player1Hand || [];
    const player2Hand = gameData.gameState.player2Hand || [];
    const player3Hand = gameData.gameState.player3Hand || [];
    const player4Hand = gameData.gameState.player4Hand || [];

    return {
      roomId: gameData.roomId,
      playerNumber: myPlayerNumber,
      myTeam: myTeam,
      players: gameData.players,
      gameType: gameData.gameType || "briskula", // Dodaj gameType

      // Debug log
      ...(console.log(
        "🎯 Game2v2 inicijaliziran sa gameType:",
        gameData.gameType,
        "| myTeam:",
        myTeam,
        "| playerNumber:",
        myPlayerNumber,
        "| myHand cards:",
        myHand?.length || 0,
      ) || {}),
      myHand: myHand,
      playedCards: [],
      trump: gameData.gameState.trump,
      currentPlayer: gameData.gameState.currentPlayer,
      gamePhase: "playing",
      winner: null,
      message:
        gameData.gameState.currentPlayer === myPlayerNumber
          ? "Vaš red! Odaberite kartu za igranje."
          : "Čekajte svoj red...",
      remainingCardsCount: gameData.gameState.remainingDeck?.length || 0,
      team1Cards: [],
      team2Cards: [],
      // Dodaj bodove za Trešetu
      team1Points: 0,
      team2Points: 0,
      handCounts: {
        player1: player1Hand.length,
        player2: player2Hand.length,
        player3: player3Hand.length,
        player4: player4Hand.length,
      },
      // Dodaj playableCards za Trešetu
      playableCards: gameData.gameState.playableCards || [],

      // Long-term scoring for Treseta (similar to 1v1)
      ...(gameData.gameType === "treseta" && {
        totalTeam1Points: gameData.gameState.totalTeam1Points || 0,
        totalTeam2Points: gameData.gameState.totalTeam2Points || 0,
        currentPartija: gameData.gameState.currentPartija || 1,
        targetScore: gameData.gameState.targetScore || 31,
        partijas: gameData.gameState.partijas || [],
      }),

      // Akuže support for Treseta
      ...(gameData.gameType === "treseta" && {
        akuzeEnabled:
          gameData.akuzeEnabled !== undefined ? gameData.akuzeEnabled : true,
        myAkuze: [],
        team1Akuze: gameData.gameState.team1Akuze || [],
        team2Akuze: gameData.gameState.team2Akuze || [],
        canAkuze:
          gameData.akuzeEnabled !== undefined ? gameData.akuzeEnabled : true,
        hasPlayedFirstRound: gameData.gameState.hasPlayedFirstRound || false, // Track if first round completed for akuze restrictions
      }),
    };
  };

  const [gameState, setGameState] = useState(initializeGameState);
  const [showScores, setShowScores] = useState(false);
  const [showAkuzeModal, setShowAkuzeModal] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // State for next partija continuation (like in 1v1)
  const [nextPartidaStatus, setNextPartidaStatus] = useState({
    playerReady: false,
    readyPlayers: [],
    waitingFor: 0,
  });

  // ELO changes after game ends
  const [eloChanges, setEloChanges] = useState(null);

  // Handle game state restoration from SocketContext (similar to Game.jsx)
  useEffect(() => {
    if (savedGameState && !gameData) {
      console.log(
        "🔄 [Game2v2] Restoring game state from SocketContext:",
        savedGameState,
      );
      console.log(
        "🃏 [Game2v2] Saved myHand:",
        savedGameState.gameState?.myHand?.length || 0,
        "cards",
      );

      // For 2v2 games, reconstruct the state with proper team information
      const restoredState = {
        roomId: savedGameState.roomId,
        playerNumber: savedGameState.playerNumber,
        myTeam: savedGameState.myTeam,
        players: savedGameState.players,
        teammates: savedGameState.teammates,
        opponents: savedGameState.opponents,
        gameType: savedGameState.gameType,
        myHand: savedGameState.gameState?.myHand || [],
        playedCards: savedGameState.gameState?.playedCards || [],
        trump: savedGameState.gameState?.trump,
        currentPlayer: savedGameState.gameState?.currentPlayer,
        gamePhase: savedGameState.gameState?.gamePhase || "playing",
        winner: savedGameState.gameState?.winner,
        message: savedGameState.gameState?.message || "Igra je u tijeku...",
        remainingCardsCount: savedGameState.gameState?.remainingCardsCount || 0,
        team1Cards: savedGameState.gameState?.team1Cards || [],
        team2Cards: savedGameState.gameState?.team2Cards || [],
        team1Points: savedGameState.gameState?.team1Points || 0,
        team2Points: savedGameState.gameState?.team2Points || 0,
        handCounts: savedGameState.gameState?.handCounts || {
          player1: 0,
          player2: 0,
          player3: 0,
          player4: 0,
        },
        playableCards: savedGameState.gameState?.playableCards || [],

        // Treseta specific properties
        ...(savedGameState.gameType === "treseta" && {
          totalTeam1Points: savedGameState.gameState?.totalTeam1Points || 0,
          totalTeam2Points: savedGameState.gameState?.totalTeam2Points || 0,
          currentPartija: savedGameState.gameState?.currentPartija || 1,
          targetScore: savedGameState.gameState?.targetScore || 31,
          partijas: savedGameState.gameState?.partijas || [],
          akuzeEnabled:
            savedGameState.akuzeEnabled !== undefined
              ? savedGameState.akuzeEnabled
              : true,
          myAkuze: savedGameState.gameState?.myAkuze || [],
          team1Akuze: savedGameState.gameState?.team1Akuze || [],
          team2Akuze: savedGameState.gameState?.team2Akuze || [],
          canAkuze:
            savedGameState.akuzeEnabled !== undefined
              ? savedGameState.akuzeEnabled
              : true,
          hasPlayedFirstRound:
            savedGameState.gameState?.hasPlayedFirstRound || false,
        }),
      };

      console.log(
        "🎯 [Game2v2] About to restore state with myHand:",
        restoredState.myHand?.length || 0,
        "cards",
      );
      setGameState(restoredState);
      console.log("✅ [Game2v2] Game state restored from SocketContext");
    }
  }, [savedGameState, gameData]);

  // Save game state to database when it changes (same as Game.jsx)
  useEffect(() => {
    if (gameState && gameState.roomId && gameState?.gamePhase === "playing") {
      const timeoutId = setTimeout(() => {
        saveGameState({
          ...gameState,
          roomId: gameState.roomId,
          gameMode: gameData?.gameMode || "2v2",
          gameType: gameState.gameType,
          playerNumber: gameState.playerNumber,
          gameState: {
            ...gameState,
            playableCards: gameState.playableCards,
          },
        });
      }, 1000); // Debounce saving to prevent too frequent calls

      return () => clearTimeout(timeoutId);
    }
  }, [gameState, gameData]); // Removed saveGameState from dependencies

  // Function to get relative position for cross layout
  const getRelativePosition = (cardPlayerNumber, myPlayerNumber) => {
    // Map actual player positions relative to current player
    const relativePositions = {
      1: { 1: "bottom", 2: "left", 3: "top", 4: "right" },
      2: { 1: "right", 2: "bottom", 3: "left", 4: "top" },
      3: { 1: "top", 2: "right", 3: "bottom", 4: "left" },
      4: { 1: "left", 2: "top", 3: "right", 4: "bottom" },
    };

    return relativePositions[myPlayerNumber]?.[cardPlayerNumber] || "center";
  };

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (!socket || !gameState?.roomId) return;

    socket.on("cardPlayed", (data) => {
      // Don't reset isCardPlaying here - wait until round finishes to prevent rapid clicking

      setGameState((prev) => {
        const newMyHand =
          data.playerNumber === prev.playerNumber
            ? prev.myHand.filter((c) => c.id !== data.card.id)
            : prev.myHand;

        return {
          ...prev,
          playedCards: data.playedCards,
          myHand: newMyHand,
          handCounts: {
            ...prev.handCounts,
            [`player${data.playerNumber}`]: Math.max(
              0,
              prev.handCounts[`player${data.playerNumber}`] - 1,
            ),
          },
          message:
            data.playerNumber === prev.playerNumber
              ? "Čekamo ostale igrače..."
              : `${data.playerName} je odigrao kartu.`,
        };
      });
    });

    socket.on("turnChange", (data) => {
      setGameState((prev) => ({
        ...prev,
        currentPlayer: data.currentPlayer,
        message:
          data.currentPlayer === prev.playerNumber
            ? "Vaš red! Odaberite kartu."
            : `Red igrača ${data.currentPlayerName}.`,
      }));
    });

    socket.on("roundFinished", (data) => {
      console.log("🎮 [2v2] Round finished data:", data);
      console.log("🎮 [2v2] Game end info:", data.gameEnd);

      setGameState((prev) => {
        console.log("🎯 [2v2] prev.myTeam:", prev.myTeam);
        console.log("🎯 [2v2] prev.playerNumber:", prev.playerNumber);

        // Fallback - calculate myTeam from playerNumber if it's undefined
        const myTeam =
          prev.myTeam ||
          (prev.playerNumber === 1 || prev.playerNumber === 3 ? 1 : 2);
        console.log("🎯 [2v2] Calculated myTeam:", myTeam);

        const newMyHand = data[`player${prev.playerNumber}Hand`];
        const useTreseta = prev.gameType === "treseta";
        const newState = {
          ...prev,
          myHand: newMyHand,
          trump: data.trump,
          team1Cards: data.team1Cards,
          team2Cards: data.team2Cards,
          playedCards: [],
          currentPlayer: data.currentPlayer,
          remainingCardsCount: data.remainingCards,
          handCounts: {
            player1: data.player1Hand?.length || prev.handCounts.player1 || 0,
            player2: data.player2Hand?.length || prev.handCounts.player2 || 0,
            player3: data.player3Hand?.length || prev.handCounts.player3 || 0,
            player4: data.player4Hand?.length || prev.handCounts.player4 || 0,
          },
          // Dodaj Trešeta specifične podatke
          playableCards:
            prev.gameType === "treseta"
              ? data[`player${prev.playerNumber}PlayableCards`] || []
              : prev.playableCards,
          team1Points:
            prev.gameType === "treseta" && data.team1Points
              ? data.team1Points.points
              : prev.team1Points,
          team2Points:
            prev.gameType === "treseta" && data.team2Points
              ? data.team2Points.points
              : prev.team2Points,
        };

        // Handle Treseta long-term scoring (similar to 1v1)
        if (
          useTreseta &&
          (data.gameEnd.isPartidaOver || data.gameEnd.isGameOver)
        ) {
          // Calculate akuže points for each team
          const team1AkuzePoints = (prev.team1Akuze || []).reduce(
            (sum, akuz) => sum + akuz.points,
            0,
          );
          const team2AkuzePoints = (prev.team2Akuze || []).reduce(
            (sum, akuz) => sum + akuz.points,
            0,
          );

          // Add akuže points to the final partija score
          const team1PartidaPoints =
            (newState.team1Points || 0) + team1AkuzePoints;
          const team2PartidaPoints =
            (newState.team2Points || 0) + team2AkuzePoints;

          // Add current partija results to partijas history (including akuže)
          const newPartijas = [
            ...(prev.partijas || []),
            {
              partija: prev.currentPartija || 1,
              team1Points: team1PartidaPoints,
              team2Points: team2PartidaPoints,
              winner:
                team1PartidaPoints > team2PartidaPoints
                  ? 1
                  : team2PartidaPoints > team1PartidaPoints
                    ? 2
                    : 0, // 0 for tie
            },
          ];

          // Update total points (including akuže)
          const newTotalTeam1Points =
            (prev.totalTeam1Points || 0) + team1PartidaPoints;
          const newTotalTeam2Points =
            (prev.totalTeam2Points || 0) + team2PartidaPoints;

          newState.partijas = newPartijas;
          newState.totalTeam1Points = newTotalTeam1Points;
          newState.totalTeam2Points = newTotalTeam2Points;
          newState.currentPartija = (prev.currentPartija || 1) + 1;
          newState.canAkuze = prev.akuzeEnabled; // Reset akuze based on settings
          newState.myTeam = myTeam; // Ensure myTeam is preserved

          // Check if game is truly over (reached target score)
          const targetScore = prev.targetScore || 31;
          if (
            newTotalTeam1Points >= targetScore ||
            newTotalTeam2Points >= targetScore
          ) {
            newState.gamePhase = "finished";

            // Determine the winning team
            const winningTeam = newTotalTeam1Points >= targetScore ? 1 : 2;
            newState.winner = winningTeam;

            // Clear saved game state when game ends
            clearGameState();

            console.log(
              `🏆 Game finished! Winning team: ${winningTeam}, My team: ${myTeam}`,
            );

            // Determine message based on winning team
            if (winningTeam === 1) {
              newState.message =
                myTeam === 1
                  ? `🎉 Vaš tim je pobijedio! (Dosegnuli ste ${targetScore} bodova)`
                  : "😔 Vaš tim je izgubio.";
            } else if (winningTeam === 2) {
              newState.message =
                myTeam === 2
                  ? `🎉 Vaš tim je pobijedio! (Dosegnuli ste ${targetScore} bodova)`
                  : "😔 Vaš tim je izgubio.";
            } else {
              newState.message = "🤝 Neriješeno!";
            }
          } else {
            // Partija finished but game continues
            newState.gamePhase = "partidaFinished";

            // Use partija points that include akuže for determining winner message
            const team1PartidaPoints =
              (newState.team1Points || 0) + team1AkuzePoints;
            const team2PartidaPoints =
              (newState.team2Points || 0) + team2AkuzePoints;

            console.log(
              `🏆 Partija finished! Team scores: ${team1PartidaPoints} - ${team2PartidaPoints}, My team: ${myTeam}`,
            );

            // Determine winner based on points
            if (team1PartidaPoints > team2PartidaPoints) {
              // Team 1 won
              newState.message =
                myTeam === 1
                  ? "🎉 Dobili ste ovu partiju!"
                  : "😔 Izgubili ste ovu partiju.";
            } else if (team2PartidaPoints > team1PartidaPoints) {
              // Team 2 won
              newState.message =
                myTeam === 2
                  ? "🎉 Dobili ste ovu partiju!"
                  : "😔 Izgubili ste ovu partiju.";
            } else {
              // Tie
              newState.message = "🤝 Partija neriješena!";
            }
          }
        } else if (data.gameEnd.isGameOver) {
          // Non-Treseta games or simple game over
          newState.gamePhase = "finished";
          newState.winner = data.gameEnd.winner;

          console.log(
            `🏆 Non-Treseta game finished! Server winner: ${data.gameEnd.winner}, My team: ${myTeam}`,
          );

          // Clear saved game state when game ends
          clearGameState();

          // Determine message based on winning team
          if (data.gameEnd.winner === 1) {
            newState.message =
              myTeam === 1
                ? "🎉 Vaš tim je pobijedio!"
                : "😔 Vaš tim je izgubio.";
          } else if (data.gameEnd.winner === 2) {
            newState.message =
              myTeam === 2
                ? "🎉 Vaš tim je pobijedio!"
                : "😔 Vaš tim je izgubio.";
          } else if (data.gameEnd.winner === null) {
            newState.message = `🤝 Neriješeno! (${data.gameEnd.reason || ""})`;
          } else {
            newState.message = "😔 Vaš tim je izgubio.";
          }
        } else {
          // Round finished, game continues
          newState.gamePhase = "playing";
          const winningTeam = data.roundWinningTeam;
          newState.message =
            winningTeam === myTeam
              ? "Vaš tim je uzeo rundu!"
              : "Protivnički tim je uzeo rundu.";
        }

        // Mark that first round has been completed - no more akuze allowed
        if (prev.gameType === "treseta") {
          newState.hasPlayedFirstRound = true;
        }

        // Always preserve myTeam in the new state
        newState.myTeam = myTeam;

        return newState;
      });
      // Reset the card playing flag when round finishes
      setIsCardPlaying(false);
      // Ne automatski preusmjeravaj na glavni ekran - neka igrač sam odluči
    });

    socket.on("playerDisconnected", (data) => {
      console.log("⚠️ Player disconnected:", data);
      // Reset card playing flag on disconnect
      setIsCardPlaying(false);

      if (data.canReconnect) {
        // Grace period - show banner, don't interrupt game
        setPlayerDisconnected(true);
        setDisconnectionInfo({
          graceEndsAt: data.graceEndsAt,
          message: data.message,
          canReconnect: data.canReconnect,
          graceMs: data.graceMs,
        });
        addToast(`${data.message}`, "info");
      } else {
        // No reconnect possible - interrupt game
        let displayMessage = data.message;
        if (data.gameMode === "2v2" && data.playerTeam) {
          displayMessage += `. Igra je prekinuta.`;
        }

        setGameState((prev) => ({
          ...prev,
          gamePhase: "finished",
          gameInterrupted: true,
          message: `${displayMessage} Kliknite 'Glavni meni' za povratak.`,
        }));
      }
    });

    socket.on("playerReconnected", (data) => {
      setPlayerDisconnected(false);
      setDisconnectionInfo(null);
      setGraceTimeLeft(0);
      addToast(`${data.message}`, "success");
    });

    // Handle permanent player disconnect
    socket.on("playerLeft", (data) => {
      console.log("❌ Player permanently left:", data);
      if (data.permanent) {
        // Reset card playing flag on permanent leave
        setIsCardPlaying(false);

        // Show permanent disconnect info
        setPlayerDisconnected(true);
        setDisconnectionInfo({
          message: data.message,
          canReconnect: false,
          permanent: true,
          reason: data.reason,
        });

        // Also interrupt the game state
        setGameState((prev) => ({
          ...prev,
          gamePhase: "finished",
          gameInterrupted: true,
          message: `${data.message} Igra je završena.`,
        }));

        addToast(data.message, "error");
      }
    });

    socket.on("playerLeft", (data) => {
      // Reset card playing flag on player leave
      setIsCardPlaying(false);

      if (data.permanent) {
        // Permanent leave - room will be deleted, clear state and redirect
        clearGameState();
        addToast(`${data.message} Vraćam vas na glavni meni.`, "warning");
        setTimeout(() => {
          onGameEnd();
        }, 2000);
      } else {
        // Temporary leave - game can continue with reconnection
        let displayMessage = data.message;
        if (data.gameMode === "2v2" && data.playerTeam) {
          displayMessage += ` Igra je prekinuta.`;
        }

        setGameState((prev) => ({
          ...prev,
          gamePhase: "finished",
          gameInterrupted: true,
          message: `${displayMessage} Kliknite 'Glavni meni' za povratak.`,
        }));
      }
    });

    // Handle room deletion
    socket.on("roomDeleted", (data) => {
      // Reset card playing flag when room is deleted
      setIsCardPlaying(false);

      clearGameState();
      addToast(data.message, "error");
      setTimeout(() => {
        onGameEnd();
      }, 2000);
    });

    // Handle reconnection failures
    socket.on("reconnectFailed", (data) => {
      clearGameState();
      let toastMessage = data.message;

      switch (data.reason) {
        case "permanentlyLeft":
          toastMessage = "Ne možete se vratiti u igru koju ste napustili.";
          break;
        case "roomDeleted":
          toastMessage = "Soba više ne postoji.";
          break;
        case "playerNotFound":
          toastMessage = "Niste dio ove igre.";
          break;
      }

      addToast(toastMessage, "error");
      setTimeout(() => {
        onGameEnd();
      }, 2000);
    });

    // Trešeta specific events
    socket.on("playableCardsUpdate", (data) => {
      if (gameState?.gameType === "treseta") {
        setGameState((prev) => ({
          ...prev,
          playableCards: data[`player${prev.playerNumber}PlayableCards`] || [],
        }));
      }
    });

    socket.on("invalidMove", (data) => {
      // Reset card playing flag on invalid move
      setIsCardPlaying(false);

      if (gameState?.gameType === "treseta") {
        addToast(`Neispavan potez: ${data.reason}`, "error");
      }
    });

    // Akuže announced by other players
    socket.on("akuzeAnnounced", (data) => {
      if (gameState?.gameType === "treseta") {
        console.log("[Akuze 2v2] Other player declared akuz:", data);

        // Show toast notification for other players' akuze
        if (data.playerNumber !== gameState?.playerNumber) {
          addToast(
            `${data.playerName} je akužao ${data.akuz.description} (+${data.akuz.points} bodova)`,
            "info",
          );
        }

        // Update team akuze tracking
        setGameState((prev) => ({
          ...prev,
          team1Akuze:
            data.team === 1
              ? [
                  ...(prev.team1Akuze || []),
                  { ...data.akuz, playerName: data.playerName },
                ]
              : prev.team1Akuze,
          team2Akuze:
            data.team === 2
              ? [
                  ...(prev.team2Akuze || []),
                  { ...data.akuz, playerName: data.playerName },
                ]
              : prev.team2Akuze,
        }));
      }
    });

    // New socket listener for partija restart in online Treseta games (like in 1v1)
    socket.on("partidaRestarted", (data) => {
      console.log("🔄 [2v2] Received partidaRestarted from server:", data);

      // Reset next partija status since new partija started
      setNextPartidaStatus({
        playerReady: false,
        readyPlayers: [],
        waitingFor: 0,
      });

      setGameState((prev) => ({
        ...prev,
        myHand: data[`player${prev.playerNumber}Hand`],
        team1Cards: [],
        team2Cards: [],
        playedCards: [],
        currentPlayer: data.currentPlayer || 1,
        gamePhase: "playing",
        remainingCardsCount: data.remainingCards || 40,
        team1Points: 0,
        team2Points: 0,
        playableCards:
          prev.gameType === "treseta"
            ? data[`player${prev.playerNumber}PlayableCards`] ||
              data[`player${prev.playerNumber}Hand`]?.map((c) => c.id) ||
              []
            : data[`player${prev.playerNumber}Hand`]?.map((c) => c.id) || [],
        canAkuze: prev.akuzeEnabled, // Reset based on settings
        myAkuze: [], // Reset akuze for new partija
        team1Akuze: [], // Reset akuze for new partija
        team2Akuze: [], // Reset akuze for new partija
        hasPlayedFirstRound: false, // Reset for new partija - allow akuze again
        handCounts: {
          player1: data.player1Hand?.length || 0,
          player2: data.player2Hand?.length || 0,
          player3: data.player3Hand?.length || 0,
          player4: data.player4Hand?.length || 0,
        },
        message:
          "Nova partija! " +
          (data.currentPlayer === prev.playerNumber
            ? "Vaš red."
            : "Čekajte svoj red."),
      }));
    });

    // Handle partija continuation status from server (like in 1v1)
    socket.on("partidaContinueStatus", (data) => {
      console.log("📊 [2v2] Received partidaContinueStatus:", data);
      setNextPartidaStatus({
        playerReady: data.isPlayerReady || false, // Use server's isPlayerReady flag
        readyPlayers: data.readyPlayers || [],
        waitingFor: data.waitingFor || 0,
      });
    });

    // Handle ELO updates after game ends
    socket.on("eloUpdate", (data) => {
      console.log("📊 [2v2] ELO update received:", data);
      setEloChanges(data);
    });

    // Handle rematch events
    socket.on("rematchAccepted", (data) => {
      console.log("🔄 [2v2] Rematch accepted - starting new game:", data);
      // Reset to initial game state with same players and teams
      setGameState(initializeGameState());
    });

    socket.on("rematchDeclined", (data) => {
      console.log("❌ [2v2] Rematch declined:", data);
      // Return to finished screen
      setGameState((prev) => ({
        ...prev,
        gamePhase: "finished",
        message: `Revanš je odbačen. ${data.reason || ""}`,
      }));
    });

    return () => {
      socket.off("cardPlayed");
      socket.off("turnChange");
      socket.off("roundFinished");
      socket.off("playerDisconnected");
      socket.off("playerReconnected");
      socket.off("playerLeft");
      socket.off("roomDeleted");
      socket.off("reconnectFailed");
      socket.off("playableCardsUpdate");
      socket.off("invalidMove");
      socket.off("akuzeAnnounced");
      socket.off("partidaRestarted");
      socket.off("partidaContinueStatus");
      socket.off("eloUpdate");
      socket.off("rematchAccepted");
      socket.off("rematchDeclined");
    };
  }, [socket, gameState?.roomId, onGameEnd]);

  const handleAkuze = (akuz) => {
    if (!gameState || !gameState.akuzeEnabled || !gameState.canAkuze) {
      console.log("[Akuze 2v2] Cannot akuze - disabled or already used:", {
        akuzeEnabled: gameState?.akuzeEnabled,
        canAkuze: gameState?.canAkuze,
      });
      return;
    }

    console.log("[Akuze 2v2] Player declared:", akuz);

    // Send to server
    if (socket) {
      socket.emit("akuze", {
        roomId: gameState.roomId,
        akuz: akuz,
      });
    }

    setGameState((prev) => ({
      ...prev,
      myAkuze: [...prev.myAkuze, akuz],
      canAkuze: false, // Može akužavati samo jednom po partiji
      message: `Akužavali ste ${akuz.description} (${akuz.points} bodova)!`,
    }));

    addToast(
      `Akužavali ste ${akuz.description} (+${akuz.points} bodova)`,
      "success",
    );

    setShowAkuzeModal(false);
  };

  const handleContinueNextPartija = () => {
    if (!gameState.roomId) {
      console.log("❌ [2v2] Cannot continue - no room");
      return;
    }

    console.log("🔄 [2v2] Player wants to continue next partija");

    // Emit to server
    socket.emit("continueNextPartija", {
      roomId: gameState.roomId,
      playerNumber: gameState.playerNumber,
    });
  };

  const handleRematch = () => {
    if (!gameState.roomId) {
      console.log("❌ [2v2] Cannot start rematch - no room");
      return;
    }

    console.log("🔄 [2v2] Player wants to start rematch");

    // Set state to show waiting for rematch
    setGameState((prev) => ({
      ...prev,
      gamePhase: "waitingForRematch",
      message: "Tražim revanš s istim igračima...",
    }));

    // Emit to server to request rematch with same players
    socket.emit("requestRematch", {
      roomId: gameState.roomId,
      playerNumber: gameState.playerNumber,
    });
  };

  const handleCardClick = (card) => {
    if (!gameState) return;

    // Block clicks if card is already playing
    if (isCardPlaying) {
      return;
    }

    if (
      gameState.gamePhase !== "playing" ||
      gameState.currentPlayer !== gameState.playerNumber ||
      isCardPlaying
    ) {
      return;
    }

    // Additional check: if all 4 cards are already played in 2v2, don't allow more clicks
    const playedCardCount = gameState.playedCards
      ? gameState.playedCards.filter(
          (card) => card !== null && card !== undefined,
        ).length
      : 0;
    if (playedCardCount >= 4) {
      // All cards for this round are played, wait for server response
      return;
    }

    // Check if this specific card was already played this round
    const cardAlreadyPlayed =
      gameState.playedCards &&
      gameState.playedCards.some(
        (playedCard) => playedCard && playedCard.id === card.id,
      );
    if (cardAlreadyPlayed) {
      return;
    }

    // Additional safety: Check if current player already played a card this round
    const currentPlayerAlreadyPlayed =
      gameState.playedCards &&
      gameState.playedCards.some(
        (playedCard) =>
          playedCard && playedCard.playerNumber === gameState.playerNumber,
      );
    if (currentPlayerAlreadyPlayed) {
      // This player already played this round, don't allow more plays
      return;
    }

    // Provjeri je li karta playable za Trešetu
    if (
      gameState.gameType === "treseta" &&
      !gameState.playableCards.includes(card.id)
    ) {
      alert(
        "Ne možete igrati tu kartu! Morate pratiti boju ili igrati jaču kartu.",
      );
      return;
    }

    // Set flag to prevent multiple clicks
    setIsCardPlaying(true);

    // Play card immediately with one click (like AI)
    playCard(gameState.roomId, card);

    // DON'T set timeout to reset isCardPlaying - wait for roundFinished event
    // This prevents cards from becoming clickable before round finishes
  };

  if (!gameState) {
    return (
      <div className="game-wrapper">
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100%",
            color: "white",
            fontSize: "1.2rem",
          }}
        >
          Učitavanje igre...
        </div>
      </div>
    );
  }

  const team1Points =
    gameState.gameType === "treseta"
      ? gameState.team1Points
      : calculatePoints(gameState.team1Cards);
  const team2Points =
    gameState.gameType === "treseta"
      ? gameState.team2Points
      : calculatePoints(gameState.team2Cards);
  const cardSize = isMobile ? "small" : "medium";

  // Get player positions for 2v2 layout
  const getPlayerByPosition = (position) => {
    const positions = {
      bottom: gameState.playerNumber,
      top:
        gameState.playerNumber === 1
          ? 3
          : gameState.playerNumber === 2
            ? 4
            : gameState.playerNumber === 3
              ? 1
              : 2,
      left:
        gameState.playerNumber === 1
          ? 4
          : gameState.playerNumber === 2
            ? 1
            : gameState.playerNumber === 3
              ? 2
              : 3,
      right:
        gameState.playerNumber === 1
          ? 2
          : gameState.playerNumber === 2
            ? 3
            : gameState.playerNumber === 3
              ? 4
              : 1,
    };
    return positions[position];
  };

  const getPlayerName = (playerNumber) => {
    return (
      gameState.players.find((p) => p.playerNumber === playerNumber)?.name ||
      `Igrač ${playerNumber}`
    );
  };

  const getPlayerTeam = (playerNumber) => {
    return (
      gameState.players.find((p) => p.playerNumber === playerNumber)?.team || 1
    );
  };

  // Function to determine team color
  const getTeamColor = (playerNumber) => {
    // U 2v2: Tim 1 = igrači 1,3 | Tim 2 = igrači 2,4
    const playerTeam =
      playerNumber === 1 || playerNumber === 3 ? "team1" : "team2";
    const myPlayerNumber = gameState.playerNumber;
    const myTeam =
      myPlayerNumber === 1 || myPlayerNumber === 3 ? "team1" : "team2";

    // Ja i moj teammate imamo "teammate" klasu (zelenu boju)
    // Suparnicki tim ima "opponent" klasu (crvenu boju)
    return playerTeam === myTeam ? "teammate" : "opponent";
  };

  return (
    <div className="game-wrapper game-2v2">
      {/* Header */}
      <div className="game-header">
        <h1 className="game-title">
          <img
            src="/cards_img/dinarICON.png"
            alt="Dinari"
            className="title-suit-icon"
          />
          {gameState.gameType === "treseta" ? "Timska Trešeta" : "Briskula 2v2"}
        </h1>

        {/* Team scores */}
        <div className="team-scores">
          <div
            className={`team-score ${
              gameState.playerNumber === 1 || gameState.playerNumber === 3
                ? "my-team"
                : ""
            }`}
          >
            <span className="team-label">Tim 1</span>
            <span className="team-points">{team1Points}</span>
          </div>
          <div className="vs-divider">vs</div>
          <div
            className={`team-score ${
              gameState.playerNumber === 2 || gameState.playerNumber === 4
                ? "my-team"
                : ""
            }`}
          >
            <span className="team-label">Tim 2</span>
            <span className="team-points">{team2Points}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="desktop-controls">
          <button
            onClick={() => setShowScores(!showScores)}
            className="game-btn btn-primary"
          >
            {showScores ? "Sakrij" : "Detalji"}
          </button>

          {/* Akužaj button za Trešeta */}
          {gameState.gameType === "treseta" &&
            gameState.akuzeEnabled &&
            gameState.canAkuze &&
            !gameState.hasPlayedFirstRound &&
            gameState.currentPlayer === gameState.playerNumber &&
            gameState.gamePhase === "playing" &&
            (() => {
              const availableAkuze = checkAkuze(gameState.myHand);
              return (
                availableAkuze.length > 0 && (
                  <button
                    onClick={() => setShowAkuzeModal(true)}
                    className="game-btn btn-warning"
                    style={{ background: "#ffc107", color: "black" }}
                  >
                    🃏 Akužaj
                  </button>
                )
              );
            })()}

          {gameState.gamePhase === "playing" && (
            <button
              onClick={() => {
                clearGameState(); // Clear saved state on manual leave
                leaveRoomPermanently(gameState.roomId); // Use permanent leave
                onGameEnd();
              }}
              className="game-btn btn-danger"
            >
              Napusti
            </button>
          )}

          {gameState.gamePhase === "finished" && (
            <button onClick={onGameEnd} className="game-btn btn-secondary">
              Povratak
            </button>
          )}
        </div>
      </div>

      {/* Game area with 2v2 layout */}
      <div className="game-area-2v2">
        {/* Top player */}
        <div className="player-position top-player">
          <div
            className={`player-icon-display ${getTeamColor(
              getPlayerByPosition("top"),
            )} ${
              gameState.currentPlayer === getPlayerByPosition("top")
                ? "current-turn"
                : ""
            }`}
          >
            <div
              className={`player-avatar ${getTeamColor(
                getPlayerByPosition("top"),
              )}`}
            >
              {getPlayerName(getPlayerByPosition("top"))
                .charAt(0)
                .toUpperCase()}
            </div>
            <div className="player-name">
              {getPlayerName(getPlayerByPosition("top"))}
            </div>
            <div className="player-cards-indicator">
              <span>
                {getCardCountText(
                  gameState.handCounts[`player${getPlayerByPosition("top")}`],
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Middle section with left player, play area, deck-trump, and right player */}
        <div
          className={`middle-section ${
            gameState.remainingCardsCount === 0 ||
            gameState.gameType === "treseta"
              ? "no-deck"
              : ""
          }`}
        >
          {/* Left player */}
          <div className="player-position left-player">
            <div
              className={`player-icon-display ${getTeamColor(
                getPlayerByPosition("left"),
              )} ${
                gameState.currentPlayer === getPlayerByPosition("left")
                  ? "current-turn"
                  : ""
              }`}
            >
              <div
                className={`player-avatar ${getTeamColor(
                  getPlayerByPosition("left"),
                )}`}
              >
                {getPlayerName(getPlayerByPosition("left"))
                  .charAt(0)
                  .toUpperCase()}
              </div>
              <div className="player-name">
                {getPlayerName(getPlayerByPosition("left"))}
              </div>
              <div className="player-cards-indicator">
                <span>
                  {getCardCountText(
                    gameState.handCounts[
                      `player${getPlayerByPosition("left")}`
                    ],
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Center play area */}
          <div className="center-area">
            <div className="played-cards-section">
              <div className="played-cards-label">Odigrane karte</div>
              <div className="played-cards-cross">
                {gameState.playedCards.map((card, index) => {
                  const position = getRelativePosition(
                    card.playerNumber,
                    gameState.playerNumber,
                  );
                  const playerName =
                    gameState.players?.find(
                      (p) => p.playerNumber === card.playerNumber,
                    )?.name || `Igrač ${card.playerNumber}`;

                  return (
                    <div
                      key={`played-${card.id}`}
                      className={`played-card-position ${position}`}
                    >
                      <Card card={card} size="played" />
                      <div className="card-player-label">{playerName}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Deck and Trump section - Hide if no cards remaining or Trešeta 2v2 */}
          {gameState.remainingCardsCount > 0 &&
            !(gameState.gameType === "treseta") && (
              <div className="deck-trump-section">
                <div className="deck-label">
                  Špil ({gameState.remainingCardsCount})
                </div>
                <div className="deck-trump-stack">
                  {gameState.trump && gameState.gameType !== "treseta" && (
                    <div className="trump-card">
                      <Card card={gameState.trump} size={cardSize} />
                    </div>
                  )}
                  <div className="deck-card">
                    <Card card={{}} isHidden={true} size={cardSize} />
                  </div>
                </div>
              </div>
            )}

          {/* Right player */}
          <div className="player-position right-player">
            <div
              className={`player-icon-display ${getTeamColor(
                getPlayerByPosition("right"),
              )} ${
                gameState.currentPlayer === getPlayerByPosition("right")
                  ? "current-turn"
                  : ""
              }`}
            >
              <div
                className={`player-avatar ${getTeamColor(
                  getPlayerByPosition("right"),
                )}`}
              >
                {getPlayerName(getPlayerByPosition("right"))
                  .charAt(0)
                  .toUpperCase()}
              </div>
              <div className="player-name">
                {getPlayerName(getPlayerByPosition("right"))}
              </div>
              <div className="player-cards-indicator">
                <span>
                  {getCardCountText(
                    gameState.handCounts[
                      `player${getPlayerByPosition("right")}`
                    ],
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom player (current user) */}
        <div className="player-position bottom-player">
          <div className="player-status-combined">
            {user?.name} - {gameState.message}
          </div>
          <div className="player-cards">
            {sortCards(gameState.myHand, gameState.gameType).map((card) => (
              <Card
                key={card.id}
                card={card}
                isPlayable={
                  gameState.gamePhase === "playing" &&
                  gameState.currentPlayer === gameState.playerNumber &&
                  (gameState.gameType !== "treseta" ||
                    gameState.playableCards.includes(card.id)) &&
                  !isCardPlaying
                }
                isSelected={false}
                onClick={handleCardClick}
                size={cardSize}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Scores overlay */}
      {showScores && (
        <div className="scores-overlay" onClick={() => setShowScores(false)}>
          <div className="scores-modal" onClick={(e) => e.stopPropagation()}>
            <div className="scores-header">
              <h2>Detaljni rezultati - 2v2</h2>
            </div>

            <div className="teams-scores-grid">
              <div className="team-stats">
                <h3>Tim 1 {gameState.myTeam === 1 && "(Vaš tim)"}</h3>
                <div className="stat-item">
                  <span>Bodovi:</span>
                  <span>{team1Points}</span>
                </div>
                <div className="team-players">
                  {gameState.players
                    .filter((p) => p.team === 1)
                    .map((player) => (
                      <div key={player.playerNumber} className="player-stat">
                        <span>{player.name}:</span>
                        <span>
                          {getCardCountText(
                            gameState.handCounts[
                              `player${player.playerNumber}`
                            ],
                          )}
                        </span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Show deck/trump info only if relevant */}
              {gameState.remainingCardsCount > 0 && (
                <div className="trump-info">
                  {gameState.gameType === "treseta" ? (
                    <>
                      <h3>Špil</h3>
                      <p>Preostalo: {gameState.remainingCardsCount}</p>
                    </>
                  ) : (
                    <>
                      <h3>Adut</h3>
                      {gameState.trump && (
                        <Card card={gameState.trump} size="small" />
                      )}
                      <p>Preostalo: {gameState.remainingCardsCount}</p>
                    </>
                  )}
                </div>
              )}

              <div className="team-stats">
                <h3>Tim 2 {gameState.myTeam === 2 && "(Vaš tim)"}</h3>
                <div className="stat-item">
                  <span>Bodovi:</span>
                  <span>{team2Points}</span>
                </div>
                <div className="team-players">
                  {gameState.players
                    .filter((p) => p.team === 2)
                    .map((player) => (
                      <div key={player.playerNumber} className="player-stat">
                        <span>{player.name}:</span>
                        <span>
                          {getCardCountText(
                            gameState.handCounts[
                              `player${player.playerNumber}`
                            ],
                          )}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* Trešeta: Historija partija i ukupni rezultat */}
            {gameState.gameType === "treseta" &&
              gameState.totalTeam1Points !== undefined && (
                <div className="treseta-details">
                  <div className="treseta-summary">
                    <h3>Dugoročno bodovanje</h3>
                    <div className="current-total">
                      <strong>
                        Ukupno: Tim 1: {gameState.totalTeam1Points} - Tim 2:{" "}
                        {gameState.totalTeam2Points}
                      </strong>
                    </div>
                    <div className="target-info">
                      Cilj: {gameState.targetScore} bodova
                    </div>
                    <div className="current-partija">
                      Trenutna partija: {gameState.currentPartija}
                    </div>
                  </div>

                  {gameState.partijas && gameState.partijas.length > 0 && (
                    <div className="partijas-history">
                      <h4>Prošle partije:</h4>
                      <div className="partijas-list">
                        {gameState.partijas.map((partija, index) => (
                          <div key={index} className="partija-item">
                            <span className="partija-number">
                              Partija {partija.partija}:
                            </span>
                            <span className="partija-score">
                              Tim 1: {partija.team1Points} - Tim 2:{" "}
                              {partija.team2Points}
                            </span>
                            <span className="partija-winner">
                              {partija.team1Points > partija.team2Points
                                ? gameState.myTeam === 1
                                  ? "🏆 Vi"
                                  : "😔 Protivnik"
                                : partija.team2Points > partija.team1Points
                                  ? gameState.myTeam === 2
                                    ? "🏆 Vi"
                                    : "😔 Protivnik"
                                  : "🤝 Neriješeno"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Akuže u trenutnoj partiji */}
                  {gameState.gameType === "treseta" &&
                    gameState.akuzeEnabled && (
                      <div className="current-akuze">
                        <h4>Akuže u ovoj partiji:</h4>
                        <div className="teams-akuze">
                          <div className="my-akuze">
                            <strong>Tim 1 akuže:</strong>
                            {gameState.team1Akuze &&
                            gameState.team1Akuze.length > 0 ? (
                              <ul>
                                {gameState.team1Akuze.map((akuz, index) => (
                                  <li key={index}>
                                    {akuz.playerName}: {akuz.description} (+
                                    {akuz.points} bod
                                    {akuz.points === 1
                                      ? ""
                                      : akuz.points <= 4
                                        ? "a"
                                        : "ova"}
                                    )
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p>Nema akuža</p>
                            )}
                          </div>

                          <div className="opponent-akuze">
                            <strong>Tim 2 akuže:</strong>
                            {gameState.team2Akuze &&
                            gameState.team2Akuze.length > 0 ? (
                              <ul>
                                {gameState.team2Akuze.map((akuz, index) => (
                                  <li key={index}>
                                    {akuz.playerName}: {akuz.description} (+
                                    {akuz.points} bod
                                    {akuz.points === 1
                                      ? ""
                                      : akuz.points <= 4
                                        ? "a"
                                        : "ova"}
                                    )
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p>Nema akuža</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                </div>
              )}

            <button
              className="close-scores"
              onClick={() => setShowScores(false)}
            >
              Zatvori
            </button>
          </div>
        </div>
      )}

      {/* Partija Finished Screen for 2v2 Treseta */}
      {gameState.gamePhase === "partidaFinished" && (
        <div className="final-score-overlay">
          <div className="final-score-container">
            <div className="final-score-header">
              <h2>
                🏆 Partija {(gameState.currentPartija || 1) - 1} završena!
              </h2>
            </div>

            <div className="partija-result">
              <p>
                {(gameState.team1Points || 0) > (gameState.team2Points || 0)
                  ? gameState.myTeam === 1 || gameState.myTeam === "A"
                    ? "🎉 Vaš tim je dobio ovu partiju!"
                    : "😔 Vaš tim je izgubio ovu partiju."
                  : (gameState.team2Points || 0) > (gameState.team1Points || 0)
                    ? gameState.myTeam === 2 || gameState.myTeam === "B"
                      ? "🎉 Vaš tim je dobio ovu partiju!"
                      : "😔 Vaš tim je izgubio ovu partiju."
                    : "🤝 Partija neriješena!"}
              </p>
              <div className="partija-scores">
                Rezultat partije: {gameState.team1Points || 0} -{" "}
                {gameState.team2Points || 0}
              </div>
              <div className="total-scores">
                <strong>
                  Ukupno: {gameState.totalTeam1Points || 0} -{" "}
                  {gameState.totalTeam2Points || 0}
                </strong>
              </div>
              <div className="target-info">
                Cilj: {gameState.targetScore || 31} bodova
              </div>
            </div>

            <div className="final-score-actions">
              {/* Show continue button or status */}
              {nextPartidaStatus.playerReady ? (
                nextPartidaStatus.waitingFor > 0 ? (
                  <div className="waiting-opponent-message">
                    <div className="loading-spinner">⏳</div>
                    <p>Čeka se odluka drugih igrača...</p>
                    <small>Ostali igrači trebaju potvrditi nastavak</small>
                  </div>
                ) : (
                  <div className="loading-spinner-message">
                    <div className="loading-spinner">⏳</div>
                    <p>Pokretanje nove partije...</p>
                  </div>
                )
              ) : (
                <button
                  onClick={handleContinueNextPartija}
                  className="btn-primary-large"
                >
                  ▶️ Nastavi sljedeću partiju
                </button>
              )}
              <button onClick={onGameEnd} className="btn-secondary-large">
                🏠 Glavni meni
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Final Score Screen for 2v2 */}
      {gameState.gamePhase === "finished" && (
        <div className="final-score-overlay">
          <div className="final-score-container">
            {gameState.gameInterrupted ? (
              // Prikaz za prekinutu igru
              <>
                <div className="final-score-header">
                  <h2>⚠️ Igra prekinuta</h2>
                  <div className="result-emoji">😕</div>
                </div>
                <div className="game-result">
                  <p>{gameState.message}</p>
                </div>
                <div className="final-score-actions">
                  <button onClick={onGameEnd} className="btn-secondary-large">
                    � Glavni meni
                  </button>
                </div>
              </>
            ) : (
              // Normalni prikaz rezultata
              <>
                <div className="final-score-header">
                  <h2>
                    {gameState.gameType === "treseta"
                      ? "🏆 Igra završena!"
                      : "🎮 Partija završena!"}
                  </h2>
                  {gameState.gameType === "treseta" && (
                    <div className="final-total-score">
                      Konačni rezultat: {gameState.totalTeam1Points || 0} -{" "}
                      {gameState.totalTeam2Points || 0}
                    </div>
                  )}
                  {gameState.winner === gameState.myTeam && (
                    <div className="result-emoji">🎉</div>
                  )}
                  {gameState.winner === null && (
                    <div className="result-emoji">🤝</div>
                  )}
                  {gameState.winner &&
                    gameState.winner !== gameState.myTeam && (
                      <div className="result-emoji">😔</div>
                    )}
                </div>

                <div className="final-teams-grid">
                  <div className="final-team-score">
                    <div className="team-header">
                      <h3>Tim A</h3>
                      {gameState.winner === "A" && (
                        <div className="winner-badge">👑 POBJEDNIK</div>
                      )}
                    </div>
                    <div className="team-points">
                      {gameState.gameType === "treseta"
                        ? `${gameState.totalTeam1Points || 0} bodova`
                        : `${calculatePoints(
                            gameState.team1Cards || [],
                          )} bodova`}
                    </div>
                    <div className="team-cards">
                      {gameState.gameType === "treseta"
                        ? `Cilj: ${gameState.targetScore || 31} bodova`
                        : getCardCountText((gameState.team1Cards || []).length)}
                    </div>
                    <div className="team-players">
                      {gameState.players
                        ?.filter((p) => p.team === "A")
                        .map((player) => (
                          <div
                            key={player.playerNumber}
                            className={`team-player ${
                              player.playerNumber === gameState.playerNumber
                                ? "current-player"
                                : ""
                            }`}
                          >
                            {player.name}{" "}
                            {player.playerNumber === gameState.playerNumber &&
                              "(Vi)"}
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="vs-divider">VS</div>

                  <div className="final-team-score">
                    <div className="team-header">
                      <h3>Tim B</h3>
                      {gameState.winner === "B" && (
                        <div className="winner-badge">👑 POBJEDNIK</div>
                      )}
                    </div>
                    <div className="team-points">
                      {gameState.gameType === "treseta"
                        ? `${gameState.totalTeam2Points || 0} bodova`
                        : `${calculatePoints(
                            gameState.team2Cards || [],
                          )} bodova`}
                    </div>
                    <div className="team-cards">
                      {gameState.gameType === "treseta"
                        ? `Završeno u ${
                            gameState.partijas?.length ||
                            (gameState.currentPartija || 1) - 1
                          } partija`
                        : getCardCountText((gameState.team2Cards || []).length)}
                    </div>
                    <div className="team-players">
                      {gameState.players
                        ?.filter((p) => p.team === "B")
                        .map((player) => (
                          <div
                            key={player.playerNumber}
                            className={`team-player ${
                              player.playerNumber === gameState.playerNumber
                                ? "current-player"
                                : ""
                            }`}
                          >
                            {player.name}{" "}
                            {player.playerNumber === gameState.playerNumber &&
                              "(Vi)"}
                          </div>
                        ))}
                    </div>
                  </div>
                </div>

                <div className="game-result">
                  <p>{gameState.message}</p>
                </div>

                {/* ELO Changes Display for 2v2 */}
                {eloChanges && user?.userId && eloChanges[user.userId] && (
                  <div className="elo-changes">
                    <div
                      className={`elo-change ${
                        eloChanges[user.userId].change >= 0
                          ? "elo-positive"
                          : "elo-negative"
                      }`}
                    >
                      <span className="elo-label">ELO:</span>
                      <span className="elo-value">
                        {eloChanges[user.userId].change >= 0 ? "+" : ""}
                        {eloChanges[user.userId].change}
                      </span>
                      <span className="elo-new">
                        → {eloChanges[user.userId].newElo}
                      </span>
                    </div>
                  </div>
                )}

                <div className="final-score-actions">
                  <button onClick={handleRematch} className="btn-primary-large">
                    🔄 Revanš
                  </button>
                  <button onClick={onGameEnd} className="btn-secondary-large">
                    🏠 Glavni meni
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Akuže selection modal */}
      {showAkuzeModal && (
        <div
          className="scores-overlay"
          onClick={() => setShowAkuzeModal(false)}
        >
          <div
            className="scores-modal akuze-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="scores-header">
              <h2>🃏 Odaberite akuz</h2>
            </div>

            <div className="akuze-selection">
              {gameState.gameType === "treseta" &&
                gameState.akuzeEnabled &&
                gameState.canAkuze &&
                !gameState.hasPlayedFirstRound &&
                (() => {
                  const availableAkuze = checkAkuze(gameState.myHand);
                  return availableAkuze.map((akuz, index) => (
                    <button
                      key={index}
                      className="akuz-option"
                      onClick={() => {
                        handleAkuze(akuz);
                        setShowAkuzeModal(false);
                      }}
                    >
                      <div className="akuz-description">{akuz.description}</div>
                      <div className="akuz-points">
                        +{akuz.points} bod
                        {akuz.points === 1
                          ? ""
                          : akuz.points <= 4
                            ? "a"
                            : "ova"}
                      </div>
                      <div className="akuz-cards">
                        {akuz.cards.map((card, cardIndex) => (
                          <span key={cardIndex} className="akuz-card">
                            {card.name} {card.suit}
                          </span>
                        ))}
                      </div>
                    </button>
                  ));
                })()}
            </div>

            <button
              className="close-scores"
              onClick={() => setShowAkuzeModal(false)}
            >
              Odustani
            </button>
          </div>
        </div>
      )}

      {/* Matchmaking Screen for Rematch */}
      {(gameState.gamePhase === "matchmaking" ||
        gameState.gamePhase === "waitingForRematch") && (
        <div className="final-score-overlay">
          <div className="final-score-container">
            <div className="final-score-header">
              <h2>🔄 Tražim revanš...</h2>
              <div className="result-emoji">⏳</div>
            </div>
            <div className="game-result">
              <p>{gameState.message}</p>
            </div>
            <div className="final-score-actions">
              <button
                onClick={() => {
                  // Odustani od revanša i vrati se na finished screen
                  setGameState((prev) => ({
                    ...prev,
                    gamePhase: "finished",
                    message:
                      prev.winner === prev.myTeam
                        ? "🎉 Vaš tim je pobijedio!"
                        : prev.winner === null
                          ? "🤝 Neriješeno!"
                          : "😔 Vaš tim je izgubio.",
                  }));
                  // Otkaži matchmaking
                  socket?.emit("cancelMatch");
                }}
                className="btn-secondary-large"
              >
                🚫 Odustani
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Player Disconnected - Grace Period Banner */}
      {playerDisconnected &&
        disconnectionInfo &&
        disconnectionInfo.canReconnect && (
          <div
            className="disconnection-banner"
            style={{
              position: "fixed",
              top: "10px",
              left: "50%",
              transform: "translateX(-50%)",
              backgroundColor: "#ff9800",
              color: "white",
              padding: "10px 20px",
              borderRadius: "8px",
              zIndex: 2000,
              boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
              textAlign: "center",
              maxWidth: "90%",
              width: "auto",
            }}
          >
            <div style={{ fontSize: "0.9em", fontWeight: "bold" }}>
              ⏳ {disconnectionInfo.message}
            </div>
            <div style={{ fontSize: "0.8em", marginTop: "5px" }}>
              Čeka se reconnect...{" "}
              {graceTimeLeft > 0 ? `(${Math.ceil(graceTimeLeft / 1000)}s)` : ""}
            </div>
          </div>
        )}

      {/* Player Disconnected - Final Modal (only for permanent disconnect) */}
      {playerDisconnected &&
        disconnectionInfo &&
        !disconnectionInfo.canReconnect && (
          <div className="modal-overlay" style={{ zIndex: 2000 }}>
            <div
              className="modal-content"
              style={{ maxWidth: "400px", textAlign: "center" }}
            >
              <h3>⚠️ Igra završena</h3>
              <p>{disconnectionInfo.message}</p>
              <p>Igrač je napustio igru.</p>
              <div style={{ marginTop: "20px" }}>
                <button
                  onClick={() => {
                    clearGameState();
                    window.location.href = "/";
                  }}
                  className="btn-primary-large"
                >
                  Glavni meni
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

export default Game2v2;
