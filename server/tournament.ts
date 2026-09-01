import { type Room, type Team } from "./types.js";

// ─── Team status ──────────────────────────────────────────────────────────────

export function isEliminated(room: Room, team: Team) {
  return team.playerIds.length === 1;
}

export function isFinalist(room: Room, team: Team) {
  return team.playerIds.length === 5;
}

export function syncTeamState(room: Room) {
  for (const team of room.teams) {
    team.rosterSize = team.playerIds.length;
    team.finalist = team.playerIds.length === 5;
    team.eliminated = team.playerIds.length === 1;

    if (team.finalist) {
      if (!room.finalists.includes(team.id)) {
        room.finalists.push(team.id);
      }
    } else {
      room.finalists = room.finalists.filter((id) => id !== team.id);
    }

    if (team.eliminated) {
      if (team.playerIds[0] && !room.eliminated.includes(team.playerIds[0])) {
        room.eliminated.push(team.playerIds[0]);
      }
    } else {
      if (team.playerIds.length > 1) {
        room.eliminated = room.eliminated.filter((id) => !team.playerIds.includes(id));
      }
    }
  }
}

// ─── Matchmaking ──────────────────────────────────────────────────────────────

export function teamInMatch(room: Room, teamId: string) {
  return room.matches.some((match) => match.status === "lobby" && [match.teamAId, match.teamBId].includes(teamId));
}

export function availableTeams(room: Room) {
  return room.teams.filter((team) => !team.finalist && !team.eliminated && team.playerIds.length >= 2 && !teamInMatch(room, team.id));
}

export function hasSameLevelPair(room: Room) {
  const counts = new Map<number, number>();
  for (const team of availableTeams(room)) counts.set(team.rosterSize, (counts.get(team.rosterSize) ?? 0) + 1);
  return [...counts.values()].some((count) => count >= 2);
}

export function nearestRosterDistance(room: Room) {
  const teams = availableTeams(room);
  let distance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < teams.length; i += 1) {
    for (let j = i + 1; j < teams.length; j += 1) {
      distance = Math.min(distance, Math.abs(teams[i].rosterSize - teams[j].rosterSize));
    }
  }
  return distance;
}

export function isEmergencyPair(room: Room, fromTeam: Team, toTeam: Team) {
  if (room.rules.matchmakingPolicy !== "strict-emergency" || hasSameLevelPair(room)) return false;
  const sizes = [...new Set(availableTeams(room).map((team) => team.rosterSize))].sort((a, b) => a - b);
  const [smallest, secondSmallest] = sizes;
  return (
    sizes.length >= 2 &&
    [smallest, secondSmallest].includes(fromTeam.rosterSize) &&
    [smallest, secondSmallest].includes(toTeam.rosterSize) &&
    fromTeam.rosterSize !== toTeam.rosterSize
  );
}

export function legalMatchmakingPair(room: Room, fromTeam: Team, toTeam: Team) {
  if (room.rules.matchmakingPolicy === "strict") return fromTeam.rosterSize === toTeam.rosterSize;
  if (room.rules.matchmakingPolicy === "strict-emergency") {
    return fromTeam.rosterSize === toTeam.rosterSize || isEmergencyPair(room, fromTeam, toTeam);
  }
  return Math.abs(fromTeam.rosterSize - toTeam.rosterSize) === nearestRosterDistance(room);
}

export function isRepeatedPair(room: Room, teamAId: string, teamBId: string) {
  const priorMatches = room.matches.filter(
    (match) =>
      match.status === "reported" &&
      ((match.teamAId === teamAId && match.teamBId === teamBId) ||
       (match.teamAId === teamBId && match.teamBId === teamAId)),
  );
  if (priorMatches.length < 2) return false;
  const [first, second] = priorMatches.slice(-2);
  const bothHaveWinners = Boolean(first.winnerTeamId && second.winnerTeamId);
  const winnersSwapped = first.winnerTeamId !== second.winnerTeamId;
  const samePlayerTraded = Boolean(first.stolenPlayerId && first.stolenPlayerId === second.stolenPlayerId);
  return bothHaveWinners && winnersSwapped && samePlayerTraded;
}
