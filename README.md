# ECNS Contracts

Smart contracts for the **Ethereum Classic Name Service** (ECNS) — a fork of [ENS](https://github.com/ensdomains/ens-contracts) adapted for Ethereum Classic.

ECNS lets you replace `0x3b09...1537` with `myname.etc`.

## Deployed Contracts (Mordor Testnet)

| Contract | Address |
|----------|---------|
| ECNSRegistry | `0x29dd3a41973ec0551bcd195e46e8eb9801621c34` |
| BaseRegistrar | `0xfbce90395535d6ae9448f55d676bde9a40215a37` |
| ETCRegistrarController | `0x6d36c84926c2637448f2a7eabad3a0eed7f95b25` |
| PublicResolver | `0xc1267bafafd08fe85580985b020b2df08d863ca4` |
| ECNSMetadataRenderer | `0xb82b372b7a368a3f3c1ff9ba96128650f629194b` |
| ECNSWordDictionary | `0xbbaf428472bbb7800c5bd255832a9858cead15fd` |
| ETCswapFullOracle | `0x34bda98deb5862a7f387a60a1e3b01879eb5f3fe` |
| ExponentialPremiumPriceOracle | `0xae4cdb10b803849766a2b695bca1a7df5a962b06` |
| ReverseRegistrar | `0x0ebc22b513866796157a9fc9e86d23c3cddc28ab` |

Full deployment details: [`deployments/mordor.json`](deployments/mordor.json)

## Key Differences from ENS

- **TLD**: `.etc` instead of `.eth`
- **Pricing Oracle**: ETCswap V2+V3 TWAP oracle (no Chainlink dependency)
- **NFT Metadata**: On-chain SVG with holographic gradient cards, trait system (Tier, Character Class, Fluency, Pattern)
- **Leetspeak Detection**: Dictionary-based verification with 3 decode strategies (Map A standard, Map A alternate, Map B calculator)
- **Content Moderation**: On-chain word dictionary + 1,876 reserved offensive terms with leet variants
- **Reserved Names**: Brand protection, trademark protection, premium auctions

## Architecture

### NFT Trait System

Each `.etc` name is an ERC-721 NFT with on-chain SVG artwork. Traits are computed deterministically:

| Trait | Values |
|-------|--------|
| **Tier** | Ultra Rare (1-2 char), Legendary (3), Epic (4), Rare (5-7), Uncommon (8-9), Common (10+) |
| **Character Class** | Pure Alpha, Numeric, Alphanumeric, Leetspeak, Hyphenated |
| **Fluency** | Euphonious, Fluent, Standard, Harsh |
| **Pattern** | Standard, Palindrome, Repeating, Sequential |

### Dictionary-Based Leetspeak

The `ECNSWordDictionary` contract stores 3 on-chain word sets:

1. **Words** (3,916) — English dictionary for verifying leet decodings
2. **Iconic Leet** (75) — Culturally legendary leet forms that get Ultra Rare tier (e.g. `1337`, `31337`, `80085`)
3. **Blacklist** (402) — Offensive terms for content moderation

Three decode strategies are tried in order:
- **Map A** (1->l): `4->a, 3->e, 1->l, 0->o, 5->s, 7->t, 8->b`
- **Map A** (1->i): same but `1->i`
- **Map B** (calculator): `4->h, 3->e, 7->l, 1->i, 0->o, 5->s, 8->b, 6->g, 9->g`

A decoded string must be **all-alpha** AND **in the dictionary** to classify as Leetspeak. This prevents false positives like `42069` (decoded `a2o69` has digits -> not leet).

Leetspeak names get the same tier as their decoded word length, except iconic forms which always get Ultra Rare.

### Pricing

| Length | Annual Cost (USD) |
|--------|-------------------|
| 1 char | $640 |
| 2 char | $160 |
| 3 char | $640 |
| 4 char | $160 |
| 5+ char | $5 |

Prices are denominated in ETC via ETCswap oracle (V2 + V3 TWAP).

## Development

### Setup

```bash
git clone https://github.com/ecnsdomains/ecns-contracts
cd ecns-contracts
pnpm install
```

### Compile

```bash
pnpm compile
# or
npx hardhat compile
```

### Test

```bash
pnpm test
```

### Deploy to Mordor

```bash
cp .env.example .env
# Edit .env with your deployer key and RPC URLs

# Full deployment (first time)
source .env && export DEPLOYER_KEY && npx tsx scripts/deploy-full.ts

# Deploy/update dictionary + renderer
source .env && export DEPLOYER_KEY && npx tsx scripts/populate-dictionary.ts

# Reserve offensive names
source .env && export DEPLOYER_KEY && npx tsx scripts/reserve-names.ts
```

### Scripts

| Script | Purpose |
|--------|---------|
| `deploy-full.ts` | Full contract deployment to any network |
| `deploy-mordor-full.ts` | Mordor-specific full deployment |
| `populate-dictionary.ts` | Deploy dictionary + renderer, populate word lists |
| `reserve-names.ts` | Reserve names from `config/reserved-names.json` |
| `upgrade-renderer.ts` | Hot-swap metadata renderer on BaseRegistrar |
| `test-dictionary.ts` | Test dictionary-based leetspeak on deployed contracts |
| `test-traits.ts` | Register names and verify trait system |
| `test-registration.ts` | Test commit-reveal registration flow |

### Configuration

| File | Purpose |
|------|---------|
| `config/dictionary-words.json` | Word lists for ECNSWordDictionary (3,916 words, 75 iconic, 402 blacklist) |
| `config/reserved-names.json` | Reserved names across 12 categories (1,876 offensive + leet variants) |
| `deployments/mordor.json` | Mordor contract addresses and configuration |

### Prototype

Open `svg-prototype/v3-card.html` in a browser to preview NFT card designs with the trait system. Includes dictionary-based leetspeak detection mirroring the on-chain logic.

## Networks

| Network | Chain ID | RPC |
|---------|----------|-----|
| ETC Mainnet | 61 | `https://etc.rivet.cloud` |
| Mordor Testnet | 63 | `https://rpc.mordor.etccooperative.org` |

## License

MIT - see [LICENSE.txt](LICENSE.txt)

## Upstream

Forked from [ensdomains/ens-contracts](https://github.com/ensdomains/ens-contracts). The `main` branch tracks upstream; the `etc` branch contains all ECNS modifications.
