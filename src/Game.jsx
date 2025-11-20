"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Card from "./Card";
import { useSocket } from "./SocketContext";
import { useToast } from "./ToastProvider";
import "./Game.css";

import {
  determineRoundWinner,
  createDeck,
  shuffleDeck,
  dealCards,
  calculatePoints,
  checkGameEnd,
} from "../core/gameLogicBriskula.js";
import {
  determineRoundWinner as determineRoundWinnerTreseta,
  createDeck as createDeckTreseta,
  shuffleDeck as shuffleDeckTreseta,
  dealCards as dealCardsTreseta,
  calculatePoints as calculatePointsTreseta,
  calculateAkuze as calculateAkuzeTreseta,
  checkGameEnd as checkGameEndTreseta,
} from "../core/gameLogicTreseta.js";

import { checkAkuze } from "../core/tresetaCommon.js";

import { chooseAiCard as chooseAiBriskula } from "../core/briskulaAI.js";
import {
  chooseAiCard as chooseAiTreseta,
  checkAiAkuze,
} from "../core/tresetaAI.js";

/**
 * Vraća pravilnu riječ za broj karata u hrvatskom jeziku
 * @param {number} count - Broj karata
 * @returns {string} - Pravilna riječ (karta/karte/karata)
 */

/**
 * Sortira karte po boji i jačini
 * @param {Array} cards - Array karata za sortiranje
 * @param {string} gameType - Tip igre (briskula ili treseta)
 * @returns {Array} - Sortirane karte
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

function Game({
  gameData,
  onGameEnd,
  isSpectatorMode = false,
  spectatorRoomId = null,
}) {
  const {
    socket,
    user,
    playCard,
    leaveRoom,
    leaveRoomPermanently,
    forfeitMatch,
    findMatch,
    rematch,
    saveGameState,
    clearGameState,
    gameState: savedGameStateFromContext,
  } = useSocket();

  const { addToast } = useToast();

  // Spectator mode states
  const [isSpectator, setIsSpectator] = useState(
    isSpectatorMode || gameData?.spectator || gameData?.isSpectatorMode || false
  );
  const [spectatorState, setSpectatorState] = useState(null);
  const [reconnectModalVisible, setReconnectModalVisible] = useState(false);
  const [playerDisconnected, setPlayerDisconnected] = useState(false);

  // New states for grace period and forfeit handling
  const [disconnectionInfo, setDisconnectionInfo] = useState(null); // { graceEndsAt, message, canReconnect }
  const [graceTimeLeft, setGraceTimeLeft] = useState(0);
  const [playerForfeited, setPlayerForfeited] = useState(false);

  const mode = useMemo(() => {
    // First check gameData if available
    if (gameData) {
      // Check for spectator mode first
      if (isSpectator || gameData?.spectator || gameData?.isSpectatorMode) {
        return "spectator";
      }

      if (
        gameData?.gameMode === "1vAI" ||
        gameData?.opponent?.isAI ||
        gameData?.opponent?.name === "AI Bot"
      ) {
        return "ai";
      }
      return "online";
    }

    // If no gameData, check saved state to determine mode
    try {
      const savedState = localStorage.getItem("gameState");
      const savedAppGameMode = localStorage.getItem("gameMode");

      if (savedState) {
        const parsedState = JSON.parse(savedState);
        if (
          parsedState.mode === "ai" ||
          parsedState.gameMode === "1vAI" ||
          parsedState.opponent?.isAI ||
          parsedState.opponent?.name === "AI Bot"
        ) {
          return "ai";
        }
      }

      // Additional check: if app-level gameMode indicates AI
      if (savedAppGameMode === "1vAI") {
        return "ai";
      }

      // IMPORTANT: For AI games, check if we came from game selection
      // AI games might not have gameState saved but should be detectable from URL/history
      const currentURL = window.location.href;
      if (currentURL.includes("ai") || currentURL.includes("AI")) {
        return "ai";
      }

      // Check if the app was in AI mode before refresh by checking appState combination
      const savedAppState = localStorage.getItem("appState");
      const savedGameType = localStorage.getItem("gameType");

      // If we're in game state but have no online game data, it's likely an AI game
      if (savedAppState === "game" && savedGameType && !savedState) {
        console.log("🤖 [Game] Detected AI game from app state pattern");
        return "ai";
      }
    } catch (error) {
      console.warn(
        "🔄 [Game] Could not parse saved game state for mode detection:",
        error
      );
    }

    return "online";
  }, [gameData, isSpectator]);

  // Helper function to find opponent from players array
  const findOpponentFromPlayers = (players, playerNumber, userName) => {
    if (!players || !Array.isArray(players)) return null;
    // Pronađi protivnika koji NIJE ja
    let opponent = players.find((p) => p.playerNumber !== playerNumber);
    // Ako je opponent isti kao user, probaj naći drugog
    if (opponent && opponent.name === userName) {
      opponent = players.find(
        (p) => p.playerNumber !== playerNumber && p.name !== userName
      );
    }
    return opponent
      ? {
          name: opponent.name,
          userId: opponent.userId,
          isGuest: opponent.isGuest,
        }
      : null;
  };

  // Create game state from provided data (for gameStart events)
  const createGameStateFromData = (data) => {
    if (!data || !data.roomId) {
      console.warn("⚠️ No data provided to createGameStateFromData");
      return null;
    }

    // DEBUG: Log everything bitno
    console.log("🔍 [createGameStateFromData] Data:", data);
    console.log("🔍 [createGameStateFromData] Spectator flags:", {
      spectator: data.spectator,
      isSpectatorMode: data.isSpectatorMode,
      playerNumber: data.playerNumber,
    });
    console.log("🔍 [createGameStateFromData] Players:", data.players);

    // --- SPECTATOR MODE: Only if explicitly flagged ---
    if (data.spectator === true || data.isSpectatorMode === true) {
      console.log("👁️ Creating spectator state");
      const player1 = data.players?.find((p) => p.playerNumber === 1);
      const player2 = data.players?.find((p) => p.playerNumber === 2);
      return {
        mode: "spectator",
        roomId: data.roomId,
        playerNumber: null, // Spectators have no playerNumber
        opponent: null, // Spectators have no specific opponent
        gameType: data.gameType,
        myHand: [],
        opponentHandCount: 0,
        myCards: [],
        opponentCards: [],
        trump: data.gameState?.trump,
        currentPlayer: data.gameState?.currentPlayer,
        playedCards: data.gameState?.playedCards || [],
        gamePhase: "spectating",
        winner: data.gameState?.winner,
        message: `👁️ Gledate: ${player1?.name || "Igrač 1"} vs ${
          player2?.name || "Igrač 2"
        }`,
        remainingCardsCount: data.gameState?.remainingCardsCount || 0,
        playableCards: [],
        myPoints: data.gameState?.player1Points || 0,
        opponentPoints: data.gameState?.player2Points || 0,
        player1Name: player1?.name || "Igrač 1",
        player2Name: player2?.name || "Igrač 2",
        players: data.players || [],
        isTournamentMatch: data.isTournamentMatch || false,
        tournamentId: data.tournamentId,
        matchId: data.matchId,
        ...(data.gameType === "treseta" && {
          akuzeEnabled:
            data.gameState?.akuzeEnabled !== undefined
              ? data.gameState.akuzeEnabled
              : true,
          totalMyPoints: data.gameState?.totalPlayer1Points || 0,
          totalOpponentPoints: data.gameState?.totalPlayer2Points || 0,
          partijas: data.gameState?.partijas || [],
          currentPartija: data.gameState?.currentPartija || 1,
          hasPlayedFirstCard: data.gameState?.hasPlayedFirstCard || false,
          hasPlayedFirstRound: data.gameState?.hasPlayedFirstRound || false,
          targetScore: data.targetScore || data.gameState?.targetScore || 31,
        }),
      };
    }

    // --- PLAYER MODE: If playerNumber is present, treat as player ---
    if (data.playerNumber) {
      // Find opponent (prefer players list, fallback to provided opponent)
      const opponentFromPlayers = data.players?.find(
        (p) => p.playerNumber !== data.playerNumber
      );
      const opponentFallback = data.opponent
        ? { name: data.opponent.name, userId: data.opponent.userId }
        : null;
      const opponent = opponentFromPlayers || opponentFallback;
      const me = data.players?.find(
        (p) => p.playerNumber === data.playerNumber
      );

      // Extract my hand based on playerNumber
      const myHand =
        data.playerNumber === 1
          ? data.gameState?.player1Hand || []
          : data.gameState?.player2Hand || [];

      return {
        mode: "online",
        roomId: data.roomId,
        playerNumber: data.playerNumber,
        opponent: opponent
          ? { name: opponent.name, userId: opponent.userId }
          : null,
        gameType: data.gameType,
        myHand: myHand,
        opponentHandCount:
          data.playerNumber === 1
            ? (data.gameState?.player2Hand || []).length
            : (data.gameState?.player1Hand || []).length,
        myCards: data.gameState?.myCards || [],
        opponentCards: data.gameState?.opponentCards || [],
        trump: data.gameState?.trump,
        currentPlayer: data.gameState?.currentPlayer,
        playedCards: data.gameState?.playedCards || [],
        gamePhase: data.gameState?.gamePhase || "playing",
        winner: data.gameState?.winner,
        message: data.gameState?.message || "",
        // Some payloads don't include remainingCardsCount – derive from remainingDeck
        remainingCardsCount:
          (data.gameState?.remainingDeck &&
            data.gameState.remainingDeck.length) ||
          data.gameState?.remainingCardsCount ||
          0,
        playableCards: data.gameState?.playableCards || [],
        myPoints: data.gameState?.myPoints || 0,
        opponentPoints: data.gameState?.opponentPoints || 0,
        player1Name:
          data.players?.find((p) => p.playerNumber === 1)?.name || "Igrač 1",
        player2Name:
          data.players?.find((p) => p.playerNumber === 2)?.name || "Igrač 2",
        players: data.players || [],
        isTournamentMatch: data.isTournamentMatch || false,
        tournamentId: data.tournamentId,
        matchId: data.matchId,
        ...(data.gameType === "treseta" && {
          akuzeEnabled:
            data.gameState?.akuzeEnabled !== undefined
              ? data.gameState.akuzeEnabled
              : true,
          totalMyPoints: data.gameState?.totalPlayer1Points || 0,
          totalOpponentPoints: data.gameState?.totalPlayer2Points || 0,
          partijas: data.gameState?.partijas || [],
          currentPartija: data.gameState?.currentPartija || 1,
          hasPlayedFirstCard: data.gameState?.hasPlayedFirstCard || false,
          hasPlayedFirstRound: data.gameState?.hasPlayedFirstRound || false,
          targetScore: data.targetScore || data.gameState?.targetScore || 31,
        }),
      };
    }

    // --- REGULAR PLAYER MODE (existing logic) ---
    let playerNumber = data.playerNumber;
    if (!playerNumber && data.players && user && user.name) {
      const me = data.players.find((p) => p.name === user.name);
      if (me) playerNumber = me.playerNumber;
    }

    console.log("🔍 [createGameStateFromData] Opponent:", data.opponent);
    console.log("🔍 [createGameStateFromData] playerNumber:", playerNumber);
    console.log("🔍 [createGameStateFromData] user:", user?.name);

    // Online state – kompatibilno s postojećim backendom
    let myHand =
      playerNumber === 1
        ? data.gameState.player1Hand
        : data.gameState.player2Hand;
    let opponentHandCount =
      playerNumber === 1
        ? (data.gameState.player2Hand || []).length
        : (data.gameState.player1Hand || []).length;

    // Ako su sve karte u myHand hidden, to je bug!
    if (myHand && myHand.length > 0 && myHand.every((c) => c.hidden)) {
      console.error(
        "❌ [createGameStateFromData] SVE KARTE SU HIDDEN! Ovo je bug u mappingu ili payloadu.",
        myHand
      );
      // Pokušaj fallback: uzmi karte iz gameState prema playerNumber
      if (
        playerNumber === 1 &&
        data.gameState.player1Hand &&
        data.gameState.player1Hand.some((c) => !c.hidden)
      ) {
        myHand = data.gameState.player1Hand;
      } else if (
        playerNumber === 2 &&
        data.gameState.player2Hand &&
        data.gameState.player2Hand.some((c) => !c.hidden)
      ) {
        myHand = data.gameState.player2Hand;
      }
    }

    // Fallback za opponent: ako je opponent isti kao user, probaj iz players arraya
    let opponentObj = data.opponent;
    if (opponentObj && user && opponentObj.name === user.name && data.players) {
      const found = findOpponentFromPlayers(
        data.players,
        playerNumber,
        user.name
      );
      if (found) {
        opponentObj = found;
        console.warn(
          "⚠️ [createGameStateFromData] Opponent bio isti kao user, fallback na:",
          found
        );
      }
    }
    if (!opponentObj && data.players) {
      opponentObj = findOpponentFromPlayers(
        data.players,
        playerNumber,
        user?.name
      );
    }

    const state = {
      mode: "online",
      roomId: data.roomId,
      playerNumber: playerNumber,
      opponent: opponentObj,
      gameType: data.gameType, // Add gameType to state
      myHand: myHand,
      opponentHandCount: opponentHandCount,
      myCards: [],
      opponentCards: [],
      trump: data.gameState.trump,
      currentPlayer: data.gameState.currentPlayer,
      playedCards: [],
      gamePhase: "playing",
      winner: null,
      message:
        data.gameState.currentPlayer === playerNumber
          ? "Vaš red! Odaberite kartu za igranje."
          : "Protivnikov red. Čekajte...",
      remainingCardsCount: (data.gameState.remainingDeck || []).length,
      playableCards: data.gameState.playableCards || [], // Lista ID-jeva karata koje se mogu igrati
      myPoints: 0, // Bodovi igrača
      opponentPoints: 0, // Bodovi protivnika

      // Tournament support
      isTournamentMatch: data.isTournamentMatch || false,
      tournamentId: data.tournamentId,
      matchId: data.matchId,

      // Akuže support for Treseta online games
      ...(data.gameType === "treseta" && {
        akuzeEnabled:
          data.akuzeEnabled !== undefined ? data.akuzeEnabled : true,

        // Long-term scoring system for Treseta
        totalMyPoints: data.gameState?.totalMyPoints || 0,
        totalOpponentPoints: data.gameState?.totalOpponentPoints || 0,
        partijas: data.gameState?.partijas || [], // Historia partija
        currentPartija: data.gameState?.currentPartija || 1,
        hasPlayedFirstCard: data.gameState?.hasPlayedFirstCard || false,
        hasPlayedFirstRound: data.gameState?.hasPlayedFirstRound || false,
        targetScore: data.targetScore || data.gameState?.targetScore || 31, // Target score from gameData or default
      }),
    };

    console.log("🎮 Final game state from createGameStateFromData:", state);
    console.log("🎮 Final opponent:", state.opponent);
    return state;
  };

  const initializeGameState = () => {
    if (!gameData) return null;

    console.log("🔍 [Game] Initializing with gameData:", gameData);
    console.log("🔍 [Game] Spectator flags:", {
      spectator: gameData?.spectator,
      isSpectatorMode: gameData?.isSpectatorMode,
      mode: mode,
    });

    // Check for spectator mode early
    if (
      gameData?.spectator === true ||
      gameData?.isSpectatorMode === true ||
      mode === "spectator"
    ) {
      console.log(
        "👁️ [Game] Detected spectator mode - clearing any saved state and using createGameStateFromData"
      );
      clearGameState(); // Clear any saved game state for spectators
      return createGameStateFromData(gameData);
    }

    console.log("🔍 [Game] Opponent data:", gameData?.opponent);
    console.log("🔍 [Game] Players data:", gameData?.players);
    console.log("🔍 [Game] Tournament data:", {
      isTournamentMatch: gameData?.isTournamentMatch,
      tournamentId: gameData?.tournamentId,
      matchId: gameData?.matchId,
    });

    // DEBUG: Check if gameData has required fields for online games
    console.log("🔍 [Game] gameData structure check:", {
      hasGameState: !!gameData?.gameState,
      hasPlayers: !!gameData?.players,
      hasOpponent: !!gameData?.opponent,
      hasRoomId: !!gameData?.roomId,
      gameMode: gameData?.gameMode,
      player1Hand: gameData?.gameState?.player1Hand?.length || 0,
      player2Hand: gameData?.gameState?.player2Hand?.length || 0,
    });

    // Tournament branch removed: server now emits standard 'gameStart' for tournaments too

    if (mode === "ai") {
      // Check if there's a saved AI game state first
      const savedState = localStorage.getItem("gameState");
      if (savedState) {
        try {
          const parsedState = JSON.parse(savedState);
          if (parsedState.mode === "ai" && parsedState.roomId === "local-ai") {
            console.log("🤖 [Game] Found saved AI game state, restoring it");
            return parsedState; // Return the exact saved state
          }
        } catch (error) {
          console.warn(
            "🔄 [Game] Error parsing saved AI state, creating new game:",
            error
          );
        }
      }

      // No saved state found or error parsing - create new AI game
      console.log("🤖 [Game] No saved AI state found, creating new AI game");

      // Lokalna partija 1v1 protiv AI-ja
      const useTreseta = (gameData.gameType || "briskula") === "treseta";
      const deck = useTreseta
        ? shuffleDeckTreseta(createDeckTreseta())
        : shuffleDeck(createDeck());
      console.log(
        "[v0] 📦 Created and shuffled deck:",
        deck.length,
        "cards",
        "useTreseta:",
        useTreseta
      );

      // For Trešeta AI mode we must use 1v1 dealing (do NOT pass is2v2=true)
      const dealt = useTreseta ? dealCardsTreseta(deck) : dealCards(deck);
      console.log(
        "[v0] 🃏 Dealt cards - Player:",
        dealt.player1Hand.length,
        "AI:",
        dealt.player2Hand.length
      );

      const initialState = {
        mode: "ai",
        playerNumber: 1,
        roomId: "local-ai",
        opponent: { id: "ai", name: "AI Bot", isAI: true },
        gameType: gameData.gameType || "briskula",
        myHand: dealt.player1Hand,
        aiHand: dealt.player2Hand,
        myCards: [],
        aiCards: [],
        trump: dealt.trump,
        trumpSuit: dealt.trumpSuit,
        remainingDeck: dealt.remainingDeck,
        playedCards: [],
        currentPlayer: 1,
        message: "Vaš red! Odaberite kartu za igranje.",
        gamePhase: "playing",
        winner: null,
        lastTrickWinner: null,
        myPoints: 0,
        opponentPoints: 0,
        opponentHandCount: dealt.player2Hand.length,
        remainingCardsCount: dealt.remainingDeck.length,
        playableCards: dealt.player1Hand.map((c) => c.id), // Za AI mod, sve karte su igrive

        // Treseta: dugoročno bodovanje i akužavanje
        ...(useTreseta && {
          totalMyPoints: 0,
          totalOpponentPoints: 0,
          partijas: [], // Historia partija
          currentPartija: 1,
          akuzeEnabled:
            gameData.akuzeEnabled !== undefined ? gameData.akuzeEnabled : true, // Respect user setting or default to true
          myAkuze: [],
          opponentAkuze:
            useTreseta &&
            (gameData.akuzeEnabled !== undefined ? gameData.akuzeEnabled : true)
              ? checkAiAkuze(dealt.player2Hand)
              : [], // AI automatski prijavi svoje akuže samo ako je akužavanje omogućeno
          aiAkuzeAnnounced: false, // Flag da se prati je li AI akuže poruka prikazana
          canAkuze:
            gameData.akuzeEnabled !== undefined ? gameData.akuzeEnabled : true, // Može akužavati samo ako je omogućeno
          hasPlayedFirstCard: false, // Flag da se prati je li odigrana prva karta partije
          hasPlayedFirstRound: false, // Flag da se prati je li završena prva runda (za akuže)
          targetScore: gameData.targetScore || 31, // Target score from gameData or default
        }),
      };

      return initialState;
    }

    // Online state – kompatibilno s postojećim backendom
    // --- FIX: Check if gameState exists before proceeding ---
    if (!gameData.gameState) {
      console.log(
        "⚠️ [Game] gameState is missing from gameData, attempting fallback"
      );
      // Try to use saved game state as fallback
      const savedState = localStorage.getItem("gameState");
      if (savedState) {
        try {
          const parsedState = JSON.parse(savedState);
          if (parsedState.mode === "online" && parsedState.roomId) {
            console.log("🔄 [Game] Using saved online game state as fallback");
            return parsedState;
          }
        } catch (error) {
          console.warn("❌ [Game] Error parsing saved state:", error);
        }
      }

      // If no valid fallback, create minimal state and let reconnection handle it
      console.log("🔄 [Game] Creating minimal state for reconnection");
      return createGameStateFromData(gameData);
    }

    // --- FIX: Odredi playerNumber ako nije definiran ---
    let playerNumber = gameData.playerNumber;
    if (!playerNumber && gameData.players && user && user.name) {
      const me = gameData.players.find((p) => p.name === user.name);
      if (me) playerNumber = me.playerNumber;
    }

    const myHand =
      playerNumber === 1
        ? gameData.gameState.player1Hand || []
        : gameData.gameState.player2Hand || [];

    const opponentHandCount =
      playerNumber === 1
        ? (gameData.gameState.player2Hand || []).length
        : (gameData.gameState.player1Hand || []).length;

    const state = {
      mode: "online",
      roomId: gameData.roomId,
      playerNumber: playerNumber,
      opponent:
        gameData.opponent ||
        findOpponentFromPlayers(gameData.players, playerNumber, user?.name),
      gameType: gameData.gameType, // Add gameType to state
      myHand: myHand,
      opponentHandCount: opponentHandCount,
      myCards: [],
      opponentCards: [],
      trump: gameData.gameState?.trump || null,
      currentPlayer: gameData.gameState?.currentPlayer || 1,
      playedCards: [],
      gamePhase: "playing",
      winner: null,
      message:
        (gameData.gameState?.currentPlayer || 1) === playerNumber
          ? "Vaš red! Odaberite kartu za igranje."
          : "Protivnikov red. Čekajte...",
      remainingCardsCount: (gameData.gameState?.remainingDeck || []).length,
      playableCards: gameData.gameState?.playableCards || [], // Lista ID-jeva karata koje se mogu igrati
      myPoints: 0, // Bodovi igrača
      opponentPoints: 0, // Bodovi protivnika

      // Tournament support
      isTournamentMatch: gameData.isTournamentMatch || false,
      tournamentId: gameData.tournamentId,
      matchId: gameData.matchId,

      // Akuže support for Treseta online games
      ...(gameData.gameType === "treseta" && {
        akuzeEnabled:
          gameData.akuzeEnabled !== undefined ? gameData.akuzeEnabled : true,
        myAkuze: [],
        opponentAkuze: [],
        canAkuze:
          gameData.akuzeEnabled !== undefined ? gameData.akuzeEnabled : true,

        // Long-term scoring system for Treseta
        totalMyPoints: gameData.gameState?.totalMyPoints || 0,
        totalOpponentPoints: gameData.gameState?.totalOpponentPoints || 0,
        partijas: gameData.gameState?.partijas || [], // Historia partija
        currentPartija: gameData.gameState?.currentPartija || 1,
        hasPlayedFirstCard: gameData.gameState?.hasPlayedFirstCard || false,
        hasPlayedFirstRound: gameData.gameState?.hasPlayedFirstRound || false,
        targetScore:
          gameData.targetScore || gameData.gameState?.targetScore || 31, // Target score from gameData or default
      }),
    };

    console.log("🎮 Final game state:", state);
    return state;
  };

  const [gameState, setGameState] = useState(() => {
    const initialState = initializeGameState();
    console.log("🎯 [Game] Initial gameState:", initialState);
    console.log("🎯 [Game] GamePhase:", initialState?.gameState?.gamePhase);

    // If no initial state, try to get game type from localStorage
    let savedGameType = "briskula";
    let savedGameMode = "1v1";
    let savedOpponent = null;
    let savedMode = "online"; // Default mode

    if (!initialState) {
      // Try to get game type from localStorage
      try {
        const savedState = localStorage.getItem("gameState");
        const savedAppGameType = localStorage.getItem("gameType");
        const savedAppGameMode = localStorage.getItem("gameMode");

        if (savedState) {
          const parsedState = JSON.parse(savedState);
          if (parsedState.gameType) {
            savedGameType = parsedState.gameType;
          }
          if (parsedState.gameMode) {
            savedGameMode = parsedState.gameMode;
          }
          if (parsedState.opponent) {
            savedOpponent = parsedState.opponent;
          }
          // Check if it was an AI game
          if (
            parsedState.mode === "ai" ||
            parsedState.gameMode === "1vAI" ||
            parsedState.opponent?.isAI ||
            parsedState.opponent?.name === "AI Bot"
          ) {
            savedMode = "ai";
          }
        }

        // Fallback to app-level saved game type
        if (savedAppGameType) {
          savedGameType = savedAppGameType;
        }
        if (savedAppGameMode) {
          savedGameMode = savedAppGameMode;
          // Also check mode from saved app game mode
          if (savedAppGameMode === "1vAI") {
            savedMode = "ai";
          }
        }

        // IMPORTANT: Additional AI detection for refresh scenarios
        // If we're in game state but have no online game data, it's likely an AI game
        const savedAppState = localStorage.getItem("appState");
        if (savedAppState === "game" && savedAppGameType && !savedState) {
          console.log(
            "🤖 [Game] Detected AI game from app state pattern in fallback"
          );
          savedMode = "ai";
        }
      } catch (error) {
        console.warn(
          "🔄 [Game] Could not parse saved game state for fallback:",
          error
        );
      }

      console.log(
        "🔄 [Game] Using fallback state with gameType:",
        savedGameType,
        "gameMode:",
        savedGameMode,
        "mode:",
        savedMode
      );
    }

    // Return safe default state if no initial state to prevent crashes
    return (
      initialState || {
        mode: savedMode,
        roomId: null,
        playerNumber: null,
        opponent: savedOpponent,
        gameType: savedGameType,
        myHand: [],
        opponentHandCount: 0,
        myCards: [],
        opponentCards: [],
        trump: null,
        currentPlayer: 1,
        playedCards: [],
        gamePhase: "waiting",
        winner: null,
        message: "Učitavanje igre...",
        remainingCardsCount: 0,
        playableCards: [],
        myPoints: 0,
        opponentPoints: 0,
        player1Name: "Igrač 1",
        player2Name: "Igrač 2",
        players: [],
        // Treseta defaults
        partijas: [],
        myAkuze: [],
        opponentAkuze: [],
        totalMyPoints: 0,
        totalOpponentPoints: 0,
        currentPartija: 1,
        hasPlayedFirstCard: false,
      }
    );
  });
  const [showScores, setShowScores] = useState(false);
  const [showAkuzeModal, setShowAkuzeModal] = useState(false);
  // Determine if we're on mobile
  const [isMobile, setIsMobile] = useState(false);
  // Animation state for picked up cards
  const [cardPickupAnimation, setCardPickupAnimation] = useState(null);
  // Block clicks during card play animation
  const [isCardPlaying, setIsCardPlaying] = useState(false);
  // State for next partija continuation
  const [nextPartidaStatus, setNextPartidaStatus] = useState({
    playerReady: false,
    readyPlayers: [],
    waitingFor: 0,
  });
  const roundFirstPlayerRef = useRef(null);
  const aiThinking = useRef(false);
  const roundResolving = useRef(false);

  // Early return if gameState is invalid
  if (!gameState) {
    console.error("❌ [Game] gameState is null/undefined!");
    return (
      <div className="game-container">
        <div className="error-message">Greška: Nema podataka o igri</div>
      </div>
    );
  }

  // Show loading state if myHand is not yet loaded from server
  if (!Array.isArray(gameState?.myHand) && gameState.gamePhase === "waiting") {
    return (
      <div className="game-container">
        <div className="loading-message">
          <div className="spinner"></div>
          <p>Obnavljam igru...</p>
        </div>
      </div>
    );
  }

  const playLocalCard = (card, playerNum) => {
    setGameState((prevState) => {
      if (prevState.gamePhase !== "playing") return prevState;
      const newPlayedCards = [...prevState.playedCards];
      newPlayedCards[playerNum - 1] = card;

      const newMyHand =
        playerNum === 1
          ? prevState.myHand.filter((c) => c.id !== card.id)
          : prevState.myHand;
      const newAiHand =
        playerNum === 2
          ? prevState.aiHand.filter((c) => c.id !== card.id)
          : prevState.aiHand;

      // Don't reset card playing flag immediately - wait until round ends

      // 👉 Ako je ovo prva karta u rundi, zapamti tko je prvi
      if (!prevState.playedCards[0] && !prevState.playedCards[1]) {
        roundFirstPlayerRef.current = playerNum;
      }

      // Za Trešetu: Označi da je odigrana prva karta partije (zabrani akužavanje)
      const newHasPlayedFirstCard =
        prevState.gameType === "treseta"
          ? prevState.hasPlayedFirstCard ||
            (!prevState.playedCards[0] && !prevState.playedCards[1])
          : prevState.hasPlayedFirstCard;

      if (newPlayedCards[0] && newPlayedCards[1]) {
        aiThinking.current = true;
        roundResolving.current = true;

        // First update state to show both cards
        const tempState = {
          ...prevState,
          myHand: newMyHand,
          aiHand: newAiHand,
          playedCards: newPlayedCards,
          message: "Određuje se pobjednik runde...",
          roundResolving: true,
          hasPlayedFirstCard: newHasPlayedFirstCard,
        };

        // Add delay before resolving the round
        // Add delay before resolving the round
        setTimeout(() => {
          setGameState((currentState) => {
            // 🔑 Odredi koja je prva, a koja druga karta
            let firstCard, secondCard;
            if (roundFirstPlayerRef.current === 1) {
              firstCard = newPlayedCards[0]; // User je igrao prvi
              secondCard = newPlayedCards[1]; // AI drugi
            } else {
              firstCard = newPlayedCards[1]; // AI je igrao prvi
              secondCard = newPlayedCards[0]; // User drugi
            }

            const useTreseta = prevState.gameType === "treseta";
            const winner = useTreseta
              ? determineRoundWinnerTreseta(
                  firstCard,
                  secondCard,
                  roundFirstPlayerRef.current
                )
              : determineRoundWinner(
                  firstCard,
                  secondCard,
                  prevState.trumpSuit,
                  roundFirstPlayerRef.current
                );

            const winnerIsP1 = winner === 1;
            const wonCards = [...newPlayedCards];
            const myCards = winnerIsP1
              ? [...(prevState.myCards || []), ...wonCards]
              : prevState.myCards;
            const aiCards = winnerIsP1
              ? prevState.aiCards
              : [...(prevState.aiCards || []), ...wonCards];

            // Dvlačenje iz špila – pobjednik vuče prvi
            let remaining = [...prevState.remainingDeck];
            let myHandAfterDraw = [...newMyHand];
            let aiHandAfterDraw = [...newAiHand];
            // Track which cards were drawn this trick (for pickup animation)
            let newCards = { player1: null, player2: null };

            if (remaining.length > 0) {
              if (remaining.length === 1) {
                // 🃏 Zadnja runda - special handling
                if (prevState.gameType === "treseta") {
                  // Trešeta: only one card remains -> winner takes it
                  if (winnerIsP1) {
                    myHandAfterDraw = [...myHandAfterDraw, remaining[0]];
                    newCards.player1 = remaining[0];
                  } else {
                    aiHandAfterDraw = [...aiHandAfterDraw, remaining[0]];
                    newCards.player2 = remaining[0];
                  }
                } else {
                  // Briskula: winner takes hidden, loser takes trump
                  if (winnerIsP1) {
                    myHandAfterDraw = [...myHandAfterDraw, remaining[0]]; // pobjednik uzima skrivenu
                    aiHandAfterDraw = [...aiHandAfterDraw, prevState.trump]; // gubitnik uzima aduta
                    newCards.player1 = remaining[0];
                    newCards.player2 = prevState.trump;
                  } else {
                    aiHandAfterDraw = [...aiHandAfterDraw, remaining[0]]; // pobjednik uzima skrivenu
                    myHandAfterDraw = [...myHandAfterDraw, prevState.trump]; // gubitnik uzima aduta
                    newCards.player2 = remaining[0];
                    newCards.player1 = prevState.trump;
                  }
                }
                remaining = []; // špil je prazan
              } else {
                // Normalno dijeljenje
                if (winnerIsP1) {
                  myHandAfterDraw = [...myHandAfterDraw, remaining[0]];
                  if (remaining[1])
                    aiHandAfterDraw = [...aiHandAfterDraw, remaining[1]];
                  newCards.player1 = remaining[0];
                  newCards.player2 = remaining[1] || null;
                } else {
                  aiHandAfterDraw = [...aiHandAfterDraw, remaining[0]];
                  if (remaining[1])
                    myHandAfterDraw = [...myHandAfterDraw, remaining[1]];
                  newCards.player2 = remaining[0];
                  newCards.player1 = remaining[1] || null;
                }
                remaining = remaining.slice(2);
              }
            }

            const isAllCardsPlayed =
              remaining.length === 0 &&
              myHandAfterDraw.length === 0 &&
              aiHandAfterDraw.length === 0;
            const ultimaWinner = useTreseta && isAllCardsPlayed ? winner : null;

            const p1Points = useTreseta
              ? calculatePointsTreseta(myCards, ultimaWinner, 1).points
              : calculatePoints(myCards);
            const p2Points = useTreseta
              ? calculatePointsTreseta(aiCards, ultimaWinner, 2).points
              : calculatePoints(aiCards);

            // For Treseta with long-term scoring, check if partija is over
            let end;
            if (useTreseta && prevState.totalMyPoints !== undefined) {
              // Treseta with long-term scoring
              const partidaEnd = isAllCardsPlayed;

              if (partidaEnd) {
                // Calculate total points including akuze for this partija
                const myPartidaPoints =
                  p1Points +
                  (prevState.myAkuze?.reduce(
                    (sum, akuz) => sum + akuz.points,
                    0
                  ) || 0);
                const opponentPartidaPoints =
                  p2Points +
                  (prevState.opponentAkuze?.reduce(
                    (sum, akuz) => sum + akuz.points,
                    0
                  ) || 0);

                // Add current partija points to total
                const newTotalMyPoints =
                  prevState.totalMyPoints + myPartidaPoints;
                const newTotalOpponentPoints =
                  prevState.totalOpponentPoints + opponentPartidaPoints;

                // Check if someone reached target score
                const matchFinished =
                  newTotalMyPoints >= prevState.targetScore ||
                  newTotalOpponentPoints >= prevState.targetScore;

                end = {
                  isGameOver: matchFinished,
                  winner: matchFinished
                    ? newTotalMyPoints >= prevState.targetScore
                      ? 1
                      : 2
                    : null,
                  isPartidaOver: true,
                  newTotalMyPoints,
                  newTotalOpponentPoints,
                };
              } else {
                end = { isGameOver: false, isPartidaOver: false };
              }
            } else {
              // Original logic for Briskula or single-partija Treseta
              end = useTreseta
                ? (function () {
                    const p1Akuze = calculateAkuzeTreseta(myCards || []);
                    const p2Akuze = calculateAkuzeTreseta(aiCards || []);
                    return checkGameEndTreseta(
                      { points: p1Points },
                      { points: p2Points },
                      p1Akuze,
                      p2Akuze,
                      remaining,
                      myHandAfterDraw,
                      aiHandAfterDraw
                    );
                  })()
                : checkGameEnd(
                    p1Points,
                    p2Points,
                    remaining,
                    myHandAfterDraw,
                    aiHandAfterDraw,
                    winner
                  );
            }

            aiThinking.current = false;
            roundResolving.current = false;
            // For local Trešeta, show the pickup animation like server does
            if (
              prevState.gameType === "treseta" &&
              (newCards.player1 || newCards.player2)
            ) {
              const myCard =
                prevState.playerNumber === 1
                  ? newCards.player1
                  : newCards.player2;
              const opponentCard =
                prevState.playerNumber === 1
                  ? newCards.player2
                  : newCards.player1;
              setCardPickupAnimation({
                myCard: myCard,
                opponentCard: opponentCard,
                roundWinner: winner,
                playerNumber: prevState.playerNumber,
              });

              // Ukloni animaciju nakon 2 sekunde
              setTimeout(() => {
                setCardPickupAnimation(null);
              }, 2000);
            }
            return {
              ...prevState,
              myHand: myHandAfterDraw,
              aiHand: aiHandAfterDraw,
              myCards,
              aiCards,
              playedCards: [],
              currentPlayer: winner, // Winner starts next round
              message:
                winner === 1
                  ? "Uzeli ste rundu! Vaš red."
                  : "Protivnik je uzeo rundu. Njegov red.",
              lastTrickWinner: winner,
              remainingDeck: remaining,
              remainingCardsCount: remaining.length,
              opponentHandCount: aiHandAfterDraw.length,
              hasPlayedFirstRound: true, // Mark that first round is complete - no more akuze
              gamePhase: end.isGameOver
                ? "finished"
                : end.isPartidaOver
                ? "partidaFinished"
                : "playing",
              winner: end.isGameOver ? end.winner : null,
              myPoints:
                p1Points +
                (prevState.myAkuze?.reduce(
                  (sum, akuz) => sum + akuz.points,
                  0
                ) || 0),
              opponentPoints:
                p2Points +
                (prevState.opponentAkuze?.reduce(
                  (sum, akuz) => sum + akuz.points,
                  0
                ) || 0),
              playableCards:
                prevState.gameType === "treseta" && !end.isGameOver
                  ? myHandAfterDraw.map((c) => c.id) // Simplified for AI mode
                  : myHandAfterDraw.map((c) => c.id),
              roundResolving: false,

              // Update total points for Treseta long-term scoring
              ...(useTreseta &&
                end.newTotalMyPoints !== undefined && {
                  totalMyPoints: end.newTotalMyPoints,
                  totalOpponentPoints: end.newTotalOpponentPoints,
                  partijas: [
                    ...prevState.partijas,
                    {
                      partija: prevState.currentPartija,
                      myPoints:
                        p1Points +
                        (prevState.myAkuze?.reduce(
                          (sum, akuz) => sum + akuz.points,
                          0
                        ) || 0),
                      opponentPoints:
                        p2Points +
                        (prevState.opponentAkuze?.reduce(
                          (sum, akuz) => sum + akuz.points,
                          0
                        ) || 0),
                      winner:
                        p1Points +
                          (prevState.myAkuze?.reduce(
                            (sum, akuz) => sum + akuz.points,
                            0
                          ) || 0) >
                        p2Points +
                          (prevState.opponentAkuze?.reduce(
                            (sum, akuz) => sum + akuz.points,
                            0
                          ) || 0)
                          ? 1
                          : p2Points +
                              (prevState.opponentAkuze?.reduce(
                                (sum, akuz) => sum + akuz.points,
                                0
                              ) || 0) >
                            p1Points +
                              (prevState.myAkuze?.reduce(
                                (sum, akuz) => sum + akuz.points,
                                0
                              ) || 0)
                          ? 2
                          : 0,
                    },
                  ],
                  currentPartija: prevState.currentPartija + 1,
                  canAkuze: prevState.akuzeEnabled, // Reset akuze based on settings
                }),
            };
          });

          // Reset card playing flag when round resolves
          setIsCardPlaying(false);
        }, 1500);

        return tempState;
      }

      // Inače – samo promijeni red
      const isFirstCardInRound =
        !prevState.playedCards[0] && !prevState.playedCards[1];

      return {
        ...prevState,
        myHand: newMyHand,
        aiHand: newAiHand,
        playedCards: newPlayedCards,
        currentPlayer: playerNum === 1 ? 2 : 1,
        message:
          playerNum === 1
            ? "Čekamo potez AI bota..."
            : "Vaš red! Odaberite kartu.",
        opponentHandCount: newAiHand.length,
        hasPlayedFirstCard: newHasPlayedFirstCard,
      };
    });

    // Don't reset isCardPlaying here - wait until round fully resolves
    // This prevents rapid card clicking when playing as second player
  };

  useEffect(() => {
    // Only initialize when we have gameData and no current gameState
    if (!gameData || (gameState && Object.keys(gameState).length > 0)) {
      return;
    }

    console.log("🔄 [Game] useEffect triggered with gameData:", gameData);
    const initialState = initializeGameState();
    console.log("🔄 [Game] initializeGameState returned:", initialState);
    if (initialState) {
      setGameState(initialState);
      console.log("✅ [Game] gameState set successfully");
    } else {
      console.log("❌ [Game] initializeGameState returned null/undefined");
    }
  }, [gameData, gameState]);

  // Handle game state restoration from SocketContext
  useEffect(() => {
    if (savedGameStateFromContext && !gameData) {
      console.log(
        "🔄 [Game] Restoring game state from SocketContext:",
        savedGameStateFromContext
      );

      // For AI games, restore the exact saved state directly
      if (savedGameStateFromContext.mode === "ai") {
        console.log("🤖 [Game] Restoring AI game state directly");
        setGameState(savedGameStateFromContext);
        console.log("✅ [Game] AI game state restored from SocketContext");
      } else {
        // For online games, use the server data processing function
        const restoredState = createGameStateFromData(
          savedGameStateFromContext
        );
        if (restoredState) {
          setGameState(restoredState);
          console.log(
            "✅ [Game] Online game state restored from SocketContext"
          );
        }
      }
    }
  }, [savedGameStateFromContext, gameData]);

  // Auto-reconnect handled by SocketContext now
  useEffect(() => {
    console.log(
      "🔄 Game component mounted - auto-reconnect handled by SocketContext"
    );
  }, []);

  // AI Akuze notification effect - show AI akuze at start of partija
  useEffect(() => {
    if (
      gameState &&
      gameState.mode === "ai" &&
      gameState.gameType === "treseta" &&
      gameState.akuzeEnabled &&
      gameState.opponentAkuze &&
      gameState.opponentAkuze.length > 0 &&
      !gameState.hasPlayedFirstCard &&
      !gameState.aiAkuzeAnnounced
    ) {
      // Delay showing AI akuze message to let initial UI settle
      const timer = setTimeout(() => {
        const totalAkuzePoints = gameState.opponentAkuze.reduce(
          (sum, akuz) => sum + akuz.points,
          0
        );
        const akuzeDescriptions = gameState.opponentAkuze
          .map((akuz) => akuz.description)
          .join(", ");

        addToast(
          `🤖 AI je akužavao: ${akuzeDescriptions} (+${totalAkuzePoints} bod${
            totalAkuzePoints === 1 ? "" : totalAkuzePoints <= 4 ? "a" : "ova"
          })`,
          "info",
          5000 // Show for 5 seconds
        );

        // Mark AI akuze as announced
        setGameState((prev) => ({
          ...prev,
          aiAkuzeAnnounced: true,
        }));
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [
    gameState?.opponentAkuze,
    gameState?.hasPlayedFirstCard,
    gameState?.aiAkuzeAnnounced,
    addToast,
  ]);

  useEffect(() => {
    // Disable AI logic in tournament matches or non-AI modes
    if (gameState?.isTournamentMatch) return;
    if (!gameState) return;
    // Only apply to AI mode
    if (mode !== "ai") return;

    const played = Array.isArray(gameState.playedCards)
      ? gameState.playedCards
      : [];

    if (
      gameState.currentPlayer === 2 &&
      !aiThinking.current &&
      !roundResolving.current &&
      gameState.gamePhase === "playing" &&
      played.filter((c) => c).length < 2
    ) {
      aiThinking.current = true;
      setTimeout(() => {
        const aiIsFirst = !played[0];
        const firstPlayedCard = (played || []).find((c) => c) || null;
        let aiHandForChoice = gameState.aiHand || [];
        if (gameState.gameType === "treseta" && firstPlayedCard && !aiIsFirst) {
          const sameSuit = (gameState.aiHand || []).filter(
            (c) => c.suit === firstPlayedCard.suit
          );
          if (sameSuit.length > 0) aiHandForChoice = sameSuit;
        }
        const aiCard =
          gameState.gameType === "treseta"
            ? chooseAiTreseta({
                hand: aiHandForChoice,
                opponentCard: firstPlayedCard,
                aiIsFirst: aiIsFirst,
              })
            : chooseAiBriskula({
                hand: aiHandForChoice,
                opponentCard: firstPlayedCard,
                trumpSuit: gameState.trumpSuit,
                aiIsFirst: aiIsFirst,
              });
        if (aiCard) {
          playLocalCard(aiCard, 2);
        } else {
          aiThinking.current = false;
        }
      }, 1200);
    }
  }, [gameState, mode]);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Countdown timer for player disconnection grace period
  useEffect(() => {
    if (!disconnectionInfo || !disconnectionInfo.graceEndsAt) return;

    const updateCountdown = () => {
      const timeLeft = Math.max(0, disconnectionInfo.graceEndsAt - Date.now());
      setGraceTimeLeft(Math.ceil(timeLeft / 1000));

      if (timeLeft <= 0) {
        // Grace period ended, reset disconnection info
        setDisconnectionInfo(null);
        setPlayerDisconnected(false);
      }
    };

    updateCountdown(); // Initial update
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [disconnectionInfo]);

  // Separate useEffect for saving game state to avoid infinite loops
  useEffect(() => {
    if (
      gameState?.gamePhase === "playing" &&
      gameState?.roomId &&
      gameState?.mode === "online" &&
      gameState?.mode !== "spectator" // Don't save state for spectators
    ) {
      const timeoutId = setTimeout(() => {
        // Avoid nesting gameState - just save the enhanced state directly
        const onlineGameState = {
          ...gameState,
          roomId: gameState.roomId,
          gameMode: gameData?.gameMode || "1v1",
          gameType: gameState.gameType,
          opponent: gameState.opponent,
          playerNumber: gameState.playerNumber,
          // No nested gameState - all data is at top level
        };
        saveGameState(onlineGameState);
      }, 1000); // Debounce saving to prevent too frequent calls

      return () => clearTimeout(timeoutId);
    }

    // Also save AI game state to enable proper refresh handling
    if (
      gameState &&
      gameState.mode === "ai" &&
      gameState.gamePhase !== "finished"
    ) {
      const timeoutId = setTimeout(() => {
        // Save complete AI game state for perfect restoration
        const completeAIState = {
          ...gameState, // Include all current game state
          roomId: gameState.roomId || "local-ai",
          gameMode: "1vAI", // Important: save as 1vAI to indicate AI mode
          gameType: gameState.gameType,
          opponent: gameState.opponent,
          playerNumber: gameState.playerNumber,
          mode: "ai", // Explicitly save mode
          // Ensure AI-specific fields are preserved
          aiHand: gameState.aiHand,
          myHand: gameState.myHand,
          remainingDeck: gameState.remainingDeck,
          trump: gameState.trump,
          trumpSuit: gameState.trumpSuit,
          playedCards: gameState.playedCards,
          myCards: gameState.myCards,
          aiCards: gameState.aiCards,
          currentPlayer: gameState.currentPlayer,
          gamePhase: gameState.gamePhase,
          myPoints: gameState.myPoints,
          opponentPoints: gameState.opponentPoints,
          // Treseta specific fields
          ...(gameState.gameType === "treseta" && {
            totalMyPoints: gameState.totalMyPoints,
            totalOpponentPoints: gameState.totalOpponentPoints,
            partijas: gameState.partijas,
            currentPartija: gameState.currentPartija,
            myAkuze: gameState.myAkuze,
            opponentAkuze: gameState.opponentAkuze,
            akuzeEnabled: gameState.akuzeEnabled,
            canAkuze: gameState.canAkuze,
            hasPlayedFirstCard: gameState.hasPlayedFirstCard,
            hasPlayedFirstRound: gameState.hasPlayedFirstRound,
            targetScore: gameState.targetScore,
            aiAkuzeAnnounced: gameState.aiAkuzeAnnounced,
          }),
        };

        console.log(
          "💾 [Game] Saving complete AI game state:",
          completeAIState
        );
        saveGameState(completeAIState);
      }, 1000);

      return () => clearTimeout(timeoutId);
    }
  }, [gameState]);

  // --- NOVO: Spectator mode and reconnect socket handlers ---
  useEffect(() => {
    if (!socket) return;

    // Reconnect handlers
    socket.on("gameStateReconnected", (data) => {
      console.log("🔄 Reconnected to game:", data);
      setPlayerDisconnected(false);
      setReconnectModalVisible(false);

      // Save reconnect data for future use
      if (data.playerId && data.roomId) {
        localStorage.setItem("playerId", data.playerId);
        localStorage.setItem("roomId", data.roomId);
      }

      // Convert raw server gameState to frontend format
      const rawGameState = data.gameState;
      const playerNumber = data.playerNumber;
      const opponent = data.players?.find(
        (p) => p.playerNumber !== playerNumber
      );

      // Create properly formatted gameState for frontend
      const convertedGameState = {
        ...rawGameState,
        myHand: rawGameState[`player${playerNumber}Hand`] || [],
        opponentHandCount:
          rawGameState[`player${playerNumber === 1 ? 2 : 1}Hand`]?.length || 0,
        myCards: rawGameState[`player${playerNumber}Cards`] || [],
        opponentCards:
          rawGameState[`player${playerNumber === 1 ? 2 : 1}Cards`] || [],
        myPoints: rawGameState[`player${playerNumber}Points`] || 0,
        opponentPoints:
          rawGameState[`player${playerNumber === 1 ? 2 : 1}Points`] || 0,
        playableCards: data.playableCards || rawGameState.playableCards || [],
        // For Treseta specific fields
        myAkuze: rawGameState[`player${playerNumber}Akuze`] || {
          points: 0,
          details: [],
        },
        opponentAkuze: rawGameState[
          `player${playerNumber === 1 ? 2 : 1}Akuze`
        ] || { points: 0, details: [] },
        totalMyPoints:
          playerNumber === 1
            ? rawGameState.totalPlayer1Points
            : rawGameState.totalPlayer2Points,
        totalOpponentPoints:
          playerNumber === 1
            ? rawGameState.totalPlayer2Points
            : rawGameState.totalPlayer1Points,
      };

      // Restore game state from reconnection data
      const reconnectedState = createGameStateFromData({
        roomId: data.roomId,
        gameState: convertedGameState,
        playerNumber: data.playerNumber,
        gameType: data.gameType,
        gameMode: data.gameMode,
        players: data.players,
        opponent: opponent,
        playableCards: data.playableCards,
      });

      if (reconnectedState) {
        setGameState(reconnectedState);
        addToast("Uspješno reconnectani u igru!", "success");
      }
    });

    socket.on("reconnectError", (data) => {
      addToast(`Reconnect greška: ${data.message}`, "error");
      setReconnectModalVisible(false);

      // Clear reconnect data if permanently left or room deleted
      if (
        data.message?.includes("napustili") ||
        data.message?.includes("ne postoji")
      ) {
        localStorage.removeItem("playerId");
        localStorage.removeItem("roomId");
      }
    });

    socket.on("playerDisconnected", (data) => {
      console.log("⚠️ Player disconnected:", data);
      if (data.canReconnect) {
        setPlayerDisconnected(true);
        setDisconnectionInfo({
          graceEndsAt: data.graceEndsAt,
          message: data.message,
          canReconnect: data.canReconnect,
          graceMs: data.graceMs,
        });
        addToast(`${data.message}`, "info");
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
        // Show permanent disconnect modal
        setPlayerDisconnected(true);
        setDisconnectionInfo({
          message: data.message,
          canReconnect: false,
          permanent: true,
          reason: data.reason,
        });
        addToast(data.message, "error");
      }
    });

    // Add new event handlers
    socket.on("playerForfeited", (data) => {
      console.log("⚠️ Player forfeited:", data);
      setPlayerForfeited(true);
      setPlayerDisconnected(false);
      setDisconnectionInfo(null);

      let message = `${data.playerName} je predao meč`;
      if (
        data.winnerPlayerNumber &&
        data.winnerPlayerNumber === gameState?.playerNumber
      ) {
        message += ". Vi ste pobjednik!";
      }
      addToast(message, data.reason === "forfeit" ? "warning" : "info");

      // For tournament games or when there's a clear winner, set game to finished
      if (gameState?.isTournamentMatch || data.winnerPlayerNumber) {
        setGameState((prev) => {
          // If server provides updated gameState, use it
          if (data.gameState) {
            const isWinner = data.winnerPlayerNumber === prev.playerNumber;
            const winnerPoints = prev.gameType === "treseta" ? 31 : 61;

            return {
              ...prev,
              ...data.gameState,
              // Ensure proper client-side fields for display
              myPoints: isWinner ? winnerPoints : 0,
              opponentPoints: isWinner ? 0 : winnerPoints,
              totalMyPoints: isWinner ? winnerPoints : 0,
              totalOpponentPoints: isWinner ? 0 : winnerPoints,
              message: isWinner
                ? "🏆 Pobijedili ste! Protivnik je predao meč."
                : "😔 Predali ste meč.",
              gameInterrupted: false, // This is a clean finish, not an interruption
            };
          }

          // Fallback to old logic if no gameState provided
          const isWinner = data.winnerPlayerNumber === prev.playerNumber;
          const winnerPoints = prev.gameType === "treseta" ? 31 : 61;

          return {
            ...prev,
            gamePhase: "finished",
            winner: data.winnerPlayerNumber,
            myPoints: isWinner ? winnerPoints : 0,
            opponentPoints: isWinner ? 0 : winnerPoints,
            totalMyPoints: isWinner ? winnerPoints : 0,
            totalOpponentPoints: isWinner ? 0 : winnerPoints,
            message: isWinner
              ? "🏆 Pobijedili ste! Protivnik je predao meč."
              : "😔 Predali ste meč.",
            gameInterrupted: false, // This is a clean finish, not an interruption
          };
        });
      }

      // Clear game state for the forfeited player
      if (data.playerName === user?.name) {
        setTimeout(() => {
          clearGameState();
          navigate("/"); // Navigate back to main menu
        }, 3000);
      } else {
        // Also clear game state for the winner after showing the victory screen
        // This prevents reconnect dialogs when they refresh later
        setTimeout(() => {
          clearGameState();
        }, 10000); // Give them 10 seconds to see the victory screen
      }
    });

    socket.on("gameRoomDeleted", (data) => {
      console.log("🗑️ Game room deleted:", data);
      addToast(data.message, "warning");
      clearGameState();
      setTimeout(() => {
        navigate("/");
      }, 2000);
    });

    socket.on("spectatorUpdate", (data) => {
      console.log("👁️ Spectator update received");
      // Update spectator state if we're spectating
      if (isSpectator && data.roomId === gameState?.roomId) {
        setSpectatorState((prev) => ({
          ...prev,
          gameState: data.gameState,
          players: data.players,
        }));
      }
    });

    return () => {
      socket.off("gameStateReconnected");
      socket.off("reconnectError");
      socket.off("playerDisconnected");
      socket.off("playerReconnected");
      socket.off("playerLeft");
      socket.off("playerForfeited");
      socket.off("gameRoomDeleted");
      socket.off("spectatorStart");
      socket.off("spectatorUpdate");
    };
  }, [socket, addToast]);

  // Auto-join as spectator if in spectator mode
  useEffect(() => {
    if (isSpectator && spectatorRoomId && socket && !spectatorState) {
      console.log("👁️ Auto-joining as spectator for room:", spectatorRoomId);
      socket.emit("joinAsSpectator", { roomId: spectatorRoomId });
    }
  }, [isSpectator, spectatorRoomId, socket, spectatorState]);

  // Socket event listeners (keeping the same logic as original)
  useEffect(() => {
    if (!socket || !gameState?.roomId) return;

    // Skip if not online mode and not spectator mode
    if (gameState?.mode !== "online" && gameState?.mode !== "spectator") return;

    // Listener za novu igru nakon revan��a ili spectator join
    socket.on("gameStart", (newGameData) => {
      console.log("🎮 Nova igra počinje (revanš ili spectator):", newGameData);
      console.log("🎮 Spectator flag:", newGameData.spectator);
      console.log("🎮 Opponent data received:", newGameData.opponent);
      console.log("🎮 Player number:", newGameData.playerNumber);
      console.log("🎮 Is resume/reconnect:", newGameData.isResume);

      // Save reconnect data if this is a player (not spectator)
      if (
        !newGameData.spectator &&
        newGameData.playerId &&
        newGameData.roomId
      ) {
        localStorage.setItem("playerId", newGameData.playerId);
        localStorage.setItem("roomId", newGameData.roomId);
        console.log("💾 Saved reconnect data:", {
          playerId: newGameData.playerId,
          roomId: newGameData.roomId,
        });
      }

      // If this is spectator data, update spectator state
      if (newGameData.spectator) {
        setIsSpectator(true);
        setSpectatorState(newGameData);
      }

      // If this is a resume/reconnect, merge with existing state instead of replacing
      if (newGameData.isResume) {
        console.log("🔄 Resuming existing game, merging state...");
        setPlayerDisconnected(false);
        setReconnectModalVisible(false);

        // Convert raw server gameState to frontend format (same as gameStateReconnected)
        const rawGameState = newGameData.gameState;
        const playerNumber = newGameData.playerNumber;

        const convertedGameState = {
          ...rawGameState,
          myHand: rawGameState[`player${playerNumber}Hand`] || [],
          opponentHandCount:
            rawGameState[`player${playerNumber === 1 ? 2 : 1}Hand`]?.length ||
            0,
          myCards: rawGameState[`player${playerNumber}Cards`] || [],
          opponentCards:
            rawGameState[`player${playerNumber === 1 ? 2 : 1}Cards`] || [],
          myPoints: rawGameState[`player${playerNumber}Points`] || 0,
          opponentPoints:
            rawGameState[`player${playerNumber === 1 ? 2 : 1}Points`] || 0,
          playableCards:
            newGameData.playableCards || rawGameState.playableCards || [],
          // For Treseta specific fields
          myAkuze: rawGameState[`player${playerNumber}Akuze`] || {
            points: 0,
            details: [],
          },
          opponentAkuze: rawGameState[
            `player${playerNumber === 1 ? 2 : 1}Akuze`
          ] || { points: 0, details: [] },
          totalMyPoints:
            playerNumber === 1
              ? rawGameState.totalPlayer1Points
              : rawGameState.totalPlayer2Points,
          totalOpponentPoints:
            playerNumber === 1
              ? rawGameState.totalPlayer2Points
              : rawGameState.totalPlayer1Points,
        };

        // Restore game state from reconnection data
        const reconnectedState = createGameStateFromData({
          roomId: newGameData.roomId,
          gameState: convertedGameState,
          playerNumber: newGameData.playerNumber,
          gameType: newGameData.gameType,
          gameMode: newGameData.gameMode,
          players: newGameData.players,
          opponent: newGameData.opponent,
          playableCards: newGameData.playableCards,
          isTournamentMatch: newGameData.isTournamentMatch,
          tournamentId: newGameData.tournamentId,
          matchId: newGameData.matchId,
        });

        if (reconnectedState) {
          setGameState(reconnectedState);
          addToast("Uspješno reconnectani u igru!", "success");
        }
        return; // Don't create new state below
      }

      // Create new state directly from newGameData (for new games/rematch)
      const newState = createGameStateFromData(newGameData);
      if (newState) {
        setGameState(newState);
      }
    });

    // Obavijest: protivnik je odustao od revanša
    socket.on("rematchDeclined", (data) => {
      console.log("❌ Revanš odbijen:", data);
      // Ako čekamo revanš, prekini matchmaking i vrati na završni ekran
      setGameState((prev) => {
        // Samo ako smo bili u traženju revanša ili na završnom ekranu
        const wasWaiting = prev.gamePhase === "matchmaking";
        // Otkaži globalni matchmaking queue na serveru da ne uparimo novog protivnika
        try {
          socket.emit("cancelMatch");
        } catch (_) {}
        // Prikaži brzi toast da je protivnik izašao
        try {
          addToast(
            "Protivnik je odustao od revanša i izašao u glavni meni.",
            "warning"
          );
        } catch (_) {}
        return {
          ...prev,
          gamePhase: "finished",
          opponentDeclinedRematch: true,
          message: wasWaiting
            ? "Protivnik je odustao od revanša."
            : prev.message,
        };
      });
    });

    // Spectator start handler
    socket.on("spectatorStart", (spectatorData) => {
      console.log("👁️ Spectator start:", spectatorData);
      setIsSpectator(true);
      setSpectatorState(spectatorData);

      // Create spectator game state
      const spectatorGameState = {
        mode: "spectator",
        roomId: spectatorData.roomId,
        playerNumber: null,
        opponent: null,
        gameType: spectatorData.gameType,
        gameMode: spectatorData.gameMode,
        myHand: [],
        opponentHandCount: 0,
        myCards: [],
        opponentCards: [],
        ...spectatorData.publicState,
        player1Name:
          spectatorData.roomPlayers?.find((p) => p.playerNumber === 1)?.name ||
          "Igrač 1",
        player2Name:
          spectatorData.roomPlayers?.find((p) => p.playerNumber === 2)?.name ||
          "Igrač 2",
        players: spectatorData.roomPlayers || [],
        isTournamentMatch: spectatorData.isTournamentMatch || false,
        tournamentId: spectatorData.tournamentId,
        matchId: spectatorData.matchId,
        playableCards: [],
        message: `👁️ Gledate: ${
          spectatorData.roomPlayers?.find((p) => p.playerNumber === 1)?.name ||
          "Igrač 1"
        } vs ${
          spectatorData.roomPlayers?.find((p) => p.playerNumber === 2)?.name ||
          "Igrač 2"
        }`,
      };

      setGameState(spectatorGameState);
    });

    // Spectator update handler
    socket.on("spectatorUpdate", (publicStateUpdate) => {
      console.log("👁️ Spectator update:", publicStateUpdate);
      setGameState((prev) => ({
        ...prev,
        ...publicStateUpdate,
        message: `👁️ Gledate: ${prev.player1Name || "Igrač 1"} vs ${
          prev.player2Name || "Igrač 2"
        }`,
      }));
    });

    socket.on("cardPlayed", (data) => {
      setGameState((prev) => {
        // For spectators, just update played cards and public info
        if (prev.mode === "spectator") {
          return {
            ...prev,
            playedCards: data.playedCards,
            currentPlayer: data.nextPlayer || prev.currentPlayer,
            message: `👁️ Gledate: ${prev.player1Name || "Igrač 1"} vs ${
              prev.player2Name || "Igrač 2"
            }`,
          };
        }

        // Check if this is the first card played in the partija
        const isFirstCardInPartija =
          prev.gameType === "treseta" && !prev.hasPlayedFirstCard;

        return {
          ...prev,
          playedCards: data.playedCards,
          myHand:
            data.playerNumber === prev.playerNumber
              ? prev.myHand.filter((c) => c.id !== data.card.id)
              : prev.myHand,
          opponentHandCount:
            data.playerNumber !== prev.playerNumber
              ? prev.opponentHandCount - 1
              : prev.opponentHandCount,
          message:
            data.playerNumber === prev.playerNumber
              ? "Čekamo protivnikov potez..."
              : "Vaš red je! Odgovorite na kartu.",
          // Set hasPlayedFirstCard to true after first card is played
          hasPlayedFirstCard: isFirstCardInPartija
            ? true
            : prev.hasPlayedFirstCard,
        };
      });

      // DON'T reset card playing flag here - wait for roundFinished
      // setIsCardPlaying(false);
    });

    socket.on("turnChange", (data) => {
      setGameState((prev) => {
        // For spectators, don't show turn-based messages
        if (prev.mode === "spectator") {
          return {
            ...prev,
            currentPlayer: data.currentPlayer,
            message: `👁️ Gledate: ${prev.player1Name || "Igrač 1"} vs ${
              prev.player2Name || "Igrač 2"
            }`,
          };
        }

        return {
          ...prev,
          currentPlayer: data.currentPlayer,
          message:
            data.currentPlayer === prev.playerNumber
              ? "Vaš red! Odaberite kartu."
              : "Protivnikov red. Čekajte...",
        };
      });
    });

    socket.on("roundFinished", (data) => {
      setGameState((prev) => {
        const useTreseta = prev.gameType === "treseta";

        let newState = {
          ...prev,
          myHand: prev.playerNumber === 1 ? data.player1Hand : data.player2Hand,
          opponentHandCount:
            prev.playerNumber === 1
              ? (data.player2Hand || []).length
              : (data.player1Hand || []).length,
          trump: data.trump,
          myCards:
            prev.playerNumber === data.roundWinner
              ? [...prev.myCards, ...prev.playedCards]
              : prev.myCards,
          opponentCards:
            prev.playerNumber === data.roundWinner
              ? prev.opponentCards
              : [...prev.opponentCards, ...prev.playedCards],
          playedCards: [],
          currentPlayer: data.currentPlayer,
          remainingCardsCount: data.remainingCards,
          // Ažuriraj playableCards za Trešetu
          playableCards:
            prev.gameType === "treseta"
              ? (prev.playerNumber === 1
                  ? data.player1PlayableCards
                  : data.player2PlayableCards) || []
              : prev.playableCards,
        };

        // Calculate points locally for Treseta (like in AI mode)
        if (useTreseta) {
          // Check if all cards are played for ultima bonus
          const isAllCardsPlayed =
            data.remainingCards === 0 &&
            (prev.playerNumber === 1 ? data.player1Hand : data.player2Hand)
              ?.length === 0 &&
            (prev.playerNumber === 1 ? data.player2Hand : data.player1Hand)
              ?.length === 0;
          const ultimaWinner = isAllCardsPlayed ? data.roundWinner : null;

          // Calculate points from won cards
          const myCardPoints = calculatePointsTreseta(
            newState.myCards,
            ultimaWinner,
            prev.playerNumber
          ).points;
          const opponentCardPoints = calculatePointsTreseta(
            newState.opponentCards,
            ultimaWinner,
            prev.playerNumber === 1 ? 2 : 1
          ).points;

          // Don't add akuze points here - they will be added only at the end of partija
          newState.myPoints = myCardPoints;
          newState.opponentPoints = opponentCardPoints;
        } else {
          // For Briskula, use server-provided points or calculate locally
          newState.myPoints =
            prev.playerNumber === 1
              ? data.player1Points?.points || calculatePoints(newState.myCards)
              : data.player2Points?.points || calculatePoints(newState.myCards);
          newState.opponentPoints =
            prev.playerNumber === 1
              ? data.player2Points?.points ||
                calculatePoints(newState.opponentCards)
              : data.player1Points?.points ||
                calculatePoints(newState.opponentCards);
        }

        // Ažuriraj akuže podatke za Trešeta (ako postoje)
        if (
          prev.gameType === "treseta" &&
          data.player1Akuze &&
          data.player2Akuze
        ) {
          newState.myAkuze =
            prev.playerNumber === 1
              ? data.player1Akuze.details || []
              : data.player2Akuze.details || [];
          newState.opponentAkuze =
            prev.playerNumber === 1
              ? data.player2Akuze.details || []
              : data.player1Akuze.details || [];
        }

        // For Treseta with long-term scoring, check if partija is over
        if (
          useTreseta &&
          prev.totalMyPoints !== undefined &&
          (data.gameEnd.isPartidaOver || data.gameEnd.isGameOver)
        ) {
          // This means all cards are played - partija is finished
          // Now add akuze points to the final partija score
          const myAkuzePoints =
            prev.myAkuze?.reduce((sum, akuz) => sum + akuz.points, 0) || 0;
          const opponentAkuzePoints =
            prev.opponentAkuze?.reduce((sum, akuz) => sum + akuz.points, 0) ||
            0;

          const myPartidaPoints = newState.myPoints + myAkuzePoints;
          const opponentPartidaPoints =
            newState.opponentPoints + opponentAkuzePoints;

          // Update display points to include akuze
          newState.myPoints = myPartidaPoints;
          newState.opponentPoints = opponentPartidaPoints;

          // Add current partija points to total
          const newTotalMyPoints = prev.totalMyPoints + myPartidaPoints;
          const newTotalOpponentPoints =
            prev.totalOpponentPoints + opponentPartidaPoints;

          // Check if someone reached target score (only if whole game is over)
          const matchFinished =
            data.gameEnd.isGameOver &&
            (newTotalMyPoints >= prev.targetScore ||
              newTotalOpponentPoints >= prev.targetScore);

          if (matchFinished) {
            // Game is completely finished
            newState.gamePhase = "finished";
            newState.winner =
              newTotalMyPoints >= prev.targetScore
                ? prev.playerNumber
                : prev.playerNumber === 1
                ? 2
                : 1;
          } else {
            // Just partija finished, not the whole match
            newState.gamePhase = "partidaFinished";
            newState.winner = null;
          }

          // Update totals and partija history
          newState.totalMyPoints = newTotalMyPoints;
          newState.totalOpponentPoints = newTotalOpponentPoints;
          newState.partijas = [
            ...prev.partijas,
            {
              partija: prev.currentPartija,
              myPoints: myPartidaPoints,
              opponentPoints: opponentPartidaPoints,
              winner:
                myPartidaPoints > opponentPartidaPoints
                  ? prev.playerNumber
                  : opponentPartidaPoints > myPartidaPoints
                  ? prev.playerNumber === 1
                    ? 2
                    : 1
                  : 0,
            },
          ];
          newState.currentPartija = prev.currentPartija + 1;
          newState.canAkuze = prev.akuzeEnabled; // Reset akuze based on settings
        } else if (data.gameEnd.isGameOver) {
          // Game over logic
          newState.gamePhase = "finished";
          newState.winner = data.gameEnd.winner;

          // Update total points from server if provided (for Trešeta series)
          if (data.gameEnd.newTotalPlayer1Points !== undefined) {
            if (prev.playerNumber === 1) {
              newState.totalMyPoints = data.gameEnd.newTotalPlayer1Points;
              newState.totalOpponentPoints = data.gameEnd.newTotalPlayer2Points;
            } else {
              newState.totalMyPoints = data.gameEnd.newTotalPlayer2Points;
              newState.totalOpponentPoints = data.gameEnd.newTotalPlayer1Points;
            }
          }
        } else {
          newState.gamePhase = "playing";
        }

        // Set appropriate messages
        if (newState.gamePhase === "finished") {
          // Clear saved game state when game ends
          clearGameState();

          if (useTreseta && prev.totalMyPoints !== undefined) {
            // Long-term scoring finished message
            if (newState.winner === prev.playerNumber) {
              newState.message = `🎉 Pobijedili ste meč! (${newState.totalMyPoints}:${newState.totalOpponentPoints})`;
            } else {
              newState.message = `😔 Izgubili ste meč. (${newState.totalMyPoints}:${newState.totalOpponentPoints})`;
            }
          } else {
            // Single game finished message
            if (data.gameEnd.winner === prev.playerNumber) {
              newState.message = `🎉 Pobijedili ste!`;
            } else if (data.gameEnd.winner === null) {
              newState.message = `🤝 Neriješeno! (${data.gameEnd.reason})`;
            } else {
              newState.message = `😔 Izgubili ste.`;
            }
          }
        } else if (newState.gamePhase === "partidaFinished") {
          const partidaWinner =
            newState.myPoints > newState.opponentPoints ? "Vi" : "Protivnik";
          newState.message = `Partija završena! ${partidaWinner} ste uzeli ${
            newState.currentPartija - 1
          }. partiju. (${newState.myPoints}:${newState.opponentPoints})`;
        } else {
          // Pokreni animaciju pokupljenih karata iz špila (samo za Trešetu)
          if (
            prev.gameType === "treseta" &&
            data.newCards &&
            (data.newCards.player1 || data.newCards.player2)
          ) {
            const myCard =
              prev.playerNumber === 1
                ? data.newCards.player1
                : data.newCards.player2;
            const opponentCard =
              prev.playerNumber === 1
                ? data.newCards.player2
                : data.newCards.player1;

            // Pokreni animaciju pokupljenih karata
            if (myCard || opponentCard) {
              setCardPickupAnimation({
                myCard: myCard,
                opponentCard: opponentCard,
                roundWinner: data.roundWinner,
                playerNumber: prev.playerNumber,
              });

              // Ukloni animaciju nakon 3 sekunde
              setTimeout(() => {
                setCardPickupAnimation(null);
              }, 2000);
            }
          }

          newState.message =
            data.roundWinner === prev.playerNumber
              ? `Uzeli ste rundu! Vaš red.`
              : `Protivnik je uzeo rundu. Njihov red.`;
        }

        // Mark that first round has been completed - no more akuze allowed
        newState.hasPlayedFirstRound = true;

        return newState;
      });

      // Reset card playing flag when round finishes
      setIsCardPlaying(false);

      // Ne automatski preusmjeravaj na glavni ekran - neka igrač sam odluči
    });

    socket.on("playerDisconnected", (data) => {
      // Let the modern handler (first useEffect) manage all disconnections with toasts and grace periods
      // This applies to both Briskula and Treseta games
      return;
    });

    socket.on("playerLeft", (data) => {
      // In tournaments, don't kick the local player; show info and let them spectate/rejoin
      if (gameState?.isTournamentMatch) {
        addToast(data.message, data.permanent ? "warning" : "info");
        setGameState((prev) => ({
          ...prev,
          gameInterrupted: true,
          message: data.message,
        }));
        return;
      }

      if (data.permanent) {
        // Permanent leave - room will be deleted, clear state and redirect
        clearGameState();
        addToast(
          "Protivnik je trajno napustio igru. Vraćam vas na glavni meni.",
          "warning"
        );
        setTimeout(() => {
          onGameEnd();
        }, 2000);
      } else {
        // Temporary leave - let the modern handler manage this for all games
        // This applies to both Briskula and Treseta games
        return;
      }
    });

    // Handle room deletion
    socket.on("roomDeleted", (data) => {
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

    // Trešeta - ažuriranje igrljivih karata
    socket.on("playableCardsUpdate", (data) => {
      console.log("🎮 Playable cards update:", data.playableCards);
      setGameState((prev) => ({
        ...prev,
        playableCards: data.playableCards,
      }));
    });

    // Trešeta - nevaljan potez
    socket.on("invalidMove", (data) => {
      console.log("❌ Invalid move:", data.message);
      addToast(`Nevaljan potez: ${data.message}`, "error");
    });

    // Akuže announced by opponent
    socket.on("akuzeAnnounced", (data) => {
      // Only add to opponentAkuze if it's not from current player
      if (data.playerNumber !== gameState?.playerNumber) {
        const message = `${data.playerName || "Protivnik"} je akužao ${
          data.akuz.description
        } (+${data.akuz.points} bodova)!`;

        setGameState((prev) => ({
          ...prev,
          opponentAkuze: [...(prev.opponentAkuze || []), data.akuz],
          message: message,
        }));

        addToast(message, "info");
      }
    });

    // New socket listener for partija restart in online Treseta games
    socket.on("partidaRestarted", (data) => {
      console.log("🔄 Received partidaRestarted from server:", data);

      // Reset next partija status since new partija started
      setNextPartidaStatus({
        playerReady: false,
        readyPlayers: [],
        waitingFor: 0,
      });

      setGameState((prev) => ({
        ...prev,
        myHand: prev.playerNumber === 1 ? data.player1Hand : data.player2Hand,
        opponentHandCount:
          prev.playerNumber === 1
            ? (data.player2Hand || []).length
            : (data.player1Hand || []).length,
        myCards: [],
        opponentCards: [],
        playedCards: [],
        currentPlayer: data.currentPlayer || 1,
        gamePhase: "playing",
        remainingCardsCount: data.remainingCards || 40,
        myPoints: 0,
        opponentPoints: 0,
        playableCards:
          prev.gameType === "treseta"
            ? (prev.playerNumber === 1
                ? data.player1PlayableCards
                : data.player2PlayableCards) ||
              (prev.playerNumber === 1
                ? data.player1Hand
                : data.player2Hand
              )?.map((c) => c.id) ||
              []
            : (prev.playerNumber === 1
                ? data.player1Hand
                : data.player2Hand
              )?.map((c) => c.id) || [],
        canAkuze: prev.akuzeEnabled, // Reset based on settings
        myAkuze: [], // Reset akuze for new partija
        opponentAkuze: [], // Reset akuze for new partija
        hasPlayedFirstCard: false, // Reset for new partija
        hasPlayedFirstRound: false, // Reset for new partija - allow akuze again
        message:
          "Nova partija! " +
          (data.currentPlayer === prev.playerNumber
            ? "Vaš red."
            : "Protivnikov red."),
      }));
    });

    // Handle partija continuation status from server
    socket.on("partidaContinueStatus", (data) => {
      console.log("📊 Received partidaContinueStatus:", data);
      setNextPartidaStatus({
        playerReady: data.isPlayerReady || false, // Use server's isPlayerReady flag
        readyPlayers: data.readyPlayers || [],
        waitingFor: data.waitingFor || 0,
      });
    });

    return () => {
      socket.off("gameStart");
      socket.off("rematchDeclined");
      socket.off("cardPlayed");
      socket.off("turnChange");
      socket.off("roundFinished");
      socket.off("playerDisconnected");
      socket.off("playerLeft");
      socket.off("roomDeleted");
      socket.off("reconnectFailed");
      socket.off("playableCardsUpdate");
      socket.off("invalidMove");
      socket.off("akuzeAnnounced");
      socket.off("partidaRestarted");
      socket.off("partidaContinueStatus");
    };
  }, [socket, gameState?.roomId, onGameEnd, mode]);

  // Helper: povratak u glavni meni uz obavijest da ne želimo revanš
  const handleReturnToMenu = () => {
    if (mode === "online" && gameState?.roomId) {
      // Obavijesti protivnika da ne želimo revanš
      try {
        socket?.emit("declineRematch", { roomId: gameState.roomId });
      } catch (_) {}
      // Također izađi iz matchmaking queue-a ako smo tamo
      try {
        socket?.emit("cancelMatch");
      } catch (_) {}
      // Trajno napusti sobu da se druga strana odmah izbaci iz igre
      try {
        leaveRoomPermanently(gameState.roomId);
      } catch (_) {}
    } else if (mode === "ai") {
      clearGameState();
    }
    onGameEnd();
  };

  const handleAkuze = (akuz) => {
    if (!gameState || !gameState.akuzeEnabled || !gameState.canAkuze) {
      console.log("[Akuze] Cannot akuze - disabled or already used:", {
        akuzeEnabled: gameState?.akuzeEnabled,
        canAkuze: gameState?.canAkuze,
      });
      return;
    }

    console.log("[Akuze] Player declared:", akuz);

    // Send to server for online games
    if (mode === "online" && socket) {
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
      "success"
    );
  };

  const handleContinueNextPartija = () => {
    if (!gameState.roomId || gameState.mode !== "online") {
      console.log("❌ Cannot continue - not in online mode or no room");
      return;
    }

    console.log("🔄 Player wants to continue next partija");

    // Don't set playerReady here - wait for server confirmation
    // setNextPartidaStatus(prev => ({ ...prev, playerReady: true }));

    // Emit to server
    socket.emit("continueNextPartija", {
      roomId: gameState.roomId,
      playerNumber: gameState.playerNumber,
    });
  };

  const startNewPartija = () => {
    if (!gameState || gameState.gameType !== "treseta") return;

    if (gameState.mode === "ai") {
      // AI mode - handle locally
      const deck = shuffleDeckTreseta(createDeckTreseta());
      const dealt = dealCardsTreseta(deck);

      setGameState((prev) => ({
        ...prev,
        myHand: dealt.player1Hand,
        aiHand: dealt.player2Hand,
        myCards: [],
        aiCards: [],
        playedCards: [],
        currentPlayer: 1,
        gamePhase: "playing",
        remainingDeck: dealt.remainingDeck,
        remainingCardsCount: dealt.remainingDeck.length,
        opponentHandCount: dealt.player2Hand.length,
        myPoints: 0,
        opponentPoints: 0,
        playableCards: dealt.player1Hand.map((c) => c.id),
        canAkuze: prev.akuzeEnabled, // Reset based on settings
        myAkuze: [], // Reset akuze for new partija
        opponentAkuze: prev.akuzeEnabled ? checkAiAkuze(dealt.player2Hand) : [], // AI automatski prijavi nove akuže u novoj partiji
        aiAkuzeAnnounced: false, // Reset for new partija
        hasPlayedFirstCard: false, // Reset for new partija
        hasPlayedFirstRound: false, // Reset for new partija - allow akuze again
        message: "Nova partija! Vaš red.",
      }));
    } else if (gameState.mode === "online" && socket && gameState.roomId) {
      // Online mode - request new partija from server
      console.log("🔄 Requesting new partija from server...");
      socket.emit("startNewPartija", {
        roomId: gameState.roomId,
        playerNumber: gameState.playerNumber,
      });

      // Set temporary message while waiting for server response
      setGameState((prev) => ({
        ...prev,
        message: "Pokretanje nove partije...",
      }));
    }
  };

  const handleCardClick = (card) => {
    if (!gameState) return;

    // Spectatori ne mogu igrati karte
    if (isSpectator || gameState.gamePhase === "spectating") {
      return;
    }

    // Block clicks if card is already playing
    if (isCardPlaying) {
      return;
    }

    if (
      gameState.gamePhase !== "playing" ||
      gameState.currentPlayer !== gameState.playerNumber
    ) {
      return;
    }

    if (mode === "ai") {
      // Set flag to prevent multiple clicks
      setIsCardPlaying(true);

      // Za AI mod - jednostavna provjera za tresetu
      if (gameState.gameType === "treseta") {
        // find first played card (array may be sparse)
        const firstCard = (gameState.playedCards || []).find((c) => c);
        if (firstCard) {
          const sameSuitCards = (gameState.myHand || []).filter(
            (c) => c.suit === firstCard.suit
          );
          if (sameSuitCards.length > 0 && card.suit !== firstCard.suit) {
            addToast("Morate baciti kartu iste boje ako je imate!", "error");
            setIsCardPlaying(false); // Reset flag on error
            return;
          }
        }
      }
      playLocalCard(card, 1);
      return;
    }

    // Za Trešetu - provjeri je li karta igriva
    if (
      gameState.gameType === "treseta" &&
      !gameState.playableCards.includes(card.id)
    ) {
      addToast(
        "Ne možete odigrati ovu kartu. Molimo odaberite drugu kartu.",
        "error"
      );
      return;
    }

    // Play card immediately with one click (consistent with 2v2 and AI)
    setIsCardPlaying(true);
    playCard(gameState.roomId, card);
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

  // Calculate current points including akuze for live display
  const getCurrentPoints = () => {
    if (gameState.gameType === "treseta") {
      // If game is finished, use total points across all partijas
      if (gameState.gamePhase === "finished") {
        return {
          myPoints: gameState.totalMyPoints || 0,
          opponentPoints: gameState.totalOpponentPoints || 0,
        };
      }

      // During gameplay, use current partija points + akuze
      const baseMyPoints = gameState.myPoints || 0;
      const baseOpponentPoints = gameState.opponentPoints || 0;

      const myAkuzePoints =
        gameState.myAkuze?.reduce((sum, akuz) => sum + akuz.points, 0) || 0;

      const opponentAkuzePoints =
        gameState.opponentAkuze?.reduce((sum, akuz) => sum + akuz.points, 0) ||
        0;

      return {
        myPoints: baseMyPoints + myAkuzePoints,
        opponentPoints: baseOpponentPoints + opponentAkuzePoints,
      };
    }

    return {
      myPoints: calculatePoints(gameState.myCards || []),
      opponentPoints: calculatePoints(
        mode === "ai" ? gameState.aiCards || [] : gameState.opponentCards || []
      ),
    };
  };

  const currentPoints = getCurrentPoints();
  const myPoints = currentPoints.myPoints;
  const opponentPoints = currentPoints.opponentPoints;

  // Determine reliable winner for finished view based on visible points
  const computedWinner = useMemo(() => {
    // If not finished, keep server/local winner as-is
    if (gameState?.gamePhase !== "finished") return gameState?.winner;

    if (myPoints > opponentPoints) return gameState.playerNumber;
    if (opponentPoints > myPoints) return gameState.playerNumber === 1 ? 2 : 1;
    // Tie – fall back to server decision (last trick)
    return gameState?.winner;
  }, [
    gameState?.gamePhase,
    gameState?.winner,
    gameState?.playerNumber,
    myPoints,
    opponentPoints,
  ]);

  const sumPoints = (cards) => {
    return cards.reduce((total, card) => total + (card.points || 0), 0);
  };

  const getCardCountText = (count) => {
    if (count === 1) return "1 karta";
    if (count < 5) return `${count} karte`;
    return `${count} karata`;
  };

  // Determine card sizes based on screen size
  const cardSize = isMobile ? "small" : "medium";
  const playedCardSize = "small"; // Always small for played cards
  const trumpCardSize = isMobile ? "small" : "medium";

  const opponentHandCount =
    mode === "ai" ? gameState.aiHand?.length || 0 : gameState.opponentHandCount;
  const remainingCount =
    mode === "ai"
      ? gameState.remainingDeck?.length || 0
      : gameState.remainingCardsCount;

  // Spectator and reconnect functions
  const handleReconnectAttempt = () => {
    if (!gameState?.roomId || !user?.name) {
      addToast("Nema podataka za reconnect", "error");
      return;
    }

    console.log(
      `🔄 Attempting reconnect to room ${gameState.roomId} as ${user.name}`
    );
    socket?.emit("reconnectToGame", {
      roomId: gameState.roomId,
      playerName: user.name,
    });
  };

  const handleJoinAsSpectator = (roomId) => {
    console.log(`👁️ Joining as spectator for room ${roomId}`);
    socket?.emit("joinAsSpectator", { roomId });
  };

  // Loading state for reconnect scenarios
  if (
    mode === "online" &&
    gameState &&
    !Array.isArray(gameState?.myHand) &&
    gameState.gamePhase === "waiting"
  ) {
    return (
      <div className="game-loading">
        <div className="loading-spinner"></div>
        <p>Obnavljam igru...</p>
      </div>
    );
  }

  return (
    <div className="game-wrapper">
      {/* Spectator Mode Badge */}
      {(isSpectator || gameState?.gamePhase === "spectating") && (
        <div
          style={{
            position: "fixed",
            top: "80px",
            right: "20px",
            background: "rgba(20,20,35,0.75)",
            backdropFilter: "blur(4px)",
            padding: "10px 18px",
            border: "1px solid #6366f1",
            borderRadius: "10px",
            color: "#e0e7ff",
            fontWeight: 600,
            zIndex: 1500,
            boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
          }}
        >
          👁️ Spectator mode
        </div>
      )}

      {/* Player Disconnected - Grace Period Banner */}
      {playerDisconnected &&
        !isSpectator &&
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
        !isSpectator &&
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
              <div
                className="countdown-timer"
                style={{
                  fontSize: "1.2em",
                  fontWeight: "bold",
                  color: "#ff6b35",
                  margin: "15px 0",
                }}
              >
                ⏰ {graceTimeLeft}s
              </div>
              <p style={{ fontSize: "0.9em", color: "#666" }}>
                Igra će se automatski nastaviti kad se igrač vrati.
              </p>
            </div>
          </div>
        )}

      {/* Reconnect Modal - Only for other scenarios */}
      {reconnectModalVisible && !playerDisconnected && !isSpectator && (
        <div className="modal-overlay" style={{ zIndex: 2000 }}>
          <div className="modal-content" style={{ maxWidth: "400px" }}>
            <h3>🔄 Reconnect</h3>
            <p>
              {playerDisconnected
                ? "Neki igrač se odspojio iz igre. Možete se reconnectati ili gledati kao spectator."
                : "Želite se reconnectati u igru?"}
            </p>
            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button
                onClick={handleReconnectAttempt}
                className="btn-primary"
                style={{ flex: 1 }}
              >
                🔄 Reconnect
              </button>
              <button
                onClick={() => handleJoinAsSpectator(gameState?.roomId)}
                className="btn-secondary"
                style={{ flex: 1 }}
              >
                👁️ Spectate
              </button>
              <button
                onClick={() => {
                  setReconnectModalVisible(false);
                  if (onGameEnd) onGameEnd();
                }}
                className="btn-danger"
                style={{ flex: 1 }}
              >
                🏠 Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {gameState?.spectator && (
        <div
          style={{
            position: "fixed",
            top: "80px",
            right: "20px",
            background: "rgba(20,20,35,0.75)",
            backdropFilter: "blur(4px)",
            padding: "10px 18px",
            border: "1px solid #6366f1",
            borderRadius: "10px",
            color: "#e0e7ff",
            fontWeight: 600,
            zIndex: 1500,
            boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
          }}
        >
          👁️ Spectator mode
        </div>
      )}
      {/* Header */}
      <div className="game-header">
        <span className="game-title">
          <img
            src={
              gameState.gameType === "treseta"
                ? "/cards_img/spadiICON.png"
                : "/cards_img/batiICON.png"
            }
            alt={gameState.gameType}
            className="title-suit-icon"
          />
          {gameState.gameType === "treseta" ? "Trešeta" : "Briskula"}{" "}
          {mode === "ai" ? "(AI)" : "Online"}
          {gameState.isTournamentMatch && (
            <span
              style={{
                marginLeft: 12,
                fontSize: "0.7em",
                padding: "4px 8px",
                background: "linear-gradient(45deg,#6366f1,#4338ca)",
                borderRadius: 8,
                fontWeight: 600,
                color: "#fff",
              }}
            >
              Turnir
            </span>
          )}
        </span>

        {/* Simple player names with colors - desktop only */}
        <div className="players-names">
          <span
            className={`player-name-simple ${
              gameState.mode !== "spectator" &&
              gameState.currentPlayer === gameState.playerNumber
                ? "active"
                : ""
            }`}
          >
            {gameState.mode === "spectator"
              ? gameState.player1Name || "Igrač 1"
              : user?.name}
          </span>
          <span className="vs-simple">VS</span>
          <span
            className={`opponent-name-simple ${
              gameState.mode !== "spectator" &&
              gameState.currentPlayer !== gameState.playerNumber
                ? "active"
                : ""
            }`}
          >
            {gameState.mode === "spectator"
              ? gameState.player2Name || "Igrač 2"
              : gameState.opponent?.name ||
                (gameState.playerNumber === 1
                  ? gameState.player2Name
                  : gameState.player1Name) ||
                "?"}
          </span>
        </div>

        {/* Desktop controls */}
        {gameState.mode !== "spectator" && (
          <div className="desktop-controls">
            <button
              onClick={() => setShowScores(!showScores)}
              className="game-btn btn-primary"
            >
              {showScores ? "Sakrij" : "Detalji"}
            </button>

            {/* Akužaj button za Trešeta */}
            {(() => {
              const shouldShowAkuze =
                gameState.gameType === "treseta" &&
                gameState.akuzeEnabled &&
                gameState.canAkuze &&
                !gameState.hasPlayedFirstRound &&
                gameState.currentPlayer === gameState.playerNumber &&
                gameState.gamePhase === "playing";

              if (!shouldShowAkuze) return null;

              const hand = Array.isArray(gameState?.myHand)
                ? gameState.myHand
                : [];
              const availableAkuze = checkAkuze(hand);

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

            {(gameState.gamePhase === "playing" ||
              gameState.gamePhase === "waiting" ||
              gameState.isTournamentMatch) && (
              <button
                onClick={() => {
                  if (mode === "online") {
                    clearGameState(); // Clear saved state on manual leave
                    // Clear reconnect data - this is forfeit, can't come back
                    localStorage.removeItem("playerId");
                    localStorage.removeItem("roomId");

                    // For tournament games, use forfeit instead of permanent leave
                    if (gameState.isTournamentMatch) {
                      forfeitMatch(gameState.roomId, "forfeit");
                    } else {
                      leaveRoomPermanently(gameState.roomId); // Use permanent leave for regular games
                    }
                  } else if (mode === "ai") {
                    // For AI games, clear the saved state since they're local
                    clearGameState();
                  }
                  onGameEnd();
                }}
                className="game-btn btn-danger"
              >
                Napusti
              </button>
            )}

            {gameState.gamePhase === "finished" && (
              <button
                onClick={handleReturnToMenu}
                className="game-btn btn-secondary"
              >
                Povratak
              </button>
            )}
          </div>
        )}

        {/* Mobile floating buttons in header */}
        {gameState.mode !== "spectator" && (
          <div className="mobile-header-buttons">
            <button
              onClick={() => setShowScores(!showScores)}
              className="floating-btn details-btn"
              title="Detalji"
            >
              🔍
            </button>

            {/* Mobile Akužaj button za Trešeta */}
            {(() => {
              const shouldShowMobileAkuze =
                gameState.gameType === "treseta" &&
                gameState.akuzeEnabled &&
                gameState.canAkuze &&
                !gameState.hasPlayedFirstRound &&
                gameState.currentPlayer === gameState.playerNumber &&
                gameState.gamePhase === "playing";

              if (!shouldShowMobileAkuze) return null;

              const availableAkuze = checkAkuze(gameState.myHand);

              return (
                availableAkuze.length > 0 && (
                  <button
                    onClick={() => setShowAkuzeModal(true)}
                    className="floating-btn akuze-btn"
                    title="Akužaj"
                    style={{
                      background: "#ffc107",
                      color: "black",
                    }}
                  >
                    🃏
                  </button>
                )
              );
            })()}

            {(gameState.gamePhase === "playing" ||
              gameState.isTournamentMatch) && (
              <button
                onClick={() => {
                  if (mode === "online") {
                    clearGameState(); // Clear saved state on manual leave
                    // Clear reconnect data - this is forfeit, can't come back
                    localStorage.removeItem("playerId");
                    localStorage.removeItem("roomId");

                    // For tournament games, use forfeit instead of permanent leave
                    if (gameState.isTournamentMatch) {
                      forfeitMatch(gameState.roomId, "forfeit");
                    } else {
                      leaveRoomPermanently(gameState.roomId); // Use permanent leave for regular games
                    }
                  } else if (mode === "ai") {
                    // For AI games, clear the saved state since they're local
                    clearGameState();
                  }
                  onGameEnd();
                }}
                className="floating-btn exit-btn"
                title="Napusti"
              >
                🚪
              </button>
            )}

            {gameState.gamePhase === "finished" && (
              <button
                onClick={handleReturnToMenu}
                className="floating-btn exit-btn"
                title="Povratak"
              >
                ↩️
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main game area with responsive scaling */}
      <div className="game-area game-area-responsive">
        {/* Opponent hand - avatar system */}
        <div className="opponent-section">
          <div className="opponent-avatar-display">
            <div className="player-avatar opponent">
              {gameState.mode === "spectator"
                ? gameState.player2Name?.charAt(0)?.toUpperCase() || "2"
                : gameState.opponent?.name?.charAt(0)?.toUpperCase() || "?"}
            </div>
            <div className="opponent-name">
              {gameState.mode === "spectator"
                ? gameState.player2Name || "Igrač 2"
                : gameState.opponent?.name ||
                  (gameState.playerNumber === 1
                    ? gameState.player2Name
                    : gameState.player1Name) ||
                  "?"}
              {gameState.currentPlayer === 2 && (
                <span className="turn-indicator"> (Na redu)</span>
              )}
            </div>
            <div className="opponent-cards-indicator">
              <span>{getCardCountText(opponentHandCount)}</span>
            </div>
            {gameState.gameType === "treseta" && (
              <div className="points-display">
                {/* ({gameState.opponentPoints} bodova) */}
              </div>
            )}
          </div>
        </div>

        {/* Center play area */}
        <div className="play-area">
          <div className="played-cards-section">
            <div className="played-cards-label">Odigrane karte</div>
            <div className="played-cards-area">
              {(gameState.playedCards || [])
                .filter((card) => card)
                .map((card, index) => (
                  <Card
                    key={`played-${
                      card.id || `${card.suit}-${card.value}-${index}`
                    }`}
                    card={card}
                    size={playedCardSize}
                  />
                ))}
            </div>
          </div>

          {remainingCount > 0 && (
            <div
              className={`deck-trump-section ${
                gameState.gameType === "treseta" ? "treseta-deck" : ""
              }`}
            >
              <div className="deck-label">Špil ({remainingCount})</div>
              <div className="deck-trump-stack">
                {/* Trump card - positioned under deck */}
                {gameState.trump && (
                  <div className="trump-card">
                    <Card card={gameState.trump} size={trumpCardSize} />
                  </div>
                )}

                {/* Deck card - on top */}
                <div className="deck-card">
                  <Card card={{}} isHidden={true} size={trumpCardSize} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Player hand */}
        <div className="player-section">
          {/* Combined player name and status */}
          <div className="player-status-combined">
            {user?.name} - {gameState.message}
            {gameState.gameType === "treseta" && (
              <span className="points-display">
                {/* ({gameState.myPoints} bodova) */}
              </span>
            )}
          </div>

          <div className="player-cards">
            {/* Hide hand cards for spectators */}
            {gameState.mode !== "spectator" &&
              Array.isArray(gameState.myHand) &&
              sortCards(gameState.myHand, gameState.gameType).map((card) => {
                let isPlayable =
                  gameState.gamePhase === "playing" &&
                  gameState.currentPlayer === gameState.playerNumber &&
                  !isCardPlaying; // Add check for card playing state

                if (gameState.gameType === "treseta") {
                  if (mode === "ai") {
                    // For local AI mode, enforce follow-suit rule locally
                    const firstCard = (gameState.playedCards || []).find(
                      (c) => c
                    );
                    if (firstCard) {
                      const hasSameSuit = (gameState.myHand || []).some(
                        (c) => c.suit === firstCard.suit
                      );
                      isPlayable =
                        isPlayable &&
                        (!hasSameSuit || card.suit === firstCard.suit);
                    } else {
                      // no lead card yet -> any card playable
                      isPlayable = isPlayable;
                    }
                  } else {
                    // Online mode - server provides playableCards list
                    isPlayable =
                      isPlayable &&
                      (gameState.playableCards || []).includes(card.id);
                  }
                } else {
                  // Briskula and other games - use server-provided playableCards if present
                  isPlayable =
                    isPlayable &&
                    ((gameState.playableCards &&
                      gameState.playableCards.includes(card.id)) ||
                      !isCardPlaying); // Also check isCardPlaying for Briskula
                }

                return (
                  <Card
                    key={card.id}
                    card={card}
                    isPlayable={isPlayable}
                    isSelected={false}
                    disabled={isCardPlaying}
                    onClick={handleCardClick}
                    size={cardSize}
                  />
                );
              })}

            {/* Spectator message when no hand to show */}
            {gameState.mode === "spectator" && (
              <div
                style={{
                  textAlign: "center",
                  padding: "20px",
                  color: "#a3a3a3",
                  fontSize: "16px",
                  fontStyle: "italic",
                }}
              >
                {gameState.message}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scores overlay */}
      {showScores && (
        <div className="scores-overlay" onClick={() => setShowScores(false)}>
          <div className="scores-modal" onClick={(e) => e.stopPropagation()}>
            <div className="scores-header">
              <h2>Detaljni rezultati</h2>
            </div>

            <div className="scores-grid">
              <div className="player-stats">
                <h3>
                  {gameState.mode === "spectator"
                    ? gameState.player1Name || "Igrač 1"
                    : user?.name}
                </h3>
                <div className="stat-item">
                  <span>Bodovi:</span>
                  <span>{myPoints}</span>
                </div>
                {gameState.mode !== "spectator" && (
                  <>
                    <div className="stat-item">
                      <span>Karte u ruci:</span>
                      <span>{getCardCountText(gameState.myHand.length)}</span>
                    </div>
                    <div className="stat-item">
                      <span>Osvojene karte:</span>
                      <span>
                        {getCardCountText((gameState.myCards || []).length)}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <div className="trump-info">
                {gameState.gameType === "treseta" ? (
                  <>
                    <h3>Špil</h3>
                    <p>Preostalo: {remainingCount}</p>
                  </>
                ) : (
                  <>
                    <h3>Adut</h3>
                    {gameState.trump && (
                      <Card card={gameState.trump} size="small" />
                    )}
                    <p>Preostalo: {remainingCount}</p>
                  </>
                )}
              </div>

              <div className="player-stats">
                <h3>
                  {gameState.mode === "spectator"
                    ? gameState.player2Name || "Igrač 2"
                    : gameState.opponent?.name}
                </h3>
                <div className="stat-item">
                  <span>Bodovi:</span>
                  <span>{opponentPoints}</span>
                </div>
                {gameState.mode !== "spectator" && (
                  <>
                    <div className="stat-item">
                      <span>Karte u ruci:</span>
                      <span>{getCardCountText(opponentHandCount)}</span>
                    </div>
                    <div className="stat-item">
                      <span>Osvojene karte:</span>
                      <span>
                        {getCardCountText(
                          (mode === "ai"
                            ? gameState.aiCards
                            : gameState.opponentCards || []
                          ).length
                        )}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Trešeta: Historija partija i ukupni rezultat */}
            {gameState.gameType === "treseta" &&
              gameState.totalMyPoints !== undefined && (
                <div className="treseta-details">
                  <div className="treseta-summary">
                    <h3>Dugoročno bodovanje</h3>
                    <div className="current-total">
                      <strong>
                        Ukupno: {gameState.totalMyPoints} -{" "}
                        {gameState.totalOpponentPoints}
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
                        {Array.isArray(gameState.partijas) &&
                          gameState.partijas.map((partija, index) => (
                            <div key={index} className="partija-item">
                              <span className="partija-number">
                                Partija {partija.partija}:
                              </span>
                              <span className="partija-score">
                                {partija.myPoints} - {partija.opponentPoints}
                              </span>
                              <span className="partija-winner">
                                {partija.myPoints > partija.opponentPoints
                                  ? "🏆 Vi"
                                  : partija.opponentPoints > partija.myPoints
                                  ? "😔 Protivnik"
                                  : "🤝 Neriješeno"}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Akuže u trenutnoj partiji */}
                  {(gameState.myAkuze?.length > 0 ||
                    gameState.opponentAkuze?.length > 0) && (
                    <div className="current-akuze">
                      <h4>Akuže u ovoj partiji:</h4>
                      {gameState.myAkuze?.length > 0 && (
                        <div className="my-akuze">
                          <strong>Vaši akuži:</strong>
                          <ul>
                            {Array.isArray(gameState.myAkuze) &&
                              gameState.myAkuze.map((akuz, index) => (
                                <li key={index}>
                                  {akuz.description} (+{akuz.points} bod
                                  {akuz.points === 1
                                    ? ""
                                    : akuz.points <= 4
                                    ? "a"
                                    : "ova"}
                                  )
                                </li>
                              ))}
                          </ul>
                        </div>
                      )}
                      {gameState.opponentAkuze?.length > 0 && (
                        <div className="opponent-akuze">
                          <strong>Protivnikovi akuži:</strong>
                          <ul>
                            {Array.isArray(gameState.opponentAkuze) &&
                              gameState.opponentAkuze.map((akuz, index) => (
                                <li key={index}>
                                  {akuz.description} (+{akuz.points} bod
                                  {akuz.points === 1
                                    ? ""
                                    : akuz.points <= 4
                                    ? "a"
                                    : "ova"}
                                  )
                                </li>
                              ))}
                          </ul>
                        </div>
                      )}
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
                  const hand = Array.isArray(gameState?.myHand)
                    ? gameState.myHand
                    : [];
                  const availableAkuze = checkAkuze(hand);
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

      {/* Card pickup animation overlay */}
      {cardPickupAnimation && (
        <div className="card-pickup-overlay">
          <div className="card-pickup-animation">
            <div className="pickup-header">
              <h3>Pokupljene karte iz špila:</h3>
            </div>
            {gameState?.mode === "spectator" ? (
              <div
                className="pickup-cards"
                style={{
                  textAlign: "center",
                  color: "#aaa",
                  fontStyle: "italic",
                  padding: "16px",
                }}
              >
                Karte su pokupljene, ali kao spectator ne možete vidjeti koje.
              </div>
            ) : (
              <>
                <div className="pickup-cards">
                  {cardPickupAnimation.myCard && (
                    <div className="pickup-player">
                      <div className="pickup-label">Vi:</div>
                      <Card card={cardPickupAnimation.myCard} size="medium" />
                    </div>
                  )}
                  {cardPickupAnimation.opponentCard && (
                    <div className="pickup-player">
                      <div className="pickup-label">Protivnik:</div>
                      <Card
                        card={cardPickupAnimation.opponentCard}
                        size="medium"
                      />
                    </div>
                  )}
                </div>
                <div className="pickup-winner">
                  {cardPickupAnimation.roundWinner ===
                  cardPickupAnimation.playerNumber
                    ? "🎉 Vi ste uzeli rundu!"
                    : "😔 Protivnik je uzeo rundu"}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Final Score Screen */}
      {gameState.gamePhase === "finished" && (
        <div className="final-score-overlay">
          <div className="final-score-container">
            {/* Spectator Game End Screen */}
            {gameState.mode === "spectator" ? (
              <>
                <div className="final-score-header">
                  <h2>🏁 Igra završena</h2>
                  <div className="result-emoji">👁️</div>
                </div>
                <div className="game-result">
                  <p>
                    Gledali ste: {gameState.player1Name || "Igrač 1"} vs{" "}
                    {gameState.player2Name || "Igrač 2"}
                  </p>
                  {gameState.winner && (
                    <p>
                      🏆 Pobjednik:{" "}
                      <strong>
                        {gameState.winner === 1
                          ? gameState.player1Name
                          : gameState.player2Name}
                      </strong>
                    </p>
                  )}
                  {gameState.gameType === "treseta" && (
                    <div className="final-total-score">
                      Konačni rezultat: {gameState.totalMyPoints || 0} -{" "}
                      {gameState.totalOpponentPoints || 0}
                    </div>
                  )}
                </div>
                <div className="final-score-actions">
                  <button onClick={onGameEnd} className="btn-secondary-large">
                    🏠 Glavni meni
                  </button>
                </div>
              </>
            ) : gameState.gameInterrupted ? (
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
                    🏠 Glavni meni
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
                      Konačni rezultat: {gameState.totalMyPoints || 0} -{" "}
                      {gameState.totalOpponentPoints || 0}
                    </div>
                  )}
                  {computedWinner === gameState.playerNumber && (
                    <div className="result-emoji">🎉</div>
                  )}
                  {computedWinner === null && (
                    <div className="result-emoji">🤝</div>
                  )}
                  {computedWinner &&
                    computedWinner !== gameState.playerNumber && (
                      <div className="result-emoji">😔</div>
                    )}
                </div>

                <div className="final-scores-grid">
                  <div className="final-player-score">
                    <div className="player-name">{user?.name}</div>
                    <div className="player-points">
                      {gameState.gameType === "treseta"
                        ? `${gameState.totalMyPoints || 0} bodova`
                        : `${myPoints} bodova`}
                    </div>
                    <div className="player-cards">
                      {gameState.gameType === "treseta"
                        ? `Cilj: ${gameState.targetScore} bodova`
                        : getCardCountText((gameState.myCards || []).length)}
                    </div>
                    {computedWinner === gameState.playerNumber && (
                      <div className="winner-badge">👑 POBJEDNIK</div>
                    )}
                  </div>

                  <div className="vs-divider">VS</div>

                  <div className="final-player-score">
                    <div className="player-name">
                      {gameState.opponent?.name}
                    </div>
                    <div className="player-points">
                      {gameState.gameType === "treseta"
                        ? `${gameState.totalOpponentPoints || 0} bodova`
                        : `${opponentPoints} bodova`}
                    </div>
                    <div className="player-cards">
                      {gameState.gameType === "treseta"
                        ? `Završeno u ${
                            gameState.partijas?.length ||
                            gameState.currentPartija - 1
                          } partija`
                        : getCardCountText(
                            (mode === "ai"
                              ? gameState.aiCards
                              : gameState.opponentCards || []
                            ).length
                          )}
                    </div>
                    {computedWinner &&
                      computedWinner !== gameState.playerNumber &&
                      computedWinner !== null && (
                        <div className="winner-badge">👑 POBJEDNIK</div>
                      )}
                  </div>
                </div>

                <div className="game-result">
                  <p>
                    {computedWinner === gameState.playerNumber
                      ? "🎉 Pobijedili ste!"
                      : computedWinner === null
                      ? "🤝 Neriješeno!"
                      : "😔 Izgubili ste."}
                  </p>
                </div>

                <div className="final-score-actions">
                  {/* Don't show Revanš button for tournament games */}
                  {!gameState.isTournamentMatch &&
                    mode === "online" &&
                    !gameState.opponentDeclinedRematch && (
                      <button
                        onClick={() => {
                          // Resetuj game state za novi match
                          setGameState((prev) => ({
                            ...prev,
                            gamePhase: "matchmaking", // Postaviti na matchmaking dok čeka novi match
                            message: "Tražim revanš s istim protivnikom...",
                            opponentDeclinedRematch: false,
                          }));
                          // Pokreni rematch s istim protivnikom
                          rematch(
                            gameData.gameMode || "1v1",
                            gameState.gameType,
                            gameState.opponent?.id // proslijedi opponent ID
                          );
                        }}
                        className="btn-primary-large"
                      >
                        🔄 Revanš
                      </button>
                    )}
                  {!gameState.isTournamentMatch && mode === "ai" && (
                    <button
                      onClick={() => {
                        const useTreseta = gameState.gameType === "treseta";
                        const deck = useTreseta
                          ? shuffleDeckTreseta(createDeckTreseta())
                          : shuffleDeck(createDeck());
                        const dealt = useTreseta
                          ? dealCardsTreseta(deck)
                          : dealCards(deck);
                        setGameState((prev) => ({
                          ...prev,
                          mode: "ai",
                          myHand: dealt.player1Hand,
                          aiHand: dealt.player2Hand,
                          myCards: [],
                          aiCards: [],
                          trump: dealt.trump || null,
                          trumpSuit: dealt.trumpSuit || null,
                          remainingDeck: dealt.remainingDeck,
                          playedCards: [],
                          currentPlayer: 1,
                          message: "Nova partija! Vaš red.",
                          gamePhase: "playing",
                          winner: null,
                          lastTrickWinner: null,
                          myPoints: 0,
                          opponentPoints: 0,
                          opponentHandCount: dealt.player2Hand.length,
                          remainingCardsCount: dealt.remainingDeck.length,
                          playableCards: dealt.player1Hand.map((c) => c.id),
                        }));
                      }}
                      className="btn-primary-large"
                    >
                      🔄 Revanš (AI)
                    </button>
                  )}
                  <button
                    onClick={handleReturnToMenu}
                    className="btn-secondary-large"
                  >
                    🏠 Glavni meni
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Partija Finished Screen for Treseta */}
      {gameState.gamePhase === "partidaFinished" && (
        <div className="final-score-overlay">
          <div className="final-score-container">
            <div className="final-score-header">
              <h2>🏆 Partija {gameState.currentPartija - 1} završena!</h2>
            </div>

            <div className="partija-result">
              <p>
                {gameState.myPoints > gameState.opponentPoints
                  ? "🎉 Dobili ste ovu partiju!"
                  : gameState.opponentPoints > gameState.myPoints
                  ? "😔 Izgubili ste ovu partiju."
                  : "🤝 Partija neriješena!"}
              </p>
              <div className="partija-scores">
                Rezultat partije: {gameState.myPoints} -{" "}
                {gameState.opponentPoints}
              </div>
              <div className="total-scores">
                <strong>
                  Ukupno: {gameState.totalMyPoints} -{" "}
                  {gameState.totalOpponentPoints}
                </strong>
              </div>
              <div className="target-info">
                Cilj: {gameState.targetScore} bodova
              </div>
            </div>

            <div className="final-score-actions">
              {gameState.mode === "ai" ? (
                <button onClick={startNewPartija} className="btn-primary-large">
                  ▶️ Sljedeća partija
                </button>
              ) : // Online mode - show continue button or status
              nextPartidaStatus.playerReady ? (
                nextPartidaStatus.waitingFor > 0 ? (
                  <div className="waiting-opponent-message">
                    <div className="loading-spinner">⏳</div>
                    <p>Čeka se protivnikova odluka...</p>
                    <small>Protivnik treba da potvrdi nastavak</small>
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

      {/* Matchmaking Screen for Rematch */}
      {gameState.gamePhase === "matchmaking" && (
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
                      prev.winner === prev.playerNumber
                        ? "🎉 Pobijedili ste! (Dosegnuli ste 61 bod)"
                        : prev.winner === null
                        ? "🤝 Neriješeno!"
                        : "😔 Izgubili ste.",
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
    </div>
  );
}

export default Game;
