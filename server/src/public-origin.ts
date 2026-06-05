import os from "node:os";

import { clientPort } from "./config.js";

const virtualInterfacePattern =
  /^(?:lo|lo0|utun\d*|awdl\d*|llw\d*|bridge\d*|docker\d*|vboxnet\d*|vmnet\d*|tap\d*|tun\d*|vnic\d*|gif\d*|stf\d*|anpi\d*)$/i;

function isPrivateIpv4(address: string): boolean {
  return (
    address.startsWith("10.") ||
    address.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
  );
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

function isPreferredLanInterface(name: string): boolean {
  return !virtualInterfacePattern.test(name);
}

function getInterfacePriority(name: string): number {
  if (/^en\d+$/i.test(name)) {
    return 0;
  }

  if (/^(?:eth\d+|wlan\d+|wifi\d+)$/i.test(name)) {
    return 1;
  }

  return 2;
}

/** Best-guess LAN URL phones should use to reach the client (for the join QR code). */
export function getPublicClientOrigin(): string {
  const configuredOrigin = process.env.SONGSTER_PUBLIC_ORIGIN ?? process.env.SONGSTER_CLIENT_ORIGIN;
  if (configuredOrigin !== undefined && configuredOrigin.trim().length > 0) {
    return normalizeOrigin(configuredOrigin.trim());
  }

  const bindHost = process.env.SONGSTER_BIND_HOST?.trim();
  if (bindHost !== undefined && bindHost.length > 0 && bindHost !== "0.0.0.0") {
    return `http://${bindHost}:${clientPort}`;
  }

  const interfaces = os.networkInterfaces();
  const interfaceNames = Object.keys(interfaces).sort((left, right) => {
    const leftPreferred = isPreferredLanInterface(left) ? 0 : 1;
    const rightPreferred = isPreferredLanInterface(right) ? 0 : 1;

    if (leftPreferred !== rightPreferred) {
      return leftPreferred - rightPreferred;
    }

    return getInterfacePriority(left) - getInterfacePriority(right) || left.localeCompare(right);
  });

  for (const name of interfaceNames) {
    if (!isPreferredLanInterface(name)) {
      continue;
    }

    for (const entry of interfaces[name] ?? []) {
      if (entry.family === "IPv4" && !entry.internal && isPrivateIpv4(entry.address)) {
        return `http://${entry.address}:${clientPort}`;
      }
    }
  }

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && isPrivateIpv4(entry.address)) {
        return `http://${entry.address}:${clientPort}`;
      }
    }
  }

  return `http://127.0.0.1:${clientPort}`;
}
