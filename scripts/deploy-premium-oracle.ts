import { createWalletClient, createPublicClient, http } from 'viem'
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

// ENS-compatible pricing (in attoUSD per second)
// $640/year for 1 char, $160/year for 2 char, $640/year for 3 char, $160/year for 4 char, $5/year for 5+
const RENTAL_PRICES = [
  BigInt('20294266869609'), // 1 letter: $640/year
  BigInt('5073566717402'),  // 2 letters: $160/year
  BigInt('20294266869609'), // 3 letters: $640/year
  BigInt('5073566717402'),  // 4 letters: $160/year
  BigInt('158548959919'),   // 5+ letters: $5/year
]

// Premium decay settings (ENS standard)
// Starting premium: $100,000,000 (to prevent frontrunning)
// Decay period: 21 days (premium halves each day)
const START_PREMIUM = BigInt('100000000') * BigInt(10**18) // $100M in attoUSD
const DECAY_DAYS = 21 // Premium decays over 21 days

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
  const ownerAddress = process.env.OWNER_ADDRESS // Optional - only set for production

  if (!privateKey) throw new Error('DEPLOYER_KEY not set')

  const account = privateKeyToAccount(`0x${privateKey}`)
  console.log('Deploying from:', account.address)
  console.log('Mode:', ownerAddress ? 'PRODUCTION (transfer to hardware wallet)' : 'DEVELOPMENT (deployer keeps ownership)')

  const publicClient = createPublicClient({ chain: mordor, transport: http() })
  const walletClient = createWalletClient({ account, chain: mordor, transport: http() })

  // Load artifacts
  const artifactsDir = path.join(__dirname, '../artifacts/contracts')
  const loadArtifact = (contractPath: string, contractName: string) => {
    const artifactPath = path.join(artifactsDir, contractPath, `${contractName}.json`)
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  }

  // Load existing deployments
  const deploymentsPath = path.join(__dirname, '../deployments/mordor.json')
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'))

  const ECNSRegistry = deployments.contracts.ECNSRegistry as `0x${string}`
  const ReverseRegistrar = deployments.contracts.ReverseRegistrar as `0x${string}`
  const DefaultReverseRegistrar = deployments.contracts.DefaultReverseRegistrar as `0x${string}`
  const BaseRegistrar = deployments.contracts.BaseRegistrar as `0x${string}`
  const ETCswapFullOracle = deployments.contracts.ETCswapFullOracle as `0x${string}`

  console.log('\nExisting contracts:')
  console.log('  ECNSRegistry:', ECNSRegistry)
  console.log('  BaseRegistrar:', BaseRegistrar)
  console.log('  ETCswapFullOracle:', ETCswapFullOracle)

  // Save old addresses
  const oldStablePriceOracle = deployments.contracts.StablePriceOracle
  const oldController = deployments.contracts.ETCRegistrarController

  // 1. Deploy ExponentialPremiumPriceOracle
  console.log('\n1. Deploying ExponentialPremiumPriceOracle...')
  console.log('   - Start premium: $100,000,000')
  console.log('   - Decay period: 21 days')
  console.log('   - Grace period: 90 days (hardcoded)')

  const premiumOracle = loadArtifact('etcregistrar/ExponentialPremiumPriceOracle.sol', 'ExponentialPremiumPriceOracle')
  const oracleHash = await walletClient.deployContract({
    abi: premiumOracle.abi,
    bytecode: premiumOracle.bytecode as `0x${string}`,
    args: [ETCswapFullOracle, RENTAL_PRICES, START_PREMIUM, DECAY_DAYS],
  })
  console.log('  Transaction:', oracleHash)
  const oracleReceipt = await publicClient.waitForTransactionReceipt({ hash: oracleHash })
  const newPriceOracle = oracleReceipt.contractAddress!
  console.log('  ExponentialPremiumPriceOracle deployed at:', newPriceOracle)

  // 2. Deploy new ETCRegistrarController with premium oracle
  console.log('\n2. Deploying ETCRegistrarController with premium oracle...')
  const controller = loadArtifact('etcregistrar/ETCRegistrarController.sol', 'ETCRegistrarController')
  const controllerHash = await walletClient.deployContract({
    abi: controller.abi,
    bytecode: controller.bytecode as `0x${string}`,
    args: [
      BaseRegistrar,
      newPriceOracle,
      60,    // minCommitmentAge: 60 seconds
      86400, // maxCommitmentAge: 24 hours
      ReverseRegistrar,
      DefaultReverseRegistrar,
      ECNSRegistry,
    ],
  })
  console.log('  Transaction:', controllerHash)
  const controllerReceipt = await publicClient.waitForTransactionReceipt({ hash: controllerHash })
  const newController = controllerReceipt.contractAddress!
  console.log('  ETCRegistrarController deployed at:', newController)

  // 3. Add new controller to BaseRegistrar
  console.log('\n3. Adding new controller to BaseRegistrar...')
  const baseRegistrarAbi = loadArtifact('etcregistrar/BaseRegistrarImplementation.sol', 'BaseRegistrarImplementation').abi
  const addControllerHash = await walletClient.writeContract({
    address: BaseRegistrar,
    abi: baseRegistrarAbi,
    functionName: 'addController',
    args: [newController],
  })
  await publicClient.waitForTransactionReceipt({ hash: addControllerHash })
  console.log('  Done!')

  // 4. Deploy new PublicResolver with new controller
  console.log('\n4. Deploying PublicResolver with new controller...')
  const publicResolver = loadArtifact('resolvers/PublicResolver.sol', 'PublicResolver')
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
  const resolverHash = await walletClient.deployContract({
    abi: publicResolver.abi,
    bytecode: publicResolver.bytecode as `0x${string}`,
    args: [
      ECNSRegistry,
      ZERO_ADDRESS, // nameWrapper
      newController,
      ReverseRegistrar,
    ],
  })
  console.log('  Transaction:', resolverHash)
  const resolverReceipt = await publicClient.waitForTransactionReceipt({ hash: resolverHash })
  const newResolver = resolverReceipt.contractAddress!
  console.log('  PublicResolver deployed at:', newResolver)

  // 5. Update default resolver on ReverseRegistrar
  console.log('\n5. Updating default resolver on ReverseRegistrar...')
  const reverseRegistrarAbi = loadArtifact('reverseRegistrar/ReverseRegistrar.sol', 'ReverseRegistrar').abi
  const setResolverHash = await walletClient.writeContract({
    address: ReverseRegistrar,
    abi: reverseRegistrarAbi,
    functionName: 'setDefaultResolver',
    args: [newResolver],
  })
  await publicClient.waitForTransactionReceipt({ hash: setResolverHash })
  console.log('  Done!')

  // Test the premium decay
  console.log('\n6. Testing premium decay...')
  const premiumOracleAbi = [
    {
      inputs: [
        { name: 'startPremium', type: 'uint256' },
        { name: 'elapsed', type: 'uint256' }
      ],
      name: 'decayedPremium',
      outputs: [{ type: 'uint256' }],
      stateMutability: 'pure',
      type: 'function'
    }
  ] as const

  const testElapsed = [
    { days: 0, label: 'Day 0 (just expired)' },
    { days: 1, label: 'Day 1' },
    { days: 7, label: 'Day 7' },
    { days: 14, label: 'Day 14' },
    { days: 21, label: 'Day 21' },
  ]

  for (const test of testElapsed) {
    const elapsed = BigInt(test.days * 24 * 60 * 60) // seconds
    try {
      const premium = await publicClient.readContract({
        address: newPriceOracle as `0x${string}`,
        abi: premiumOracleAbi,
        functionName: 'decayedPremium',
        args: [START_PREMIUM, elapsed]
      })
      const premiumUSD = Number(premium) / 1e18
      console.log(`  ${test.label}: $${premiumUSD.toLocaleString()}`)
    } catch (e: any) {
      console.log(`  ${test.label}: error - ${e.message?.slice(0, 50)}`)
    }
  }

  // Update deployments
  deployments.contracts.ExponentialPremiumPriceOracle = newPriceOracle
  deployments.contracts.ETCRegistrarController = newController
  deployments.contracts.ETCRegistrarControllerV2 = oldController
  deployments.contracts.StablePriceOracleV1 = oldStablePriceOracle
  deployments.contracts.StablePriceOracle = newPriceOracle // Alias
  deployments.contracts.PublicResolver = newResolver
  deployments.pricing.premium = {
    type: 'ExponentialDecay',
    startPremium: '$100,000,000',
    decayPeriod: '21 days',
    gracePeriod: '90 days',
    description: 'Expired names go into Dutch auction. Premium starts at $100M and halves daily for 21 days.'
  }
  deployments.features.exponentialPremium = true
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2))

  // 7. Transfer ownership (only in production mode)
  if (ownerAddress) {
    console.log('\n7. Transferring ownership to hardware wallet...')
    console.log('   Owner address:', ownerAddress)

    const newContracts = [
      { name: 'ExponentialPremiumPriceOracle', address: newPriceOracle },
      { name: 'ETCRegistrarController', address: newController },
      { name: 'PublicResolver', address: newResolver },
    ]

    for (const { name, address } of newContracts) {
      try {
        const hash = await walletClient.writeContract({
          address: address as `0x${string}`,
          abi: ownableAbi,
          functionName: 'transferOwnership',
          args: [ownerAddress as `0x${string}`]
        })
        await publicClient.waitForTransactionReceipt({ hash })
        console.log(`  ${name}: Ownership transferred`)
      } catch (error: any) {
        console.log(`  ${name}: ${error.message?.slice(0, 50)}`)
      }
    }

    deployments.ownership = {
      owner: ownerAddress,
      deployer: account.address,
      note: 'Contracts owned by hardware wallet'
    }
  } else {
    console.log('\n7. Skipping ownership transfer (development mode)')
    deployments.ownership = {
      owner: account.address,
      deployer: account.address,
      mode: 'development',
      note: 'Deployer owns contracts - transfer to hardware wallet before production'
    }
  }
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2))

  console.log('\n=== Deployment Complete ===')
  console.log('ExponentialPremiumPriceOracle:', newPriceOracle)
  console.log('ETCRegistrarController:', newController)
  console.log('PublicResolver:', newResolver)
  console.log('\nOwnership:', ownerAddress ? `Transferred to ${ownerAddress}` : 'Deployer (development mode)')
  console.log('\nPremium Pricing:')
  console.log('  - Grace period: 90 days after expiry')
  console.log('  - Then: Dutch auction starts at $100M')
  console.log('  - Premium halves each day for 21 days')
  console.log('  - After 21 days: Normal pricing')
  console.log('\nIMPORTANT: Run reserve-names.ts to re-reserve names on new controller!')
}

main().catch(console.error)
