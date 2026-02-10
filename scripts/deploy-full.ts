/**
 * ECNS Full Deployment Script
 *
 * Deploys all ECNS contracts from scratch with:
 * - Real ETCswap V2+V3 price oracle
 * - Exponential premium for expired names
 * - Reserved names system
 *
 * Usage:
 *   Development: OWNER_ADDRESS not set - deployer keeps ownership
 *   Production:  OWNER_ADDRESS set - transfers to hardware wallet
 */

import { createWalletClient, createPublicClient, http, namehash, labelhash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const mordor = {
  id: 63,
  name: 'Mordor',
  nativeCurrency: { name: 'Mordor Ether', symbol: 'METC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mordor.etccooperative.org'] } },
  testnet: true,
} as const

// Constants
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000'

// TLD Configuration
const TLD = 'etc'
const TLD_LABEL_HASH = labelhash(TLD)
const TLD_NODE = namehash(TLD)

// ETCswap addresses on Mordor
const WETC = '0x1953cab0E5bFa6D4a9BaD6E05fD46C1CC6527a5a'
const V2_PAIR = '0x0a73dc518791Fa8436939C8a8a08003EC782A509'
const V3_POOL = '0x7E4ABAeF2b18F05B8eB406CF76C23f517bEb3e13'

// Pricing (in attoUSD per second)
const RENTAL_PRICES = [
  BigInt('20294266869609'), // 1 letter: $640/year
  BigInt('5073566717402'),  // 2 letters: $160/year
  BigInt('20294266869609'), // 3 letters: $640/year
  BigInt('5073566717402'),  // 4 letters: $160/year
  BigInt('158548959919'),   // 5+ letters: $5/year
]

// Premium decay for expired names
const START_PREMIUM = BigInt('100000000') * BigInt(10**18) // $100M
const DECAY_DAYS = 21

