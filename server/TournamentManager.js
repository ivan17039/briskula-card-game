import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";

//obrisat    POST http://localhost:3002/api/dev/reset-tournaments
//kreirat    POST http://localhost:3002/api/dev/create-sample-tournaments
/**
 * TournamentManager
 * - Supports Postgres/Supabase persistence or in-memory fallback
 * - Emits socket events through provided io instance
 * Tables (Supabase SQL reference):
 *  CREATE TABLE tournaments (
 *    id uuid primary key,
 *    name text not null,
 *    game_type text not null check (game_type in ('briskula','treseta')),
 *    max_participants int not null check (max_participants > 1),
 *    status text not null default 'registration' check (status in ('registration','ongoing','finished','cancelled')),
 *    seeding_method text not null default 'random' check (seeding_method in ('random','elo')),
 *    registration_deadline timestamptz,
 *    round_deadline_hours int not null default 48,
 *    prize_pool text,

 *    winner_user_id text,
 *    created_by text,
 *    created_at timestamptz default now(),
 *    started_at timestamptz,
 *    finished_at timestamptz
 *  );
 *  CREATE TABLE tournament_players (
 *    id uuid primary key,
 *    tournament_id uuid references tournaments(id) on delete cascade,
 *    user_id text not null,
 *    user_name text not null,
 *    elo int default 1000,
 *    seed int,
 *    joined_at timestamptz default now(),
 *    unique(tournament_id,user_id)
 *  );
 *  CREATE TABLE tournament_matches (
 *    id uuid primary key,
 *    tournament_id uuid references tournaments(id) on delete cascade,
 *    round_number int not null,
 *    match_number int not null,
 *    player1_user_id text,
 *    player2_user_id text,
 *    winner_user_id text,
 *    status text not null default 'waiting' check (status in ('waiting','pending','playing','finished','forfeit')),
 *    deadline timestamptz,
 *    game_room_id text,
 *    started_at timestamptz,
 *    finished_at timestamptz,
 *    UNIQUE(tournament_id, round_number, match_number)
 *  );
 *  CREATE TABLE tournament_leaderboard (
 *    user_id text primary key,
 *    wins int default 0,
 *    finals int default 0,
 *    semifinals int default 0,
 *    points int default 0,
 *    updated_at timestamptz default now()
 *  );
 */
export default class TournamentManager {
  constructor({ io }) {
    this.io = io;
    this.memory = {
      tournaments: new Map(),
      players: new Map(), // key: tournamentId -> Map(userId, playerObj)
      matches: new Map(), // key: tournamentId -> array of matches
      leaderboard: new Map(),
    };

    const url = process.env.SUPABASE_URL;
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (url && key) {
      this.supabase = createClient(url, key, {
        auth: { persistSession: false },
      });
    }

    // periodic deadline processing
    setInterval(() => {
      this.processDeadlines();
    }, 5 * 60 * 1000); // every 5 min
  }

  // ---------- Helpers ----------
  _isDb() {
    return !!this.supabase;
  }

  _broadcastTournament(t) {
    const emitPublic = async () => {
      let enriched = t;
      if (this._isDb()) {
        try {
          const { count } = await this.supabase
            .from("tournament_players")
            .select("user_id", { count: "exact", head: true })
            .eq("tournament_id", t.id);
          enriched = { ...t, currentParticipants: count || 0 };
        } catch (e) {
          // silent fail keeps existing
        }
      } else if (!t.currentParticipants) {
        enriched = { ...t, currentParticipants: t.participants?.length || 0 };
      }
      this.io.emit("tournamentUpdated", this._publicTournament(enriched));
    };
    emitPublic();
  }

  _publicTournament(t) {
    return {
      id: t.id,
      name: t.name,
      gameType: t.game_type || t.gameType,
      maxParticipants: t.max_participants || t.maxParticipants,
      currentParticipants:
        typeof t.currentParticipants === "number"
          ? t.currentParticipants
          : t.participantCount || t.participants?.length || 0,
      registrationDeadline: t.registration_deadline || t.registrationDeadline,
      status: t.status,
      prizePool: t.prize_pool || t.prizePool,
      createdAt: t.created_at || t.createdAt,
      winner: t.winner_user_id || t.winner,
    };
  }

