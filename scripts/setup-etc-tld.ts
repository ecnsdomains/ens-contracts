import { createWalletClient, createPublicClient, http, keccak256, toHex } from 'viem'
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

// ECNSRegistry ABI (minimal for setSubnodeOwner)
const registryAbi = [
  {
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'label', type: 'bytes32' },
      { name: 'owner', type: 'address' }
    ],
    name: 'setSubnodeOwner',
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'owner',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const

async function main() {
  const privateKey = process.env.DEPLOYER_KEY
  if (!privateKey) throw new Error('DEPLOYER_KEY not set')

  const account = privateKeyToAccount(`0x${privateKey}`)
  console.log('Using account:', account.address)

  const publicClient = createPublicClient({ chain: mordor, transport: http() })
  const walletClient = createWalletClient({ account, chain: mordor, transport: http() })

  // Load deployments
  const deployments = JSON.parse(fs.readFileSync(path.join(__dirname, '../deployments/mordor.json'), 'utf8'))
  console.log('ECNSRegistry:', deployments.ECNSRegistry)

  // Check root owner
  const rootNode = '0x0000000000000000000000000000000000000000000000000000000000000000'
  const rootOwner = await publicClient.readContract({
    address: deployments.ECNSRegistry as `0x${string}`,
    abi: registryAbi,
    functionName: 'owner',
    args: [rootNode as `0x${string}`]
  })
  console.log('Root node owner:', rootOwner)

  // Calculate .etc label hash
  const etcLabelHash = keccak256(toHex('etc'))
  console.log('.etc label hash:', etcLabelHash)

  // Set .etc subnode owner
  console.log('\nSetting up .etc TLD...')
  const hash = await walletClient.writeContract({
    address: deployments.ECNSRegistry as `0x${string}`,
    abi: registryAbi,
    functionName: 'setSubnodeOwner',
    args: [rootNode as `0x${string}`, etcLabelHash, account.address]
  })
  console.log('Transaction:', hash)

  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  console.log('Confirmed in block:', receipt.blockNumber)

  // Verify .etc is set up
  const etcNode = keccak256(
    Buffer.concat([
      Buffer.from(rootNode.slice(2), 'hex'),
      Buffer.from(etcLabelHash.slice(2), 'hex')
    ])
  )
  const etcOwner = await publicClient.readContract({
    address: deployments.ECNSRegistry as `0x${string}`,
    abi: registryAbi,
    functionName: 'owner',
    args: [etcNode as `0x${string}`]
  })
  console.log('\n.etc node:', etcNode)
  console.log('.etc owner:', etcOwner)
  console.log('\n✓ .etc TLD is ready!')
}

main().catch(console.error)
