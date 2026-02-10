/**
 * Transfer ownership back to deployer for development
 * This is temporary - will transfer to hardware wallet before mainnet
 */

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

// All Ownable contracts
const OWNABLE_CONTRACTS = [
  'BaseRegistrar',
  'ETCRegistrarController',
  'ReverseRegistrar',
  'DefaultReverseRegistrar',
  'ETCswapFullOracle',
]

async function main() {
  // For this script, we need the OWNER private key (hardware wallet)
  // Since that's not available, we'll output instructions instead

  const deployerKey = process.env.DEPLOYER_KEY
  if (!deployerKey) throw new Error('DEPLOYER_KEY not set')

  const deployer = privateKeyToAccount(`0x${deployerKey}`)

  const publicClient = createPublicClient({ chain: mordor, transport: http() })

  // Load deployments
  const deploymentsPath = path.join(__dirname, '../deployments/mordor.json')
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'))

  const currentOwner = deployments.ownership?.owner
  const deployerAddress = deployer.address

  console.log('=== Transfer Ownership to Deployer (for development) ===')
  console.log('')
  console.log('Current owner (hardware wallet):', currentOwner)
  console.log('New owner (deployer):           ', deployerAddress)
  console.log('')

  // Check current ownership
  console.log('Current contract ownership:')
  for (const name of OWNABLE_CONTRACTS) {
    const address = deployments.contracts[name]
    if (!address) continue

    try {
      const owner = await publicClient.readContract({
        address: address as `0x${string}`,
        abi: ownableAbi,
        functionName: 'owner'
      })
      const isHardware = owner.toLowerCase() === currentOwner?.toLowerCase()
      const isDeployer = owner.toLowerCase() === deployerAddress.toLowerCase()
      console.log(`  ${name}: ${isDeployer ? 'deployer ✓' : isHardware ? 'hardware wallet (needs transfer)' : owner}`)
    } catch {
      console.log(`  ${name}: not Ownable`)
    }
  }

  console.log('')
  console.log('To transfer ownership back to deployer, the hardware wallet must sign.')
  console.log('Run these transactions from your hardware wallet:')
  console.log('')

  for (const name of OWNABLE_CONTRACTS) {
    const address = deployments.contracts[name]
    if (!address) continue

    try {
      const owner = await publicClient.readContract({
        address: address as `0x${string}`,
        abi: ownableAbi,
        functionName: 'owner'
      })
      if (owner.toLowerCase() === currentOwner?.toLowerCase()) {
        console.log(`${name} (${address}):`)
        console.log(`  transferOwnership("${deployerAddress}")`)
        console.log('')
      }
    } catch {}
  }
}

main().catch(console.error)
