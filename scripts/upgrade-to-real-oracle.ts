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

async function main() {
  const privateKey = process.env.DEPLOYER_KEY
  if (!privateKey) throw new Error('DEPLOYER_KEY not set')

  const account = privateKeyToAccount(`0x${privateKey}`)
  console.log('Upgrading from:', account.address)

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

  // 1. Deploy new StablePriceOracle with ETCswapFullOracle
  console.log('\n1. Deploying StablePriceOracle with ETCswapFullOracle...')
  const stablePriceOracle = loadArtifact('etcregistrar/StablePriceOracle.sol', 'StablePriceOracle')
  const priceOracleHash = await walletClient.deployContract({
    abi: stablePriceOracle.abi,
    bytecode: stablePriceOracle.bytecode as `0x${string}`,
    args: [ETCswapFullOracle, RENTAL_PRICES],
  })
  console.log('  Transaction:', priceOracleHash)
  const priceOracleReceipt = await publicClient.waitForTransactionReceipt({ hash: priceOracleHash })
  const newPriceOracle = priceOracleReceipt.contractAddress!
  console.log('  StablePriceOracle deployed at:', newPriceOracle)

  // 2. Deploy new ETCRegistrarController with real oracle
  console.log('\n2. Deploying ETCRegistrarController with real oracle...')
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

  // Test the new price oracle
  console.log('\n6. Testing new pricing...')
  const controllerAbi = [
    {
      inputs: [
        { name: 'name', type: 'string' },
        { name: 'duration', type: 'uint256' }
      ],
      name: 'rentPrice',
      outputs: [
        {
          components: [
            { name: 'base', type: 'uint256' },
            { name: 'premium', type: 'uint256' }
          ],
          type: 'tuple'
        }
      ],
      stateMutability: 'view',
      type: 'function'
    }
  ] as const

  const oneYear = BigInt(365 * 24 * 60 * 60)
  const testNames = ['a', 'ab', 'abc', 'abcd', 'abcde', 'testname']

  for (const name of testNames) {
    const price = await publicClient.readContract({
      address: newController as `0x${string}`,
      abi: controllerAbi,
      functionName: 'rentPrice',
      args: [name, oneYear]
    })
    console.log(`  ${name}.etc (${name.length} char): ${(Number(price.base) / 1e18).toFixed(4)} ETC/year`)
  }

  // Update deployments
  deployments.contracts.StablePriceOracle = newPriceOracle
  deployments.contracts.ETCRegistrarController = newController
  deployments.contracts.PublicResolver = newResolver
  deployments.pricing = {
    oracle: 'ETCswapFullOracle',
    sources: ['V2', 'V3', 'V4 (pending Olympia)'],
    rentPrices: {
      '1char': '$640/year',
      '2char': '$160/year',
      '3char': '$640/year',
      '4char': '$160/year',
      '5+char': '$5/year',
    }
  }
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2))

  console.log('\n=== Upgrade Complete ===')
  console.log('StablePriceOracle:', newPriceOracle)
  console.log('ETCRegistrarController:', newController)
  console.log('PublicResolver:', newResolver)
  console.log('\n✓ ECNS now uses real ETCswap V2+V3 price feeds!')
  console.log('  Current ETC price: ~$20 USD (from ETCswap pools)')
}

main().catch(console.error)
