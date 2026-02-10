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

interface ReservedNamesConfig {
  version: string
  categories: {
    [key: string]: {
      description: string
      names: string[]
    }
  }
}

const controllerAbi = [
  {
    inputs: [{ name: 'labels', type: 'string[]' }],
    name: 'reserveNames',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: 'label', type: 'string' }],
    name: 'isReserved',
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'label', type: 'string' }],
    name: 'available',
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const

async function main() {
  const privateKey = process.env.DEPLOYER_KEY
  if (!privateKey) throw new Error('DEPLOYER_KEY not set')

  // Load config
  const configPath = path.join(__dirname, '../config/reserved-names.json')
  const config: ReservedNamesConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))

  // Flatten all names from all categories, dedupe
  const allNames = new Set<string>()
  const categoryStats: { [key: string]: number } = {}

  for (const [category, data] of Object.entries(config.categories)) {
    categoryStats[category] = data.names.length
    for (const name of data.names) {
      allNames.add(name.toLowerCase())
    }
  }

  const RESERVED_NAMES = Array.from(allNames).sort()

  console.log('=== Reserved Names Configuration ===')
  console.log(`Version: ${config.version}`)
  console.log(`\nCategories:`)
  for (const [category, count] of Object.entries(categoryStats)) {
    console.log(`  ${category}: ${count} names`)
  }
  console.log(`\nTotal unique names: ${RESERVED_NAMES.length}`)

  const account = privateKeyToAccount(`0x${privateKey}`)
  console.log('\nReserving names from:', account.address)

  const publicClient = createPublicClient({ chain: mordor, transport: http() })
  const walletClient = createWalletClient({ account, chain: mordor, transport: http() })

  // Load deployments
  const deploymentsPath = path.join(__dirname, '../deployments/mordor.json')
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'))
  const controller = deployments.contracts.ETCRegistrarController as `0x${string}`

  console.log('\nETCRegistrarController:', controller)

  // Check which names are already reserved
  console.log('\nChecking existing reservations...')
  const toReserve: string[] = []
  const alreadyReserved: string[] = []

  for (const name of RESERVED_NAMES) {
    try {
      const isReserved = await publicClient.readContract({
        address: controller,
        abi: controllerAbi,
        functionName: 'isReserved',
        args: [name]
      })
      if (isReserved) {
        alreadyReserved.push(name)
      } else {
        toReserve.push(name)
      }
    } catch {
      toReserve.push(name)
    }
  }

  console.log(`  Already reserved: ${alreadyReserved.length}`)
  console.log(`  To reserve: ${toReserve.length}`)

  if (toReserve.length === 0) {
    console.log('\nAll names already reserved!')
    return
  }

  // Reserve names in batches to avoid gas limits
  const BATCH_SIZE = 20
  console.log(`\nReserving ${toReserve.length} names in batches of ${BATCH_SIZE}...`)

  for (let i = 0; i < toReserve.length; i += BATCH_SIZE) {
    const batch = toReserve.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(toReserve.length / BATCH_SIZE)
    console.log(`\nBatch ${batchNum}/${totalBatches}: ${batch.length} names`)

    try {
      const hash = await walletClient.writeContract({
        address: controller,
        abi: controllerAbi,
        functionName: 'reserveNames',
        args: [batch],
      })
      console.log('  Transaction:', hash)
      await publicClient.waitForTransactionReceipt({ hash })
      console.log('  Done!')
    } catch (error: any) {
      console.log('  Error:', error.message?.slice(0, 100))
      console.log('  Names:', batch.join(', '))
    }
  }

  // Verify some reserved names
  console.log('\n=== Verification ===')
  const testNames = ['etc', 'ecns', 'wallet', 'bitcoin', 'metamask', 'support', 'testname123']
  for (const name of testNames) {
    try {
      const isReserved = await publicClient.readContract({
        address: controller,
        abi: controllerAbi,
        functionName: 'isReserved',
        args: [name]
      })
      const isAvailable = await publicClient.readContract({
        address: controller,
        abi: controllerAbi,
        functionName: 'available',
        args: [name]
      })
      console.log(`  ${name}.etc: reserved=${isReserved}, available=${isAvailable}`)
    } catch (error: any) {
      console.log(`  ${name}.etc: error - ${error.message?.slice(0, 50)}`)
    }
  }

  // Update deployments with reserved names info
  deployments.reservedNames = {
    configVersion: config.version,
    totalCount: RESERVED_NAMES.length,
    categories: Object.keys(config.categories),
    configFile: 'config/reserved-names.json',
    note: 'Reserved names cannot be registered. Owner can unreserve via unreserveName()'
  }
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2))

  console.log('\n=== Reserved Names Setup Complete ===')
  console.log(`Total reserved: ${RESERVED_NAMES.length}`)
  console.log(`Config file: config/reserved-names.json`)
  console.log('\nTo add more names:')
  console.log('  1. Edit config/reserved-names.json')
  console.log('  2. Run: npx tsx scripts/reserve-names.ts')
}

main().catch(console.error)
