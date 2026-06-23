# Songster Rules of the Game 🎵

Songster is a digital music trivia and timeline party game where teams compete to correctly place song snippets in chronological order.

---

## 👥 Teams and Roles

*   **Teams:** Players are grouped into teams (e.g., Red, Blue). The game supports multiple teams.
*   **Active Placer:** Each turn, one member of the active team is designated as the **Placer**. Only the active Placer can lock in the final timeline guess (though the song snippet plays on the shared Hub screen for everyone to hear).
*   **Teammates:** Other members of the active team can suggest placement slots by clicking on their timelines, sending visual cues (lightbulb suggestions) to the Placer to help guide their guess.
*   **Placer Rotation:** The Placer role rotates round-robin among all team members every time it is that team's turn, ensuring everyone gets a chance to guess.

---

## ⏱️ Turn Play and Placement

1.  A song snippet plays on the shared **Hub** screen.
2.  The active Placer drags or selects a slot in their team's timeline where they believe the song fits chronologically.
    *   *Timeline slots* are relative to cards already correctly placed (e.g., before the oldest, between two cards, or after the newest).
    *   Ties in release years are resolved in favor of the player: placing a card on either side of an identical year is counted as correct.
3.  The Placer locks in their placement guess.

---

## 🕵️ Steals

*   **Steal Tokens:** Every player starts the game with a set number of Steal tokens (configured in the room settings).
*   **Placing a Steal:** While the active Placer is deciding, players on *opposing teams* can spend a Steal token to challenge.
    *   Only **one steal** can be placed per turn (first-come, first-served).
    *   The stealer chooses a slot in their own team's timeline where they believe the song fits chronologically.
*   **Resolution:**
    *   If the active Placer is **correct**, the card goes to the active team's timeline. Any opposing steal is discarded, and the spent token is lost.
    *   If the active Placer is **wrong**, the card is tested against the stealer's guessed slot. If the stealer is **correct**, the card is awarded to the stealer's team timeline. If the stealer is also wrong, the card is discarded.

---

## 🏆 Winning and Tiebreaking

*   **The Target:** The first team to correctly place the target number of songs (typically 7 or 10 non-seed cards) in their timeline wins.
*   **No Tiebreakers Needed:** Because the game is strictly sequential:
    *   A team wins immediately on their own turn by locking in a correct guess that reaches the target.
    *   A team can also win on an opponent's turn by successfully stealing a card and placing it correctly to reach the target.
    *   Since only one team can score at any single resolution point, simultaneous wins are impossible. The first team to reach the target wins the match instantly.
