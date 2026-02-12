# GitHub Copilot Instructions: ECNS Contracts

> **Important:** GitHub Copilot only reads this file and your project code. It does NOT have access to global settings. All LTS rules and standards must be included here.

## Project

ECNS Contracts - Smart contracts for Ethereum Classic Name Service (ECNS), a fork of ENS for Ethereum Classic. Provides `.etc` domain names with on-chain NFT metadata and dictionary-based leetspeak detection.

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

- Node.js 24.x (volta: 24.6.0)
- Solidity 0.8.26 / 0.8.17 (Paris EVM)
- Hardhat 3.1.4
- TypeScript 5.9.2 (strict mode)
- Vitest 3.2.3
- Viem 2.33.3 / ethers 6.15.0
- pnpm 10.x

## Commands

```bash
pnpm install       # Dependencies
pnpm compile       # Compile contracts
pnpm test          # Run tests
pnpm lint          # Lint
pnpm build         # Full build
pnpm format        # Prettier
```

## Key Rules

1. Use TypeScript strict mode
2. Follow ENS patterns (this is a fork)
3. Test on Mordor before ETC mainnet
4. Optimize for gas efficiency (1M runs)
5. No `selfdestruct` (deprecated)
6. Run tests before commits

## Protected Files

Do not modify without explicit request:

- `hardhat.config.ts`
- `vitest.config.ts`
- `deployments/mordor.json`
- `config/dictionary-words.json`
- `config/reserved-names.json`
- `package.json`

## Code Style

- 2-space indentation
- Single quotes for strings
- No semicolons
- Trailing commas in multiline
- Descriptive variable names
- JSDoc comments on public functions

### Solidity Style

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ECNSContract
/// @notice Brief description
contract ECNSContract {
    /// @notice Detailed function description
    /// @param name The ECNS name
    /// @return The namehash
    function register(string calldata name) external returns (bytes32) {
        // Implementation
    }
}
```

### TypeScript Style

```typescript
export async function deployContract(
  deployer: Address,
  args: ContractArgs,
): Promise<Address> {
  // Implementation
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

## Structure

```
contracts/        # Solidity contracts
deploy/           # Hardhat deploy scripts
test/             # Vitest tests
scripts/          # Deployment utilities
deployments/      # Deployed addresses
config/           # Word dictionaries, reserved names
```

## Networks

| Network | Chain ID | RPC |
|---------|----------|-----|
| ETC Mainnet | 61 | https://etc.rivet.link |
| Mordor Testnet | 63 | https://rpc.mordor.etccooperative.org |

## Don't

- Commit `.env` files or secrets
- Deploy to mainnet without Mordor testing
- Use `any` type in TypeScript
- Use deprecated Solidity patterns
- Modify deployed contract addresses
- Skip gas optimization

## Response Style

- No pleasantries ("Great!", "Sure!", "Happy to help!")
- Code first, explanations only if asked
- Concise bullet points over paragraphs
- Don't repeat the prompt back
- Get straight to the answer
