# TONNET WALLET - Enterprise Implementation Plan

> **Version:** 1.0.0
> **Status:** Draft
> **Classification:** Internal - Technical Specification
> **Last Updated:** 2026-01-26

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Security Model](#3-security-model)
4. [Core Wallet Engine](#4-core-wallet-engine)
5. [TON Connect Integration](#5-ton-connect-integration)
6. [Asset Support](#6-asset-support)
7. [User Interface](#7-user-interface)
8. [Data Persistence](#8-data-persistence)
9. [Testing Strategy](#9-testing-strategy)
10. [Deployment & Distribution](#10-deployment--distribution)
11. [Implementation Phases](#11-implementation-phases)
12. [Risk Assessment](#12-risk-assessment)
13. [Appendices](#13-appendices)

---

## 1. Executive Summary

### 1.1 Objective

Implement a native, enterprise-grade TON wallet within Tonnet Browser that:

- Provides seamless TON Connect 2.0 compatibility with all TON dApps
- Supports TON native currency, Jettons (tokens), and NFTs
- Maintains highest security standards for key management
- Delivers fluid, intuitive user experience

### 1.2 Success Criteria

| Metric | Target |
|--------|--------|
| TON Connect Compliance | 100% protocol spec |
| Security Audit Score | No critical/high vulnerabilities |
| Transaction Success Rate | > 99.9% |
| UI Response Time | < 100ms for all interactions |
| Cold Start Time | < 500ms wallet ready |

### 1.3 Non-Goals

- Hardware wallet support (future consideration)
- Multi-chain support (TON only)
- Custodial features
- Fiat on/off ramp integration

---

## 2. Architecture Overview

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TONNET BROWSER                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────┐      ┌─────────────────────────────────┐   │
│  │      RENDERER PROCESS       │      │         MAIN PROCESS            │   │
│  │      (Untrusted Zone)       │      │        (Trusted Zone)           │   │
│  ├─────────────────────────────┤      ├─────────────────────────────────┤   │
│  │                             │      │                                 │   │
│  │  ┌───────────────────────┐  │      │  ┌───────────────────────────┐  │   │
│  │  │    Wallet UI Panel    │  │ IPC  │  │     Wallet Core Engine    │  │   │
│  │  │  - Balance Display    │◄─┼──────┼─►│  - Key Management         │  │   │
│  │  │  - Send/Receive       │  │      │  │  - Transaction Signing    │  │   │
│  │  │  - Transaction List   │  │      │  │  - Blockchain API         │  │   │
│  │  │  - NFT Gallery        │  │      │  │  - Asset Indexing         │  │   │
│  │  │  - Token Portfolio    │  │      │  │                           │  │   │
│  │  └───────────────────────┘  │      │  └─────────────┬─────────────┘  │   │
│  │                             │      │                │                │   │
│  │  ┌───────────────────────┐  │      │  ┌─────────────▼─────────────┐  │   │
│  │  │     BrowserView       │  │      │  │    Secure Storage Layer   │  │   │
│  │  │    (TON dApps)        │  │      │  │  - Electron safeStorage   │  │   │
│  │  │                       │  │ IPC  │  │  - AES-256-GCM Encryption │  │   │
│  │  │  window.tonnet        │◄─┼──────┼─►│  - PBKDF2 Key Derivation  │  │   │
│  │  │    .tonconnect        │  │      │  │                           │  │   │
│  │  └───────────────────────┘  │      │  └───────────────────────────┘  │   │
│  │                             │      │                                 │   │
│  └─────────────────────────────┘      └─────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                    ┌───────────────────────────────────────┐
                    │           TON BLOCKCHAIN              │
                    │  - Toncenter API (Primary)            │
                    │  - TON Access (Fallback)              │
                    │  - GetBlock (Fallback)                │
                    └───────────────────────────────────────┘
```

### 2.2 Process Isolation Model

| Component | Process | Trust Level | Access |
|-----------|---------|-------------|--------|
| Wallet UI | Renderer | Untrusted | Display only, no keys |
| BrowserView (dApps) | Renderer | Untrusted | TON Connect bridge only |
| Wallet Core | Main | Trusted | Full key access |
| Secure Storage | Main | Trusted | Encrypted persistence |
| Preload Scripts | Bridge | Semi-trusted | IPC relay only |

### 2.3 Directory Structure

```
src/
├── main/
│   └── wallet/
│       ├── core/
│       │   ├── engine.ts           # Main wallet engine
│       │   ├── keychain.ts         # Key management
│       │   ├── signer.ts           # Transaction signing
│       │   └── types.ts            # Core type definitions
│       ├── blockchain/
│       │   ├── client.ts           # TON API client
│       │   ├── contracts.ts        # Wallet contract wrappers
│       │   └── providers.ts        # Multi-provider fallback
│       ├── assets/
│       │   ├── jettons.ts          # Token operations
│       │   ├── nfts.ts             # NFT operations
│       │   └── indexer.ts          # Asset discovery
│       ├── storage/
│       │   ├── secure.ts           # Encrypted storage
│       │   ├── cache.ts            # Transaction cache
│       │   └── migrations.ts       # Schema migrations
│       ├── tonconnect/
│       │   ├── bridge.ts           # JS Bridge implementation
│       │   ├── protocol.ts         # Protocol handlers
│       │   ├── sessions.ts         # Session management
│       │   └── injection.ts        # Preload injection
│       └── ipc/
│           ├── handlers.ts         # IPC request handlers
│           └── validators.ts       # Input validation
│
├── renderer/src/
│   ├── components/wallet/
│   │   ├── WalletPanel.tsx         # Main wallet panel
│   │   ├── WalletSetup.tsx         # Onboarding flow
│   │   ├── WalletUnlock.tsx        # Password entry
│   │   ├── WalletBalance.tsx       # Balance display
│   │   ├── WalletSend.tsx          # Send transaction
│   │   ├── WalletReceive.tsx       # Receive/QR code
│   │   ├── WalletHistory.tsx       # Transaction history
│   │   ├── WalletTokens.tsx        # Token list
│   │   ├── WalletNFTs.tsx          # NFT gallery
│   │   ├── WalletBackup.tsx        # Seed phrase backup
│   │   ├── WalletSettings.tsx      # Wallet settings
│   │   └── WalletConfirmTx.tsx     # Transaction confirmation modal
│   │
│   └── stores/
│       └── wallet.ts               # Wallet state (Zustand)
│
├── preload/
│   └── tonconnect.ts               # TON Connect bridge injection
│
└── shared/
    └── wallet/
        ├── types.ts                # Shared type definitions
        ├── constants.ts            # Wallet constants
        └── validation.ts           # Address validation
```

---

## 3. Security Model

### 3.1 Threat Model

| Threat | Severity | Mitigation |
|--------|----------|------------|
| Key extraction from memory | Critical | Keys only in main process, zeroed after use |
| Malicious dApp transaction | High | User confirmation for all transactions |
| Storage compromise | High | Multi-layer encryption |
| IPC message tampering | Medium | Schema validation, signed requests |
| Phishing via fake UI | Medium | Trusted UI indicators |
| Brute force password | Medium | PBKDF2 with high iterations, rate limiting |
| Session hijacking | Medium | Per-origin session isolation |

### 3.2 Encryption Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ENCRYPTION LAYERS                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User Password                                                  │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  PBKDF2-SHA512 (600,000 iterations)                     │   │
│  │  Salt: 32 bytes random (stored separately)              │   │
│  └─────────────────────────────────────────────────────────┘   │
│       │                                                         │
│       ▼                                                         │
│  Derived Key (256-bit)                                          │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  AES-256-GCM Encryption                                 │   │
│  │  IV: 12 bytes random per encryption                     │   │
│  │  Auth Tag: 16 bytes                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│       │                                                         │
│       ▼                                                         │
│  Encrypted Seed Phrase                                          │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Electron safeStorage                                   │   │
│  │  - macOS: Keychain                                      │   │
│  │  - Windows: DPAPI                                       │   │
│  │  - Linux: libsecret/kwallet                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│       │                                                         │
│       ▼                                                         │
│  Persisted to: userData/wallet.enc                              │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  BIOMETRIC LAYER (Optional)                              │  │
│  │  - TouchID (macOS)                                       │  │
│  │  - Windows Hello (Windows)                               │  │
│  │  - fprintd (Linux)                                       │  │
│  │                                                          │  │
│  │  Biometric-derived key → Encrypt seed phrase locally    │  │
│  │  Stored in OS secure enclave (never touches disk)       │  │
│  │  Fallback to password always available                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 Key Management Rules

| Rule | Implementation |
|------|----------------|
| Private keys NEVER leave main process | IPC returns signatures, not keys |
| Keys zeroed after signing | Buffer.fill(0) immediately after use |
| No key logging | Strict lint rules, code review |
| Memory-only decryption | Keys never written to disk unencrypted |
| Session timeout | Auto-lock after configurable inactivity |
| Failed attempt limiting | 5 attempts, then exponential backoff |

### 3.4 Transaction Security

```
dApp Request → Validation → User Confirmation → Signing → Broadcast
                   │              │                │
                   ▼              ▼                ▼
            - Schema check   - Amount display  - Main process only
            - Address valid  - Recipient show  - Keys in memory
            - Amount sane    - Fee estimate    - Immediate zeroing
            - Network match  - dApp origin     - Signed BoC only
```

### 3.5 Session Isolation (TON Connect)

```typescript
// Each dApp origin gets isolated session
type Session = {
  origin: string;           // https://app.example.ton
  publicKey: string;        // Session public key
  walletAddress: string;    // Connected wallet address
  permissions: string[];    // Granted permissions
  createdAt: number;
  lastActivity: number;
}

// Sessions stored per-origin, never shared
// Disconnect clears session completely
```

### 3.6 TON Race Condition Protection

TON's asynchronous 5-phase transaction processing creates race condition vulnerabilities. Critical mitigations:

```typescript
interface RaceConditionGuard {
  // Seqno Management
  seqnoLock: AsyncMutex;  // Lock seqno during TX preparation

  async getAndLockSeqno(address: string): Promise<{
    seqno: number;
    release: () => void;
  }>;

  // Message Ordering
  messageQueue: PriorityQueue<{
    message: Message;
    priority: number;
    timestamp: number;
  }>;

  // Idempotency Protection
  transactionCache: Map<string, {
    txHash: string;
    status: 'pending' | 'confirmed' | 'failed';
    timestamp: number;
    boc: string;
  }>;

  // Prevent duplicate TX
  async checkIdempotency(params: TransactionParams): Promise<boolean>;

  // 5-Phase Monitoring
  async waitForTransactionPhase(
    hash: string,
    targetPhase: 1 | 2 | 3 | 4 | 5,
    timeout: number
  ): Promise<PhaseResult>;

  // Temporal Dependency Tracking
  pendingOperations: Map<string, {
    dependencies: string[];  // TX hashes this depends on
    status: 'waiting' | 'ready' | 'executing';
  }>;
}

// Implementation Example
class TransactionGuard implements RaceConditionGuard {
  private seqnoLock = new AsyncMutex();
  private activeSeqno: number | null = null;

  async signTransaction(params: TransactionParams): Promise<string> {
    // 1. Lock seqno to prevent parallel TX
    const lock = await this.seqnoLock.acquire();

    try {
      // 2. Get current seqno
      const seqno = await this.getSeqno(params.from);

      // 3. Check idempotency
      const cached = await this.checkIdempotency(params);
      if (cached) return cached.boc;

      // 4. Build and sign with locked seqno
      const signed = await this.buildAndSign(params, seqno);

      // 5. Cache with 24h TTL
      this.transactionCache.set(this.getTxId(params), {
        txHash: signed.hash,
        status: 'pending',
        timestamp: Date.now(),
        boc: signed.boc
      });

      return signed.boc;
    } finally {
      lock.release();
    }
  }

  // Strict seqno verification before broadcast
  async verifySeqnoBeforeSend(address: string, expectedSeqno: number): Promise<boolean> {
    const currentSeqno = await this.getSeqno(address);
    if (currentSeqno !== expectedSeqno) {
      throw new Error(`Seqno mismatch: expected ${expectedSeqno}, got ${currentSeqno}`);
    }
    return true;
  }
}
```

**Critical Rules:**
- One transaction at a time per wallet (seqno lock)
- Verify seqno immediately before broadcast
- Cache transactions for 24h idempotency
- Monitor all 5 phases for confirmation
- Queue dependent transactions until dependencies confirm

---

## 4. Core Wallet Engine

### 4.1 Wallet Types Support

| Wallet Version | Contract | Use Case | Priority |
|----------------|----------|----------|----------|
| **v5R1** | EQC... | **Default for new wallets** | **PRIMARY** |
| v4R2 | EQB... | Import/legacy compatibility | SECONDARY |
| v3R2 | EQA... | Import compatibility only | LEGACY |

**v5 Advantages:**
- 25% lower transaction fees
- Gasless transactions support (via Battery/relayers)
- Up to 255 messages per transaction (vs 4 in v4)
- Extension mechanism for future features
- Account delegation and recovery support

### 4.2 Key Derivation

```typescript
// TON Standard Mnemonic (24 words)
// BIP39-like but TON-specific implementation

import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';

// Generation
const mnemonic: string[] = await mnemonicNew(24);

// Derivation
const keyPair = await mnemonicToPrivateKey(mnemonic);
// keyPair.publicKey: Buffer (32 bytes)
// keyPair.secretKey: Buffer (64 bytes)
```

### 4.3 Address Generation

```typescript
import { WalletContractV4 } from '@ton/ton';

const wallet = WalletContractV4.create({
  workchain: 0,
  publicKey: keyPair.publicKey
});

const address = wallet.address;
// Raw: 0:abc123...
// Friendly (bounceable): EQxxx...
// Friendly (non-bounceable): UQxxx...
```

### 4.4 Engine Interface

```typescript
interface WalletEngine {
  // Lifecycle
  initialize(): Promise<void>;
  isInitialized(): boolean;
  isUnlocked(): boolean;

  // Setup
  createWallet(password: string, version?: 'v5r1' | 'v4r2'): Promise<CreateWalletResult>;
  importWallet(mnemonic: string[], password: string, version?: 'v5r1' | 'v4r2' | 'v3r2'): Promise<ImportWalletResult>;
  migrateToV5(password: string): Promise<MigrationResult>;  // Migrate v4 → v5

  // Access
  unlock(password: string): Promise<boolean>;
  lock(): void;
  changePassword(oldPassword: string, newPassword: string): Promise<boolean>;

  // Info (no unlock required)
  getAddress(): string | null;
  getPublicKey(): string | null;

  // Balance & Assets (unlock required)
  getBalance(): Promise<bigint>;
  getJettons(): Promise<JettonBalance[]>;
  getNFTs(): Promise<NFTItem[]>;
  getTransactions(limit: number, offset?: string): Promise<Transaction[]>;

  // Signing (unlock required)
  signTransaction(params: TransactionParams): Promise<SignedTransaction>;
  signData(params: SignDataParams): Promise<SignedData>;

  // Transaction Monitoring & Security
  getTransactionRiskScore(params: TransactionParams): Promise<RiskScore>;
  checkRecipientSafety(address: string): Promise<SafetyCheck>;
  getAnomalyDetection(): AnomalyDetector;

  // Backup & Recovery
  exportMnemonic(password: string): Promise<string[]>;
  setupBiometricAuth(password: string): Promise<boolean>;
  unlockWithBiometric(): Promise<boolean>;
  setupSocialRecovery(guardians: Guardian[], password: string): Promise<void>;
  initiateSocialRecovery(approvals: GuardianApproval[]): Promise<RecoveryRequest>;

  // Danger zone
  wipeWallet(): Promise<void>;
  emergencyLock(): void;  // Immediate lock on security threat
}

interface Guardian {
  name: string;
  email?: string;
  publicKey: string;  // For shard encryption
}

interface GuardianApproval {
  guardianPublicKey: string;
  encryptedShard: string;
  signature: string;
}

interface MigrationResult {
  newAddress: string;  // v5 address
  oldAddress: string;  // v4 address for fund transfer
  estimatedFees: bigint;
}

interface CreateWalletResult {
  address: string;
  mnemonic: string[];  // Show once, user must backup
  publicKey: string;
}

interface TransactionParams {
  to: string;
  amount: bigint;
  payload?: string;       // Base64 BoC
  stateInit?: string;     // Base64 BoC
  validUntil?: number;
}

interface SignedTransaction {
  boc: string;            // Base64 signed BoC
  hash: string;           // Transaction hash
}

// Transaction Monitoring & Security

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

interface RiskScore {
  level: RiskLevel;
  score: number;  // 0-100
  reasons: string[];
  requiresAdditionalConfirmation: boolean;
}

interface SafetyCheck {
  isSafe: boolean;
  isKnownAddress: boolean;
  isContract: boolean;
  reputation?: 'trusted' | 'unknown' | 'suspicious' | 'scam';
  warnings: string[];
}

interface AnomalyDetector {
  // Amount anomalies
  checkAmountAnomaly(amount: bigint, history: Transaction[]): {
    isAnomaly: boolean;
    reason?: string;
    severity: RiskLevel;
  };

  // Frequency anomalies
  checkFrequencyAnomaly(address: string, window: '1h' | '24h'): {
    transactionCount: number;
    isUnusual: boolean;
    averageCount: number;
  };

  // Recipient anomalies
  checkNewRecipient(recipient: string, knownAddresses: string[]): {
    isNew: boolean;
    shouldWarn: boolean;
  };

  // Pattern detection
  detectSuspiciousPattern(transactions: Transaction[]): {
    pattern?: 'draining' | 'phishing' | 'money-laundering';
    confidence: number;
  };
}

interface TransactionMonitor {
  // Real-time monitoring
  async monitorTransaction(tx: SignedTransaction): Promise<void>;

  // Security event logging
  logSecurityEvent(event: SecurityEvent): void;

  // Audit trail
  async exportAuditLog(startDate: number, endDate: number): Promise<AuditLog>;
}

type SecurityEvent = {
  type: 'auth_failed' | 'suspicious_tx' | 'password_change' | 'wallet_access' | 'emergency_lock';
  timestamp: number;
  details: Record<string, any>;
  severity: RiskLevel;
};

interface AuditLog {
  events: SecurityEvent[];
  generatedAt: number;
  walletAddress: string;
}
```

### 4.5 Multi-Provider Blockchain Client

```typescript
interface BlockchainClient {
  // Providers (with automatic fallback)
  providers: [
    { name: 'toncenter', url: 'https://toncenter.com/api/v2' },
    { name: 'tonaccess', url: 'https://tonapi.io/v2' },
    { name: 'getblock', url: 'https://ton.getblock.io/v2' }
  ];

  // Methods
  getBalance(address: string): Promise<bigint>;
  getTransactions(address: string, limit: number): Promise<Transaction[]>;
  sendBoc(boc: string): Promise<SendResult>;
  getJettonWallets(owner: string): Promise<JettonWallet[]>;
  getNFTs(owner: string): Promise<NFTItem[]>;
  estimateFee(boc: string): Promise<bigint>;
  getSeqno(address: string): Promise<number>;
}
```

---

## 5. TON Connect Integration

### 5.1 Protocol Compliance Checklist

| Feature | Status | Priority |
|---------|--------|----------|
| JS Bridge injection | Required | P0 |
| connect() method | Required | P0 |
| restoreConnection() method | Required | P0 |
| send(sendTransaction) | Required | P0 |
| send(disconnect) | Required | P0 |
| send(signData) | Optional | P1 |
| listen() events | Required | P0 |
| DeviceInfo reporting | Required | P0 |
| WalletInfo reporting | Required | P0 |
| Error codes compliance | Required | P0 |

### 5.2 Bridge Implementation

```typescript
// Injected into every BrowserView via preload
class TonnetBridge implements TonConnectBridge {
  deviceInfo: DeviceInfo = {
    platform: 'browser',
    appName: 'tonnet',                    // MUST match wallets-list
    appVersion: APP_VERSION,
    maxProtocolVersion: 2,
    features: [
      'SendTransaction',
      {
        name: 'SendTransaction',
        maxMessages: 4,
        extraCurrencySupported: false
      }
    ]
  };

  walletInfo: WalletInfo = {
    name: 'Tonnet Browser',
    image: 'https://tonnet.app/icon-288.png',
    about_url: 'https://tonnet.app'
  };

  protocolVersion = 2;
  isWalletBrowser = true;

  private listeners: Set<(event: WalletEvent) => void> = new Set();
  private sessionId: string | null = null;

  async connect(
    protocolVersion: number,
    message: ConnectRequest
  ): Promise<ConnectEvent> {
    // 1. Validate protocol version
    if (protocolVersion > this.protocolVersion) {
      return this.errorEvent(1, 'Unsupported protocol version');
    }

    // 2. Fetch and validate manifest
    const manifest = await this.fetchManifest(message.manifestUrl);
    if (!manifest) {
      return this.errorEvent(2, 'Manifest not found');
    }

    // 2.5 Enhanced manifest validation
    if (!await this.validateManifestSignature(manifest)) {
      return this.errorEvent(3, 'Invalid manifest signature');
    }

    if (!this.validateManifestCORS(message.manifestUrl, window.location.origin)) {
      return this.errorEvent(1, 'CORS policy violation');
    }

    // 3. Request user approval via IPC
    const approval = await window.electron.invoke('wallet:connect-request', {
      origin: window.location.origin,
      manifest,
      items: message.items
    });

    if (!approval.approved) {
      return this.errorEvent(300, 'User declined connection');
    }

    // 4. Build response
    this.sessionId = approval.sessionId;
    return {
      event: 'connect',
      id: Date.now(),
      payload: {
        items: approval.items,
        device: this.deviceInfo
      }
    };
  }

  async restoreConnection(): Promise<ConnectEvent> {
    const session = await window.electron.invoke('wallet:restore-session', {
      origin: window.location.origin
    });

    if (!session) {
      return this.errorEvent(100, 'No active session');
    }

    this.sessionId = session.id;
    return {
      event: 'connect',
      id: Date.now(),
      payload: {
        items: session.items,
        device: this.deviceInfo
      }
    };
  }

  async send(message: AppRequest): Promise<WalletResponse> {
    if (!this.sessionId) {
      return { error: { code: 100, message: 'Not connected' }, id: message.id };
    }

    // Session rotation check (every 15 minutes)
    if (await this.shouldRotateSession()) {
      await this.rotateSession();
    }

    switch (message.method) {
      case 'sendTransaction':
        return this.handleSendTransaction(message);
      case 'signData':
        return this.handleSignData(message);
      case 'disconnect':
        return this.handleDisconnect(message);
      default:
        return { error: { code: 400, message: 'Unknown method' }, id: message.id };
    }
  }

  // Session security enhancements
  private async shouldRotateSession(): Promise<boolean> {
    const session = await this.getSession();
    const SESSION_ROTATION_INTERVAL = 15 * 60 * 1000;  // 15 minutes
    return Date.now() - session.lastRotation > SESSION_ROTATION_INTERVAL;
  }

  private async rotateSession(): Promise<void> {
    // Generate new session keys
    const newSessionId = crypto.randomUUID();

    // Notify main process to rotate
    await window.electron.invoke('wallet:rotate-session', {
      oldSessionId: this.sessionId,
      newSessionId
    });

    this.sessionId = newSessionId;
  }

  listen(callback: (event: WalletEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private async handleSendTransaction(message: AppRequest): Promise<WalletResponse> {
    const txParams = message.params[0];

    // 1. Get risk score
    const riskScore = await window.electron.invoke('wallet:get-risk-score', txParams);

    // 2. Re-authenticate for high-value transactions
    if (riskScore.level === 'high' || riskScore.level === 'critical') {
      const reAuth = await window.electron.invoke('wallet:re-authenticate', {
        reason: 'high-value-transaction',
        amount: txParams.messages[0].amount
      });

      if (!reAuth.success) {
        return { error: { code: 300, message: 'Re-authentication failed' }, id: message.id };
      }
    }

    // 3. Request user confirmation via IPC
    const result = await window.electron.invoke('wallet:send-transaction', {
      origin: window.location.origin,
      sessionId: this.sessionId,
      params: txParams,
      riskScore  // Include risk score in confirmation UI
    });

    if (result.error) {
      return { error: result.error, id: message.id };
    }

    return { result: result.boc, id: message.id };
  }
}

// Expose bridge
window.tonnet = { tonconnect: new TonnetBridge() };
```

### 5.3 Wallets-List Entry

```json
{
  "app_name": "tonnet",
  "name": "Tonnet Browser",
  "image": "https://tonnet.app/assets/tonnet-288.png",
  "about_url": "https://tonnet.app",
  "platforms": ["linux", "windows", "macos"],
  "bridge": [
    {
      "type": "js",
      "key": "tonnet"
    }
  ],
  "features": [
    "SendTransaction",
    {
      "name": "SendTransaction",
      "maxMessages": 4,
      "extraCurrencySupported": false
    }
  ]
}
```

### 5.4 Session Management

```typescript
interface ConnectedSession {
  id: string;
  origin: string;
  manifestUrl: string;
  appName: string;
  appIcon: string;
  walletAddress: string;
  permissions: ('ton_addr' | 'ton_proof')[];
  createdAt: number;
  lastActivity: number;
}

// Storage: One session per origin
// Auto-expire: 30 days of inactivity
// User can disconnect manually
```

---

## 6. Asset Support

### 6.1 Native TON

| Feature | Implementation |
|---------|----------------|
| Balance | Toncenter getAddressBalance |
| Send | Standard transfer message |
| Receive | Display address + QR |
| History | Toncenter getTransactions |

### 6.2 Jettons (Tokens)

```typescript
interface JettonBalance {
  contractAddress: string;    // Jetton master contract
  walletAddress: string;      // User's jetton wallet
  balance: bigint;
  metadata: {
    name: string;
    symbol: string;
    decimals: number;
    image?: string;
  };
}

// Discovery: Tonapi getAccountJettons
// Transfer: Jetton wallet transfer message
// Standard: TEP-74 (Fungible Tokens)
```

### 6.3 NFTs

```typescript
interface NFTItem {
  address: string;            // NFT item address
  collectionAddress?: string; // Collection contract
  index: number;
  metadata: {
    name: string;
    description?: string;
    image: string;
    attributes?: NFTAttribute[];
  };
  owner: string;
}

// Discovery: Tonapi getAccountNfts
// Transfer: NFT transfer message
// Standard: TEP-62 (NFT Standard)
```

### 6.4 Asset Indexing Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                    ASSET INDEXER                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. On wallet unlock:                                       │
│     → Fetch TON balance                                     │
│     → Fetch known jettons (cached list)                     │
│     → Fetch NFTs (paginated)                                │
│                                                             │
│  2. Background refresh (every 30s):                         │
│     → TON balance only                                      │
│                                                             │
│  3. Full refresh (every 5min or manual):                    │
│     → All assets                                            │
│                                                             │
│  4. On transaction sent:                                    │
│     → Immediate refresh of affected asset                   │
│                                                             │
│  Cache: IndexedDB with 5min TTL                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. User Interface

### 7.1 Component Hierarchy

```
WalletPanel (main container)
├── WalletHeader
│   ├── AddressDisplay (copyable)
│   ├── NetworkIndicator
│   └── LockButton
│
├── WalletTabs
│   ├── Tab: Assets
│   │   ├── BalanceCard (TON)
│   │   ├── JettonList
│   │   └── QuickActions (Send/Receive)
│   │
│   ├── Tab: NFTs
│   │   └── NFTGallery (grid)
│   │
│   ├── Tab: Activity
│   │   └── TransactionList
│   │
│   └── Tab: Connected
│       └── SessionList (dApps)
│
└── WalletFooter
    └── SettingsButton
```

### 7.2 Critical Flows

#### 7.2.1 First-Time Setup

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Welcome   │────►│   Create    │────►│   Backup    │────►│   Verify    │
│   Screen    │     │  Password   │     │  Seed (24)  │     │  Seed Test  │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │                                                            │
       │            ┌─────────────┐     ┌─────────────┐            │
       └───────────►│   Import    │────►│   Enter     │────────────┘
                    │   Wallet    │     │  Password   │
                    └─────────────┘     └─────────────┘
```

#### 7.2.2 Send Transaction

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Enter     │────►│   Review    │────►│   Confirm   │────►│   Success   │
│  Recipient  │     │   Amount    │     │   + Risk    │     │   (Hash)    │
│  + Amount   │     │   + Fee     │     │   Score     │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │   Error     │
                                        │  Handling   │
                                        └─────────────┘
```

#### 7.2.2b Wallet Migration (v4 → v5)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Detect    │────►│   Explain   │────►│   Create    │────►│   Transfer  │
│   v4 Wallet │     │   Benefits  │     │   v5 Wallet │     │   Funds     │
│             │     │   -25% fees │     │   (same     │     │   (guided)  │
│             │     │   +gasless  │     │   seed)     │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                           │                                        │
                           │                                        ▼
                           │                                 ┌─────────────┐
                           │                                 │   Success   │
                           └────────────────────────────────►│   Keep v4?  │
                                   Skip                      └─────────────┘
```

#### 7.2.3 TON Connect Request

```
┌─────────────────────────────────────────────────────────────┐
│                  CONNECT REQUEST                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   [App Icon]  App Name                                      │
│               app.example.ton                               │
│                                                             │
│   Wants to:                                                 │
│   ✓ View your wallet address                                │
│   ✓ Request transaction approval                            │
│                                                             │
│   Your address:                                             │
│   EQxxx...xxx                                               │
│                                                             │
│   ┌─────────────┐         ┌─────────────┐                  │
│   │   Cancel    │         │   Connect   │                  │
│   └─────────────┘         └─────────────┘                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 7.2.4 Transaction Confirmation (TON Connect)

```
┌─────────────────────────────────────────────────────────────┐
│                CONFIRM TRANSACTION                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   From: app.example.ton                                     │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐  │
│   │  Send                                               │  │
│   │                                                     │  │
│   │  1.5 TON                        ≈ $3.42 USD         │  │
│   │                                                     │  │
│   │  To: EQxxx...xxx                                    │  │
│   │      (Known: Alice's Wallet) ← if in contacts       │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
│   Network fee: ~0.01 TON                                    │
│                                                             │
│   ⚠️  Review carefully. Transactions cannot be reversed.   │
│                                                             │
│   ┌─────────────┐         ┌─────────────┐                  │
│   │   Reject    │         │   Confirm   │                  │
│   └─────────────┘         └─────────────┘                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.3 Design Specifications

| Element | Specification |
|---------|---------------|
| Font | Inter (existing) |
| Colors | Theme-aware (resistance-dog / utya-duck) |
| Icons | Lucide React (existing) |
| Animations | Framer Motion, max 200ms |
| Touch targets | Min 44×44px |
| Spacing | 4px grid system |

---

## 8. Data Persistence

### 8.1 Storage Schema

```typescript
// Main Process Storage (Encrypted)
interface WalletStorage {
  version: number;                    // Schema version for migrations
  encryptedSeed: string;              // AES-256-GCM encrypted mnemonic
  salt: string;                       // PBKDF2 salt (base64)
  iv: string;                         // AES IV (base64)
  authTag: string;                    // GCM auth tag (base64)
  publicKey: string;                  // Public key (hex)
  address: string;                    // Wallet address
  walletVersion: 'v5r1' | 'v4r2' | 'v3r2';  // Contract version
  createdAt: number;

  // Biometric (optional)
  biometricEnabled?: boolean;
  biometricPublicKey?: string;        // For verification

  // Social Recovery (optional)
  socialRecovery?: {
    enabled: boolean;
    guardians: {
      name: string;
      publicKey: string;
      encryptedShard: string;         // Encrypted with guardian's public key
    }[];
    threshold: number;                 // e.g., 3 for 3-of-5
    timelock: number;                  // Hours delay (default: 48)
  };
}

// Renderer Storage (Zustand + localStorage)
interface WalletUIState {
  isSetup: boolean;
  isUnlocked: boolean;
  address: string | null;
  balance: bigint;
  jettons: JettonBalance[];
  nfts: NFTItem[];
  transactions: Transaction[];
  connectedSessions: ConnectedSession[];
  settings: WalletSettings;
}

// Session Storage (Main Process, in-memory + encrypted backup)
interface SessionStorage {
  sessions: Map<string, ConnectedSession>;  // origin → session
}
```

### 8.2 Cache Strategy

| Data | Storage | TTL | Invalidation |
|------|---------|-----|--------------|
| TON Balance | Memory | 30s | On send/receive |
| Jetton Balances | IndexedDB | 5min | On transfer |
| NFTs | IndexedDB | 10min | On transfer |
| Transactions | IndexedDB | 1min | On new tx |
| Sessions | Encrypted file | 30 days | On disconnect |

### 8.3 Migration Strategy

```typescript
const CURRENT_VERSION = 1;

const migrations: Migration[] = [
  {
    version: 1,
    up: async (data) => {
      // Initial schema, no migration needed
      return data;
    }
  },
  // Future migrations added here
];

async function migrateStorage(data: any): Promise<WalletStorage> {
  let current = data;
  for (const migration of migrations) {
    if (current.version < migration.version) {
      current = await migration.up(current);
      current.version = migration.version;
    }
  }
  return current;
}
```

### 8.4 Social Recovery Implementation

```typescript
// Shamir's Secret Sharing for seed phrase distribution
class SocialRecoveryManager {
  // Setup: Distribute seed phrase across guardians
  async setupRecovery(
    seedPhrase: string[],
    guardians: Guardian[],
    threshold: number = 3
  ): Promise<void> {
    // 1. Convert seed phrase to secret
    const secret = Buffer.from(seedPhrase.join(' '), 'utf-8');

    // 2. Split into shares using Shamir's Secret Sharing
    const shares = await this.splitSecret(secret, guardians.length, threshold);

    // 3. Encrypt each shard with guardian's public key
    for (let i = 0; i < guardians.length; i++) {
      const encryptedShard = await this.encryptForGuardian(
        shares[i],
        guardians[i].publicKey
      );

      // 4. Store encrypted shard (send to guardian via email/QR)
      guardians[i].encryptedShard = encryptedShard;
    }

    // 5. Save recovery config
    await this.saveRecoveryConfig({
      guardians,
      threshold,
      timelock: 48 * 3600 * 1000  // 48 hours
    });
  }

  // Recovery: Reconstruct seed from guardian approvals
  async initiateRecovery(
    approvals: GuardianApproval[]
  ): Promise<RecoveryRequest> {
    // 1. Verify minimum threshold
    if (approvals.length < this.threshold) {
      throw new Error(`Need ${this.threshold} approvals, got ${approvals.length}`);
    }

    // 2. Verify signatures
    for (const approval of approvals) {
      const isValid = await this.verifyGuardianSignature(approval);
      if (!isValid) throw new Error('Invalid guardian signature');
    }

    // 3. Decrypt shards
    const shards = await Promise.all(
      approvals.map(a => this.decryptShard(a.encryptedShard))
    );

    // 4. Create recovery request with 48h timelock
    const request: RecoveryRequest = {
      id: crypto.randomUUID(),
      shards,
      status: 'pending',
      timelockEnd: Date.now() + this.config.timelock,
      createdAt: Date.now()
    };

    // 5. Store pending request
    await this.storePendingRecovery(request);

    return request;
  }

  // Wait for timelock, then reconstruct
  async completeRecovery(requestId: string): Promise<string[]> {
    const request = await this.getPendingRecovery(requestId);

    // 1. Check timelock
    if (Date.now() < request.timelockEnd) {
      const remainingHours = (request.timelockEnd - Date.now()) / 3600000;
      throw new Error(`Recovery locked for ${remainingHours.toFixed(1)} more hours`);
    }

    // 2. Reconstruct secret from shards
    const secret = await this.reconstructSecret(request.shards);

    // 3. Convert back to seed phrase
    const seedPhrase = secret.toString('utf-8').split(' ');

    // 4. Clean up recovery request
    await this.deletePendingRecovery(requestId);

    return seedPhrase;
  }

  // Shamir's Secret Sharing implementation
  private async splitSecret(
    secret: Buffer,
    totalShares: number,
    threshold: number
  ): Promise<Buffer[]> {
    // Use secrets.js-grempe or similar library
    // Returns array of shares
  }

  private async reconstructSecret(shards: Buffer[]): Promise<Buffer> {
    // Combine shares to reconstruct original secret
  }
}

interface RecoveryRequest {
  id: string;
  shards: Buffer[];
  status: 'pending' | 'completed' | 'cancelled';
  timelockEnd: number;
  createdAt: number;
}
```

### 8.5 Recovery

Recovery = import wallet from seed phrase (already in WalletEngine.importWallet).

Password reset = delete wallet + import with new password.

---

## 9. Testing Strategy

### 9.1 Test Pyramid

```
                    ┌───────────┐
                    │   E2E     │  10%
                    │  Tests    │  - Full wallet flows
                    ├───────────┤
                    │Integration│  30%
                    │  Tests    │  - IPC communication
                    │           │  - TON Connect flows
                    ├───────────┤
                    │   Unit    │  60%
                    │  Tests    │  - Core engine
                    │           │  - Encryption
                    │           │  - Validation
                    └───────────┘
```

### 9.2 Critical Test Cases

#### Security Tests
- [ ] Private key never exposed via IPC
- [ ] Encryption/decryption roundtrip
- [ ] Password validation (min length, complexity)
- [ ] Brute force protection
- [ ] Memory zeroing after signing
- [ ] Session isolation between origins
- [ ] Biometric authentication enrollment/unlock
- [ ] Social recovery shard distribution
#### TON Connect Tests
- [ ] connect() success flow
- [ ] connect() user rejection
- [ ] connect() invalid manifest
- [ ] restoreConnection() with valid session
- [ ] restoreConnection() with expired session
- [ ] sendTransaction() success
- [ ] sendTransaction() user rejection
- [ ] sendTransaction() invalid params
- [ ] disconnect() clears session
- [ ] listen() receives events

#### Blockchain Tests
- [ ] Balance fetch (mainnet/testnet)
- [ ] Transaction broadcast
- [ ] Jetton discovery
- [ ] NFT discovery
- [ ] Provider fallback on failure

### 9.3 Test Environment

```typescript
// Testnet configuration
const TESTNET_CONFIG = {
  endpoint: 'https://testnet.toncenter.com/api/v2',
  network: '-3',
  faucet: 'https://testnet.ton.org/faucet'
};

// Mock wallet for testing
const TEST_MNEMONIC = [
  'abandon', 'abandon', 'abandon', /* ... 24 words */
];
```

---

## 10. Deployment & Distribution

### 10.1 Wallets-List Submission

**Timeline:**
1. **Week 1-2:** Implement wallet + TON Connect
2. **Week 3:** Internal testing
3. **Week 4:** Submit PR to ton-connect/wallets-list
4. **Week 5+:** Address review feedback, merge

**PR Requirements:**
- [ ] All required fields in wallets.json
- [ ] 288×288 PNG icon hosted on HTTPS
- [ ] about_url page live
- [ ] Working wallet implementation
- [ ] Tested with reference dApp

### 10.2 Interim Solution (Pre-Approval)

During wallets-list approval process, implement local wallet injection:

```typescript
// Intercept wallets-list fetch and inject our wallet
session.webRequest.onBeforeRequest(
  { urls: ['*://raw.githubusercontent.com/ton-connect/wallets-list/*'] },
  (details, callback) => {
    // Fetch original, inject our wallet, return modified
  }
);
```

**Remove after official approval.**

### 10.3 Version Rollout

| Phase | Scope | Duration |
|-------|-------|----------|
| Alpha | Internal testing | 1 week |
| Beta | Opt-in users | 2 weeks |
| RC | All users (feature flag) | 1 week |
| GA | Default enabled | Ongoing |

---

## 11. Implementation Phases

### Phase 1: Foundation (Week 1-2) - ENHANCED

**Deliverables:**
- [ ] Core wallet engine (create, import, unlock)
- [ ] **v5R1 wallet as default** (v4R2/v3R2 for import only)
- [ ] Secure storage implementation (PBKDF2 + AES-256-GCM + safeStorage)
- [ ] **Biometric authentication setup**
- [ ] Basic IPC handlers with validation
- [ ] Wallet UI scaffold
- [ ] **Race condition guard (seqno locking)**

**Success Criteria:**
- Can create v5 wallet with password
- Can import v3/v4/v5 from mnemonic
- Seed phrase encrypted at rest (triple-layer)
- Biometric unlock working (macOS/Windows)
- Basic balance display
- **No concurrent transaction bug**

### Phase 2: Blockchain Integration (Week 3) - ENHANCED

**Deliverables:**
- [ ] Toncenter API client
- [ ] Multi-provider fallback (Toncenter/Tonapi/GetBlock)
- [ ] Balance fetching
- [ ] **Transaction sending with race condition protection**
- [ ] Transaction history
- [ ] **Transaction monitoring & risk scoring**
- [ ] **Anomaly detection (amount/frequency)**

**Success Criteria:**
- Real-time balance updates
- Can send TON successfully (no seqno conflicts)
- Transaction history loads
- **High-value TX trigger re-auth**
- **Suspicious patterns detected**

### Phase 3: TON Connect (Week 4) - ENHANCED

**Deliverables:**
- [ ] TonConnectBridge implementation (protocol v2)
- [ ] Preload injection
- [ ] **Session management with 15min rotation**
- [ ] Connect/disconnect flows
- [ ] **Enhanced manifest validation (signature + CORS)**
- [ ] sendTransaction handling
- [ ] **Re-authentication for high-risk TX**
- [ ] **Risk score integration in confirmation UI**

**Success Criteria:**
- Can connect to reference dApp
- Transaction requests show confirmation with risk level
- Sessions persist across restarts
- **Session auto-rotates every 15min**
- **Manifest forgery blocked**

### Phase 4: Assets & Recovery (Week 5) - ENHANCED

**Deliverables:**
- [ ] Jetton discovery and display (TEP-74)
- [ ] Jetton transfers
- [ ] NFT discovery and gallery (TEP-62)
- [ ] NFT transfers
- [ ] **Social recovery setup (3-of-5 guardians)**
- [ ] **Shamir's Secret Sharing implementation**
- [ ] **Guardian management UI**
- [ ] **v4→v5 migration wizard**

**Success Criteria:**
- All user tokens visible
- All user NFTs visible
- Can transfer tokens/NFTs
- **Can setup social recovery with guardians**
- **Can migrate v4 wallet to v5**

### Phase 5: Polish (Week 6)

**Deliverables:**
- [ ] Security audit fixes
- [ ] Performance optimization
- [ ] Error handling improvements
- [ ] UI/UX polish
- [ ] Wallets-list PR submission

**Success Criteria:**
- No critical security issues
- All tests passing
- Smooth user experience
- PR submitted

---

## 12. Risk Assessment

### 12.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Key extraction vulnerability | Low | Critical | Security audit, memory zeroing |
| TON Connect spec changes | Low | High | Monitor updates, version check |
| API provider downtime | Medium | Medium | Multi-provider fallback |
| Electron security bug | Low | Critical | Keep Electron updated |
| Performance issues | Medium | Medium | Lazy loading, caching |

### 12.2 Project Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Wallets-list rejection | Low | High | Follow spec exactly, iterate |
| Scope creep | Medium | Medium | Strict phase boundaries |
| Integration complexity | Medium | Medium | Incremental development |

### 12.3 Rollback Plan

If critical issues found post-release:

1. **Immediate:** Feature flag disable wallet
2. **Short-term:** Hotfix release
3. **If unrecoverable:** Remove wallet, clear encrypted storage

---

## 13. Appendices

### Appendix A: Dependencies

```json
{
  "dependencies": {
    "@ton/crypto": "^3.3.0",
    "@ton/ton": "^15.0.0",
    "@ton/core": "^0.59.0",
    "@tonconnect/protocol": "^2.2.0"
  }
}
```

### Appendix B: API Endpoints

| Provider | Endpoint | Rate Limit |
|----------|----------|------------|
| Toncenter | https://toncenter.com/api/v2 | 10 req/s |
| Tonapi | https://tonapi.io/v2 | 5 req/s |
| GetBlock | https://ton.getblock.io | 60 req/min |

### Appendix C: Error Codes (TON Connect)

| Code | Meaning |
|------|---------|
| 0 | Unknown error |
| 1 | Bad request |
| 2 | Manifest not found |
| 3 | Manifest content error |
| 100 | Unknown app |
| 300 | User declined |
| 400 | Method not supported |

### Appendix D: References

- [TON Connect Protocol](https://github.com/ton-blockchain/ton-connect)
- [TON Connect SDK](https://github.com/ton-connect/sdk)
- [Wallets List](https://github.com/ton-connect/wallets-list)
- [TEP-74: Fungible Tokens](https://github.com/ton-blockchain/TEPs/blob/master/text/0074-jettons-standard.md)
- [TEP-62: NFT Standard](https://github.com/ton-blockchain/TEPs/blob/master/text/0062-nft-standard.md)
- [TON Wallet Contracts](https://docs.ton.org/participate/wallets/contracts)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-01-26 | Tonnet Team | Initial draft |

---

**END OF DOCUMENT**