  // ---------- Creation ----------
  async createTournament(data, createdBy) {
    const id = uuidv4();
    const t = {
      id,
      name: data.name,
      gameType: data.gameType,
      maxParticipants: data.maxParticipants,
      status: "registration",
      seedingMethod: data.seedingMethod || "random",
      registrationDeadline: data.registrationDeadline || null,
      roundDeadlineHours: data.roundDeadlineHours || 48,
      prizePool: data.prizePool || null,
      createdAt: new Date(),
      createdBy,
      participants: [],
      bracket: [],
    };

    if (this._isDb()) {
      await this.supabase.from("tournaments").insert({
        id,
        name: t.name,
        game_type: t.gameType,
        max_participants: t.maxParticipants,
        registration_deadline: t.registrationDeadline,
        round_deadline_hours: t.roundDeadlineHours,
        prize_pool: t.prizePool,
        seeding_method: t.seedingMethod,
        created_by: createdBy,
      });
    } else {
      this.memory.tournaments.set(id, t);
      this.memory.players.set(id, new Map());
      this.memory.matches.set(id, []);
    }
    this._broadcastTournament(t);
    return t;
  }

  // ---------- Registration ----------
  async registerPlayer(tournamentId, user) {
    const t = await this.getTournament(tournamentId);
    if (!t) throw new Error("Tournament not found");
    if (t.status !== "registration")
      throw new Error("Not in registration phase");
    const players = await this.listPlayers(tournamentId);
    if (players.find((p) => p.userId === user.userId))
      throw new Error("Already registered");
    if (players.length >= (t.maxParticipants || t.max_participants))
      throw new Error("Full");

    const player = {
      id: uuidv4(),
      tournamentId,
      userId: user.userId,
      userName: user.name,
      elo: user.elo || 1000,
      joinedAt: new Date(),
    };
    if (this._isDb()) {
      await this.supabase.from("tournament_players").insert({
        id: player.id,
        tournament_id: tournamentId,
        user_id: player.userId,
        user_name: player.userName,
        elo: player.elo,
      });
      // Accurate count using head count query to avoid race conditions
      const { count: newCount } = await this.supabase
        .from("tournament_players")
        .select("user_id", { count: "exact", head: true })
        .eq("tournament_id", tournamentId);
      this._broadcastTournament({
        ...t,
        currentParticipants: newCount || players.length + 1,
      });
      if ((newCount || 0) === (t.maxParticipants || t.max_participants)) {
        await this.startTournament(tournamentId);
      }
    } else {
      this.memory.players.get(tournamentId).set(player.userId, player);
      t.participants.push(player.userId);
      t.currentParticipants = t.participants.length;
      this._broadcastTournament({ ...t });
      if (t.participants.length === (t.maxParticipants || t.max_participants)) {
        await this.startTournament(tournamentId);
      }
    }
    return player;
  }

  // ---------- Retrieval ----------
  async listTournaments(gameType) {
    if (this._isDb()) {
      let query = this.supabase.from("tournaments").select("*");
      if (gameType) query = query.eq("game_type", gameType);
      const { data: tournaments } = await query;
      if (!tournaments || tournaments.length === 0) return [];

      // Fetch all players for these tournaments in one go to compute counts & name map
      const ids = tournaments.map((t) => t.id);
      const { data: players } = await this.supabase
        .from("tournament_players")
        .select("tournament_id,user_id,user_name")
        .in("tournament_id", ids);
      const counts = new Map();
      if (players) {
        for (const p of players) {
          counts.set(p.tournament_id, (counts.get(p.tournament_id) || 0) + 1);
        }
      }
      return tournaments.map((row) => ({
        ...row,
        gameType: row.game_type,
        maxParticipants: row.max_participants,
        registrationDeadline: row.registration_deadline,
        prizePool: row.prize_pool,
        currentParticipants: counts.get(row.id) || 0,
      }));
    }
    return Array.from(this.memory.tournaments.values()).filter(
      (t) => !gameType || t.gameType === gameType
    );
  }

