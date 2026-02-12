# Claude Code Instructions: ECNS Contracts

> **For Claude Code only.** This file references global settings. GitHub Copilot uses `.github/copilot-instructions.md` instead (which must be self-contained).

## Global Standards

Reference: /media/dev/2tb/dev/claude-global-settings/CLAUDE.md

---

## Project Context

ECNS Contracts - Smart contracts for **Ethereum Classic Name Service** (ECNS), a fork of ENS adapted for Ethereum Classic. Provides human-readable `.etc` domain names with on-chain NFT metadata, dictionary-based leetspeak detection, and ETCswap oracle pricing.

**Repository:** https://github.com/ecnsdomains/ens-contracts
**Status:** Active development, Mordor testnet deployed (2026-02-06)

---

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 24.x | Runtime (volta: 24.6.0) |
| Solidity | 0.8.26 / 0.8.17 | Smart contracts |
| Hardhat | 3.1.4 | Development framework |
| TypeScript | 5.9.2 | Language |
| Vitest | 3.2.3 | Testing |
| Viem | 2.33.3 | Blockchain interactions |
| ethers | 6.15.0 | Alternative library |
| pnpm | 10.x | Package manager (primary) |
| Bun | 1.x | Alternative runtime |

---

## Quick Commands

```bash
pnpm install              # Install dependencies
pnpm compile              # Compile Solidity contracts
pnpm test                 # Run Vitest tests
pnpm test:remote          # Test against remote networks
pnpm test:parallel        # Parallel test execution
pnpm lint                 # ESLint check
pnpm build                # Full build (compile + TypeScript)
pnpm format               # Prettier formatting
```

### Deployment Scripts

```bash
# Deploy to Mordor testnet
source .env && export DEPLOYER_KEY && npx tsx scripts/deploy-full.ts

# Deploy/update dictionary + renderer
source .env && export DEPLOYER_KEY && npx tsx scripts/populate-dictionary.ts

# Reserve offensive names
source .env && export DEPLOYER_KEY && npx tsx scripts/reserve-names.ts
```

---

## Project Structure

```
contracts/
├── contracts/            # Solidity smart contracts
│   ├── ccipRead/        # CCIP read support
│   ├── dnsregistrar/    # DNS integration
│   ├── registry/        # Core ECNS registry
│   ├── registrar/       # .etc registrar
│   ├── reverseRegistrar/ # Reverse resolution
│   ├── wrapper/         # Name wrapper (ERC-1155)
│   ├── resolvers/       # Resolver contracts
│   └── nft/             # NFT metadata renderer
├── deploy/              # Hardhat deploy scripts
├── test/                # Vitest test suite
├── scripts/             # Deployment/utility scripts
├── deployments/         # Deployed contract addresses
│   └── mordor.json      # Mordor testnet deployment
├── config/              # Configuration files
│   ├── dictionary-words.json  # Word lists (3,916 words, 75 iconic, 402 blacklist)
│   └── reserved-names.json    # Reserved names (1,876 offensive + variants)
├── artifacts/           # Compiled contracts
└── svg-prototype/       # NFT card design preview
```

---

## Key Files

| File | Purpose |
|------|---------|
| `hardhat.config.ts` | Hardhat configuration (networks, compilers, tasks) |
| `vitest.config.ts` | Vitest test configuration |
| `deployments/mordor.json` | Deployed Mordor addresses |
| `config/dictionary-words.json` | On-chain word dictionary |
| `config/reserved-names.json` | Reserved names configuration |
| `contracts/registry/ECNSRegistry.sol` | Core ECNS registry |
| `contracts/nft/ECNSMetadataRenderer.sol` | On-chain SVG metadata |

---

## ECNS-Specific Context

### Key Differences from ENS

- **TLD:** `.etc` instead of `.eth`
- **Chain IDs:** ETC mainnet (61), Mordor testnet (63)
- **Pricing Oracle:** ETCswap V2+V3 TWAP oracle (no Chainlink)
- **NFT Metadata:** On-chain SVG with holographic gradient cards
- **Trait System:** Tier, Character Class, Fluency, Pattern
- **Leetspeak Detection:** Dictionary-based with 3 decode strategies
- **Content Moderation:** On-chain word blacklist (402 offensive terms + leet variants)

