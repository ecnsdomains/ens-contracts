/**
 * Deploy ECNSWordDictionary and populate with word lists.
 * Then deploy new ECNSMetadataRenderer pointing to the dictionary.
 * Finally, hot-swap the renderer on the BaseRegistrar.
 *
 * Usage: source .env && export DEPLOYER_KEY && npx tsx scripts/populate-dictionary.ts
 */
import { createWalletClient, createPublicClient, http, labelhash } from 'viem'
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

const BATCH_SIZE = 50 // words per tx to stay under gas limits

async function main() {
  const privateKey = process.env.DEPLOYER_KEY
  if (!privateKey) throw new Error('DEPLOYER_KEY not set')

  const account = privateKeyToAccount(`0x${privateKey}`)
  const publicClient = createPublicClient({ chain: mordor, transport: http() })
  const walletClient = createWalletClient({ account, chain: mordor, transport: http() })

  // Load deployments
  const deploymentsPath = path.join(__dirname, '../deployments/mordor.json')
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'))
  const baseRegistrar = deployments.contracts.BaseRegistrar as `0x${string}`

  // Load artifacts
  const artifactsDir = path.join(__dirname, '../artifacts/contracts')
  const dictArtifact = JSON.parse(
    fs.readFileSync(path.join(artifactsDir, 'nft/ECNSWordDictionary.sol/ECNSWordDictionary.json'), 'utf8')
  )
  const rendererArtifact = JSON.parse(
    fs.readFileSync(path.join(artifactsDir, 'nft/ECNSMetadataRenderer.sol/ECNSMetadataRenderer.json'), 'utf8')
  )
  const baseAbi = JSON.parse(
    fs.readFileSync(path.join(artifactsDir, 'etcregistrar/BaseRegistrarImplementation.sol/BaseRegistrarImplementation.json'), 'utf8')
  ).abi

  // Load word lists
  const wordsPath = path.join(__dirname, '../config/dictionary-words.json')
  const wordData = JSON.parse(fs.readFileSync(wordsPath, 'utf8'))

  const balance = await publicClient.getBalance({ address: account.address })
  console.log('Deploying from:', account.address)
  console.log('Balance:', Number(balance) / 1e18, 'METC')
  console.log(`Word lists: ${wordData.words.length} words, ${wordData.iconicLeet.length} iconic, ${wordData.blacklist.length} blacklist`)

  // =========================================================================
  // Step 1: Deploy ECNSWordDictionary
  // =========================================================================
  console.log('\n1. Deploying ECNSWordDictionary...')
  const dictHash = await walletClient.deployContract({
    abi: dictArtifact.abi,
    bytecode: dictArtifact.bytecode as `0x${string}`,
  })
  console.log('  Tx:', dictHash)
  const dictReceipt = await publicClient.waitForTransactionReceipt({ hash: dictHash })
  const dictionaryAddr = dictReceipt.contractAddress!
  console.log('  Dictionary deployed at:', dictionaryAddr)

  // =========================================================================
  // Step 2: Populate words in batches
  // =========================================================================
  console.log('\n2. Populating words...')
  await populateBatch(walletClient, publicClient, dictionaryAddr, dictArtifact.abi, 'addWords', wordData.words)

  console.log('\n3. Populating iconic leet...')
  await populateBatch(walletClient, publicClient, dictionaryAddr, dictArtifact.abi, 'addIconicLeet', wordData.iconicLeet)

  console.log('\n4. Populating blacklist...')
  await populateBatch(walletClient, publicClient, dictionaryAddr, dictArtifact.abi, 'addBlacklist', wordData.blacklist)

  // Verify counts
  const wordCount = await publicClient.readContract({
    address: dictionaryAddr,
    abi: dictArtifact.abi,
    functionName: 'wordCount',
  })
  const iconicCount = await publicClient.readContract({
    address: dictionaryAddr,
    abi: dictArtifact.abi,
    functionName: 'iconicLeetCount',
  })
  const blacklistCount = await publicClient.readContract({
    address: dictionaryAddr,
    abi: dictArtifact.abi,
    functionName: 'blacklistCount',
  })
  console.log(`\n  On-chain counts: ${wordCount} words, ${iconicCount} iconic, ${blacklistCount} blacklist`)

  // =========================================================================
  // Step 3: Deploy new ECNSMetadataRenderer with dictionary
  // =========================================================================
  console.log('\n5. Deploying ECNSMetadataRenderer (with dictionary)...')
  const rendererHash = await walletClient.deployContract({
    abi: rendererArtifact.abi,
    bytecode: rendererArtifact.bytecode as `0x${string}`,
    args: [dictionaryAddr],
  })
  console.log('  Tx:', rendererHash)
  const rendererReceipt = await publicClient.waitForTransactionReceipt({ hash: rendererHash })
  const rendererAddr = rendererReceipt.contractAddress!
  console.log('  Renderer deployed at:', rendererAddr)

  // =========================================================================
  // Step 4: Hot-swap renderer on BaseRegistrar
  // =========================================================================
  console.log('\n6. Swapping renderer on BaseRegistrar...')
  const swapHash = await walletClient.writeContract({
    address: baseRegistrar,
    abi: baseAbi,
    functionName: 'setMetadataRenderer',
    args: [rendererAddr],
  })
  await publicClient.waitForTransactionReceipt({ hash: swapHash })
  console.log('  Renderer swapped!')

  // =========================================================================
  // Step 5: Update mordor.json
  // =========================================================================
  deployments.contracts.ECNSMetadataRenderer = rendererAddr
  deployments.contracts.ECNSWordDictionary = dictionaryAddr
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2))
  console.log('\n7. Updated mordor.json')

  // =========================================================================
  // Step 6: Quick verification
  // =========================================================================
  console.log('\n=== Verification ===')
  const testWords = ['leet', 'hacker', 'noob', 'hello', 'strong', 'pwned', 'haxor', 'eleet']
  for (const word of testWords) {
    const isWord = await publicClient.readContract({
      address: dictionaryAddr,
      abi: dictArtifact.abi,
      functionName: 'isWord',
      args: [word],
    })
    console.log(`  isWord("${word}"): ${isWord}`)
  }

  const testIconic = ['1337', '31337', '80085', 'h4x0r', '43770']
  for (const label of testIconic) {
    const isIconic = await publicClient.readContract({
      address: dictionaryAddr,
      abi: dictArtifact.abi,
      functionName: 'isIconicLeet',
      args: [label],
    })
    console.log(`  isIconicLeet("${label}"): ${isIconic}`)
  }

  // Test tokenURI for existing names
  console.log('\n=== Token URI Test ===')
  const testNames = ['alice', 'h4x0r', 'n00b']
  for (const name of testNames) {
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
      for (const a of json.attributes) attrs[a.trait_type] = a.value

      console.log(`  ${name}.etc → Tier: ${attrs['Tier']}, Class: ${attrs['Character Class']}, Fluency: ${attrs['Fluency']}`)
    } catch (e: any) {
      console.log(`  ${name}.etc → ${e.message?.slice(0, 60)}`)
    }
  }

  console.log('\n=== Done! ===')
  console.log('ECNSWordDictionary:', dictionaryAddr)
  console.log('ECNSMetadataRenderer:', rendererAddr)
}

async function populateBatch(
  walletClient: any,
  publicClient: any,
  contractAddr: `0x${string}`,
  abi: any,
  functionName: string,
  words: string[]
) {
  const totalBatches = Math.ceil(words.length / BATCH_SIZE)
  for (let i = 0; i < words.length; i += BATCH_SIZE) {
    const batch = words.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    try {
      const tx = await walletClient.writeContract({
        address: contractAddr,
        abi,
        functionName,
        args: [batch],
      })
      await publicClient.waitForTransactionReceipt({ hash: tx })
      process.stdout.write(`  Batch ${batchNum}/${totalBatches} (${batch.length} words)\r`)
    } catch (e: any) {
      console.log(`\n  Batch ${batchNum} failed: ${e.message?.slice(0, 80)}`)
    }
  }
  console.log(`  Done: ${words.length} words in ${totalBatches} batches`)
}

main().catch(console.error)
