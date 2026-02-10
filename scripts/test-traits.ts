/**
 * Register multiple test names and verify trait system.
 * Usage: source .env && export DEPLOYER_KEY && npx tsx scripts/test-traits.ts
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

const TEST_NAMES = [
  'alice',    // 5 chars, Pure Alpha, Fluent, Standard → Rare
  'abc',      // 3 chars, Pure Alpha, Sequential → Legendary
  'aba',      // 3 chars, Pure Alpha, Palindrome → Legendary
  'h4x0r',   // Leetspeak (haxor), Ultra Rare
  'n00b',    // Leetspeak (noob), Ultra Rare
  'ab',       // 2 chars, Ultra Rare
  'aaa',      // 3 chars, Repeating → Legendary
  'ethereum', // 8 chars, Uncommon
]

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

  const balance = await publicClient.getBalance({ address: account.address })
  console.log('Balance:', Number(balance) / 1e18, 'METC')

  const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`
  const duration = BigInt(365 * 24 * 60 * 60)

  // Phase 1: Commit all names
  console.log('\n=== Phase 1: Committing names ===')
  const secrets: Record<string, `0x${string}`> = {}

  for (const name of TEST_NAMES) {
    const secret = keccak256(toHex(`test-trait-${name}-${Date.now()}`))
    secrets[name] = secret

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

    try {
      const commitment = await publicClient.readContract({
        address: controller,
        abi: controllerAbi,
        functionName: 'makeCommitment',
        args: [registration],
      }) as `0x${string}`

      const tx = await walletClient.writeContract({
        address: controller,
        abi: controllerAbi,
        functionName: 'commit',
        args: [commitment],
      })
      await publicClient.waitForTransactionReceipt({ hash: tx })
      console.log(`  Committed: ${name}`)
    } catch (e: any) {
      console.log(`  Skip ${name}: ${e.message?.slice(0, 60)}`)
    }
  }

  // Wait for commitment age
  console.log('\nWaiting 90s for commitment age...')
  await new Promise(r => setTimeout(r, 90000))

  // Phase 2: Register all names
  console.log('\n=== Phase 2: Registering names ===')
  for (const name of TEST_NAMES) {
    const registration = {
      label: name,
      owner: account.address,
      duration,
      secret: secrets[name],
      resolver,
      data: [] as `0x${string}`[],
      reverseRecord: 0,
      referrer: ZERO_BYTES32,
    }

    try {
      const price = await publicClient.readContract({
        address: controller,
        abi: controllerAbi,
        functionName: 'rentPrice',
        args: [name, duration],
      }) as { base: bigint; premium: bigint }
      const totalPrice = price.base + price.premium

      const tx = await walletClient.writeContract({
        address: controller,
        abi: controllerAbi,
        functionName: 'register',
        args: [registration],
        value: totalPrice + totalPrice / 10n,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx })
      console.log(`  Registered: ${name}.etc (${Number(totalPrice) / 1e18} METC)`)
    } catch (e: any) {
      console.log(`  Failed ${name}: ${e.message?.slice(0, 80)}`)
    }
  }

  // Phase 3: Check tokenURIs
  console.log('\n=== Phase 3: Checking traits ===')
  console.log('─'.repeat(80))

  for (const name of TEST_NAMES) {
    const tokenId = BigInt(labelhash(name))

    try {
      const tokenURI = await publicClient.readContract({
        address: baseRegistrar,
        abi: baseAbi,
        functionName: 'tokenURI',
        args: [tokenId],
      }) as string

      const jsonBase64 = tokenURI.replace('data:application/json;base64,', '')
      const json = JSON.parse(Buffer.from(jsonBase64, 'base64').toString())

      const attrs: Record<string, any> = {}
      for (const a of json.attributes) {
        attrs[a.trait_type] = a.value
      }

      console.log(`\n${name}.etc`)
      console.log(`  Tier: ${attrs['Tier']}`)
      console.log(`  Length: ${attrs['Name Length']}`)
      console.log(`  Class: ${attrs['Character Class']}`)
      console.log(`  Fluency: ${attrs['Fluency']}`)
      console.log(`  Pattern: ${attrs['Pattern']}`)
      console.log(`  Chain: ${attrs['Chain']}`)
      console.log(`  Expires: ${new Date(attrs['Registration Expires'] * 1000).toISOString().split('T')[0]}`)

      // Save SVG
      const svgBase64 = json.image.replace('data:image/svg+xml;base64,', '')
      const svg = Buffer.from(svgBase64, 'base64').toString()
      const svgPath = path.join(__dirname, `../svg-prototype/test-output-${name}.svg`)
      fs.writeFileSync(svgPath, svg)
    } catch (e: any) {
      console.log(`\n${name}.etc → ERROR: ${e.message?.slice(0, 80)}`)
    }
  }

  console.log('\n─'.repeat(80))
  console.log('SVGs saved to svg-prototype/test-output-*.svg')
}

main().catch(console.error)