  async getTournament(id) {
    if (this._isDb()) {
      const { data } = await this.supabase
        .from("tournaments")
        .select("*")
        .eq("id", id)
        .single();
      if (!data) return null;
      return {
        ...data,
        gameType: data.game_type,
        maxParticipants: data.max_participants,
        registrationDeadline: data.registration_deadline,
        roundDeadlineHours: data.round_deadline_hours,
        prizePool: data.prize_pool,
      };
    }
    return this.memory.tournaments.get(id) || null;
  }

  async listPlayers(tournamentId) {
    if (this._isDb()) {
      const { data } = await this.supabase
        .from("tournament_players")
        .select("user_id,user_name,elo,seed")
        .eq("tournament_id", tournamentId);
      return (data || []).map((p) => ({
        userId: p.user_id,
        userName: p.user_name,
        elo: p.elo,
        seed: p.seed,
      }));
    }
    return Array.from(
      this.memory.players.get(tournamentId)?.values() || []
    ).map((p) => ({
      userId: p.userId,
      userName: p.userName,
      elo: p.elo,
    }));
  }

  // Check if a user is registered in a tournament
  async isPlayerRegistered(tournamentId, userId) {
    if (!userId) return false;
    if (this._isDb()) {
      const { data, error } = await this.supabase
        .from("tournament_players")
        .select("id")
        .eq("tournament_id", tournamentId)
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (error && error.code !== "PGRST116") {
        console.error("isPlayerRegistered error:", error.message);
      }
      return !!data;
    }
    const map = this.memory.players.get(tournamentId);
    return map ? map.has(userId) : false;
  }

  async getBracket(tournamentId) {
    const t = await this.getTournament(tournamentId);
    if (!t) return [];
    if (t.bracket && t.bracket.length) return t.bracket;
    if (this._isDb()) {
      const { data: matches } = await this.supabase
        .from("tournament_matches")
        .select("*")
        .eq("tournament_id", tournamentId)
        .order("round_number", { ascending: true })
        .order("match_number", { ascending: true });
      // Fetch player names for name display
      const { data: players } = await this.supabase
        .from("tournament_players")
        .select("user_id,user_name")
        .eq("tournament_id", tournamentId);
      const nameMap = new Map();
      (players || []).forEach((p) => nameMap.set(p.user_id, p.user_name));
      const grouped = [];
      (matches || []).forEach((m) => {
        if (!grouped[m.round_number - 1]) {
          grouped[m.round_number - 1] = {
            roundNumber: m.round_number,
            name: this._roundName(m.round_number, matches),
            matches: [],
          };
        }
        grouped[m.round_number - 1].matches.push({
          id: m.id,
          roundNumber: m.round_number,
          matchNumber: m.match_number,
          player1: m.player1_user_id || "TBD",
          player2: m.player2_user_id || "TBD",
          player1Name: m.player1_user_id
            ? nameMap.get(m.player1_user_id) || m.player1_user_id
            : "TBD",
          player2Name: m.player2_user_id
            ? nameMap.get(m.player2_user_id) || m.player2_user_id
            : "TBD",
          winner: m.winner_user_id,
          status: m.status,
          deadline: m.deadline,
          gameRoomId: m.game_room_id || null,
        });
      });
      return grouped;
    }
    return t.bracket || [];
  }

  _roundName(r, allMatches) {
    // crude naming; total rounds inferred from highest round_number
    const max = Math.max(...allMatches.map((m) => m.round_number));
    if (r === max) return "Finale";
    if (r === max - 1) return "Polufinale";
    return r === 1 ? "Prva runda" : `Runda ${r}`;
  }

