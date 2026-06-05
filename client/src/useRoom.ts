import { useEffect, useState } from "react";

import type { RoomState } from "@songster/shared/room";

import { socket } from "./socket";

/** Subscribe to server-pushed room:state and ensure the socket is connected. */
export function useRoomState(): RoomState | null {
  const [state, setState] = useState<RoomState | null>(null);
  useEffect(() => {
    function onState(next: RoomState) {
      setState(next);
    }
    socket.on("room:state", onState);
    if (!socket.connected) socket.connect();
    return () => {
      socket.off("room:state", onState);
    };
  }, []);
  return state;
}

export function joinUrl(code: string): string {
  return `${window.location.origin}/?code=${code}`;
}

export function hubUrl(code: string): string {
  return `${window.location.origin}/hub/${code}`;
}
