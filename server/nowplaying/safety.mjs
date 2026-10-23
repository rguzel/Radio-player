// Keeps outbound stream connections away from the server's own network.

import dns from 'node:dns';
import net from 'node:net';

// Addresses a public stream URL must never resolve to (loopback, private
// ranges, link-local/cloud metadata, multicast, reserved).
const blockedRanges = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blockedRanges.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) {
  blockedRanges.addSubnet(address, prefix, 'ipv6');
}

export function isBlockedAddress(address) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return blockedRanges.check(mapped[1], 'ipv4');
  return blockedRanges.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');
}

/**
 * dns.lookup replacement that refuses blocked addresses. Used as the socket's
 * lookup function, so the check applies to the address actually connected to
 * (no DNS-rebinding gap) and to every redirect hop.
 */
export function createSafeLookup({ allowPrivateNetworks = false } = {}) {
  const lookup = (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      const blocked = allowPrivateNetworks ? undefined : addresses.find(a => isBlockedAddress(a.address));
      if (blocked) return callback(Object.assign(new Error(`Blocked address ${blocked.address}`), { code: 'EBLOCKED' }));
      if (options?.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
  // Node skips the lookup function for IP-literal hosts, so readStreamTitle
  // checks those itself with this.
  lookup.isAllowed = address => allowPrivateNetworks || !isBlockedAddress(address);
  return lookup;
}