  // ---------- Start tournament & bracket generation ----------
  async startTournament(tournamentId) {
    const t = await this.getTournament(tournamentId);
    if (!t || t.status !== "registration") return false;
    const players = await this.listPlayers(tournamentId);
    if (players.length < 2) return false;

    // seeding
    let ordered = [...players];
    if (t.seedingMethod === "elo") {
      ordered.sort((a, b) => b.elo - a.elo);
    } else {
      // random
      for (let i = ordered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      }
    }

    // bracket size = next power of 2
    const size = Math.pow(2, Math.ceil(Math.log2(ordered.length)));
    const byes = size - ordered.length;
    const participants = [...ordered.map((p) => p.userId)];
    for (let i = 0; i < byes; i++) participants.push("BYE-" + i);

    const rounds = Math.log2(size);
    const bracket = [];
    const firstRoundMatches = [];
    let matchNumber = 1;
    for (let i = 0; i < size; i += 2) {
      const p1 = participants[i];
      const p2 = participants[i + 1];
      const isBye = p1.startsWith("BYE") || p2.startsWith("BYE");
      const mId = uuidv4();
      firstRoundMatches.push({
        id: mId,
        roundNumber: 1,
        matchNumber: matchNumber++,
        player1: p1.startsWith("BYE") ? "TBD" : p1,
        player2: p2.startsWith("BYE") ? "TBD" : p2,
        winner: null,
        status: isBye ? "finished" : "pending",
        deadline: isBye
          ? null
          : new Date(Date.now() + t.roundDeadlineHours * 3600 * 1000),
      });
    }
    bracket.push({
      roundNumber: 1,
      name: "Prva runda",
      matches: firstRoundMatches,
    });
    for (let r = 2; r <= rounds; r++) {
      const count = size / Math.pow(2, r);
      const matches = [];
      for (let m = 1; m <= count; m++) {
        matches.push({
          id: uuidv4(),
          roundNumber: r,
          matchNumber: m,
          player1: "TBD",
          player2: "TBD",
          winner: null,
          status: "waiting",
          deadline: null,
        });
      }
      const name =
        r === rounds
          ? "Finale"
          : r === rounds - 1
          ? "Polufinale"
          : `Runda ${r}`;
      bracket.push({ roundNumber: r, name, matches });
    }

    // auto advance BYEs
    await this._autoAdvanceByes(bracket);

    if (this._isDb()) {
      await this.supabase
        .from("tournaments")
        .update({ status: "ongoing", started_at: new Date() })
        .eq("id", tournamentId);
      // persist matches
      const rows = bracket.flatMap((r) =>
        r.matches.map((m) => ({
          id: m.id,
          tournament_id: tournamentId,
          round_number: m.roundNumber,
          match_number: m.matchNumber,
          player1_user_id: m.player1 === "TBD" ? null : m.player1,
          player2_user_id: m.player2 === "TBD" ? null : m.player2,
          winner_user_id: m.winner,
          status: m.status === "finished" && !m.winner ? "waiting" : m.status,
          deadline: m.deadline,
        }))
      );
      if (rows.length)
        await this.supabase.from("tournament_matches").insert(rows);
    } else {
      const mem = this.memory.tournaments.get(tournamentId);
      mem.status = "ongoing";
      mem.bracket = bracket;
      mem.startedAt = new Date();
    }
    this.io.emit("tournamentStarted", {
      id: tournamentId,
      name: t.name,
      gameType: t.gameType,
      status: "ongoing",
      bracket,
    });
    this.io.emit("bracketUpdated", { tournamentId, bracket });
    return bracket;
  }

  async _autoAdvanceByes(bracket) {
    // When a match contains a BYE, mark winner as the real player and propagate
    for (let r = 0; r < bracket.length - 1; r++) {
      const round = bracket[r];
      round.matches.forEach((m) => {
        if (m.status === "finished" && !m.winner) {
          // treat single real player as winner
          const real =
            m.player1 === "TBD"
              ? m.player2
              : m.player2 === "TBD"
              ? m.player1
              : null;
          if (real && real !== "TBD") {
            m.winner = real;
            this._propagateWinner(bracket, m);
          }
        }
      });
    }
  }

  _propagateWinner(bracket, match) {
    const currentRoundIndex = match.roundNumber - 1;
    if (currentRoundIndex >= bracket.length - 1) return; // final
    const nextRound = bracket[currentRoundIndex + 1];
    const targetIndex = Math.floor((match.matchNumber - 1) / 2);
    const targetMatch = nextRound.matches[targetIndex];
    if ((match.matchNumber - 1) % 2 === 0)
      targetMatch.player1 = match.winner || "TBD";
    else targetMatch.player2 = match.winner || "TBD";
    if (targetMatch.player1 !== "TBD" && targetMatch.player2 !== "TBD") {
      targetMatch.status = "pending";
      targetMatch.deadline = new Date(Date.now() + 48 * 3600 * 1000);
    }
  }

