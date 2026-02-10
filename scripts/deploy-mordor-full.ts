import { createWalletClient, createPublicClient, http, keccak256, toHex, namehash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Mordor testnet chain definition
const mordor = {
  id: 63,
  name: 'Mordor',
  nativeCurrency: { name: 'Mordor Ether', symbol: 'METC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mordor.etccooperative.org'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://etc.blockscout.com/mordor' } },
  testnet: true,
} as const

// ENS-compatible pricing (in attoUSD per second, same as ENS)
// $640/year for 1 char, $160/year for 2 char, $640/year for 3 char, $160/year for 4 char, $5/year for 5+
const RENTAL_PRICES = [
  BigInt('20294266869609'), // 1 letter: $640/year
  BigInt('5073566717402'),  // 2 letters: $160/year
  BigInt('20294266869609'), // 3 letters: $640/year
  BigInt('5073566717402'),  // 4 letters: $160/year
  BigInt('158548959919'),   // 5+ letters: $5/year
]

// ETC price oracle value: $20 USD = 20 * 10^8 (8 decimals like Chainlink)
const ETC_PRICE_USD = BigInt(20 * 10**8)

async function main() {
  const privateKey = process.env.DEPLOYER_KEY
  if (!privateKey) throw new Error('DEPLOYER_KEY not set')

  const account = privateKeyToAccount(`0x${privateKey}`)
  console.log('Deploying from:', account.address)

  const publicClient = createPublicClient({ chain: mordor, transport: http() })
  const walletClient = createWalletClient({ account, chain: mordor, transport: http() })

  const balance = await publicClient.getBalance({ address: account.address })
  console.log('Balance:', Number(balance) / 1e18, 'METC')

  // Load artifacts
  const artifactsDir = path.join(__dirname, '../artifacts/contracts')
  const loadArtifact = (contractPath: string, contractName: string) => {
    const artifactPath = path.join(artifactsDir, contractPath, `${contractName}.json`)
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  }

  // Load existing deployments
  const deploymentsPath = path.join(__dirname, '../deployments/mordor.json')
  const existingDeployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'))

  const deployments: Record<string, string> = {
    ...existingDeployments.contracts
  }

  const ECNSRegistry = deployments.ECNSRegistry
  const ReverseRegistrar = deployments.ReverseRegistrar
  const etcNode = existingDeployments.tld.node

  console.log('\nExisting deployments:')
  console.log('  ECNSRegistry:', ECNSRegistry)
  console.log('  ReverseRegistrar:', ReverseRegistrar)
  console.log('  .etc node:', etcNode)

  // 1. Deploy DummyOracle (for ETC/USD price)
  console.log('\n1. Deploying DummyOracle...')
  const dummyOracle = loadArtifact('etcregistrar/DummyOracle.sol', 'DummyOracle')
  const oracleHash = await walletClient.deployContract({
    abi: dummyOracle.abi,
    bytecode: dummyOracle.bytecode as `0x${string}`,
    args: [ETC_PRICE_USD],
  })
  console.log('  Transaction:', oracleHash)
  const oracleReceipt = await publicClient.waitForTransactionReceipt({ hash: oracleHash })
  deployments.DummyOracle = oracleReceipt.contractAddress!
  console.log('  DummyOracle deployed at:', deployments.DummyOracle)

  // 2. Deploy StablePriceOracle
  console.log('\n2. Deploying StablePriceOracle...')
  const stablePriceOracle = loadArtifact('etcregistrar/StablePriceOracle.sol', 'StablePriceOracle')
  const priceOracleHash = await walletClient.deployContract({
    abi: stablePriceOracle.abi,
    bytecode: stablePriceOracle.bytecode as `0x${string}`,
    args: [deployments.DummyOracle, RENTAL_PRICES],
  })
  console.log('  Transaction:', priceOracleHash)
  const priceOracleReceipt = await publicClient.waitForTransactionReceipt({ hash: priceOracleHash })
  deployments.StablePriceOracle = priceOracleReceipt.contractAddress!
  console.log('  StablePriceOracle deployed at:', deployments.StablePriceOracle)

  // 3. Deploy BaseRegistrarImplementation
  console.log('\n3. Deploying BaseRegistrarImplementation...')
  const baseRegistrar = loadArtifact('etcregistrar/BaseRegistrarImplementation.sol', 'BaseRegistrarImplementation')
  const baseHash = await walletClient.deployContract({
    abi: baseRegistrar.abi,
    bytecode: baseRegistrar.bytecode as `0x${string}`,
    args: [ECNSRegistry, etcNode],
  })
  console.log('  Transaction:', baseHash)
  const baseReceipt = await publicClient.waitForTransactionReceipt({ hash: baseHash })
  deployments.BaseRegistrar = baseReceipt.contractAddress!
  console.log('  BaseRegistrar deployed at:', deployments.BaseRegistrar)

  // 4. Deploy DefaultReverseRegistrar
  console.log('\n4. Deploying DefaultReverseRegistrar...')
  const defaultReverseRegistrar = loadArtifact('reverseRegistrar/DefaultReverseRegistrar.sol', 'DefaultReverseRegistrar')
  const defaultReverseHash = await walletClient.deployContract({
    abi: defaultReverseRegistrar.abi,
    bytecode: defaultReverseRegistrar.bytecode as `0x${string}`,
  })
  console.log('  Transaction:', defaultReverseHash)
  const defaultReverseReceipt = await publicClient.waitForTransactionReceipt({ hash: defaultReverseHash })
  deployments.DefaultReverseRegistrar = defaultReverseReceipt.contractAddress!
  console.log('  DefaultReverseRegistrar deployed at:', deployments.DefaultReverseRegistrar)

  // 5. Deploy ETCRegistrarController
  console.log('\n5. Deploying ETCRegistrarController...')
  const controller = loadArtifact('etcregistrar/ETCRegistrarController.sol', 'ETCRegistrarController')
  // Constructor: base, prices, minCommitmentAge, maxCommitmentAge, reverseRegistrar, defaultReverseRegistrar, ecns
  const controllerHash = await walletClient.deployContract({
    abi: controller.abi,
    bytecode: controller.bytecode as `0x${string}`,
    args: [
      deployments.BaseRegistrar,
      deployments.StablePriceOracle,
      60,    // minCommitmentAge: 60 seconds
      86400, // maxCommitmentAge: 24 hours
      ReverseRegistrar,
      deployments.DefaultReverseRegistrar,
      ECNSRegistry,
    ],
  })
  console.log('  Transaction:', controllerHash)
  const controllerReceipt = await publicClient.waitForTransactionReceipt({ hash: controllerHash })
  deployments.ETCRegistrarController = controllerReceipt.contractAddress!
  console.log('  ETCRegistrarController deployed at:', deployments.ETCRegistrarController)

  // 6. Deploy PublicResolver
  console.log('\n6. Deploying PublicResolver...')
  const publicResolver = loadArtifact('resolvers/PublicResolver.sol', 'PublicResolver')
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
  const resolverHash = await walletClient.deployContract({
    abi: publicResolver.abi,
    bytecode: publicResolver.bytecode as `0x${string}`,
    args: [
      ECNSRegistry,
      ZERO_ADDRESS, // nameWrapper (not used initially)
      deployments.ETCRegistrarController,
      ReverseRegistrar,
    ],
  })
  console.log('  Transaction:', resolverHash)
  const resolverReceipt = await publicClient.waitForTransactionReceipt({ hash: resolverHash })
  deployments.PublicResolver = resolverReceipt.contractAddress!
  console.log('  PublicResolver deployed at:', deployments.PublicResolver)

  // 7. Configure contracts
  console.log('\n7. Configuring contracts...')

  // Set .etc owner to BaseRegistrar
  const registryAbi = loadArtifact('registry/ECNSRegistry.sol', 'ECNSRegistry').abi
  console.log('  Setting .etc owner to BaseRegistrar...')
  const setOwnerHash = await walletClient.writeContract({
    address: ECNSRegistry as `0x${string}`,
    abi: registryAbi,
    functionName: 'setOwner',
    args: [etcNode as `0x${string}`, deployments.BaseRegistrar],
  })
  await publicClient.waitForTransactionReceipt({ hash: setOwnerHash })
  console.log('  Done!')

  // Add ETCRegistrarController as controller on BaseRegistrar
  console.log('  Adding ETCRegistrarController as controller on BaseRegistrar...')
  const addControllerHash = await walletClient.writeContract({
    address: deployments.BaseRegistrar as `0x${string}`,
    abi: baseRegistrar.abi,
    functionName: 'addController',
    args: [deployments.ETCRegistrarController],
  })
  await publicClient.waitForTransactionReceipt({ hash: addControllerHash })
  console.log('  Done!')

  // Set default resolver on ReverseRegistrar
  console.log('  Setting default resolver on ReverseRegistrar...')
  const reverseRegistrarAbi = loadArtifact('reverseRegistrar/ReverseRegistrar.sol', 'ReverseRegistrar').abi
  const setResolverHash = await walletClient.writeContract({
    address: ReverseRegistrar as `0x${string}`,
    abi: reverseRegistrarAbi,
    functionName: 'setDefaultResolver',
    args: [deployments.PublicResolver],
  })
  await publicClient.waitForTransactionReceipt({ hash: setResolverHash })
  console.log('  Done!')

  // Save updated deployments
  const updatedDeployments = {
    ...existingDeployments,
    contracts: deployments,
    pricing: {
      oracle: 'DummyOracle',
      etcPriceUSD: Number(ETC_PRICE_USD) / 1e8,
      rentPrices: {
        '1char': '$640/year',
        '2char': '$160/year',
        '3char': '$640/year',
        '4char': '$160/year',
        '5+char': '$5/year',
      }
    }
  }
  fs.writeFileSync(deploymentsPath, JSON.stringify(updatedDeployments, null, 2))
  console.log('\nDeployments saved to:', deploymentsPath)

  console.log('\n=== ECNS Mordor Deployment Complete ===')
  console.log('ECNSRegistry:', deployments.ECNSRegistry)
  console.log('ReverseRegistrar:', deployments.ReverseRegistrar)
  console.log('DefaultReverseRegistrar:', deployments.DefaultReverseRegistrar)
  console.log('BaseRegistrar:', deployments.BaseRegistrar)
  console.log('StablePriceOracle:', deployments.StablePriceOracle)
  console.log('ETCRegistrarController:', deployments.ETCRegistrarController)
  console.log('PublicResolver:', deployments.PublicResolver)
  console.log('\n✓ ECNS is ready for .etc name registration!')
}

main().catch(console.error)
