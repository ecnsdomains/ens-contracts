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

async function main() {
  const privateKey = process.env.DEPLOYER_KEY
  if (!privateKey) throw new Error('DEPLOYER_KEY not set')

  const account = privateKeyToAccount(`0x${privateKey}`)
  console.log('Redeploying from:', account.address)

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
  const BaseRegistrar = deployments.contracts.BaseRegistrar as `0x${string}`
  const StablePriceOracle = deployments.contracts.StablePriceOracle as `0x${string}`
  const DefaultReverseRegistrar = deployments.contracts.DefaultReverseRegistrar as `0x${string}`
  const PublicResolver = deployments.contracts.PublicResolver as `0x${string}`

  console.log('\nExisting deployments:')
  console.log('  ECNSRegistry:', ECNSRegistry)
  console.log('  BaseRegistrar:', BaseRegistrar)
  console.log('  StablePriceOracle:', StablePriceOracle)

  // 1. Deploy new ETCRegistrarController with ETC_NODE fix
  console.log('\n1. Deploying fixed ETCRegistrarController...')
  const controller = loadArtifact('etcregistrar/ETCRegistrarController.sol', 'ETCRegistrarController')
  const controllerHash = await walletClient.deployContract({
    abi: controller.abi,
    bytecode: controller.bytecode as `0x${string}`,
    args: [
      BaseRegistrar,
      StablePriceOracle,
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
  console.log('  New ETCRegistrarController deployed at:', newController)

  // 2. Add new controller to BaseRegistrar
  console.log('\n2. Adding new controller to BaseRegistrar...')
  const baseRegistrarAbi = loadArtifact('etcregistrar/BaseRegistrarImplementation.sol', 'BaseRegistrarImplementation').abi
  const addControllerHash = await walletClient.writeContract({
    address: BaseRegistrar,
    abi: baseRegistrarAbi,
    functionName: 'addController',
    args: [newController],
  })
  await publicClient.waitForTransactionReceipt({ hash: addControllerHash })
  console.log('  Done!')

  // 3. Deploy new PublicResolver with new controller as trusted
  console.log('\n3. Deploying new PublicResolver with new controller...')
  const publicResolver = loadArtifact('resolvers/PublicResolver.sol', 'PublicResolver')
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
  const resolverHash = await walletClient.deployContract({
    abi: publicResolver.abi,
    bytecode: publicResolver.bytecode as `0x${string}`,
    args: [
      ECNSRegistry,
      ZERO_ADDRESS, // nameWrapper (not used initially)
      newController,
      ReverseRegistrar,
    ],
  })
  console.log('  Transaction:', resolverHash)
  const resolverReceipt = await publicClient.waitForTransactionReceipt({ hash: resolverHash })
  const newResolver = resolverReceipt.contractAddress!
  console.log('  New PublicResolver deployed at:', newResolver)

  // 4. Set default resolver on ReverseRegistrar
  console.log('\n4. Updating default resolver on ReverseRegistrar...')
  const reverseRegistrarAbi = loadArtifact('reverseRegistrar/ReverseRegistrar.sol', 'ReverseRegistrar').abi
  const setResolverHash = await walletClient.writeContract({
    address: ReverseRegistrar,
    abi: reverseRegistrarAbi,
    functionName: 'setDefaultResolver',
    args: [newResolver],
  })
  await publicClient.waitForTransactionReceipt({ hash: setResolverHash })
  console.log('  Done!')

  // Update deployments
  deployments.contracts.ETCRegistrarController = newController
  deployments.contracts.PublicResolver = newResolver
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2))
  console.log('\nDeployments updated!')

  console.log('\n=== Updated Contract Addresses ===')
  console.log('ETCRegistrarController:', newController)
  console.log('PublicResolver:', newResolver)
  console.log('\n✓ Ready to test registration!')
}

main().catch(console.error)
