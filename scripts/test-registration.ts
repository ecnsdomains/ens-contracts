import { createWalletClient, createPublicClient, http, keccak256, toHex, namehash, parseEther } from 'viem'
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

// Controller ABI - uses Registration struct
const controllerAbi = [
  {
    inputs: [
      {
        components: [
          { name: 'label', type: 'string' },
          { name: 'owner', type: 'address' },
          { name: 'duration', type: 'uint256' },
          { name: 'secret', type: 'bytes32' },
          { name: 'resolver', type: 'address' },
          { name: 'data', type: 'bytes[]' },
          { name: 'reverseRecord', type: 'uint8' },
          { name: 'referrer', type: 'bytes32' }
        ],
        name: 'registration',
        type: 'tuple'
      }
    ],
    name: 'makeCommitment',
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'pure',
    type: 'function'
  },
  {
    inputs: [{ name: 'commitment', type: 'bytes32' }],
    name: 'commit',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      {
        components: [
          { name: 'label', type: 'string' },
          { name: 'owner', type: 'address' },
          { name: 'duration', type: 'uint256' },
          { name: 'secret', type: 'bytes32' },
          { name: 'resolver', type: 'address' },
          { name: 'data', type: 'bytes[]' },
          { name: 'reverseRecord', type: 'uint8' },
          { name: 'referrer', type: 'bytes32' }
        ],
        name: 'registration',
        type: 'tuple'
      }
    ],
    name: 'register',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  },
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
  },
  {
    inputs: [{ name: 'name', type: 'string' }],
    name: 'available',
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const

const registryAbi = [
  {
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'owner',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'resolver',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const

async function main() {
  const privateKey = process.env.DEPLOYER_KEY
  if (!privateKey) throw new Error('DEPLOYER_KEY not set')

  const account = privateKeyToAccount(`0x${privateKey}`)
  console.log('Testing with account:', account.address)

  const publicClient = createPublicClient({ chain: mordor, transport: http() })
  const walletClient = createWalletClient({ account, chain: mordor, transport: http() })

  // Load deployments
  const deploymentsPath = path.join(__dirname, '../deployments/mordor.json')
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'))

  const ECNSRegistry = deployments.contracts.ECNSRegistry as `0x${string}`
  const ETCRegistrarController = deployments.contracts.ETCRegistrarController as `0x${string}`
  const PublicResolver = deployments.contracts.PublicResolver as `0x${string}`

  console.log('ECNSRegistry:', ECNSRegistry)
  console.log('ETCRegistrarController:', ETCRegistrarController)
  console.log('PublicResolver:', PublicResolver)

  // Test name
  const testLabel = 'testname' + Math.floor(Date.now() / 1000)
  const duration = BigInt(365 * 24 * 60 * 60) // 1 year
  const secret = keccak256(toHex('random-secret-' + Date.now()))
  const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`

  console.log('\n=== Testing ECNS Registration ===')
  console.log('Name:', testLabel + '.etc')

  // Check availability
  console.log('\n1. Checking availability...')
  const isAvailable = await publicClient.readContract({
    address: ETCRegistrarController,
    abi: controllerAbi,
    functionName: 'available',
    args: [testLabel]
  })
  console.log('  Available:', isAvailable)

  if (!isAvailable) {
    console.error('Name not available!')
    return
  }

  // Get price
  console.log('\n2. Getting price...')
  const price = await publicClient.readContract({
    address: ETCRegistrarController,
    abi: controllerAbi,
    functionName: 'rentPrice',
    args: [testLabel, duration]
  })
  console.log('  Base price:', Number(price.base) / 1e18, 'ETC')
  console.log('  Premium:', Number(price.premium) / 1e18, 'ETC')
  const totalPrice = price.base + price.premium
  console.log('  Total:', Number(totalPrice) / 1e18, 'ETC')

  // Build Registration struct
  const registration = {
    label: testLabel,
    owner: account.address,
    duration: duration,
    secret: secret,
    resolver: PublicResolver,
    data: [] as `0x${string}`[],
    reverseRecord: 0,
    referrer: ZERO_BYTES32
  }

  // Make commitment
  console.log('\n3. Making commitment...')
  const commitment = await publicClient.readContract({
    address: ETCRegistrarController,
    abi: controllerAbi,
    functionName: 'makeCommitment',
    args: [registration]
  })
  console.log('  Commitment:', commitment)

  // Submit commitment
  console.log('\n4. Submitting commitment...')
  const commitHash = await walletClient.writeContract({
    address: ETCRegistrarController,
    abi: controllerAbi,
    functionName: 'commit',
    args: [commitment]
  })
  console.log('  Transaction:', commitHash)
  await publicClient.waitForTransactionReceipt({ hash: commitHash })
  console.log('  Committed!')

  // Wait for minCommitmentAge (60 seconds) + buffer for ETC's 13-14s block time
  console.log('\n5. Waiting 90 seconds for commitment to mature (ETC has 13-14s blocks)...')
  await new Promise(resolve => setTimeout(resolve, 90000))
  console.log('  Done waiting!')

  // Register
  console.log('\n6. Registering name...')
  const registerHash = await walletClient.writeContract({
    address: ETCRegistrarController,
    abi: controllerAbi,
    functionName: 'register',
    args: [registration],
    value: totalPrice + parseEther('0.01') // add buffer for gas fluctuation
  })
  console.log('  Transaction:', registerHash)
  const registerReceipt = await publicClient.waitForTransactionReceipt({ hash: registerHash })
  console.log('  Registered! Gas used:', registerReceipt.gasUsed)

  // Verify ownership
  console.log('\n7. Verifying ownership...')
  const fullName = testLabel + '.etc'
  const node = namehash(fullName)
  console.log('  Node:', node)

  const owner = await publicClient.readContract({
    address: ECNSRegistry,
    abi: registryAbi,
    functionName: 'owner',
    args: [node as `0x${string}`]
  })
  console.log('  Owner:', owner)

  const resolver = await publicClient.readContract({
    address: ECNSRegistry,
    abi: registryAbi,
    functionName: 'resolver',
    args: [node as `0x${string}`]
  })
  console.log('  Resolver:', resolver)

  if (owner === account.address) {
    console.log('\n✓ SUCCESS! Name', fullName, 'registered to', account.address)
  } else {
    console.log('\n✗ FAILED! Owner mismatch')
  }
}

main().catch(console.error)
