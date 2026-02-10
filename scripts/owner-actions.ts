/**
 * Owner Actions for ECNS
 *
 * These are transactions that must be signed by the hardware wallet owner.
 * Run this script to get the transaction data, then sign with your hardware wallet.
 *
 * Usage: npx tsx scripts/owner-actions.ts <action>
 *
 * Actions:
 *   add-controller <address>  - Add a new controller to BaseRegistrar
 *   reserve-names             - Reserve all names from config
 *   withdraw                  - Withdraw fees from controller
 */

import { createPublicClient, http, encodeFunctionData } from 'viem'
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

const baseRegistrarAbi = [
  {
    inputs: [{ name: 'controller', type: 'address' }],
    name: 'addController',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
] as const

const controllerAbi = [
  {
    inputs: [],
    name: 'withdraw',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: 'labels', type: 'string[]' }],
    name: 'reserveNames',
    outputs: [],
    stateMutability: 'nonpayable',
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

async function main() {
  const action = process.argv[2]
  const arg = process.argv[3]

  // Load deployments
  const deploymentsPath = path.join(__dirname, '../deployments/mordor.json')
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'))

  const ownerAddress = deployments.ownership?.owner
  const BaseRegistrar = deployments.contracts.BaseRegistrar as `0x${string}`
  const Controller = deployments.contracts.ETCRegistrarController as `0x${string}`

  console.log('=== ECNS Owner Actions ===')
  console.log('Owner (hardware wallet):', ownerAddress)
  console.log('Network: Mordor (chainId 63)')
  console.log('')

  if (!action) {
    console.log('Usage: npx tsx scripts/owner-actions.ts <action> [args]')
    console.log('')
    console.log('Actions:')
    console.log('  add-controller <address>  - Add controller to BaseRegistrar')
    console.log('  transfer-ownership <contract> <newOwner> - Transfer ownership')
    console.log('  withdraw                  - Withdraw fees from controller')
    console.log('  show-pending              - Show pending transactions')
    return
  }

  if (action === 'add-controller') {
    const controllerToAdd = arg as `0x${string}`
    if (!controllerToAdd) {
      console.log('Usage: npx tsx scripts/owner-actions.ts add-controller <address>')
      return
    }

    const data = encodeFunctionData({
      abi: baseRegistrarAbi,
      functionName: 'addController',
      args: [controllerToAdd]
    })

    console.log('=== Add Controller Transaction ===')
    console.log('')
    console.log('Sign this transaction with your hardware wallet:')
    console.log('')
    console.log('  To:       ', BaseRegistrar)
    console.log('  From:     ', ownerAddress)
    console.log('  Value:    ', '0')
    console.log('  Data:     ', data)
    console.log('')
    console.log('Function: addController(', controllerToAdd, ')')
    console.log('')
    console.log('You can use:')
    console.log('  - MyEtherWallet with hardware wallet')
    console.log('  - Rabby with hardware wallet')
    console.log('  - cast send (foundry) with hardware wallet')
    console.log('')
    console.log('Example with cast:')
    console.log(`  cast send ${BaseRegistrar} "${data}" --rpc-url https://rpc.mordor.etccooperative.org --ledger`)
  }

  if (action === 'transfer-ownership') {
    const contract = arg as `0x${string}`
    const newOwner = process.argv[4] as `0x${string}`

    if (!contract || !newOwner) {
      console.log('Usage: npx tsx scripts/owner-actions.ts transfer-ownership <contract> <newOwner>')
      return
    }

    const data = encodeFunctionData({
      abi: controllerAbi,
      functionName: 'transferOwnership',
      args: [newOwner]
    })

    console.log('=== Transfer Ownership Transaction ===')
    console.log('')
    console.log('  To:       ', contract)
    console.log('  From:     ', ownerAddress)
    console.log('  Value:    ', '0')
    console.log('  Data:     ', data)
    console.log('')
    console.log('Function: transferOwnership(', newOwner, ')')
  }

  if (action === 'withdraw') {
    const data = encodeFunctionData({
      abi: controllerAbi,
      functionName: 'withdraw',
      args: []
    })

    console.log('=== Withdraw Fees Transaction ===')
    console.log('')
    console.log('  To:       ', Controller)
    console.log('  From:     ', ownerAddress)
    console.log('  Value:    ', '0')
    console.log('  Data:     ', data)
    console.log('')
    console.log('Function: withdraw()')
  }

  if (action === 'show-pending') {
    console.log('=== Pending Owner Actions ===')
    console.log('')

    // New controller that needs to be added
    const newController = '0xb9c1e95d9e87a9837f3edce90c074b6339dbecac'
    const newOracle = '0x66662f994be69b5d2ccf7d739fdc856c676e66a0'

    console.log('1. Add new controller to BaseRegistrar:')
    console.log('   npx tsx scripts/owner-actions.ts add-controller', newController)
    console.log('')
    console.log('2. After adding controller, update deployments and reserve names')
    console.log('')
    console.log('New contracts deployed (need integration):')
    console.log('  - ExponentialPremiumPriceOracle:', newOracle)
    console.log('  - ETCRegistrarController (v3):', newController)
  }
}

main().catch(console.error)
