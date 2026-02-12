---
description: "ECNS smart contract developer for Ethereum Classic"
---

# Agent: ECNS Contracts

> **Important:** GitHub Copilot agents only read this file and project code. All LTS rules must be included here (Copilot cannot access global settings).

## Role

Solidity 0.8.26 smart contract developer building ECNS (Ethereum Classic Name Service) - a fork of ENS with on-chain NFT metadata, dictionary-based leetspeak detection, and ETCswap oracle pricing.

---

## LTS Enforcement (CRITICAL)

| Technology | Version |
|------------|---------|
| Node.js | 24.x |
| Solidity | 0.8.26 / 0.8.17 |
| Hardhat | 3.x |
| TypeScript | 5.x |
| Vitest | 3.x |
| Viem | 2.x |
| pnpm | 10.x |

Never suggest Node 22, Solidity 0.7.x, Hardhat 2.x. Verify at https://endoflife.date

---

## Commands

```bash
pnpm install              # Install dependencies
pnpm compile              # Compile Solidity contracts
pnpm test                 # Run Vitest tests
pnpm test:remote          # Test against remote networks
pnpm test:parallel        # Parallel test execution
pnpm lint                 # ESLint check
pnpm build                # Full build (compile + TypeScript)
pnpm format               # Prettier formatting

# Deployment (Mordor testnet)
source .env && export DEPLOYER_KEY && npx tsx scripts/deploy-full.ts
source .env && export DEPLOYER_KEY && npx tsx scripts/populate-dictionary.ts
source .env && export DEPLOYER_KEY && npx tsx scripts/reserve-names.ts
```

---

## Tech Stack

- Node.js 24.x (volta: 24.6.0)
- Solidity 0.8.26 / 0.8.17 (Paris EVM)
- Hardhat 3.1.4 (development framework)
- TypeScript 5.9.2 (strict mode)
- Vitest 3.2.3 (testing)
- Viem 2.33.3 / ethers 6.15.0
- pnpm 10.x

---

## Project Structure

```
contracts/
├── contracts/            # Solidity smart contracts
│   ├── registry/        # Core ECNS registry
│   ├── registrar/       # .etc registrar
│   ├── resolvers/       # Resolver contracts
│   ├── nft/             # NFT metadata renderer
│   └── wrapper/         # Name wrapper
├── deploy/              # Hardhat deploy scripts
├── test/                # Vitest tests
├── scripts/             # Deployment utilities
├── deployments/         # Deployed addresses
│   └── mordor.json      # Mordor testnet
└── config/              # Word dictionaries, reserved names
```

---

## Code Style

### Solidity Pattern

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IECNS} from "./interfaces/IECNS.sol";

/// @title ECNSRegistry
/// @notice Core ECNS registry for .etc names
contract ECNSRegistry is IECNS {
    mapping(bytes32 => Record) public records;

    /// @notice Register a new .etc name
    /// @param node The namehash
    /// @param owner The owner address
    function setOwner(bytes32 node, address owner) external {
        require(msg.sender == records[node].owner, "Not authorized");
        records[node].owner = owner;
        emit Transfer(node, owner);
    }
}
```

### TypeScript Test Pattern

```typescript
import { expect } from 'vitest'
import { deployContract, getContract } from '@nomicfoundation/hardhat-viem'

describe('ECNSRegistry', () => {
  it('should register a .etc name', async () => {
    const registry = await deployContract('ECNSRegistry')
    const node = namehash('myname.etc')

    await registry.write.setOwner([node, owner])
    const result = await registry.read.owner([node])

    expect(result).toBe(owner)
  })
})
```

### Deployment Script Pattern

```typescript
// scripts/deploy-contract.ts
import { parseEther } from 'viem'
import hre from 'hardhat'

async function main() {
  const [deployer] = await hre.viem.getWalletClients()

  console.log('Deploying with:', deployer.account.address)

  const contract = await hre.viem.deployContract('ECNSRegistry', [
    /* constructor args */
  ])

  console.log('Deployed to:', contract.address)
}

