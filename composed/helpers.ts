/**
 * Gmail Toolkit — Shared Helpers for Composed Operations
 *
 * Contact parsing, header extraction, and other utilities
 * shared across multiple composed operation modules.
 */

import type { Contact } from '../types.js';

/**
 * Parse a single email contact string into a Contact object.
 * Handles formats: "Name <email>", "<email>", "email"
 */
export function parseContact(raw: string): Contact {
  const trimmed = raw.trim();
  if (!trimmed) return { name: null, email: '' };

  // "Display Name <email@example.com>"
  const match = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    const name = match[1].replace(/^["']|["']$/g, '').trim();
    return { name: name || null, email: match[2].trim() };
  }

  // "<email@example.com>"
  const angleMatch = trimmed.match(/^<([^>]+)>$/);
  if (angleMatch) {
    return { name: null, email: angleMatch[1].trim() };
  }

  // Plain email
  return { name: null, email: trimmed };
}

/**
 * Parse a comma-separated list of contacts.
 * Handles quoted names containing commas.
 */
export function parseContactList(raw: string): Contact[] {
  if (!raw.trim()) return [];

  const contacts: Contact[] = [];
  let current = '';
  let inQuotes = false;
  let depth = 0;

  for (const char of raw) {
    if (char === '"') inQuotes = !inQuotes;
    if (char === '<') depth++;
    if (char === '>') depth--;
    if (char === ',' && !inQuotes && depth === 0) {
      const parsed = parseContact(current);
      if (parsed.email) contacts.push(parsed);
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    const parsed = parseContact(current);
    if (parsed.email) contacts.push(parsed);
  }

  return contacts;
}

/**
 * Deduplicate contacts by email address (case-insensitive).
 * Keeps the first occurrence (which typically has the most complete name).
 */
export function deduplicateContacts(contacts: Contact[]): Contact[] {
  const seen = new Map<string, Contact>();
  for (const contact of contacts) {
    const key = contact.email.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, contact);
    }
  }
  return Array.from(seen.values());
}