  // ---------- Report match result ----------
  async reportMatchResult(tournamentId, matchId, winnerUserId) {
    const bracket = await this.getBracket(tournamentId);
    let target;
    outer: for (const round of bracket) {
      for (const m of round.matches) {
        if (m.id === matchId) {
          target = m;
          break outer;
        }
      }
    }
    if (!target) throw new Error("Match not found");
    if (target.status === "finished") return target;
    target.winner = winnerUserId;
    target.status = "finished";
    target.finishedAt = new Date();
    this._propagateWinner(bracket, target);
    await this._persistBracket(tournamentId, bracket);
    // check final
    const finalMatch = bracket[bracket.length - 1].matches[0];
    if (finalMatch.winner) {
      await this._markTournamentFinished(tournamentId, finalMatch.winner);
    }
    this.io.emit("bracketUpdated", { tournamentId, bracket });
    return target;
  }

  // ---------- Start match (set to playing) ----------
  async startMatch(tournamentId, matchId, gameRoomId) {
    const bracket = await this.getBracket(tournamentId);
    let target;
    for (const round of bracket) {
      for (const m of round.matches) {
        if (m.id === matchId) {
          target = m;
          break;
        }
      }
      if (target) break;
    }
    if (!target) throw new Error("Match not found");
    if (target.status !== "pending") throw new Error("Match not pending");
    target.status = "playing";
    target.startedAt = new Date();
    target.gameRoomId = gameRoomId;
    if (this._isDb()) {
      await this.supabase
        .from("tournament_matches")
        .update({
          status: "playing",
          started_at: target.startedAt,
          game_room_id: gameRoomId,
        })
        .eq("id", matchId)
        .eq("tournament_id", tournamentId);
    } else {
      // persist in-memory bracket
      await this._persistBracket(tournamentId, bracket);
    }
    this.io.emit("bracketUpdated", { tournamentId, bracket });
    return target;
  }

  async _persistBracket(tournamentId, bracket) {
    if (this._isDb()) {
      for (const round of bracket) {
        for (const m of round.matches) {
          await this.supabase.from("tournament_matches").upsert({
            id: m.id,
            tournament_id: tournamentId,
            round_number: m.roundNumber,
            match_number: m.matchNumber,
            player1_user_id: m.player1 === "TBD" ? null : m.player1,
            player2_user_id: m.player2 === "TBD" ? null : m.player2,
            winner_user_id: m.winner,
            status: m.status,
            deadline: m.deadline,
          });
        }
      }
    } else {
      const t = this.memory.tournaments.get(tournamentId);
      if (t) t.bracket = bracket;
    }
  }

  async _markTournamentFinished(tournamentId, winnerUserId) {
    if (this._isDb()) {
      await this.supabase
        .from("tournaments")
        .update({
          status: "finished",
          winner_user_id: winnerUserId,
          finished_at: new Date(),
        })
        .eq("id", tournamentId);
    } else {
      const t = this.memory.tournaments.get(tournamentId);
      if (t) {
        t.status = "finished";
        t.winner = winnerUserId;
        t.finishedAt = new Date();
      }
    }
    await this._updateLeaderboard(winnerUserId, "win");
    this.io.emit("tournamentFinished", { tournamentId, winner: winnerUserId });
  }

  async _updateLeaderboard(userId, event) {
    if (this._isDb()) {
      // Simple points: win=5
      const { data: existing } = await this.supabase
        .from("tournament_leaderboard")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      const wins = (existing?.wins || 0) + (event === "win" ? 1 : 0);
      const points = (existing?.points || 0) + (event === "win" ? 5 : 0);
      await this.supabase.from("tournament_leaderboard").upsert({
        user_id: userId,
        wins,
        points,
        updated_at: new Date(),
      });
    } else {
      const row = this.memory.leaderboard.get(userId) || { wins: 0, points: 0 };
      if (event === "win") {
        row.wins += 1;
        row.points += 5;
      }
      this.memory.leaderboard.set(userId, row);
    }
  }