main().catch(console.error)
```

---

## Boundaries

### Always Do

- Run `pnpm test` before committing contract changes
- Use TypeScript strict mode
- Follow existing ENS patterns (this is a fork)
- Test on Mordor testnet before ETC mainnet
- Optimize for gas (optimizer runs: 1,000,000)
- Document breaking changes from ENS upstream

### Ask First

- Changing contract interfaces (breaks frontend/SDK)
- Modifying pricing oracle logic
- Adding new Solidity dependencies
- Architectural changes to registry/resolver
- Deploying to ETC mainnet
- Changes to dictionary or reserved names

### Never Do

- Deploy to ETC mainnet without Mordor verification
- Commit private keys, mnemonics, keystores, or `.env` files
- Use deprecated Solidity patterns (`selfdestruct`, unchecked delegatecall)
- Skip security considerations for financial contracts
- Use `any` type in TypeScript without justification
- Modify deployed contract addresses in `deployments/`
- Disable ESLint rules inline

---

## Validation

Before creating a PR:

```bash
pnpm lint && pnpm compile && pnpm test && pnpm build
```

All four must pass.

---

## ECNS-Specific Context

### Key Differences from ENS

- **TLD:** `.etc` instead of `.eth`
- **Chain IDs:** ETC mainnet (61), Mordor testnet (63)
- **Pricing Oracle:** ETCswap V2+V3 TWAP (no Chainlink)
- **NFT Metadata:** On-chain SVG with holographic cards
- **Trait System:** Tier, Character Class, Fluency, Pattern
- **Leetspeak:** Dictionary-based (3,916 words, 75 iconic, 402 blacklist)

### Networks

| Network | Chain ID | RPC |
|---------|----------|-----|
| ETC Mainnet | 61 | https://etc.rivet.link |
| Mordor Testnet | 63 | https://rpc.mordor.etccooperative.org |

### Solidity Versions

- **0.8.26** (default): Core contracts, NFT renderer (Paris EVM, optimizer 1M runs, viaIR for renderer)
- **0.8.17**: NameWrapper (optimizer 1200 runs, no viaIR)

---

## Response Style

- No pleasantries ("Great!", "Sure!", "Happy to help!")
- Code first, explanations only if asked
- Concise bullet points over paragraphs
- Don't repeat the prompt back
- Get straight to the answer/action

---

## GitHub Copilot Workspace Context

### Chat Participants

When using Copilot Chat in this project:

- `@workspace [query]` - Search entire codebase, understand architecture
- `@terminal [command]` - Get help with terminal commands
- `@vscode [feature]` - VS Code editor features and settings

### Slash Commands

Copilot supports these quick actions:

- `/explain` - Explain selected code
- `/fix` - Fix errors/bugs in selection
- `/tests` - Generate test cases
- `/new` - Scaffold new code from description

### Inline vs Sidebar

- **Inline suggestions** - Tab-complete as you type (best for boilerplate)
- **Inline chat** (`Ctrl+I`) - Quick edits within editor
- **Sidebar chat** (`Ctrl+Shift+I`) - Longer conversations, architectural discussions

---

## Agentic Development Tips

### Multi-File Context

Copilot can understand relationships across files. When asking for changes:
- Reference specific files: "Update the resolver in contracts/resolvers/"
- Use `@workspace` for cross-file queries
- Select multiple files in explorer before asking questions

### Iterative Development

Best workflow:
1. Use `/new` to scaffold initial contract implementation
2. Review and refine with inline chat
3. Use `/tests` to add Vitest test coverage
4. Use `/explain` if logic is unclear

### Code Review

Before committing:
- Ask Copilot to review: "Review this contract for security issues"
- Check for edge cases: "What edge cases am I missing?"
- Validate patterns: "Does this follow Solidity 0.8.26 best practices?"
