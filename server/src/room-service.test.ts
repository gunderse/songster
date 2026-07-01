import assert from "node:assert/strict";
import { test } from "node:test";
import { RoomManager } from "./room-service.js";

test("RoomManager pause and resume", () => {
  const manager = new RoomManager({} as any, {
    broadcast: () => {},
    playAudioToHubs: () => {},
    emceeToHubs: () => {},
    showcaseToHubs: () => {},
  });

  const room = manager.createRoom({
    targetLength: 7,
    specialsPerTeam: 3,
    snippetLenS: 30,
    teamCount: 2,
    turnTimerS: 45,
    deck: {},
    musicSource: "all",
    showcaseSteals: false,
    showcaseLeadChanges: false,
    showcaseStreaks: false,
    showcaseMilestones: false,
    narratorVoice: "cycle",
  });

  assert.equal(room.game, null);

  // If there's no game active, pauseGame should return undefined
  const resNull = manager.pauseGame(room.code);
  assert.equal(resNull, undefined);

  // Initialize a mock game
  room.game = {
    active: null,
    teams: [],
    turnIndex: 0,
    turnCounter: 0,
    leaderTeamId: null,
    winnerTeamId: null,
    countdownTimer: null,
    countdownEndsAt: null,
    countdownReady: false,
    history: [],
    paused: false,
    pauseRemainingMs: null,
    revealDeadline: null,
    revealTimer: null,
  } as any;

  // Now pausing should toggle paused flag
  manager.pauseGame(room.code);
  assert.equal(room.game!.paused, true);

  // Resuming should toggle it back
  manager.resumeGame(room.code);
  assert.equal(room.game!.paused, false);
});