  // ---------- Deadlines ----------
  async processDeadlines() {
    const now = new Date();
    if (this._isDb()) {
      // Auto-start tournaments whose registration deadline passed
      try {
        const { data: due } = await this.supabase
          .from("tournaments")
          .select("id, status, registration_deadline")
          .eq("status", "registration")
          .lt("registration_deadline", now.toISOString());
        for (const row of due || []) {
          await this.startTournament(row.id);
        }
      } catch (e) {
        console.error("Auto-start fetch failed:", e.message);
      }

      // Auto-advance expired pending matches
      try {
        const { data: expired } = await this.supabase
          .from("tournament_matches")
          .select("id, tournament_id, player1_user_id, player2_user_id")
          .eq("status", "pending")
          .lt("deadline", now.toISOString());
        for (const m of expired || []) {
          const players = [m.player1_user_id, m.player2_user_id].filter(
            Boolean
          );
          if (players.length === 2) {
            const winner = players[Math.floor(Math.random() * 2)];
            await this.reportMatchResult(m.tournament_id, m.id, winner);
          }
        }
      } catch (e) {
        console.error("Deadline match processing failed:", e.message);
      }
    } else {
      // In-memory path
      for (const [tid, t] of this.memory.tournaments.entries()) {
        // Auto-start if registration deadline passed
        if (
          t.status === "registration" &&
          t.registrationDeadline &&
          new Date(t.registrationDeadline) < now &&
          (t.participants?.length || 0) >= 2
        ) {
          await this.startTournament(tid);
          continue; // bracket just built; next loop handles matches
        }
        if (t.status !== "ongoing") continue;
        let changed = false;
        for (const round of t.bracket) {
          for (const m of round.matches) {
            if (
              m.status === "pending" &&
              m.deadline &&
              new Date(m.deadline) < now
            ) {
              const candidates = [m.player1, m.player2].filter(
                (p) => p !== "TBD"
              );
              if (candidates.length === 2) {
                const winner = candidates[Math.floor(Math.random() * 2)];
                m.winner = winner;
                m.status = "finished";
                this._propagateWinner(t.bracket, m);
                changed = true;
              }
            }
          }
        }
        if (changed) {
          this.io.emit("bracketUpdated", {
            tournamentId: tid,
            bracket: t.bracket,
          });
        }
      }
    }
  }

  // ---------- Leaderboard ----------
  async getLeaderboard(limit = 50) {
    if (this._isDb()) {
      const { data } = await this.supabase
        .from("tournament_leaderboard")
        .select("*")
        .order("points", { ascending: false })
        .limit(limit);
      return data || [];
    }
    return Array.from(this.memory.leaderboard.entries()).map(
      ([userId, row]) => ({
        userId,
        ...row,
      })
    );
  }

  // ---------- Seeding helper (optional) ----------
  async autoSeedIfEmpty() {
    if (!this._isDb()) return; // only DB mode
    try {
      const { count } = await this.supabase
        .from("tournaments")
        .select("id", { count: "exact", head: true });
      if (count && count > 0) return; // already have tournaments
      console.log("🌱 Seeding default tournaments (none found)...");
      const now = new Date();
      const in2h = new Date(now.getTime() + 2 * 3600 * 1000).toISOString();
      const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();
      await this.supabase.from("tournaments").insert([
        {
          id: uuidv4(),
          name: "Briskula Open",
          game_type: "briskula",
          max_participants: 8,
          registration_deadline: in2h,
          seeding_method: "random",
        },
        {
          id: uuidv4(),
          name: "Treseta Night Cup",
          game_type: "treseta",
          max_participants: 16,
          registration_deadline: tomorrow,
          seeding_method: "elo",
        },
      ]);
      console.log("✅ Default tournaments seeded");
    } catch (e) {
      console.error("Seeding tournaments failed:", e.message);
    }
  }

