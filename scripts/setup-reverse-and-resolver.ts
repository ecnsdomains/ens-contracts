import { createWalletClient, createPublicClient, http, keccak256, toHex, namehash } from 'viem'
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

const ROOT_NODE = '0x0000000000000000000000000000000000000000000000000000000000000000'
const ADDR_REVERSE_NODE = '0x91d1777781884d03a6757a803996e38de2a42967fb37eeaca72729271025a9e2'

async function main() {
  const privateKey = process.env.DEPLOYER_KEY
  if (!privateKey) throw new Error('DEPLOYER_KEY not set')

  const account = privateKeyToAccount(`0x${privateKey}`)
  console.log('Using account:', account.address)

  const publicClient = createPublicClient({ chain: mordor, transport: http() })
  const walletClient = createWalletClient({ account, chain: mordor, transport: http() })

  // Load artifacts and deployments
  const artifactsDir = path.join(__dirname, '../artifacts/contracts')
  const loadArtifact = (contractPath: string, contractName: string) => {
    const artifactPath = path.join(artifactsDir, contractPath, `${contractName}.json`)
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  }

  const deploymentsPath = path.join(__dirname, '../deployments/mordor.json')
  const existingDeployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'))

  const ECNSRegistry = existingDeployments.contracts.ECNSRegistry as `0x${string}`
  const ReverseRegistrar = existingDeployments.contracts.ReverseRegistrar as `0x${string}`

  // Previously deployed contracts (from last run)
  const DummyOracle = '0x19bac4a58331667ad385688eee5a1b027c3c068f' as `0x${string}`
  const StablePriceOracle = '0xb51106e283a25abc0ef6611a1a822537a43ac948' as `0x${string}`
  const BaseRegistrar = '0x350a43aeeded00d968ebe03e9cdf0370a801abc2' as `0x${string}`
  const DefaultReverseRegistrar = '0x0fd55f88128cb48c28a737933349bb37182ad302' as `0x${string}`
  const ETCRegistrarController = '0x306f22da3cb165922af0c78acb4314d743fcb2d5' as `0x${string}`

  console.log('ECNSRegistry:', ECNSRegistry)
  console.log('ReverseRegistrar:', ReverseRegistrar)

  const registryAbi = loadArtifact('registry/ECNSRegistry.sol', 'ECNSRegistry').abi

  // Step 1: Set up reverse namespace
  console.log('\n1. Setting up reverse namespace...')

  // Create 'reverse' TLD
  const reverseLabelHash = keccak256(toHex('reverse'))
  console.log('  reverse label hash:', reverseLabelHash)

  // Check if reverse TLD exists
  const reverseNode = namehash('reverse')
  console.log('  reverse node:', reverseNode)

  const reverseOwner = await publicClient.readContract({
    address: ECNSRegistry,
    abi: registryAbi,
    functionName: 'owner',
    args: [reverseNode as `0x${string}`],
  })
  console.log('  Current reverse owner:', reverseOwner)

  if (reverseOwner === '0x0000000000000000000000000000000000000000') {
    console.log('  Creating reverse TLD...')
    const tx1 = await walletClient.writeContract({
      address: ECNSRegistry,
      abi: registryAbi,
      functionName: 'setSubnodeOwner',
      args: [ROOT_NODE as `0x${string}`, reverseLabelHash, account.address],
    })
    await publicClient.waitForTransactionReceipt({ hash: tx1 })
    console.log('  Done!')
  }

  // Create 'addr.reverse' subnode owned by ReverseRegistrar
  const addrLabelHash = keccak256(toHex('addr'))
  console.log('  addr label hash:', addrLabelHash)

  const addrReverseOwner = await publicClient.readContract({
    address: ECNSRegistry,
    abi: registryAbi,
    functionName: 'owner',
    args: [ADDR_REVERSE_NODE as `0x${string}`],
  })
  console.log('  Current addr.reverse owner:', addrReverseOwner)

  if (addrReverseOwner !== ReverseRegistrar) {
    console.log('  Setting addr.reverse owner to ReverseRegistrar...')
    const tx2 = await walletClient.writeContract({
      address: ECNSRegistry,
      abi: registryAbi,
      functionName: 'setSubnodeOwner',
      args: [reverseNode as `0x${string}`, addrLabelHash, ReverseRegistrar],
    })
    await publicClient.waitForTransactionReceipt({ hash: tx2 })
    console.log('  Done!')
  }

  // Step 2: Deploy PublicResolver
  console.log('\n2. Deploying PublicResolver...')
  const publicResolver = loadArtifact('resolvers/PublicResolver.sol', 'PublicResolver')
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

  const resolverHash = await walletClient.deployContract({
    abi: publicResolver.abi,
    bytecode: publicResolver.bytecode as `0x${string}`,
    args: [
      ECNSRegistry,
      ZERO_ADDRESS, // nameWrapper (not used initially)
      ETCRegistrarController,
      ReverseRegistrar,
    ],
  })
  console.log('  Transaction:', resolverHash)
  const resolverReceipt = await publicClient.waitForTransactionReceipt({ hash: resolverHash })
  const PublicResolver = resolverReceipt.contractAddress!
  console.log('  PublicResolver deployed at:', PublicResolver)

  // Step 3: Configure contracts
  console.log('\n3. Configuring contracts...')

  // Set .etc owner to BaseRegistrar
  const etcNode = existingDeployments.tld.node as `0x${string}`
  console.log('  Setting .etc owner to BaseRegistrar...')
  const setOwnerHash = await walletClient.writeContract({
    address: ECNSRegistry,
    abi: registryAbi,
    functionName: 'setOwner',
    args: [etcNode, BaseRegistrar],
  })
  await publicClient.waitForTransactionReceipt({ hash: setOwnerHash })
  console.log('  Done!')

  // Add ETCRegistrarController as controller on BaseRegistrar
  console.log('  Adding ETCRegistrarController as controller on BaseRegistrar...')
  const baseRegistrarAbi = loadArtifact('etcregistrar/BaseRegistrarImplementation.sol', 'BaseRegistrarImplementation').abi
  const addControllerHash = await walletClient.writeContract({
    address: BaseRegistrar,
    abi: baseRegistrarAbi,
    functionName: 'addController',
    args: [ETCRegistrarController],
  })
  await publicClient.waitForTransactionReceipt({ hash: addControllerHash })
  console.log('  Done!')

  // Set default resolver on ReverseRegistrar
  console.log('  Setting default resolver on ReverseRegistrar...')
  const reverseRegistrarAbi = loadArtifact('reverseRegistrar/ReverseRegistrar.sol', 'ReverseRegistrar').abi
  const setResolverHash = await walletClient.writeContract({
    address: ReverseRegistrar,
    abi: reverseRegistrarAbi,
    functionName: 'setDefaultResolver',
    args: [PublicResolver],
  })
  await publicClient.waitForTransactionReceipt({ hash: setResolverHash })
  console.log('  Done!')

  // Save updated deployments
  const updatedDeployments = {
    ...existingDeployments,
    contracts: {
      ECNSRegistry,
      ReverseRegistrar,
      DefaultReverseRegistrar,
      BaseRegistrar,
      DummyOracle,
      StablePriceOracle,
      ETCRegistrarController,
      PublicResolver,
    },
    reverse: {
      node: reverseNode,
      addrReverseNode: ADDR_REVERSE_NODE,
    },
    pricing: {
      oracle: 'DummyOracle',
      etcPriceUSD: 20,
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
  console.log('ECNSRegistry:', ECNSRegistry)
  console.log('ReverseRegistrar:', ReverseRegistrar)
  console.log('DefaultReverseRegistrar:', DefaultReverseRegistrar)
  console.log('BaseRegistrar:', BaseRegistrar)
  console.log('DummyOracle:', DummyOracle)
  console.log('StablePriceOracle:', StablePriceOracle)
  console.log('ETCRegistrarController:', ETCRegistrarController)
  console.log('PublicResolver:', PublicResolver)
  console.log('\n✓ ECNS is ready for .etc name registration!')
}

main().catch(console.error)
