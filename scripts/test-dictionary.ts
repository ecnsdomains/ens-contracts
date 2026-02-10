/**
 * Test the dictionary-based leetspeak detection system.
 * Checks existing names + registers new test names to verify tier parity.
 *
 * Usage: source .env && export DEPLOYER_KEY && npx tsx scripts/test-dictionary.ts
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

// Names already registered from previous test runs
const EXISTING_NAMES = ['alice', 'h4x0r', 'n00b', 'aba', 'aaa']

// New names to register and test
const NEW_NAMES = [
  '31337',   // iconic leet "eleet" → Ultra Rare (iconic override)
  '80085',   // iconic leet "boobs" → Ultra Rare (iconic override)
  '43770',   // calculator leet "hello" → Ultra Rare (iconic override, Map B)
  'b4d',     // leet "bad" → Legendary (3 chars, NOT iconic)
  'str0ng',  // leet "strong" → Rare (6 chars, NOT iconic)
  '42069',   // NOT leet (decoded "a2o69" has digits) → Numeric
  '12345',   // NOT leet (decoded "l2eas" has digit) → Numeric
  'ph34r',   // iconic leet "phear" → Ultra Rare
  'classic', // 7 chars, Pure Alpha → Rare
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
  const dictionaryAddr = deployments.contracts.ECNSWordDictionary as `0x${string}`

  const artifactsDir = path.join(__dirname, '../artifacts/contracts')
  const controllerAbi = JSON.parse(
    fs.readFileSync(path.join(artifactsDir, 'etcregistrar/ETCRegistrarController.sol/ETCRegistrarController.json'), 'utf8')
  ).abi
  const baseAbi = JSON.parse(
    fs.readFileSync(path.join(artifactsDir, 'etcregistrar/BaseRegistrarImplementation.sol/BaseRegistrarImplementation.json'), 'utf8')
  ).abi
  const dictAbi = JSON.parse(
    fs.readFileSync(path.join(artifactsDir, 'nft/ECNSWordDictionary.sol/ECNSWordDictionary.json'), 'utf8')
  ).abi

  const balance = await publicClient.getBalance({ address: account.address })
  console.log('Balance:', Number(balance) / 1e18, 'METC')
  console.log('Dictionary:', dictionaryAddr)
  console.log('Renderer:', deployments.contracts.ECNSMetadataRenderer)

  // =========================================================================
  // Phase 1: Quick dictionary check
  // =========================================================================
  console.log('\n=== Dictionary Checks ===')
  const wordChecks = ['leet', 'eleet', 'hacker', 'haxor', 'noob', 'hello', 'strong', 'bad', 'phear', 'boobs']
  for (const w of wordChecks) {
    const isWord = await publicClient.readContract({
      address: dictionaryAddr, abi: dictAbi, functionName: 'isWord', args: [w],
    })
    console.log(`  isWord("${w}"): ${isWord}`)
  }

  const iconicChecks = ['1337', '31337', '80085', '43770', 'h4x0r', 'n00b', 'ph34r', 'b4d', '42069']
  for (const l of iconicChecks) {
    const isIconic = await publicClient.readContract({
      address: dictionaryAddr, abi: dictAbi, functionName: 'isIconicLeet', args: [l],
    })
    console.log(`  isIconicLeet("${l}"): ${isIconic}`)
  }

  // =========================================================================
  // Phase 2: Check existing registered names with new renderer
  // =========================================================================
  console.log('\n=== Existing Names (new renderer) ===')
  await checkNames(publicClient, baseRegistrar, baseAbi, EXISTING_NAMES)

  // =========================================================================
  // Phase 3: Register new test names
  // =========================================================================
  console.log('\n=== Registering New Test Names ===')
  const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`
  const duration = BigInt(365 * 24 * 60 * 60)
  const secrets: Record<string, `0x${string}`> = {}

  // Commit phase
  for (const name of NEW_NAMES) {
    const secret = keccak256(toHex(`dict-test-${name}-${Date.now()}`))
    secrets[name] = secret

    try {
      const commitment = await publicClient.readContract({
        address: controller, abi: controllerAbi, functionName: 'makeCommitment',
        args: [{ label: name, owner: account.address, duration, secret, resolver, data: [] as `0x${string}`[], reverseRecord: 0, referrer: ZERO_BYTES32 }],
      }) as `0x${string}`

      const tx = await walletClient.writeContract({
        address: controller, abi: controllerAbi, functionName: 'commit', args: [commitment],
      })
      await publicClient.waitForTransactionReceipt({ hash: tx })
      console.log(`  Committed: ${name}`)
    } catch (e: any) {
      console.log(`  Skip commit ${name}: ${e.message?.slice(0, 60)}`)
    }
  }

  console.log('\nWaiting 90s for commitment age...')
  await new Promise(r => setTimeout(r, 90000))

  // Register phase
  for (const name of NEW_NAMES) {
    if (!secrets[name]) continue
    try {
      const price = await publicClient.readContract({
        address: controller, abi: controllerAbi, functionName: 'rentPrice', args: [name, duration],
      }) as { base: bigint; premium: bigint }
      const totalPrice = price.base + price.premium

      const tx = await walletClient.writeContract({
        address: controller, abi: controllerAbi, functionName: 'register',
        args: [{ label: name, owner: account.address, duration, secret: secrets[name], resolver, data: [] as `0x${string}`[], reverseRecord: 0, referrer: ZERO_BYTES32 }],
        value: totalPrice + totalPrice / 10n,
      })
      await publicClient.waitForTransactionReceipt({ hash: tx })
      console.log(`  Registered: ${name}.etc`)
    } catch (e: any) {
      console.log(`  Failed ${name}: ${e.message?.slice(0, 80)}`)
    }
  }

  // =========================================================================
  // Phase 4: Check all names
  // =========================================================================
  console.log('\n=== All Names After Registration ===')
  await checkNames(publicClient, baseRegistrar, baseAbi, [...EXISTING_NAMES, ...NEW_NAMES])

  console.log('\n=== Test Complete ===')
}

async function checkNames(publicClient: any, baseRegistrar: `0x${string}`, baseAbi: any, names: string[]) {
  console.log('─'.repeat(90))
  console.log(`${'Name'.padEnd(12)} ${'Tier'.padEnd(12)} ${'Class'.padEnd(16)} ${'Fluency'.padEnd(12)} ${'Pattern'.padEnd(12)}`)
  console.log('─'.repeat(90))

  for (const name of names) {
    const tokenId = BigInt(labelhash(name))
    try {
      const tokenURI = await publicClient.readContract({
        address: baseRegistrar, abi: baseAbi, functionName: 'tokenURI', args: [tokenId],
      }) as string

      const jsonBase64 = tokenURI.replace('data:application/json;base64,', '')
      const json = JSON.parse(Buffer.from(jsonBase64, 'base64').toString())

      const attrs: Record<string, any> = {}
      for (const a of json.attributes) attrs[a.trait_type] = a.value

      console.log(`${(name + '.etc').padEnd(12)} ${(attrs['Tier'] || '').padEnd(12)} ${(attrs['Character Class'] || '').padEnd(16)} ${(attrs['Fluency'] || '').padEnd(12)} ${(attrs['Pattern'] || '').padEnd(12)}`)
    } catch {
      console.log(`${(name + '.etc').padEnd(12)} (not registered)`)
    }
  }
}

main().catch(console.error)