  // ---------- Dev seed with dummy players (memory or DB) ----------
  async devSeed() {
    const wantDummy = process.env.TOURNAMENT_DEV_SEED === "true";
    if (!wantDummy) return;
    try {
      if (this._isDb()) {
        const { count } = await this.supabase
          .from("tournaments")
          .select("id", { count: "exact", head: true });
        if (count && count > 0) return; // don't pollute existing env
      } else if (this.memory.tournaments.size > 0) {
        return;
      }
      console.log("🧪 Dev seeding tournaments with dummy players...");
      // Create two tournaments
      const t1 = await this.createTournament(
        {
          name: "Briskula Demo Cup",
          gameType: "briskula",
          maxParticipants: 8,
          registrationDeadline: new Date(Date.now() + 30 * 60 * 1000),
        },
        "system"
      );
      const t2 = await this.createTournament(
        {
          name: "Treseta Night Demo",
          gameType: "treseta",
          maxParticipants: 4,
          registrationDeadline: new Date(Date.now() + 2 * 60 * 60 * 1000),
        },
        "system"
      );
      const dummyPlayers = [
        { userId: "demo1", name: "Demo1" },
        { userId: "demo2", name: "Demo2" },
        { userId: "demo3", name: "Demo3" },
        { userId: "demo4", name: "Demo4" },
      ];
      for (const p of dummyPlayers) {
        try {
          await this.registerPlayer(t1.id, p);
        } catch (_) {}
      }
      // Start t1 immediately
      await this.startTournament(t1.id);
      // Add two players to second so user can join more spots
      await this.registerPlayer(t2.id, { userId: "demo5", name: "Demo5" });
      await this.registerPlayer(t2.id, { userId: "demo6", name: "Demo6" });
      console.log("✅ Dev seed complete");
    } catch (e) {
      console.error("Dev seed failed:", e.message);
    }
  }

  // Always ensure at least some sample tournaments exist (one active/one open) if empty
  async ensureSampleTournaments() {
    try {
      if (this._isDb()) {
        const { count } = await this.supabase
          .from("tournaments")
          .select("id", { count: "exact", head: true });
        if (count && count > 0) return; // already have
      } else if (this.memory.tournaments.size > 0) {
        return;
      }

      console.log(
        "🌱 Creating sample tournaments (ensureSampleTournaments)..."
      );
      const now = Date.now();
      const base = [
        {
          name: "Briskula Daily Clash",
          gameType: "briskula",
          maxParticipants: 8,
          registrationDeadline: new Date(now + 45 * 60 * 1000), // 45 min
        },
        {
          name: "Treseta Evening Cup",
          gameType: "treseta",
          maxParticipants: 16,
          registrationDeadline: new Date(now + 3 * 60 * 60 * 1000),
        },
        {
          name: "🎄 Božićni Cup",
          gameType: "briskula",
          maxParticipants: 32,
          registrationDeadline: new Date(
            new Date().getFullYear(),
            11,
            20,
            12,
            0,
            0
          ), // Dec 20
        },
        {
          name: "🐰 Uskršnji Turnir",
          gameType: "treseta",
          maxParticipants: 4,
          registrationDeadline: new Date(
            new Date().getFullYear() + 1,
            2,
            25,
            12,
            0,
            0
          ), // approx March 25 next year
        },
      ];

      const created = [];
      for (const cfg of base) {
        const t = await this.createTournament(cfg, "system");
        created.push(t);
      }

      // Add a few dummy players to first tournament and start it
      const dummies = [
        { userId: "seed1", name: "Seed1" },
        { userId: "seed2", name: "Seed2" },
        { userId: "seed3", name: "Seed3" },
        { userId: "seed4", name: "Seed4" },
      ];
      for (const p of dummies) {
        try {
          await this.registerPlayer(created[0].id, p);
        } catch (_) {}
      }
      await this.startTournament(created[0].id);
      console.log("✅ Sample tournaments created");
    } catch (e) {
      console.error("ensureSampleTournaments failed:", e.message);
    }
  }

  /**
   * resetAll - potpuni clean slate (DB + memory)
   */
  async resetAll({ includeSessions = true } = {}) {
    try {
      if (this._isDb()) {
        await this.supabase
          .from("tournament_matches")
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000");
        await this.supabase
          .from("tournament_players")
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000");
        await this.supabase
          .from("tournaments")
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000");
        await this.supabase
          .from("tournament_leaderboard")
          .delete()
          .neq("user_id", "__keep__");
        await this.supabase
          .from("game_states")
          .delete()
          .neq("room_id", "__keep__");
        if (includeSessions) {
          await this.supabase
            .from("sessions")
            .delete()
            .neq("id", "00000000-0000-0000-0000-000000000000");
        }
      }
      this.memory.tournaments.clear();
      this.memory.players.clear();
      this.memory.matches.clear();
      this.memory.leaderboard.clear();
      return { success: true };
    } catch (e) {
      console.error("resetAll failed:", e.message);
      return { success: false, error: e.message };
    }
  }
}
