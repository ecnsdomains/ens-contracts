/**
 * Deploy new ECNSMetadataRenderer and hot-swap it on BaseRegistrar.
 * Then test tokenURI on existing registered names.
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
  const rendererArtifact = JSON.parse(
    fs.readFileSync(path.join(artifactsDir, 'nft/ECNSMetadataRenderer.sol/ECNSMetadataRenderer.json'), 'utf8')
  )
  const baseAbi = JSON.parse(
    fs.readFileSync(path.join(artifactsDir, 'etcregistrar/BaseRegistrarImplementation.sol/BaseRegistrarImplementation.json'), 'utf8')
  ).abi

  console.log('Deploying from:', account.address)
  console.log('BaseRegistrar:', baseRegistrar)
  console.log('Old renderer:', deployments.contracts.ECNSMetadataRenderer)

  // 1. Deploy new ECNSMetadataRenderer
  console.log('\n1. Deploying new ECNSMetadataRenderer...')
  const deployHash = await walletClient.deployContract({
    abi: rendererArtifact.abi,
    bytecode: rendererArtifact.bytecode as `0x${string}`,
  })
  console.log('  Tx:', deployHash)
  const receipt = await publicClient.waitForTransactionReceipt({ hash: deployHash })
  const newRenderer = receipt.contractAddress!
  console.log('  New renderer:', newRenderer)

  // 2. Hot-swap renderer on BaseRegistrar
  console.log('\n2. Calling setMetadataRenderer...')
  const swapHash = await walletClient.writeContract({
    address: baseRegistrar,
    abi: baseAbi,
    functionName: 'setMetadataRenderer',
    args: [newRenderer],
  })
  console.log('  Tx:', swapHash)
  await publicClient.waitForTransactionReceipt({ hash: swapHash })
  console.log('  Renderer swapped!')

  // 3. Update mordor.json
  deployments.contracts.ECNSMetadataRenderer = newRenderer
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2))
  console.log('\n3. Updated mordor.json')

  // 4. Test existing registered names
  const testNames = process.argv.slice(2)
  if (testNames.length === 0) {
    testNames.push('holographic') // default
  }

  console.log('\n=== Testing tokenURI ===')
  for (const name of testNames) {
    const tokenId = BigInt(labelhash(name))
    console.log(`\n--- ${name}.etc (tokenId: ${tokenId.toString().slice(0, 20)}...) ---`)

    try {
      const tokenURI = await publicClient.readContract({
        address: baseRegistrar,
        abi: baseAbi,
        functionName: 'tokenURI',
        args: [tokenId],
      }) as string

      // Decode the data URI
      const jsonBase64 = tokenURI.replace('data:application/json;base64,', '')
      const json = JSON.parse(Buffer.from(jsonBase64, 'base64').toString())

      console.log('Name:', json.name)
      console.log('Attributes:')
      for (const attr of json.attributes) {
        if (attr.display_type === 'number') {
          console.log(`  ${attr.trait_type}: ${attr.value}`)
        } else if (attr.display_type === 'date') {
          console.log(`  ${attr.trait_type}: ${new Date(attr.value * 1000).toISOString()}`)
        } else {
          console.log(`  ${attr.trait_type}: ${attr.value}`)
        }
      }

      // Save SVG
      const svgBase64 = json.image.replace('data:image/svg+xml;base64,', '')
      const svg = Buffer.from(svgBase64, 'base64').toString()
      const svgPath = path.join(__dirname, `../svg-prototype/test-output-${name}.svg`)
      fs.writeFileSync(svgPath, svg)
      console.log(`SVG saved: ${svgPath}`)
    } catch (e: any) {
      console.log(`  Error: ${e.message?.slice(0, 100)}`)
    }
  }

  console.log('\n=== Done! ===')
  console.log('New ECNSMetadataRenderer:', newRenderer)
}

main().catch(console.error)
