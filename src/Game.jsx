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

import { chooseAiCard as chooseAiBriskula } from "../core/briskulaAI.js";
import { chooseAiCard as chooseAiTreseta } from "../core/tresetaAI.js";

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

function Game({ gameData, onGameEnd }) {
  const {
    socket,
    user,
    playCard,
    leaveRoom,
    leaveRoomPermanently,
    findMatch,
    rematch,
    saveGameState,
    clearGameState,
  } = useSocket();

  const { addToast } = useToast();

  const mode = useMemo(() => {
    if (!gameData) return "online";
    if (
      gameData?.gameMode === "1vAI" ||
      gameData?.opponent?.isAI ||
      gameData?.opponent?.name === "AI Bot"
    ) {
      return "ai";
    }
    return "online";
  }, [gameData]);

  const initializeGameState = () => {
    if (!gameData) return null;

    console.log("[v0] 🚀 Initializing game state with gameData:", gameData);
    console.log("[v0] 🎯 Detected mode:", mode);

    if (mode === "ai") {
      // Lokalna partija 1v1 protiv AI-ja
      console.log("[v0] 🤖 Setting up AI mode game");
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
      console.log("[v0] 🃏 Player hand:", dealt.player1Hand);
      console.log("[v0] 🃏 Trump card:", dealt.trump);

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
      };

      console.log("[v0] ✅ AI game state initialized:", initialState);
      return initialState;
    }

    // Online state – kompatibilno s postojećim backendom
    const myHand =
      gameData.playerNumber === 1
        ? gameData.gameState.player1Hand
        : gameData.gameState.player2Hand;

    const opponentHandCount =
      gameData.playerNumber === 1
        ? (gameData.gameState.player2Hand || []).length
        : (gameData.gameState.player1Hand || []).length;

    const state = {
      mode: "online",
      roomId: gameData.roomId,
      playerNumber: gameData.playerNumber,
      opponent: gameData.opponent,
      gameType: gameData.gameType, // Add gameType to state
      myHand: myHand,
      opponentHandCount: opponentHandCount,
      myCards: [],
      opponentCards: [],
      trump: gameData.gameState.trump,
      currentPlayer: gameData.gameState.currentPlayer,
      playedCards: [],
      gamePhase: "playing",
      winner: null,
      message:
        gameData.gameState.currentPlayer === gameData.playerNumber
          ? "Vaš red! Odaberite kartu za igranje."
          : "Protivnikov red. Čekajte...",
      remainingCardsCount: (gameData.gameState.remainingDeck || []).length,
      playableCards: gameData.gameState.playableCards || [], // Lista ID-jeva karata koje se mogu igrati
      myPoints: 0, // Bodovi igrača
      opponentPoints: 0, // Bodovi protivnika
    };

    console.log("🎮 Final game state:", state);
    return state;
  };

  const [gameState, setGameState] = useState(initializeGameState);
  const [selectedCard, setSelectedCard] = useState(null);
  const [showScores, setShowScores] = useState(false);
  // Determine if we're on mobile
  const [isMobile, setIsMobile] = useState(false);
  // Animation state for picked up cards
  const [cardPickupAnimation, setCardPickupAnimation] = useState(null);
  const roundFirstPlayerRef = useRef(null);
  const aiThinking = useRef(false);
  const roundResolving = useRef(false);

  const playLocalCard = (card, playerNum) => {
    console.log("[v0] 🎯 Playing card:", card, "for player:", playerNum);

    setGameState((prevState) => {
      if (prevState.gamePhase !== "playing") return prevState;
      const newPlayedCards = [...prevState.playedCards];
      newPlayedCards[playerNum - 1] = card;

      console.log("[v0] 🃏 New played cards:", newPlayedCards);

      const newMyHand =
        playerNum === 1
          ? prevState.myHand.filter((c) => c.id !== card.id)
          : prevState.myHand;
      const newAiHand =
        playerNum === 2
          ? prevState.aiHand.filter((c) => c.id !== card.id)
          : prevState.aiHand;

      // 👉 Ako je ovo prva karta u rundi, zapamti tko je prvi
      if (!prevState.playedCards[0] && !prevState.playedCards[1]) {
        roundFirstPlayerRef.current = playerNum;
      }

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
        };

        // Add delay before resolving the round
        // Add delay before resolving the round
        setTimeout(() => {
          setGameState((currentState) => {
            console.log("[v0] 🎯 ROUND RESOLUTION STARTING:");
            console.log(
              "[v0] First player this round (fixed):",
              roundFirstPlayerRef.current
            );
            console.log("[v0] Cards played this round:", newPlayedCards);

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

            console.log("[v0] 🏆 ROUND WINNER:", winner);
            console.log("[v0] Setting currentPlayer to winner:", winner);
            console.log(
              "[v0] This means next round will be started by:",
              winner === 1 ? "User" : "AI"
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
            const end = useTreseta
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
              gamePhase: end.isGameOver ? "finished" : "playing",
              winner: end.isGameOver ? end.winner : null,
              myPoints: p1Points,
              opponentPoints: p2Points,
              playableCards:
                prevState.gameType === "treseta" && !end.isGameOver
                  ? myHandAfterDraw.map((c) => c.id) // Simplified for AI mode
                  : myHandAfterDraw.map((c) => c.id),
              roundResolving: false,
            };
          });
        }, 1500);

        return tempState;
      }

      // Inače – samo promijeni red
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
      };
    });
  };

  useEffect(() => {
    console.log("[v0] 🔄 Game component mounted, gameData:", gameData);
    const initialState = initializeGameState();
    if (initialState) {
      console.log("[v0] 🎮 Setting initial game state");
      setGameState(initialState);
    } else {
      console.log("[v0] ❌ Failed to initialize game state");
    }
  }, [gameData]);

  useEffect(() => {
    console.log("[v0] 🤖 AI useEffect triggered");
    console.log("[v0] Current player:", gameState.currentPlayer);
    console.log("[v0] AI thinking:", aiThinking.current);
    console.log("[v0] Round resolving:", roundResolving.current);
    console.log("[v0] Game phase:", gameState.gamePhase);
    console.log("[v0] Played cards:", gameState.playedCards);
    console.log(
      "[v0] Should AI play?",
      gameState.currentPlayer === 2 &&
        !aiThinking.current &&
        !roundResolving.current &&
        gameState.gamePhase === "playing" &&
        gameState.playedCards.filter((c) => c).length < 2
    );

    if (
      gameState.currentPlayer === 2 &&
      !aiThinking.current &&
      !roundResolving.current &&
      gameState.gamePhase === "playing" &&
      gameState.playedCards.filter((c) => c).length < 2
    ) {
      console.log("[v0] ✅ AI SHOULD PLAY - all conditions met");
      aiThinking.current = true;

      setTimeout(() => {
        console.log("[v0] 🤖 AI is choosing card...");

        const aiIsFirst = !gameState.playedCards[0]; // AI is first if no card played yet
        console.log("[v0] AI is first:", aiIsFirst);
        console.log("[v0] Opponent card (if any):", gameState.playedCards[0]);

        const firstPlayedCard =
          (gameState.playedCards || []).find((c) => c) || null;

        // For Trešeta, restrict AI's candidate hand to follow-suit if necessary
        let aiHandForChoice = gameState.aiHand || [];
        if (gameState.gameType === "treseta" && firstPlayedCard && !aiIsFirst) {
          const sameSuit = (gameState.aiHand || []).filter(
            (c) => c.suit === firstPlayedCard.suit
          );
          if (sameSuit.length > 0) aiHandForChoice = sameSuit;
        }

        console.log(
          "[AI DEBUG] AI candidate hand:",
          aiHandForChoice,
          "firstPlayedCard:",
          firstPlayedCard
        );

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

        console.log("[v0] 🎯 AI chose card:", aiCard);
        if (aiCard) {
          playLocalCard(aiCard, 2);
        } else {
          console.log("[v0] ❌ AI could not choose a card!");
          aiThinking.current = false;
        }
      }, 1200);
    } else {
      console.log("[v0] ❌ AI should NOT play - conditions not met");
      if (gameState.currentPlayer !== 2)
        console.log("[v0] - currentPlayer is not 2 (AI)");
      if (aiThinking.current) console.log("[v0] - AI is already thinking");
      if (roundResolving.current) console.log("[v0] - Round is resolving");
      if (gameState.gamePhase !== "playing")
        console.log("[v0] - Game phase is not 'playing'");
      if (gameState.playedCards.filter((c) => c).length >= 2)
        console.log("[v0] - Already 2 cards played");
    }
  }, [gameState]);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Separate useEffect for saving game state to avoid infinite loops
  useEffect(() => {
    if (
      gameState?.gamePhase === "playing" &&
      gameState?.roomId &&
      gameState?.mode === "online"
    ) {
      const timeoutId = setTimeout(() => {
        saveGameState({
          ...gameState,
          roomId: gameState.roomId,
          gameMode: gameData?.gameMode || "1v1",
          gameType: gameState.gameType,
          opponent: gameState.opponent,
          playerNumber: gameState.playerNumber,
          gameState: {
            ...gameState,
            playableCards: gameState.playableCards,
          },
        });
      }, 1000); // Debounce saving to prevent too frequent calls

      return () => clearTimeout(timeoutId);
    }
  }, [gameState]);

  // Socket event listeners (keeping the same logic as original)
  useEffect(() => {
    if (!socket || !gameState?.roomId || gameState?.mode !== "online") return;

    // Listener za novu igru nakon revan��a
    socket.on("gameStart", (newGameData) => {
      console.log("🎮 Nova igra počinje (revanš):", newGameData);
      // Reset game state s novim podacima
      const newState = initializeGameState();
      if (newState) {
        // Ažuriraj s novim game data
        setGameState({
          ...newState,
          roomId: newGameData.roomId,
          playerNumber: newGameData.playerNumber,
          opponent: newGameData.opponent,
          gameType: newGameData.gameType,
          myHand:
            newGameData.playerNumber === 1
              ? newGameData.gameState.player1Hand
              : newGameData.gameState.player2Hand,
          opponentHandCount:
            newGameData.playerNumber === 1
              ? (newGameData.gameState.player2Hand || []).length
              : (newGameData.gameState.player1Hand || []).length,
          trump: newGameData.gameState.trump,
          currentPlayer: newGameData.gameState.currentPlayer,
          remainingCardsCount: (newGameData.gameState.remainingDeck || [])
            .length,
          playableCards: newGameData.gameState.playableCards || [],
          gamePhase: "playing",
          message:
            newGameData.gameState.currentPlayer === newGameData.playerNumber
              ? "Vaš red! Odaberite kartu za igranje."
              : "Protivnikov red. Čekajte...",
        });
      }
    });

    socket.on("cardPlayed", (data) => {
      setGameState((prev) => ({
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
      }));
    });

    socket.on("turnChange", (data) => {
      setGameState((prev) => ({
        ...prev,
        currentPlayer: data.currentPlayer,
        message:
          data.currentPlayer === prev.playerNumber
            ? "Vaš red! Odaberite kartu."
            : "Protivnikov red. Čekajte...",
      }));
    });

    socket.on("roundFinished", (data) => {
      setGameState((prev) => {
        const newState = {
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
          gamePhase: data.gameEnd.isGameOver ? "finished" : "playing",
          winner: data.gameEnd.winner,
          // Ažuriraj playableCards za Trešetu
          playableCards:
            prev.gameType === "treseta"
              ? (prev.playerNumber === 1
                  ? data.player1PlayableCards
                  : data.player2PlayableCards) || []
              : prev.playableCards,
          // Ažuriraj bodove
          myPoints:
            prev.playerNumber === 1
              ? data.player1Points?.points || 0
              : data.player2Points?.points || 0,
          opponentPoints:
            prev.playerNumber === 1
              ? data.player2Points?.points || 0
              : data.player1Points?.points || 0,
        };

        if (data.gameEnd.isGameOver) {
          // Clear saved game state when game ends
          clearGameState();

          if (data.gameEnd.winner === prev.playerNumber) {
            newState.message = `🎉 Pobijedili ste!`;
          } else if (data.gameEnd.winner === null) {
            newState.message = `🤝 Neriješeno! (${data.gameEnd.reason})`;
          } else {
            newState.message = `😔 Izgubili ste.`;
          }
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

        return newState;
      });

      // Ne automatski preusmjeravaj na glavni ekran - neka igrač sam odluči
    });

    socket.on("playerDisconnected", (data) => {
      setGameState((prev) => ({
        ...prev,
        gamePhase: "finished",
        gameInterrupted: true, // Dodaj flag da je igra prekinuta
        message: `${data.message}. Kliknite 'Glavni meni' za povratak.`,
      }));
      // Ne automatski preusmjeravaj - neka igrač sam odluči
    });

    socket.on("playerLeft", (data) => {
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
        // Temporary leave - game can continue with reconnection
        setGameState((prev) => ({
          ...prev,
          gamePhase: "finished",
          gameInterrupted: true,
          message: `${data.message} Kliknite 'Glavni meni' za povratak.`,
        }));
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

    return () => {
      socket.off("gameStart");
      socket.off("cardPlayed");
      socket.off("turnChange");
      socket.off("roundFinished");
      socket.off("playerDisconnected");
      socket.off("playerLeft");
      socket.off("roomDeleted");
      socket.off("reconnectFailed");
      socket.off("playableCardsUpdate");
      socket.off("invalidMove");
    };
  }, [socket, gameState?.roomId, onGameEnd, mode]);

  const handleCardClick = (card) => {
    if (!gameState) return;

    if (
      gameState.gamePhase !== "playing" ||
      gameState.currentPlayer !== gameState.playerNumber
    ) {
      return;
    }

    if (mode === "ai") {
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
            return;
          }
        }
      }
      playLocalCard(card, 1);
      setSelectedCard(null);
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

    if (selectedCard && selectedCard.id === card.id) {
      playCard(gameState.roomId, card);
      setSelectedCard(null);
    } else {
      setSelectedCard(card);
    }
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

  const myPoints =
    gameState.gameType === "treseta"
      ? gameState.myPoints || 0
      : calculatePoints(gameState.myCards || []);

  const opponentPoints =
    gameState.gameType === "treseta"
      ? gameState.opponentPoints || 0
      : calculatePoints(gameState.opponentCards || []);

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

  return (
    <div className="game-wrapper">
      {/* Header */}
      <div className="game-header">
        <h1 className="game-title">
          <img
            src="/cards_img/dinarICON.png"
            alt="Dinari"
            className="title-suit-icon"
          />{" "}
          {gameState.gameType === "treseta" ? "Trešeta" : "Briskula"}{" "}
          {mode === "ai" ? "(AI)" : "Online"}
        </h1>

        {/* Simple player names with colors - desktop only */}
        <div className="players-names">
          <span
            className={`player-name-simple ${
              gameState.currentPlayer === gameState.playerNumber ? "active" : ""
            }`}
          >
            {user?.name}
          </span>
          <span className="vs-simple">vs</span>
          <span
            className={`opponent-name-simple ${
              gameState.currentPlayer !== gameState.playerNumber ? "active" : ""
            }`}
          >
            {gameState.opponent?.name}
          </span>
        </div>

        {/* Desktop controls */}
        <div className="desktop-controls">
          <button
            onClick={() => setShowScores(!showScores)}
            className="game-btn btn-primary"
          >
            {showScores ? "Sakrij" : "Detalji"}
          </button>

          {gameState.gamePhase === "playing" && (
            <button
              onClick={() => {
                if (mode === "online") {
                  clearGameState(); // Clear saved state on manual leave
                  leaveRoomPermanently(gameState.roomId); // Use permanent leave
                }
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

        {/* Mobile floating buttons in header */}
        <div className="mobile-header-buttons">
          <button
            onClick={() => setShowScores(!showScores)}
            className="floating-btn details-btn"
            title="Detalji"
          >
            🔍
          </button>

          {gameState.gamePhase === "playing" && (
            <button
              onClick={() => {
                if (mode === "online") {
                  clearGameState(); // Clear saved state on manual leave
                  leaveRoomPermanently(gameState.roomId); // Use permanent leave
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
              onClick={onGameEnd}
              className="floating-btn exit-btn"
              title="Povratak"
            >
              ↩️
            </button>
          )}
        </div>
      </div>

      {/* Main game area with responsive scaling */}
      <div className="game-area game-area-responsive">
        {/* Opponent hand - avatar system */}
        <div className="opponent-section">
          <div className="opponent-avatar-display">
            <div className="player-avatar opponent">
              {gameState.opponent?.name?.charAt(0)?.toUpperCase() || "?"}
            </div>
            <div className="opponent-name">
              {gameState.opponent?.name}
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
              {gameState.playedCards
                .filter((card) => card)
                .map((card, index) => (
                  <Card
                    key={`played-${card.id}`}
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
            {sortCards(gameState.myHand, gameState.gameType).map((card) => {
              let isPlayable =
                gameState.gamePhase === "playing" &&
                gameState.currentPlayer === gameState.playerNumber;

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
                    true);
              }

              return (
                <Card
                  key={card.id}
                  card={card}
                  isPlayable={isPlayable}
                  isSelected={selectedCard && selectedCard.id === card.id}
                  onClick={handleCardClick}
                  size={cardSize}
                />
              );
            })}
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
                <h3>{user?.name}</h3>
                <div className="stat-item">
                  <span>Bodovi:</span>
                  <span>
                    {gameState.gameType === "treseta"
                      ? gameState.myPoints
                      : myPoints}
                  </span>
                </div>
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
                <h3>{gameState.opponent?.name}</h3>
                <div className="stat-item">
                  <span>Bodovi:</span>
                  <span>
                    {gameState.gameType === "treseta"
                      ? gameState.opponentPoints
                      : opponentPoints}
                  </span>
                </div>
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
              </div>
            </div>

            <button
              className="close-scores"
              onClick={() => setShowScores(false)}
            >
              Zatvori
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
                  <Card card={cardPickupAnimation.opponentCard} size="medium" />
                </div>
              )}
            </div>

            <div className="pickup-winner">
              {cardPickupAnimation.roundWinner ===
              cardPickupAnimation.playerNumber
                ? "🎉 Vi ste uzeli rundu!"
                : "😔 Protivnik je uzeo rundu"}
            </div>
          </div>
        </div>
      )}

      {/* Final Score Screen */}
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
                    🏠 Glavni meni
                  </button>
                </div>
              </>
            ) : (
              // Normalni prikaz rezultata
              <>
                <div className="final-score-header">
                  <h2>🎮 Partija završena!</h2>
                  {gameState.winner === gameState.playerNumber && (
                    <div className="result-emoji">🎉</div>
                  )}
                  {gameState.winner === null && (
                    <div className="result-emoji">🤝</div>
                  )}
                  {gameState.winner &&
                    gameState.winner !== gameState.playerNumber && (
                      <div className="result-emoji">😔</div>
                    )}
                </div>

                <div className="final-scores-grid">
                  <div className="final-player-score">
                    <div className="player-name">{user?.name}</div>
                    <div className="player-points">
                      {gameState.gameType === "treseta"
                        ? gameState.myPoints
                        : myPoints}{" "}
                      bodova
                    </div>
                    <div className="player-cards">
                      {getCardCountText((gameState.myCards || []).length)}
                    </div>
                    {gameState.winner === gameState.playerNumber && (
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
                        ? gameState.opponentPoints
                        : opponentPoints}{" "}
                      bodova
                    </div>
                    <div className="player-cards">
                      {getCardCountText(
                        (mode === "ai"
                          ? gameState.aiCards
                          : gameState.opponentCards || []
                        ).length
                      )}
                    </div>
                    {gameState.winner &&
                      gameState.winner !== gameState.playerNumber &&
                      gameState.winner !== null && (
                        <div className="winner-badge">👑 POBJEDNIK</div>
                      )}
                  </div>
                </div>

                <div className="game-result">
                  <p>
                    {gameState.winner === gameState.playerNumber
                      ? "🎉 Pobijedili ste!"
                      : gameState.winner === 2
                      ? "😔 Izgubili ste."
                      : "🤝 Neriješeno!"}
                  </p>
                </div>

                <div className="final-score-actions">
                  {mode === "online" ? (
                    <button
                      onClick={() => {
                        // Resetuj game state za novi match
                        setGameState((prev) => ({
                          ...prev,
                          gamePhase: "matchmaking", // Postaviti na matchmaking dok čeka novi match
                          message: "Tražim revanš s istim protivnikom...",
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
                  ) : (
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
                  <button onClick={onGameEnd} className="btn-secondary-large">
                    🏠 Glavni meni
                  </button>
                </div>
              </>
            )}
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
