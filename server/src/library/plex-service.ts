import { logger } from "../logger.js";

interface PlexPinResponse {
  id: number;
  code: string;
  authToken: string | null;
}

/**
 * Get a new link PIN from plex.tv.
 * The clientIdentifier must be stable for this installation.
 */
export async function getPlexPin(clientIdentifier: string): Promise<{ pinId: number; code: string }> {
  try {
    const response = await fetch("https://plex.tv/api/v2/pins", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Plex-Product": "Songster",
        "X-Plex-Version": "1.0.0",
        "X-Plex-Client-Identifier": clientIdentifier,
      },
      body: JSON.stringify({ strong: true }),
    });

    if (!response.ok) {
      throw new Error(`Failed to request PIN from plex.tv: Status ${response.status}`);
    }

    const data = (await response.json()) as PlexPinResponse;
    return { pinId: data.id, code: data.code };
  } catch (error) {
    logger.error({ error: (error as Error).message }, "Failed to request Plex PIN");
    throw error;
  }
}

/**
 * Check if the PIN has been authorized and return the token if so.
 */
export async function checkPlexPin(pinId: string, clientIdentifier: string): Promise<string | null> {
  try {
    const response = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Plex-Client-Identifier": clientIdentifier,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as PlexPinResponse;
    return data.authToken;
  } catch (error) {
    logger.error({ pinId, error: (error as Error).message }, "Failed to check Plex PIN");
    return null;
  }
}

/**
 * Helper to query Plex Server sections/libraries.
 */
export async function fetchPlexSections(plexUrl: string, token: string): Promise<any> {
  const cleanUrl = plexUrl.replace(/\/+$/, "");
  const response = await fetch(`${cleanUrl}/library/sections`, {
    headers: {
      "Accept": "application/json",
      "X-Plex-Token": token,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to contact Plex server: status ${response.status}`);
  }

  return response.json();
}
