# GitHub Copilot Instructions: ECNS Contracts

> **Important:** GitHub Copilot only reads this file and your project code. It does NOT have access to global settings. All LTS rules and standards must be included here.

## Project

ECNS Contracts - Smart contracts for **Ethereum Classic Name Service** (ECNS), a fork of ENS adapted for Ethereum Classic. Provides human-readable `.etc` domain names with on-chain NFT metadata, dictionary-based leetspeak detection, and ETCswap oracle pricing.

**Repository:** https://github.com/ecnsdomains/ens-contracts
**Status:** Mordor testnet deployed (2026-02-06), ETC mainnet deployment pending

## LTS Enforcement (CRITICAL)

**ALWAYS use current stable LTS versions.**

| Technology | Version |
|------------|---------|
| Node.js | 24.x |
| TypeScript | 5.x |
| Solidity | 0.8.26 / 0.8.17 |
| Hardhat | 3.x |
| Vitest | 3.x |
| Viem | 2.x |

**Never suggest:** Node 22, TypeScript 4.x, Solidity 0.7.x
If unsure, verify at https://endoflife.date

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 24.x | Runtime (volta: 24.6.0) |
| Solidity | 0.8.26 / 0.8.17 | Smart contracts (Paris EVM) |
| Hardhat | 3.1.4 | Development framework |
| TypeScript | 5.9.2 | Language (strict mode) |
| Vitest | 3.2.3 | Testing |
| Viem | 2.33.3 | Blockchain interactions |
| ethers | 6.15.0 | Alternative library |
| pnpm | 10.x | Package manager |

## Commands

```bash
# Development
pnpm install              # Install dependencies
pnpm compile              # Compile Solidity contracts
pnpm test                 # Run Vitest tests
pnpm test:remote          # Test against remote networks
pnpm test:parallel        # Parallel test execution
pnpm lint                 # ESLint check
pnpm build                # Full build (compile + TypeScript)
pnpm format               # Prettier formatting

# Deployment Scripts (Mordor testnet)
source .env && export DEPLOYER_KEY && npx tsx scripts/deploy-full.ts
source .env && export DEPLOYER_KEY && npx tsx scripts/populate-dictionary.ts
source .env && export DEPLOYER_KEY && npx tsx scripts/reserve-names.ts

# Gas Analysis
pnpm test --reporter=json  # Check gas usage in tests
npx hardhat test --gas-report  # Hardhat gas reporter
```

## Key Rules

1. Use TypeScript strict mode in all files
2. Follow existing ENS patterns (this is a fork)
3. Test on Mordor testnet before ETC mainnet deployment
4. Optimize for gas efficiency (optimizer: 1M runs)
5. Never use `selfdestruct` (deprecated in Solidity 0.8.18+)
6. Run `pnpm test` before every commit
7. Use custom errors over require strings (saves gas)
8. Validate inputs early in functions
9. Use ReentrancyGuard for state-changing functions
10. Cache array lengths in loops

## Networks

| Network | Chain ID | RPC |
|---------|----------|-----|
| ETC Mainnet | 61 | https://etc.rivet.link |
| Mordor Testnet | 63 | https://rpc.mordor.etccooperative.org |

**Mordor Deployment (2026-02-06):**
- ECNSRegistry: `0x29dd3a41973ec0551bcd195e46e8eb9801621c34`
- ETCRegistrarController: `0x6d36c84926c2637448f2a7eabad3a0eed7f95b25`
- PublicResolver: `0xc1267bafafd08fe85580985b020b2df08d863ca4`
- ECNSMetadataRenderer: `0xb82b372b7a368a3f3c1ff9ba96128650f629194b`

---

## ECNS-Specific Context

### Key Differences from ENS
- **TLD:** `.etc` instead of `.eth`
- **Chain IDs:** ETC mainnet (61), Mordor testnet (63)
- **Pricing Oracle:** ETCswap V2+V3 TWAP oracle (no Chainlink)
- **NFT Metadata:** 100% on-chain SVG with holographic gradient cards
- **Trait System:** Tier (Common→Mythic), Character Class, Fluency, Pattern
- **Leetspeak Detection:** Dictionary-based with 3 decode strategies
- **Content Moderation:** On-chain blacklist (402 offensive terms + leet variants)

### Dictionary System
- 3,916 valid words (base dictionary)
- 75 iconic words (e.g., "bitcoin", "ethereum", "satoshi")
- 402 blacklisted offensive terms + leetspeak variants
- 1,876 reserved names (offensive + variants)

---

## Protected Files

Do not modify without explicit request:

- `hardhat.config.ts` - Network configuration
- `vitest.config.ts` - Test configuration
- `deployments/mordor.json` - Deployed addresses
- `config/dictionary-words.json` - Word lists (3,916 words, 75 iconic, 402 blacklist)
- `config/reserved-names.json` - Reserved names (1,876 entries)
- `package.json` - Dependency versions
- `.env.example` - Environment variable template

## Code Style

- 2-space indentation
- Single quotes for strings
- No semicolons in TypeScript
- Trailing commas in multiline
- Descriptive variable names
- JSDoc/NatSpec comments on public functions

