import { customAlphabet } from "nanoid";
import { timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const newHash = customAlphabet(ALPHABET, config.hashLength);

const HASH_RE = /^[0-9A-Za-z]{10,16}$/;
export const isHashShaped = (value: string) => HASH_RE.test(value);

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
