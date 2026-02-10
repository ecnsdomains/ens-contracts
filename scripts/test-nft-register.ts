/**
 * Complete the registration from a prior commitment, then check tokenURI
 */
import { createWalletClient, createPublicClient, http, keccak256, toHex, labelhash } from 'viem'
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
  const publicClient = createPublicClient({ chain: mordor, transport: http() })
  const walletClient = createWalletClient({ account, chain: mordor, transport: http() })

  const deploymentsPath = path.join(__dirname, '../deployments/mordor.json')
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'))
  const controller = deployments.contracts.ETCRegistrarController as `0x${string}`
  const baseRegistrar = deployments.contracts.BaseRegistrar as `0x${string}`
  const resolver = deployments.contracts.PublicResolver as `0x${string}`

  const artifactsDir = path.join(__dirname, '../artifacts/contracts')
  const controllerAbi = JSON.parse(
    fs.readFileSync(path.join(artifactsDir, 'etcregistrar/ETCRegistrarController.sol/ETCRegistrarController.json'), 'utf8')
  ).abi
  const baseAbi = JSON.parse(
    fs.readFileSync(path.join(artifactsDir, 'etcregistrar/BaseRegistrarImplementation.sol/BaseRegistrarImplementation.json'), 'utf8')
  ).abi

  const name = process.argv[2] || 'holographic'
  const duration = BigInt(365 * 24 * 60 * 60)
  // Same secret as the commitment that was already made
  const secret = keccak256(toHex('test-secret-123'))
  const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`

  const registration = {
    label: name,
    owner: account.address,
    duration,
    secret,
    resolver,
    data: [] as `0x${string}`[],
    reverseRecord: 0,
    referrer: ZERO_BYTES32,
  }

  // Get price
  const price = await publicClient.readContract({
    address: controller,
    abi: controllerAbi,
    functionName: 'rentPrice',
    args: [name, duration],
  }) as { base: bigint; premium: bigint }
  const totalPrice = price.base + price.premium
  console.log(`Registering "${name}.etc" - Price: ${Number(totalPrice) / 1e18} METC`)

  // Register (using existing commitment)
  const registerTx = await walletClient.writeContract({
    address: controller,
    abi: controllerAbi,
    functionName: 'register',
    args: [registration],
    value: totalPrice + totalPrice / 10n,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: registerTx })
  console.log('Registered! Tx:', receipt.transactionHash)

  // Get tokenId and tokenURI
  const tokenId = BigInt(labelhash(name))
  console.log('TokenId:', tokenId.toString())

  const tokenURI = await publicClient.readContract({
    address: baseRegistrar,
    abi: baseAbi,
    functionName: 'tokenURI',
    args: [tokenId],
  }) as string

  console.log('\n=== TOKEN URI ===')
  console.log('Length:', tokenURI.length)

  // Decode
  const jsonBase64 = tokenURI.replace('data:application/json;base64,', '')
  const json = JSON.parse(Buffer.from(jsonBase64, 'base64').toString())

  console.log('\n=== METADATA ===')
  console.log('Name:', json.name)
  console.log('Attributes:', JSON.stringify(json.attributes, null, 2))

  // Save SVG
  const svgBase64 = json.image.replace('data:image/svg+xml;base64,', '')
  const svg = Buffer.from(svgBase64, 'base64').toString()

  const svgPath = path.join(__dirname, `../svg-prototype/test-output-${name}.svg`)
  fs.writeFileSync(svgPath, svg)
  console.log(`\nSVG saved to: ${svgPath}`)
  console.log('Status:', svg.includes('???') ? 'UNREVEALED' : 'REVEALED')
}

main().catch(console.error)