### Solidity Patterns

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IECNS.sol";

/**
 * @title ContractName
 * @notice Brief description
 * @dev Implementation details
 */
contract ContractName is Ownable {
    // State variables
    IECNS public immutable ecns;

    // Events
    event NameRegistered(bytes32 indexed node, address indexed owner);

    // Errors (prefer custom errors over require strings)
    error UnauthorizedAccess(address caller);
    error InvalidName(string name);

    // Constructor
    constructor(IECNS _ecns) Ownable(msg.sender) {
        ecns = _ecns;
    }

    // External functions
    function register(string calldata name) external {
        if (bytes(name).length == 0) revert InvalidName(name);
        // ...
    }

    // Internal functions
    function _isValidName(string calldata name) internal pure returns (bool) {
        // ...
    }
}
```

### TypeScript Test Patterns

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mordor } from 'viem/chains'

describe('ETCRegistrarController', () => {
  let client: PublicClient
  let walletClient: WalletClient

  beforeEach(async () => {
    client = createPublicClient({
      chain: mordor,
      transport: http()
    })

    walletClient = createWalletClient({
      chain: mordor,
      transport: http(),
      account: privateKeyToAccount(process.env.DEPLOYER_KEY!)
    })
  })

  it('should register a name', async () => {
    const name = 'test'
    const duration = 31536000n // 1 year

    const hash = await walletClient.writeContract({
      address: controller,
      abi: ETCRegistrarControllerABI,
      functionName: 'register',
      args: [name, walletClient.account.address, duration]
    })

    await client.waitForTransactionReceipt({ hash })

    const owner = await client.readContract({
      address: controller,
      abi: ETCRegistrarControllerABI,
      functionName: 'ownerOf',
      args: [namehash(`${name}.etc`)]
    })

    expect(owner).toBe(walletClient.account.address)
  })
})
```

### Gas Optimization Patterns

```solidity
// Good: Use immutable for constructor-set values
IECNS public immutable ecns;

// Good: Cache array length in loops
uint256 length = names.length;
for (uint256 i = 0; i < length; ++i) {
    // ...
}

// Good: Use custom errors (saves gas vs require strings)
error Unauthorized();
if (msg.sender != owner) revert Unauthorized();

// Good: Use unchecked for safe arithmetic
unchecked { ++i; }  // Safe in bounded loops
```

### Security Patterns

```solidity
// Always use ReentrancyGuard for state-changing functions
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Registrar is ReentrancyGuard {
    function register() external nonReentrant {
        // ...
    }
}

// Validate inputs early
function setName(string calldata name) external {
    if (bytes(name).length == 0) revert InvalidName();
    if (bytes(name).length > 255) revert NameTooLong();
    // ...
}

// Use pull over push for payments
mapping(address => uint256) public pendingWithdrawals;

function withdraw() external {
    uint256 amount = pendingWithdrawals[msg.sender];
    pendingWithdrawals[msg.sender] = 0;
    (bool success, ) = msg.sender.call{value: amount}("");
    require(success, "Transfer failed");
}
```

## Validation

Before committing:

```bash
pnpm lint        # Must pass
pnpm compile     # Must succeed
pnpm test        # All tests must pass
pnpm build       # Must succeed
```

## Project Structure

```
contracts/
├── contracts/              # Solidity smart contracts
│   ├── ccipRead/          # CCIP read support
│   ├── dnsregistrar/      # DNS integration
│   ├── registry/          # Core ECNS registry
│   │   └── ECNSRegistry.sol
│   ├── registrar/         # .etc registrar
│   │   └── ETCRegistrarController.sol
│   ├── reverseRegistrar/  # Reverse resolution
│   ├── wrapper/           # Name wrapper (ERC-1155)
│   ├── resolvers/         # Resolver contracts
│   │   └── PublicResolver.sol
│   └── nft/               # NFT metadata renderer
│       └── ECNSMetadataRenderer.sol
├── deploy/                # Hardhat deploy scripts
├── test/                  # Vitest test suite
├── scripts/               # Deployment/utility scripts
├── deployments/           # Deployed contract addresses
├── config/                # Word dictionaries, reserved names
└── artifacts/             # Compiled contracts (gitignored)
```

## Security & Best Practices

### Always Do
- Run `pnpm test` before committing
- Use custom errors over require strings
- Validate inputs early in functions
- Use ReentrancyGuard for state-changing functions
- Cache array lengths in loops
- Use immutable for constructor-set values
- Optimize for gas (every user pays)

### Never Do
- Commit `.env` files or secrets (use `.env.example`)
- Deploy to ETC mainnet without Mordor verification
- Use `any` type in TypeScript without justification
- Use deprecated Solidity patterns (`selfdestruct`, `tx.origin`, etc.)
- Use `delegatecall` without proper access controls
- Use `block.timestamp` for randomness
- Modify deployed contract addresses in `deployments/`
- Skip gas optimization analysis for public functions

## Response Style

- No pleasantries ("Great!", "Sure!", "Happy to help!")
- Code first, explanations only if asked
- Concise bullet points over paragraphs
- Don't repeat the prompt back
- Get straight to the answer
