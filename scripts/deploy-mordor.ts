import { createWalletClient, createPublicClient, http, parseEther, keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { namehash } from 'viem/ens'
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
  rpcUrls: {
    default: { http: ['https://rpc.mordor.etccooperative.org'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://etc.blockscout.com/mordor' },
  },
  testnet: true,
} as const

async function main() {
  const privateKey = process.env.DEPLOYER_KEY
  if (!privateKey) {
    throw new Error('DEPLOYER_KEY not set in environment')
  }

  const account = privateKeyToAccount(`0x${privateKey}`)
  console.log('Deploying from:', account.address)

  const publicClient = createPublicClient({
    chain: mordor,
    transport: http(),
  })

  const walletClient = createWalletClient({
    account,
    chain: mordor,
    transport: http(),
  })

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address })
  console.log('Balance:', Number(balance) / 1e18, 'ETC')

  // Load compiled artifacts
  const artifactsDir = path.join(__dirname, '../artifacts/contracts')

  const loadArtifact = (contractPath: string, contractName: string) => {
    const artifactPath = path.join(artifactsDir, contractPath, `${contractName}.json`)
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
    return artifact
  }

  const deployments: Record<string, string> = {}

  // 1. Deploy ECNSRegistry
  console.log('\n1. Deploying ECNSRegistry...')
  const ecnsRegistry = loadArtifact('registry/ECNSRegistry.sol', 'ECNSRegistry')
  const registryHash = await walletClient.deployContract({
    abi: ecnsRegistry.abi,
    bytecode: ecnsRegistry.bytecode as `0x${string}`,
  })
  console.log('  Transaction:', registryHash)
  const registryReceipt = await publicClient.waitForTransactionReceipt({ hash: registryHash })
  deployments.ECNSRegistry = registryReceipt.contractAddress!
  console.log('  ECNSRegistry deployed at:', deployments.ECNSRegistry)

  // 2. Deploy ReverseRegistrar
  console.log('\n2. Deploying ReverseRegistrar...')
  const reverseRegistrar = loadArtifact('reverseRegistrar/ReverseRegistrar.sol', 'ReverseRegistrar')
  const reverseHash = await walletClient.deployContract({
    abi: reverseRegistrar.abi,
    bytecode: reverseRegistrar.bytecode as `0x${string}`,
    args: [deployments.ECNSRegistry],
  })
  console.log('  Transaction:', reverseHash)
  const reverseReceipt = await publicClient.waitForTransactionReceipt({ hash: reverseHash })
  deployments.ReverseRegistrar = reverseReceipt.contractAddress!
  console.log('  ReverseRegistrar deployed at:', deployments.ReverseRegistrar)

  // 3. Deploy PublicResolver
  console.log('\n3. Deploying PublicResolver...')
  const publicResolver = loadArtifact('resolvers/PublicResolver.sol', 'PublicResolver')
  const resolverHash = await walletClient.deployContract({
    abi: publicResolver.abi,
    bytecode: publicResolver.bytecode as `0x${string}`,
    args: [
      deployments.ECNSRegistry,
      '0x0000000000000000000000000000000000000000', // wrapper (not used initially)
      account.address, // trusted controller
      deployments.ReverseRegistrar,
    ],
  })
  console.log('  Transaction:', resolverHash)
  const resolverReceipt = await publicClient.waitForTransactionReceipt({ hash: resolverHash })
  deployments.PublicResolver = resolverReceipt.contractAddress!
  console.log('  PublicResolver deployed at:', deployments.PublicResolver)

  // Save deployments
  const deploymentsPath = path.join(__dirname, '../deployments/mordor.json')
  fs.mkdirSync(path.dirname(deploymentsPath), { recursive: true })
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2))
  console.log('\nDeployments saved to:', deploymentsPath)

  // Set up .etc TLD
  console.log('\n4. Setting up .etc TLD...')
  const etcNode = namehash('etc')
  console.log('  .etc namehash:', etcNode)

  // The registry constructor sets deployer as owner of root
  // Set .etc subnode owner to deployer
  const etcLabelHash = keccak256(toHex('etc'))
  console.log('  .etc label hash:', etcLabelHash)
  const setSubnodeHash = await walletClient.writeContract({
    address: deployments.ECNSRegistry as `0x${string}`,
    abi: ecnsRegistry.abi,
    functionName: 'setSubnodeOwner',
    args: [
      '0x0000000000000000000000000000000000000000000000000000000000000000', // root
      etcLabelHash, // keccak256('etc')
      account.address,
    ],
  })
  console.log('  setSubnodeOwner tx:', setSubnodeHash)
  await publicClient.waitForTransactionReceipt({ hash: setSubnodeHash })
  console.log('  .etc TLD created!')

  console.log('\n=== Deployment Summary ===')
  console.log('Network: Mordor (chainId 63)')
  console.log('ECNSRegistry:', deployments.ECNSRegistry)
  console.log('ReverseRegistrar:', deployments.ReverseRegistrar)
  console.log('PublicResolver:', deployments.PublicResolver)
}

main().catch(console.error)
