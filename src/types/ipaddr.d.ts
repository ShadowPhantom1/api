/**
 * Minimal ambient declaration for `ipaddr.js` (the package ships no types and
 * there is no DefinitelyTyped package). Only the surface Anvex actually uses
 * is declared, which keeps the SSRF guard type-safe without `any`.
 */
declare module "ipaddr.js" {
  interface IPv4 {
    kind(): "ipv4";
    octets: [number, number, number, number];
    toString(): string;
    toNormalizedString(): string;
    toIPv4MappedAddress(): IPv6;
    range(): string;
  }

  interface IPv6 {
    kind(): "ipv6";
    parts: number[];
    toString(): string;
    toNormalizedString(): string;
    toIPv4Address(): IPv4;
    isIPv4MappedAddress(): boolean;
    range(): string;
  }

  type IPAddress = IPv4 | IPv6;

  interface IpAddr {
    isValid(ip: string): boolean;
    isValid4(ip: string): boolean;
    isValid6(ip: string): boolean;
    parse(ip: string): IPAddress;
    parseCIDR(cidr: string): [IPAddress, number];
    IPv4: new (octets?: number[]) => IPv4;
    IPv6: new (parts?: number[]) => IPv6;
    subnetMatch(address: IPAddress, rangeList: ReadonlyArray<[string, number]>, rangeName?: string): string;
  }

  const ipaddr: IpAddr;
  export default ipaddr;
  export type { IPAddress, IPv4, IPv6 };
}
