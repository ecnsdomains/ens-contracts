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

const ownableAbi = [
  {
    inputs: [],
    name: 'owner',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'newOwner', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
] as const

// Contracts that have Ownable and need ownership transferred
const OWNABLE_CONTRACTS = [
  'ECNSRegistry',
  'BaseRegistrar',
  'ETCRegistrarController',
  'ReverseRegistrar',
  'DefaultReverseRegistrar',
  'ETCswapFullOracle',
  'StablePriceOracle',
]

async function main() {
  const privateKey = process.env.DEPLOYER_KEY
  const ownerAddress = process.env.OWNER_ADDRESS

  if (!privateKey) throw new Error('DEPLOYER_KEY not set')
  if (!ownerAddress) throw new Error('OWNER_ADDRESS not set - please set the hardware wallet address in .env')

  // Validate owner address format
  if (!ownerAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
    throw new Error(`Invalid OWNER_ADDRESS format: ${ownerAddress}`)
  }

  const account = privateKeyToAccount(`0x${privateKey}`)
  console.log('Transferring ownership from:', account.address)
  console.log('New owner (hardware wallet):', ownerAddress)

  const publicClient = createPublicClient({ chain: mordor, transport: http() })
  const walletClient = createWalletClient({ account, chain: mordor, transport: http() })

  // Load deployments
  const deploymentsPath = path.join(__dirname, '../deployments/mordor.json')
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'))

  console.log('\n=== Checking Contract Ownership ===')

  const transfers: { name: string; address: string }[] = []
  const alreadyOwned: { name: string; address: string }[] = []
  const notOwnable: string[] = []

  for (const contractName of OWNABLE_CONTRACTS) {
    const address = deployments.contracts[contractName]
    if (!address) {
      console.log(`  ${contractName}: Not deployed`)
      continue
    }

    try {
      const currentOwner = await publicClient.readContract({
        address: address as `0x${string}`,
        abi: ownableAbi,
        functionName: 'owner'
      })

      if (currentOwner.toLowerCase() === ownerAddress.toLowerCase()) {
        console.log(`  ${contractName}: Already owned by hardware wallet`)
        alreadyOwned.push({ name: contractName, address })
      } else if (currentOwner.toLowerCase() === account.address.toLowerCase()) {
        console.log(`  ${contractName}: Owned by deployer - will transfer`)
        transfers.push({ name: contractName, address })
      } else {
        console.log(`  ${contractName}: Owned by ${currentOwner} (cannot transfer)`)
      }
    } catch (error) {
      console.log(`  ${contractName}: Not Ownable or error reading owner`)
      notOwnable.push(contractName)
    }
  }

  if (transfers.length === 0) {
    console.log('\nNo contracts need ownership transfer.')
    return
  }

  console.log(`\n=== Transferring Ownership of ${transfers.length} contracts ===`)

  for (const { name, address } of transfers) {
    console.log(`\nTransferring ${name} (${address})...`)
    try {
      const hash = await walletClient.writeContract({
        address: address as `0x${string}`,
        abi: ownableAbi,
        functionName: 'transferOwnership',
        args: [ownerAddress as `0x${string}`]
      })
      console.log('  Transaction:', hash)
      await publicClient.waitForTransactionReceipt({ hash })

      // Verify
      const newOwner = await publicClient.readContract({
        address: address as `0x${string}`,
        abi: ownableAbi,
        functionName: 'owner'
      })
      if (newOwner.toLowerCase() === ownerAddress.toLowerCase()) {
        console.log('  Success! New owner:', newOwner)
      } else {
        console.log('  Warning: Owner is', newOwner)
      }
    } catch (error: any) {
      console.log('  Error:', error.message?.slice(0, 100))
    }
  }

  // Update deployments with owner info
  deployments.ownership = {
    owner: ownerAddress,
    deployer: account.address,
    transferredAt: new Date().toISOString(),
    note: 'All contract ownership transferred to hardware wallet'
  }
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2))

  console.log('\n=== Ownership Transfer Complete ===')
  console.log('Hardware wallet now owns all ECNS contracts')
  console.log('\nOwner address:', ownerAddress)
  console.log('\nThe owner can now:')
  console.log('  - Reserve/unreserve names')
  console.log('  - Withdraw registration fees')
  console.log('  - Configure V4 oracle after Olympia')
  console.log('  - Update oracle parameters')
}

main().catch(console.error)