// Ownable ABI for transfers
const ownableAbi = [
  {
    inputs: [{ name: 'newOwner', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
] as const

async function main() {
  const privateKey = process.env.DEPLOYER_KEY
  const ownerAddress = process.env.OWNER_ADDRESS

  if (!privateKey) throw new Error('DEPLOYER_KEY not set')

  const account = privateKeyToAccount(`0x${privateKey}`)
  const isProduction = !!ownerAddress
  const finalOwner = ownerAddress || account.address

  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║              ECNS Full Deployment - Mordor                   ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('Deployer:', account.address)
  console.log('Mode:', isProduction ? 'PRODUCTION' : 'DEVELOPMENT')
  console.log('Final Owner:', finalOwner)
  console.log('')

  const publicClient = createPublicClient({ chain: mordor, transport: http() })
  const walletClient = createWalletClient({ account, chain: mordor, transport: http() })

  // Load artifacts helper
  const artifactsDir = path.join(__dirname, '../artifacts/contracts')
  const loadArtifact = (contractPath: string, contractName: string) => {
    const artifactPath = path.join(artifactsDir, contractPath, `${contractName}.json`)
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  }

  const deployed: Record<string, string> = {}

  // ═══════════════════════════════════════════════════════════════════
  // 1. ECNS Registry
  // ═══════════════════════════════════════════════════════════════════
  console.log('1. Deploying ECNSRegistry...')
  const registry = loadArtifact('registry/ECNSRegistry.sol', 'ECNSRegistry')
  const registryHash = await walletClient.deployContract({
    abi: registry.abi,
    bytecode: registry.bytecode as `0x${string}`,
    args: [],
  })
  const registryReceipt = await publicClient.waitForTransactionReceipt({ hash: registryHash })
  deployed.ECNSRegistry = registryReceipt.contractAddress!
  console.log('   ✓', deployed.ECNSRegistry)

  // ═══════════════════════════════════════════════════════════════════
  // 2. Reverse Registrar
  // ═══════════════════════════════════════════════════════════════════
  console.log('2. Deploying ReverseRegistrar...')
  const reverseRegistrar = loadArtifact('reverseRegistrar/ReverseRegistrar.sol', 'ReverseRegistrar')
  const reverseHash = await walletClient.deployContract({
    abi: reverseRegistrar.abi,
    bytecode: reverseRegistrar.bytecode as `0x${string}`,
    args: [deployed.ECNSRegistry],
  })
  const reverseReceipt = await publicClient.waitForTransactionReceipt({ hash: reverseHash })
  deployed.ReverseRegistrar = reverseReceipt.contractAddress!
  console.log('   ✓', deployed.ReverseRegistrar)

  // ═══════════════════════════════════════════════════════════════════
  // 3. Default Reverse Registrar (no constructor args)
  // ═══════════════════════════════════════════════════════════════════
  console.log('3. Deploying DefaultReverseRegistrar...')
  const defaultReverse = loadArtifact('reverseRegistrar/DefaultReverseRegistrar.sol', 'DefaultReverseRegistrar')
  const defaultReverseHash = await walletClient.deployContract({
    abi: defaultReverse.abi,
    bytecode: defaultReverse.bytecode as `0x${string}`,
    args: [],
  })
  const defaultReverseReceipt = await publicClient.waitForTransactionReceipt({ hash: defaultReverseHash })
  deployed.DefaultReverseRegistrar = defaultReverseReceipt.contractAddress!
  console.log('   ✓', deployed.DefaultReverseRegistrar)

  // ═══════════════════════════════════════════════════════════════════
  // 4. Setup reverse namespace in registry
  // ═══════════════════════════════════════════════════════════════════
  console.log('4. Setting up reverse namespace...')
  const registryAbi = registry.abi
  const reverseNode = namehash('reverse')

  // Create 'reverse' TLD - deployer owns it initially
  const reverseLabelHash = labelhash('reverse')
  const tx1 = await walletClient.writeContract({
    address: deployed.ECNSRegistry as `0x${string}`,
    abi: registryAbi,
    functionName: 'setSubnodeOwner',
    args: [ZERO_HASH as `0x${string}`, reverseLabelHash, account.address],
  })
  await publicClient.waitForTransactionReceipt({ hash: tx1 })
  console.log('   ✓ reverse TLD created')

  // Create 'addr.reverse' - owned by ReverseRegistrar
  const addrLabelHash = labelhash('addr')
  const tx2 = await walletClient.writeContract({
    address: deployed.ECNSRegistry as `0x${string}`,
    abi: registryAbi,
    functionName: 'setSubnodeOwner',
    args: [reverseNode, addrLabelHash, deployed.ReverseRegistrar as `0x${string}`],
  })
  await publicClient.waitForTransactionReceipt({ hash: tx2 })
  console.log('   ✓ addr.reverse configured')

  // Create 'default.reverse' - owned by DefaultReverseRegistrar
  const defaultLabelHash = labelhash('default')
  const tx3 = await walletClient.writeContract({
    address: deployed.ECNSRegistry as `0x${string}`,
    abi: registryAbi,
    functionName: 'setSubnodeOwner',
    args: [reverseNode, defaultLabelHash, deployed.DefaultReverseRegistrar as `0x${string}`],
  })
  await publicClient.waitForTransactionReceipt({ hash: tx3 })
  console.log('   ✓ default.reverse configured')

  // ═══════════════════════════════════════════════════════════════════
  // 5a. Metadata Renderer (must deploy before BaseRegistrar)
  // ═══════════════════════════════════════════════════════════════════
  console.log('5a. Deploying ECNSMetadataRenderer...')
  const metadataRenderer = loadArtifact('nft/ECNSMetadataRenderer.sol', 'ECNSMetadataRenderer')
  const rendererHash = await walletClient.deployContract({
    abi: metadataRenderer.abi,
    bytecode: metadataRenderer.bytecode as `0x${string}`,
    args: [],
  })
  const rendererReceipt = await publicClient.waitForTransactionReceipt({ hash: rendererHash })
  deployed.ECNSMetadataRenderer = rendererReceipt.contractAddress!
  console.log('   ✓', deployed.ECNSMetadataRenderer)

  // ═══════════════════════════════════════════════════════════════════
  // 5b. Base Registrar (with metadata renderer)
  // ═══════════════════════════════════════════════════════════════════
  console.log('5b. Deploying BaseRegistrar...')
  const baseRegistrar = loadArtifact('etcregistrar/BaseRegistrarImplementation.sol', 'BaseRegistrarImplementation')
  const baseHash = await walletClient.deployContract({
    abi: baseRegistrar.abi,
    bytecode: baseRegistrar.bytecode as `0x${string}`,
    args: [deployed.ECNSRegistry, TLD_NODE, deployed.ECNSMetadataRenderer],
  })
  const baseReceipt = await publicClient.waitForTransactionReceipt({ hash: baseHash })
  deployed.BaseRegistrar = baseReceipt.contractAddress!
  console.log('   ✓', deployed.BaseRegistrar)

  // ═══════════════════════════════════════════════════════════════════
  // 6. Setup .etc TLD
  // ═══════════════════════════════════════════════════════════════════
  console.log('6. Setting up .etc TLD...')
  await walletClient.writeContract({
    address: deployed.ECNSRegistry as `0x${string}`,
    abi: registryAbi,
    functionName: 'setSubnodeOwner',
    args: [ZERO_HASH as `0x${string}`, TLD_LABEL_HASH, deployed.BaseRegistrar as `0x${string}`],
  })
  console.log('   ✓ .etc TLD owned by BaseRegistrar')

  // ═══════════════════════════════════════════════════════════════════
  // 7. ETCswap Full Oracle (V2+V3+V4 ready)
  // ═══════════════════════════════════════════════════════════════════
  console.log('7. Deploying ETCswapFullOracle...')
  const etcswapOracle = loadArtifact('etcregistrar/ETCswapFullOracle.sol', 'ETCswapFullOracle')
  const oracleHash = await walletClient.deployContract({
    abi: etcswapOracle.abi,
    bytecode: etcswapOracle.bytecode as `0x${string}`,
    args: [V2_PAIR, true, V3_POOL, true], // wetcIsToken0 = true for both
  })
  const oracleReceipt = await publicClient.waitForTransactionReceipt({ hash: oracleHash })
  deployed.ETCswapFullOracle = oracleReceipt.contractAddress!
  console.log('   ✓', deployed.ETCswapFullOracle)

  // ═══════════════════════════════════════════════════════════════════
  // 8. Exponential Premium Price Oracle
  // ═══════════════════════════════════════════════════════════════════
  console.log('8. Deploying ExponentialPremiumPriceOracle...')
  const premiumOracle = loadArtifact('etcregistrar/ExponentialPremiumPriceOracle.sol', 'ExponentialPremiumPriceOracle')
  const premiumHash = await walletClient.deployContract({
    abi: premiumOracle.abi,
    bytecode: premiumOracle.bytecode as `0x${string}`,
    args: [deployed.ETCswapFullOracle, RENTAL_PRICES, START_PREMIUM, DECAY_DAYS],
  })
  const premiumReceipt = await publicClient.waitForTransactionReceipt({ hash: premiumHash })
  deployed.ExponentialPremiumPriceOracle = premiumReceipt.contractAddress!
  console.log('   ✓', deployed.ExponentialPremiumPriceOracle)

  // ═══════════════════════════════════════════════════════════════════
  // 9. ETC Registrar Controller
  // ═══════════════════════════════════════════════════════════════════
  console.log('9. Deploying ETCRegistrarController...')
  const controller = loadArtifact('etcregistrar/ETCRegistrarController.sol', 'ETCRegistrarController')
  const controllerHash = await walletClient.deployContract({
    abi: controller.abi,
    bytecode: controller.bytecode as `0x${string}`,
    args: [
      deployed.BaseRegistrar,
      deployed.ExponentialPremiumPriceOracle,
      60,    // minCommitmentAge: 60 seconds
      86400, // maxCommitmentAge: 24 hours
      deployed.ReverseRegistrar,
      deployed.DefaultReverseRegistrar,
      deployed.ECNSRegistry,
    ],
  })
  const controllerReceipt = await publicClient.waitForTransactionReceipt({ hash: controllerHash })
  deployed.ETCRegistrarController = controllerReceipt.contractAddress!
  console.log('   ✓', deployed.ETCRegistrarController)

  // ═══════════════════════════════════════════════════════════════════
  // 10. Add Controller to BaseRegistrar
  // ═══════════════════════════════════════════════════════════════════
  console.log('10. Adding controller to BaseRegistrar...')
  await walletClient.writeContract({
    address: deployed.BaseRegistrar as `0x${string}`,
    abi: baseRegistrar.abi,
    functionName: 'addController',
    args: [deployed.ETCRegistrarController],
  })
  console.log('    ✓ Controller authorized')

  // ═══════════════════════════════════════════════════════════════════
  // 11. Public Resolver
  // ═══════════════════════════════════════════════════════════════════
  console.log('11. Deploying PublicResolver...')
  const resolver = loadArtifact('resolvers/PublicResolver.sol', 'PublicResolver')
  const resolverHash = await walletClient.deployContract({
    abi: resolver.abi,
    bytecode: resolver.bytecode as `0x${string}`,
    args: [
      deployed.ECNSRegistry,
      ZERO_ADDRESS, // nameWrapper (not used)
      deployed.ETCRegistrarController,
      deployed.ReverseRegistrar,
    ],
  })
  const resolverReceipt = await publicClient.waitForTransactionReceipt({ hash: resolverHash })
  deployed.PublicResolver = resolverReceipt.contractAddress!
  console.log('    ✓', deployed.PublicResolver)

  // ═══════════════════════════════════════════════════════════════════
  // 12. Set default resolver on ReverseRegistrar
  // ═══════════════════════════════════════════════════════════════════
  console.log('12. Setting default resolver on ReverseRegistrar...')
  await walletClient.writeContract({
    address: deployed.ReverseRegistrar as `0x${string}`,
    abi: reverseRegistrar.abi,
    functionName: 'setDefaultResolver',
    args: [deployed.PublicResolver],
  })
  console.log('    ✓ Default resolver set')

  // ═══════════════════════════════════════════════════════════════════
  // 13. Reserve Names
  // ═══════════════════════════════════════════════════════════════════
  console.log('13. Reserving names...')
  const configPath = path.join(__dirname, '../config/reserved-names.json')

  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    const allNames = new Set<string>()
    for (const category of Object.values(config.categories) as any[]) {
      for (const name of category.names) {
        allNames.add(name.toLowerCase())
      }
    }
    const names = Array.from(allNames)

    const controllerAbi = [
      {
        inputs: [{ name: 'labels', type: 'string[]' }],
        name: 'reserveNames',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function'
      }
    ] as const

    const BATCH_SIZE = 25
    for (let i = 0; i < names.length; i += BATCH_SIZE) {
      const batch = names.slice(i, i + BATCH_SIZE)
      await walletClient.writeContract({
        address: deployed.ETCRegistrarController as `0x${string}`,
        abi: controllerAbi,
        functionName: 'reserveNames',
        args: [batch],
      })
    }
    console.log(`    ✓ ${names.length} names reserved`)
  } else {
    console.log('    ⚠ No reserved-names.json found, skipping')
  }

  // ═══════════════════════════════════════════════════════════════════
  // 14. Transfer Ownership (production only)
  // ═══════════════════════════════════════════════════════════════════
  const ownableContracts = [
    'BaseRegistrar',
    'ETCRegistrarController',
    'ReverseRegistrar',
    'DefaultReverseRegistrar',
    'ETCswapFullOracle',
    'ExponentialPremiumPriceOracle',
  ]

  if (isProduction) {
    console.log('14. Transferring ownership to hardware wallet...')
    for (const name of ownableContracts) {
      try {
        await walletClient.writeContract({
          address: deployed[name] as `0x${string}`,
          abi: ownableAbi,
          functionName: 'transferOwnership',
          args: [ownerAddress as `0x${string}`],
        })
        console.log(`    ✓ ${name}`)
      } catch (e) {
        console.log(`    ⚠ ${name} (may not be Ownable)`)
      }
    }
  } else {
    console.log('14. Skipping ownership transfer (development mode)')
  }

  // ═══════════════════════════════════════════════════════════════════
  // Save Deployment
  // ═══════════════════════════════════════════════════════════════════
  const deployment = {
    chainId: 63,
    network: 'mordor',
    deployer: account.address,
    deployedAt: new Date().toISOString(),
    contracts: deployed,
    tld: {
      name: TLD,
      labelHash: TLD_LABEL_HASH,
      node: TLD_NODE,
    },
    blockExplorer: 'https://etc-mordor.blockscout.com',
    reverse: {
      node: reverseNode,
      addrReverseNode: namehash('addr.reverse'),
    },
    pricing: {
      oracle: 'ETCswapFullOracle',
      priceOracle: 'ExponentialPremiumPriceOracle',
      sources: ['V2', 'V3', 'V4 (pending Olympia)'],
      rentPrices: {
        '1char': '$640/year',
        '2char': '$160/year',
        '3char': '$640/year',
        '4char': '$160/year',
        '5+char': '$5/year',
      },
      premium: {
        type: 'ExponentialDecay',
        startPremium: '$100,000,000',
        decayPeriod: '21 days',
        gracePeriod: '90 days',
      },
    },
    oracle: {
      type: 'ETCswapFull',
      v2: { pair: V2_PAIR, wetcIsToken0: true },
      v3: { pool: V3_POOL, wetcIsToken0: true, feeTier: 500 },
      v4: { enabled: false, note: 'Configure after Olympia via configureV4()' },
    },
    features: {
      reservedNames: true,
      exponentialPremium: true,
      realTimeOracle: true,
    },
    ownership: {
      owner: finalOwner,
      deployer: account.address,
      mode: isProduction ? 'production' : 'development',
    },
  }

  const deploymentsPath = path.join(__dirname, '../deployments/mordor.json')
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployment, null, 2))

  // ═══════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════
  console.log('')
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║                    Deployment Complete!                      ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('Contracts:')
  for (const [name, address] of Object.entries(deployed)) {
    console.log(`  ${name}: ${address}`)
  }
  console.log('')
  console.log('Owner:', finalOwner)
  console.log('Mode:', isProduction ? 'PRODUCTION' : 'DEVELOPMENT')
  console.log('')
  console.log('Saved to: deployments/mordor.json')
}

main().catch(console.error)