### Networks

| Network | Chain ID | RPC |
|---------|----------|-----|
| ETC Mainnet | 61 | https://etc.rivet.link |
| Mordor Testnet | 63 | https://rpc.mordor.etccooperative.org |

### Deployed Contracts (Mordor)

See `deployments/mordor.json` for full list. Key contracts:

- ECNSRegistry: `0x29dd3a41973ec0551bcd195e46e8eb9801621c34`
- ETCRegistrarController: `0x6d36c84926c2637448f2a7eabad3a0eed7f95b25`
- PublicResolver: `0xc1267bafafd08fe85580985b020b2df08d863ca4`
- ECNSMetadataRenderer: `0xb82b372b7a368a3f3c1ff9ba96128650f629194b`

---

## Boundaries

### Always Do

- Run `pnpm test` before committing contract changes
- Use TypeScript strict mode
- Follow existing ENS patterns (this is a fork)
- Test on Mordor testnet before ETC mainnet
- Verify gas optimizations with hardhat-gas-reporter
- Document breaking changes from ENS upstream

### Ask First

- Changing contract interfaces (breaks frontend/SDK)
- Modifying pricing oracle logic
- Adding new Solidity dependencies
- Architectural changes to registry/resolver patterns
- Deploying to ETC mainnet
- Changes to reserved names or dictionary logic

### Never Do

- Deploy to ETC mainnet without Mordor verification
- Commit private keys, mnemonics, or keystores
- Skip security considerations for financial contracts
- Use deprecated Solidity patterns (delegatecall without checks, etc.)
- Modify deployed contract addresses in `deployments/`
- Use `selfdestruct` (deprecated in Solidity 0.8.18+)
- Commit `.env` files (use `.env.example` only)

---

## Protected Files

Do not modify without explicit request:

- `hardhat.config.ts` (network configuration)
- `vitest.config.ts` (test configuration)
- `deployments/mordor.json` (deployed addresses)
- `config/dictionary-words.json` (word lists)
- `config/reserved-names.json` (reserved names)
- `package.json` (dependency changes)

---

## Validation

Before committing:

```bash
pnpm lint        # Must pass
pnpm compile     # Must succeed
pnpm test        # All tests must pass
pnpm build       # Must succeed
```

---

## Claude Model Selection

**Claude Haiku 4.5** (Fastest, $1/$5 per MTok)
- Use for: Quick fixes, typos, simple scaffolding, boilerplate, gas optimization tweaks

**Claude Sonnet 4.5** (Recommended default, $3/$15 per MTok)
- Use for: Features, tests, reviews, documentation, multi-file changes, deployment scripts

**Claude Opus 4.5** (Most capable, $5/$25 per MTok)
- Use for: Complex security audits, deep debugging, large refactors, architecture planning, oracle integration

**Switch models during session:** Use `/model haiku`, `/model sonnet`, or `/model opus`

Reference: @~/.claude/rules/model-routing.md for detailed task mapping.

---

## Response Style

- No pleasantries or filler phrases
- Code first, explanations only if asked
- Concise bullet points over paragraphs
- Don't repeat the prompt back
- Tables for comparisons, not prose

---

## Notes

- This is a fork of ENS contracts - the `main` branch tracks upstream, `etc` branch has ECNS modifications
- Monorepo parent: `/media/dev/2tb/dev/ecns/` (contracts, app, sdk, thorin, docs)
- Parent-level `.claude/CLAUDE.md` exists with monorepo context
- Mordor testnet is fully deployed and functional (deployed 2026-02-06)
- ETC mainnet deployment is Phase 2 (pending user pool addresses)
- NFT metadata is 100% on-chain (no IPFS dependency)
- Dictionary-based leetspeak prevents false positives (e.g., `42069` is not leet)
