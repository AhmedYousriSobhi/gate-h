import { safeStorage } from 'electron'

// Wraps Electron's OS-keychain-backed safeStorage (libsecret on Linux) so SSH passphrases and
// Grafana/Jira API tokens never touch disk in plaintext. We intentionally do NOT fall back to
// plaintext storage when the OS keychain is unavailable - callers must surface the error instead.

export class SecretStorageUnavailableError extends Error {
  constructor() {
    super(
      'OS-level secure storage is unavailable (no keychain/libsecret backend detected). ' +
        'Cannot store credentials safely on this system.'
    )
    this.name = 'SecretStorageUnavailableError'
  }
}

export function encryptSecret(plainText: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SecretStorageUnavailableError()
  }
  return safeStorage.encryptString(plainText).toString('base64')
}

export function decryptSecret(encryptedBase64: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SecretStorageUnavailableError()
  }
  return safeStorage.decryptString(Buffer.from(encryptedBase64, 'base64'))
}
